import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as metadata from "../src/engine/connectorRelationshipMetadata.js";
import { buildLedSurfaceConnectionIndex } from "../src/engine/ledSurfaceModel.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { ledProjectLoadingFixture } from "../fixtures/led-project-loading.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = name => {
  const result = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
  assert.ok(result, name); return result[0];
};

test("90 LED endpoints use real metadata resolution once per source device and indexed coordinates thereafter", () => {
  const project = ledProjectLoadingFixture(), before = structuredClone(project);
  let normalizations = 0, lookups = 0;
  const ctx = vm.createContext({state:project, deviceEditorPlacementModule:{...metadata,
    normalizeConnectorRelationshipMetadata(...args) { normalizations++; return metadata.normalizeConnectorRelationshipMetadata(...args); }} });
  // These are the real production functions, including generated-card guards.
  for (const name of ["templateForInstance", "instanceById", "relationshipMetadataApi", "generatedCardConnectors",
    "generatedCardRelationships", "effectiveTemplateConnectors", "effectiveTemplateConnectorRelationships",
    "resolvedInstanceConnectorModel", "connectorById", "resolvedConnectorForInstance"]) vm.runInContext(source(name), ctx);
  const resolved = new Map();
  const index = buildLedSurfaceConnectionIndex(project.connections, project.ledSurfaces, (deviceId, connectorId) => {
    lookups++;
    if (!resolved.has(deviceId)) resolved.set(deviceId, new Map(ctx.resolvedInstanceConnectorModel(ctx.instanceById(deviceId)).connectors.map(c => [c.id,c])));
    return resolved.get(deviceId).get(connectorId);
  });
  assert.equal(lookups,90); assert.equal(resolved.size,6); assert.equal(normalizations,12);
  assert.equal(index.get("wall-0").connections.length,82); assert.equal(index.get("wall-1").connections.length,8);
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project));
  ctx.activeEngineBridge = () => ({scene}); ctx.ledSurfaceById = id => project.ledSurfaces.find(s => s.id === id);
  vm.runInContext(source("pointForLedSurface"), ctx);
  vm.runInContext(source("connectionsForLedSurface"), ctx);
  const cached = scene.ledSurfaceWireLayout("wall-0");
  const count = normalizations;
  for (let repeat = 0; repeat < 10; repeat++) for (const s of project.ledSurfaces) {
    const order = index.get(s.id).connections;
    order.forEach((w,i) => assert.deepEqual({...ctx.pointForLedSurface(s.id,w.connection)}, {x:s.x,y:s.y+s.height*((i+.5)/order.length)}));
  }
  assert.equal(scene.ledSurfaceWireLayout("wall-0"),cached);
  assert.equal(normalizations,count,"endpoints perform no metadata normalization");
  assert.deepEqual(project,before,"drawing does not mutate project definitions or ordering");
});

test("explicit per-wire landing order survives save, rewire and reload across processors", () => {
  const project = ledProjectLoadingFixture();
  const normalized = normalizeAvDesignerProject(project), scene = new SceneGraph(); scene.setData(normalized);
  const mutations = new ProjectMutationAdapter(normalized);
  const initial = scene.ledSurfaceWireLayout("wall-0");
  const wire = scene.addWire({fromDeviceId:"device-0",fromConnectorId:"port-0",toSurfaceId:"wall-0",cableType:"led-signal",signalIndex:1});
  mutations.commitCreatedWire(scene,wire);
  assert.notEqual(scene.ledSurfaceWireLayout("wall-0"),initial);
  assert.equal(scene.orderedLedSurfaceWires("wall-0").at(-1).id,wire.id);
  mutations.persistLedSurfaceIndexes(scene);
  const saved = JSON.parse(JSON.stringify(mutations.project));
  const reloaded = new SceneGraph(); reloaded.setData(normalizeAvDesignerProject(saved));
  assert.deepEqual(reloaded.orderedLedSurfaceWires("wall-0").map(w=>w.id),scene.orderedLedSurfaceWires("wall-0").map(w=>w.id));
  const before = structuredClone(wire);
  scene.rewireWireEndpoint(wire.id,"to","wall-1","");
  assert.equal(scene.orderedLedSurfaceWires("wall-0").length,82);
  assert.equal(scene.orderedLedSurfaceWires("wall-1").length,9);
  scene.applyWireState(wire.id,before);
  assert.equal(scene.orderedLedSurfaceWires("wall-0").length,83);
  assert.equal(scene.orderedLedSurfaceWires("wall-1").length,8);
  const removed=scene.deleteWire(wire.id); scene.insertWire(removed);
  assert.equal(scene.orderedLedSurfaceWires("wall-0").at(-1).id,wire.id);
});

test("missing processor metadata derives original ranks once without mutating the source", () => {
  const surfaces = [{id:"wall"}];
  const connections = ["main", "backup"].flatMap(deviceId => [1,2,3,4].map(signalIndex => ({
    id:`${deviceId}-${signalIndex}`, from:{deviceId,connectorId:`signal-${signalIndex}`},
    to:{surfaceId:"wall"}, cableType:"led-signal",signalIndex
  })));
  const before = structuredClone({surfaces,connections});
  const index = buildLedSurfaceConnectionIndex(connections,surfaces);
  assert.deepEqual(index.get("wall").connections.map(c=>c.id),connections.map(c=>c.id));
  assert.deepEqual({surfaces,connections},before);
  connections.forEach((c,i)=>{c.to.portIndex=7-i;});
  assert.deepEqual(buildLedSurfaceConnectionIndex(connections,surfaces).get("wall").connections.map(c=>c.id),connections.map(c=>c.id).reverse());
});

test("partial explicit indexes append missing entries without reclaiming gapped indexes", () => {
  const connections = [
    {id:"a",from:{deviceId:"p"},to:{surfaceId:"wall",portIndex:10}},
    {id:"b",fromSurfaceId:"wall",fromPortIndex:20,toDeviceId:"p"},
    {id:"c",from:{deviceId:"p"},to:{surfaceId:"wall"}}
  ];
  const index=buildLedSurfaceConnectionIndex(connections,[{id:"wall"}]).get("wall");
  assert.deepEqual([...index.rankById],[ ["a",10],["b",20],["c",21] ]);
});

test("initial ordering retains signal indexes stored on source endpoints", () => {
  const wires=[3,1,2].map((signalIndex,i)=>({id:`wire-${i}`,cableType:"led-signal",
    from:{deviceId:"processor",connectorId:`signal-${signalIndex}`,signalIndex},to:{surfaceId:"wall"}}));
  const index=buildLedSurfaceConnectionIndex(wires,[{id:"wall"}]).get("wall");
  assert.deepEqual(index.connections.map(w=>w.id),["wire-1","wire-2","wire-0"]);
});

test("connector edits retain explicit ordering; relationship/project replacement invalidates indexes", () => {
  const normalized=normalizeAvDesignerProject(ledProjectLoadingFixture());
  const scene=new SceneGraph();scene.setData(normalized);
  const order=()=>scene.orderedLedSurfaceWires("wall-0").map(w=>w.id);
  const before=order(),cached=scene.ledSurfaceWireLayout("wall-0");
  scene.updateConnector("device-0","port-0",{signalIndex:99,nameText:"Changed"});
  assert.equal(scene.ledSurfaceWireLayout("wall-0"),cached,"connector metadata does not own explicit wire order");
  assert.deepEqual(order(),before);
  const device=normalized.devices.find(d=>d.id==="device-0");
  scene.replaceDevice({...device,connectorRelationships:[]});
  assert.notEqual(scene.ledSurfaceWireLayout("wall-0"),cached);
  assert.deepEqual(order(),before);
  const wire=scene.getWire(before[0]),oldIndex=wire.toPortIndex;
  scene.applyWireState(wire.id,{toPortIndex:100});
  assert.equal(order().at(-1),wire.id);
  scene.applyWireState(wire.id,{toPortIndex:oldIndex});assert.deepEqual(order(),before);
  scene.setData(normalized);assert.deepEqual(order(),before);
});

test("retired URL flags cannot activate another canvas; shell and deferred Fit do not draw SVG", () => {
  let shell=0,fit=0;
  const ctx=vm.createContext({renderShellUi(){shell++;},activeEngineBridge:()=>({fitView(){fit++;}}),cancelSvgDetailRefresh(){}});
  for(const name of ["engineEditorRequestedByUrl","render","renderCanvasOnly","zoomToFit"]) vm.runInContext(source(name),ctx);
  for(const search of ["","?legacy=1","?engine=0","?engine=false&debugRuntime=1"]) {
    ctx.window={location:{search}};assert.equal(ctx.engineEditorRequestedByUrl(),true);
  }
  ctx.render(); ctx.renderCanvasOnly(); ctx.renderCanvasOnly({lightweight:true}); ctx.zoomToFit();
  assert.equal(shell,2); assert.equal(fit,1);
  assert.doesNotMatch(html,/id="engineBetaToggle"|Reload Legacy Editor|switchEngineEditorMode|showEngineFailureFallback/);
  assert.doesNotMatch(html,/function (?:scheduleSvgDetailRefresh|renderRetiredSvgCanvas|renderDevices|renderWires)\(|id="(?:canvas|webglCanvas|deviceTextureCanvas|navigationSnapshotCanvas)"/);
});

test("shared wire editing syncs Engine without retired renderer caches", () => {
  const a = { id: "a", from: "moved", to: "fixed" }, b = { id: "b", from: "other", to: "fixed" };
  const synced = [], repaired = [];
  let shell = 0;
  const ctx = vm.createContext({ state: { connections: [a, b], wireMode: "orthogonal" },
    syncEngineWireFromProduction: wire => synced.push(wire.id), renderShellUi: () => shell++,
    selectionMoveKey: selection => selection.id, endpointMoveKey: endpoint => endpoint,
    repairOrthogonalRouteForMovedEndpoint: wire => repaired.push(wire.id) });
  for (const name of ["syncWireChange", "repairOrthogonalRoutesForMovedSelections"]) vm.runInContext(source(name), ctx);
  ctx.syncWireChange("a"); ctx.syncWireChange(["b", "missing", null]);
  assert.deepEqual(synced, ["a", "b"]); assert.equal(shell, 2);
  ctx.repairOrthogonalRoutesForMovedSelections([{ id: "moved" }]);
  assert.deepEqual(repaired, ["a"]);
  ctx.state.wireMode = "bezier";
  ctx.repairOrthogonalRoutesForMovedSelections([{ id: "other" }]);
  assert.deepEqual(repaired, ["a"]);
  assert.doesNotMatch(source("startEditorNodeDrag"), /startEditorFaceplateMarquee/,
    "Engine faceplate clicks cannot call the retired secondary-preview marquee");
});
