import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as jump from "../src/engine/jumpNodeModel.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputCableTrace } from "../src/engine/outputViewerModel.js";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";

const link = { id: "portal", outputJumpId: "a", inputJumpId: "b" };
function sceneFor(project) { const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project)); return scene; }
const pair = scene => jump.jumpPairCompatibility(scene, "a", "b", { compatibilitySummary: engineCompatibilitySummary });

for (const alias of ["io", "bidirectional", "bi-directional", "two-way", "twoway", "both"]) {
  test(`bidirectional role alias ${alias}`, () => {
    assert.equal(jump.normalizeJumpNodeDirection(alias), "bidirectional");
    const project = bidirectionalJumpFixture();
    project.devices[0].templateOverride.connectors[0].direction = alias;
    delete project.devices[0].templateOverride.connectors[0].signalDirection;
    assert.equal(jump.rawJumpNodeRole(project, "a").baseRole, "bidirectional");
    assert.equal(sceneFor(project).jumpNodeRole("a").baseRole, "bidirectional");
  });
}
test("V2 signal direction takes precedence; unknown and disconnected stay neutral", () => {
  const project = bidirectionalJumpFixture();
  const c = project.devices[0].templateOverride.connectors[0];
  c.direction = "input";
  assert.equal(jump.rawJumpNodeRole(project, "a").role, "bidirectional");
  for (const direction of [undefined, "unknown"]) {
    c.direction = direction; delete c.signalDirection;
    assert.equal(jump.rawJumpNodeRole(project, "a").role, "neutral");
    assert.equal(sceneFor(project).jumpNodeRole("a").role, "neutral");
  }
  assert.equal(sceneFor(project).jumpNodeRole("neutral").role, "neutral");
});

const roles = ["output", "input", "bidirectional", "neutral"];
for (const first of roles) for (const second of roles) test(`pair matrix ${first} -> ${second}`, () => {
  const project = bidirectionalJumpFixture(first, second);
  const scene = sceneFor(project);
  const result = pair(scene);
  const valid = first !== "neutral" && second !== "neutral" && (first !== second || first === "bidirectional");
  assert.equal(result.valid, valid);
  if (valid) {
    const output = first === "output" || second === "input" || first === second ? "a" : "b";
    assert.equal(result.outputJumpId, output);
    assert.equal(result.inputJumpId, output === "a" ? "b" : "a");
  }
});

test("base/effective roles, visual refresh, deletion, restore and immutable wire orientation", () => {
  const project = bidirectionalJumpFixture(), scene = sceneFor(project), before = JSON.stringify(project.connections);
  assert.equal(scene.jumpNodeRole("a").role, "bidirectional");
  assert.notEqual(scene.getDevice("a").visual.jumpColor, jump.JUMP_NODE_ROLE_COLORS.neutral);
  scene.addJumpLink(link);
  for (const [id, effective] of [["a", "output"], ["b", "input"]]) {
    assert.equal(scene.jumpNodeRole(id).baseRole, "bidirectional");
    assert.equal(scene.jumpNodeRole(id).role, effective);
    assert.equal(scene.getDevice(id).visual.jumpRole, effective);
    assert.equal(scene.getDevice(id).visual.jumpBaseRole, "bidirectional");
    assert.equal(scene.getDevice(id).visual.jumpColor, jump.jumpNodeRoleColor(effective));
  }
  assert.deepEqual(jump.invalidJumpLinksForScene(scene), []);
  assert.equal(scene.jumpNodeConnectionInfo("b").prefix, "from");
  scene.deleteJumpLink(link.id);
  assert.equal(scene.getDevice("b").visual.jumpRole, "bidirectional");
  scene.insertJumpLink(link);
  assert.equal(scene.getDevice("b").visual.jumpRole, "input");
  project.jumpLinks = [link];
  assert.deepEqual(jump.validateJumpLinks(project).warnings, []);
  assert.equal(jump.rawJumpNodeRole(project, "b").baseRole, "bidirectional");
  assert.equal(jump.rawJumpNodeRole(project, "b").role, "input");
  assert.equal(sceneFor(JSON.parse(JSON.stringify(project))).getDevice("b").visual.jumpRole, "input");
  const steps = jump.resolvePlayableSignalPath({ project, startingWireId: "wire-b" });
  assert.deepEqual(steps.map(s => s.type), ["wire", "teleport", "wire"]);
  assert.equal(steps[0].reverse, false); assert.equal(steps[2].reverse, true);
  assert.equal(JSON.stringify(project.connections), before);
});

test("saved orientation cannot conceal incompatible base direction or missing local wire", () => {
  const project = bidirectionalJumpFixture(); project.jumpLinks = [link];
  const scene = sceneFor(project);
  Object.assign(scene.getConnector("source", "port"), { direction: "input", signalDirection: "input" });
  assert.equal(scene.jumpNodeRole("a").baseRole, "input");
  assert.equal(jump.invalidJumpLinksForScene(scene).length, 1);
  Object.assign(project.devices[0].templateOverride.connectors[0], { direction: "input", signalDirection: "input" });
  assert.equal(jump.validateJumpLinks(project).valid, false);
  scene.removeInvalidJumpLinksForJumps(["a"]);
  assert.equal(scene.getDevice("b").visual.jumpRole, "bidirectional");
  const clean = sceneFor(bidirectionalJumpFixture()); clean.addJumpLink(link); clean.deleteWire("wire-a");
  clean.removeInvalidJumpLinksForJumps(["a"]);
  assert.equal(clean.getDevice("a").visual.jumpRole, "neutral");
  assert.equal(clean.getDevice("b").visual.jumpRole, "bidirectional");
});

for (const issue of ["family", "fiber", "not-working", "module", "paired", "self"]) test(`reject ${issue} using real connectors`, () => {
  const scene = sceneFor(bidirectionalJumpFixture());
  const a = scene.getConnector("source", "port"), b = scene.getConnector("destination", "port");
  if (issue === "family") b.type = "sdi";
  if (issue === "fiber") { Object.assign(a, { type: "fiber-lc", fiberMode: "single-mode" }); Object.assign(b, { type: "fiber-lc", fiberMode: "om4" }); }
  if (issue === "not-working") b.operationalStatus = "not-working";
  if (issue === "module") { a.type = "sfp-cage"; b.type = "sfp-cage"; }
  if (issue === "paired") scene.addJumpLink({ ...link, outputJumpId: "out-2" });
  const result = issue === "self" ? jump.jumpPairCompatibility(scene, "a", "a") : pair(scene);
  assert.equal(result.valid, false);
});

for (const [first, second, output] of [["bidirectional", "bidirectional", "a"], ["bidirectional", "output", "b"], ["input", "bidirectional", "b"], ["output", "input", "a"]]) {
  test(`legacy pairId ${first}/${second} has stable complementary orientation`, () => {
    const project = bidirectionalJumpFixture(first, second);
    project.jumpNodes[0].pairId = project.jumpNodes[1].pairId = "older-pair";
    const derived = jump.deriveLegacyPairJumpLinks(project);
    assert.equal(derived.length, 1); assert.equal(derived[0].outputJumpId, output);
    assert.deepEqual(sceneFor(project).jumpLinks, derived);
    assert.deepEqual(jump.resolvePlayableSignalPath({ project, startingWireId: "wire-a" }).map(s => s.type), ["wire", "teleport", "wire"]);
  });
}

test("canonical Engine scene and read-only viewer retain valid portals and reversed cable segment", () => {
  const project = bidirectionalJumpFixture(); project.jumpLinks = [link];
  const snapshot = buildEngineOutputScene(project);
  assert.equal(snapshot.jumpLinks.length, 1);
  assert.deepEqual(jump.validateJumpLinks(project).warnings, []);
  const model = createOutputViewerModel(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(model.scene.getDevice("b").visual.jumpRole, "input");
  assert.equal(model.scene.getDevice("b").visual.jumpBaseRole, "bidirectional");
  const trace = outputCableTrace(model, { type: "wire", id: "wire-a" });
  assert.deepEqual(trace.map(s => s.id), ["wire-a", "portal", "wire-b"]);
  assert.deepEqual(trace[2].points, [...snapshot.wires.find(w => w.id === "wire-b").renderPolyline].reverse());
});

test("connector updates and endpoint rewires refresh base roles through the cleanup lifecycle", () => {
  const scene = sceneFor(bidirectionalJumpFixture());
  scene.addJumpLink(link);
  scene.updateConnector("source", "port", { direction: "input", signalDirection: "input" });
  assert.equal(scene.getDevice("a").visual.jumpBaseRole, "input");
  assert.equal(scene.getDevice("a").visual.jumpRole, "output");
  assert.equal(scene.removeInvalidJumpLinksForJumps(["a"]).length, 1);
  assert.equal(scene.getDevice("a").visual.jumpRole, "input");
  assert.equal(scene.getDevice("b").visual.jumpRole, "bidirectional");
  scene.updateConnector("source", "port", { direction: "io", signalDirection: "bidirectional" });
  scene.addJumpLink(link);
  scene.rewireWireEndpoint("wire-a", "from", "source-2", "port");
  assert.equal(scene.getDevice("a").visual.jumpBaseRole, "output");
  assert.equal(scene.removeInvalidJumpLinksForJumps(["a"]).length, 0);
  scene.rewireWireEndpoint("wire-a", "from", "destination-2", "port");
  assert.equal(scene.getDevice("a").visual.jumpBaseRole, "input");
  assert.equal(scene.removeInvalidJumpLinksForJumps(["a"]).length, 1);
  assert.equal(scene.getDevice("b").visual.jumpRole, "bidirectional");
});

test("library-backed V2 connectors validate using the same resolved connectors as the live scene", () => {
  const project = bidirectionalJumpFixture();
  project.deviceLibrary = project.devices.map(d => d.templateOverride);
  project.devices.forEach(d => { d.templateId = d.templateOverride.id; delete d.templateOverride; });
  project.jumpLinks = [link];
  const scene = sceneFor(project);
  assert.deepEqual(jump.validateJumpLinks(project, { getConnector: e => scene.getConnector(e.deviceId, e.connectorId) }).warnings, []);
  assert.deepEqual(normalizeAvDesignerProject(project).meta.jumpLinkWarnings, []);
});

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function legacyHarness(project) {
  const context = vm.createContext({ state: project, jumpGestureModule: jump, jumpCompatibilityModule: {},
    connectorById: (id, port) => project.devices.find(d => d.instanceId === id)?.templateOverride.connectors.find(c => c.id === port),
    jumpNodeById: id => project.jumpNodes.find(n => n.id === id) });
  for (const name of ["normalizeJumpRole", "jumpConnectorRole", "jumpPairOrientation", "jumpRoleColor",
    "connectionForJumpNode", "jumpNodeBaseRole", "jumpLinkForJumpNode", "jumpNodeRole", "pruneInvalidJumpLinks", "legacyJumpLinkStartStatus"]) {
    const start = html.indexOf(`    function ${name}(`);
    assert.ok(start >= 0);
    vm.runInContext(html.slice(start, html.indexOf("\n    function ", start + 1)), context);
  }
  return context;
}
test("Legacy uses the same aliases and complete pair matrix as Engine", () => {
  const legacy = legacyHarness(bidirectionalJumpFixture());
  for (const alias of ["io", "bidirectional", "bi-directional", "two-way", "twoway", "both", "unknown", ""]) {
    assert.equal(legacy.jumpConnectorRole({ direction: alias }), jump.jumpConnectorBaseRole({ direction: alias }));
  }
  for (const first of roles) for (const second of roles) {
    assert.equal(JSON.stringify(legacy.jumpPairOrientation("a", first, "b", second)), JSON.stringify(jump.orientJumpPair("a", first, "b", second)));
  }
  assert.equal(legacy.legacyJumpLinkStartStatus("a").valid, true);
  assert.equal(legacy.legacyJumpLinkStartStatus("neutral").valid, false);
});
test("Legacy link cleanup uses base roles after direction changes, rewire and local-wire deletion", () => {
  for (const change of ["direction", "rewire", "delete"]) {
    const project = bidirectionalJumpFixture(); project.jumpLinks = [link];
    const legacy = legacyHarness(project);
    assert.equal(legacy.jumpNodeRole("a").baseRole, "bidirectional");
    assert.equal(legacy.jumpNodeRole("a").role, "output");
    assert.equal(legacy.pruneInvalidJumpLinks().length, 0);
    if (change === "direction") Object.assign(project.devices[0].templateOverride.connectors[0], { direction: "input", signalDirection: "input" });
    if (change === "rewire") project.connections[0].from.deviceId = "destination-2";
    if (change === "delete") project.connections.splice(0, 1);
    assert.equal(legacy.pruneInvalidJumpLinks().length, 1);
    assert.equal(legacy.jumpNodeRole("a").role, change === "delete" ? "neutral" : "input");
    assert.equal(legacy.jumpNodeRole("b").role, "bidirectional");
    assert.equal(legacy.jumpNodeRole("b").color, jump.JUMP_NODE_ROLE_COLORS.bidirectional);
  }
});
test("Legacy pairId inference is independent of the queried endpoint and accepts bidirectional peers", () => {
  for (const [first, second] of [["bidirectional", "bidirectional"], ["input", "bidirectional"], ["bidirectional", "output"]]) {
    const project = bidirectionalJumpFixture(first, second);
    project.jumpNodes[0].pairId = project.jumpNodes[1].pairId = "old";
    const legacy = legacyHarness(project);
    const expected = jump.deriveLegacyPairJumpLinks(project)[0];
    for (const id of ["b", "a"]) {
      assert.equal(legacy.jumpLinkForJumpNode(id).outputJumpId, expected.outputJumpId);
      assert.equal(legacy.jumpLinkForJumpNode(id).inputJumpId, expected.inputJumpId);
    }
  }
});
