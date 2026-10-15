import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { normalizeLoom } from "../src/engine/loomModel.js";
import { loomTrunkPoints } from "../src/engine/loomGeometry.js";
import * as jump from "../src/engine/jumpNodeModel.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { jumpNodeStatusDotColor } from "../src/engine/renderer.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";

function projectFor(routeStyle, corners = []) {
  const loom = normalizeLoom({ id: "loom-1", name: "LM-001", routeStyle,
    sideA: { x: 100, y: 100 }, sideB: { x: 600, y: 350 },
    routePoints: [...corners, { x: 600, y: 350 }] });
  loom.jumpRouting = { usageMode: "loom", entryJumpId: "a", exitJumpId: "",
    entryAnchorId: loom.routePoints.at(-1).id, continuationComplete: false };
  return { devices: [], connections: [], jumpNodes: [{ id: "a", x: 600, y: 350 }, { id: "b", x: 900, y: 120 }],
    jumpLinks: [], looms: [loom] };
}
const sceneFor = project => { const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project)); return scene; };
for (const routeStyle of ["bezier", "orthogonal"]) for (const corners of [[], [{ x: 240, y: 100 }],
  [{ x: 240, y: 100 }, { x: 240, y: 250 }]]) {
  test(`${routeStyle}: ${corners.length} authored corners survive attachment, continuation and reload exactly`, () => {
    const project = projectFor(routeStyle, corners), saved = structuredClone(project.looms[0]);
    const expected = loomTrunkPoints({ ...saved, routePoints: saved.routePoints.slice(0, -1) });
    assert.deepEqual(sceneFor(project).loomPlans[0].visibleTrunkSections[0], expected);
    project.jumpLinks = [{ id: "pair", outputJumpId: "b", inputJumpId: "a", deviceIndependent: true }];
    const waiting = sceneFor(project);
    assert.deepEqual(waiting.loomPlans[0].visibleTrunkSections[0], expected);
    project.looms[0].routePoints.push({ id: "lrp-20", x: 1000, y: 220 });
    project.looms[0].sideB = { x: 1200, y: 400 };
    project.looms[0].jumpRouting.continuationComplete = true;
    const complete = sceneFor(JSON.parse(JSON.stringify(project)));
    assert.deepEqual(complete.loomPlans[0].visibleTrunkSections[0], expected,
      "controls beyond the Jump gap cannot alter the first section's tangents or elbows");
    assert.deepEqual(project.looms[0].routePoints.slice(0, saved.routePoints.length), saved.routePoints);
    assert.equal(project.looms[0].routeStyle, routeStyle);
    if (routeStyle === "orthogonal") for (const section of complete.loomPlans[0].visibleTrunkSections) {
      for (let i = 1; i < section.length; i++) assert.ok(section[i].x === section[i - 1].x || section[i].y === section[i - 1].y);
    }
    const output = createOutputViewerModel(buildEngineOutputScene(project));
    assert.deepEqual(output.scene.loomPlans[0].visibleTrunkSections, complete.loomPlans[0].visibleTrunkSections);
    for (const scene of [complete, output.scene]) {
      assert.equal(scene.getDevice("a").visual.jumpColor, jump.JUMP_NODE_ROLE_COLORS.output);
      assert.equal(scene.getDevice("b").visual.jumpColor, jump.JUMP_NODE_ROLE_COLORS.input);
      assert.equal(jumpNodeStatusDotColor(scene.getDevice("a")), "");
      assert.equal(jump.jumpNodeRenderRadius(scene.getDevice("a")), 52.8);
    }
    assert.deepEqual(project.connections, []);
  });
}

test("Loom occupancy is red only while unpaired; ordinary empty pairs remain purple", () => {
  const project = projectFor("bezier");
  let scene = sceneFor(project);
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("a")), "#ef4444");
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("b")), "");
  project.jumpLinks = [{ id: "pair", outputJumpId: "b", inputJumpId: "a", deviceIndependent: true }];
  scene = sceneFor(project);
  assert.equal(scene.getDevice("a").visual.jumpColor, "#32b6ff");
  assert.equal(scene.getDevice("b").visual.jumpColor, "#fb7904");
  project.looms = []; scene = sceneFor(project);
  assert.deepEqual(scene.devices.filter(node => node.kind === "jump").map(jumpNodeStatusDotColor), ["#a855f7", "#a855f7"]);
});

const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
function method(name) {
  const start = source.indexOf(`\n  ${name}(`), tail = source.slice(start + 1);
  assert.ok(start >= 0, name);
  return tail.slice(0, tail.slice(1).search(/\n  (?:async )?[a-zA-Z]\w*\(/) + 1);
}
function pairHarness(reverse = false, fail = false) {
  const project = projectFor("orthogonal", [{ x: 240, y: 100 }]), scene = sceneFor(project), events = [];
  const context = { ...jump, engineCompatibilitySummary, createJumpLinkCommand: link => ({ type: "CreateJumpLinkCommand", link }) };
  const methods = ["completeJumpLinkCreate", "currentJumpLinkCompatibilityFromState", "currentJumpLinkCompatibility", "beginLoomContinuation"];
  const bridge = vm.runInNewContext(`({${methods.map(method).join(",\n")}})`, context);
  Object.assign(bridge, { scene, api: { setJumpNodeToolActive() {} },
    mutations: new ProjectMutationAdapter({ projectData: project }, { cloneProjectData: false }),
    jumpLinkCreate: { fromJumpId: reverse ? "b" : "a", target: { device: scene.getDevice(reverse ? "a" : "b") },
      pointerWorld: { x: reverse ? 600 : 900, y: reverse ? 350 : 120 } },
    canvas: { classList: { remove() {} } }, hud: { setMetric() {} },
    uniqueJumpLinkId: () => "new-pair", clearJumpMoveArm() {}, clearHoverState() {}, updateCanvasCursor() {},
    updateInteractionHud() {}, beginProductionCommit() {}, refreshJumpNodeVisuals() {},
    refreshLoomComposition: () => scene.rebuildLoomGeometry(), updateSelectionHud() {},
    recordCommand: () => events.push("history"), markCommitted: () => events.push("committed"),
    scheduleRender: () => events.push("render") });
  if (fail) bridge.currentJumpLinkCompatibilityFromState = () => ({ valid: false });
  return { bridge, project, events };
}
for (const reverse of [false, true]) test(`pair commit auto-resumes from owner partner, reverse gesture=${reverse}`, () => {
  const { bridge, project, events } = pairHarness(reverse);
  bridge.completeJumpLinkCreate();
  assert.equal(project.jumpLinks.length, 1);
  assert.equal(bridge.loomCreate.resumeLoomId, "loom-1");
  assert.equal(bridge.loomCreate.sideA.x, 900); assert.equal(bridge.loomCreate.sideA.y, 120);
  assert.equal(bridge.loomCreate.pointerWorld.x, reverse ? 600 : 900);
  assert.deepEqual(Array.from(bridge.loomCreate.routePoints), []);
  assert.equal(bridge.loomCreate.awaitingPointerDown, true);
  assert.equal(events.filter(item => item === "history").length, 1);
  assert.ok(events.indexOf("committed") < events.indexOf("render"));
  assert.equal(project.connections.length, 0);
});
test("rejected pair never activates Loom continuation", () => {
  const { bridge, project } = pairHarness(false, true); bridge.completeJumpLinkCreate();
  assert.equal(bridge.loomCreate, undefined); assert.equal(project.jumpLinks.length, 0);
});
test("pair-completion synthetic double-click cannot finish the newly activated continuation", () => {
  const handler = vm.runInNewContext(`({${method("handleCanvasWrapDoubleClick")}})`);
  Object.assign(handler, { loomCreationActive: true, loomCreate: { awaitingPointerDown: true },
    completeLoomCreation() { assert.fail("pair release cannot finish a Loom"); } });
  handler.handleCanvasWrapDoubleClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(handler.loomCreate.awaitingPointerDown, true);
});
