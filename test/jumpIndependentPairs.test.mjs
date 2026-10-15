import test from "node:test";
import assert from "node:assert/strict";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { engineOutputPrimitives, jumpNodeStatusDotColor } from "../src/engine/renderer.js";
import { jumpPairCompatibility, jumpDeviceAttachmentCompatibility, validateJumpLinks, invalidJumpLinksForScene } from "../src/engine/jumpNodeModel.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";

const sceneFor = project => { const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project)); return scene; };

test("empty ordinary Jump pair persists with neutral electrical roles and centered purple mesh", () => {
  const project = bidirectionalJumpFixture(); project.connections = [];
  const scene = sceneFor(project);
  const pair = jumpPairCompatibility(scene, "a", "b", { compatibilitySummary: engineCompatibilitySummary });
  assert.equal(pair.valid, true);
  project.jumpLinks = [{ id: "empty-pair", outputJumpId: pair.outputJumpId, inputJumpId: pair.inputJumpId, deviceIndependent: true }];
  const restored = sceneFor(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(validateJumpLinks(project).warnings, []);
  assert.deepEqual(invalidJumpLinksForScene(restored), []);
  for (const id of ["a", "b"]) {
    const node = restored.getDevice(id);
    assert.equal(node.visual.jumpRole, "neutral");
    assert.equal(node.visual.jumpLocalWireId, "");
    assert.equal(jumpNodeStatusDotColor(node), "#a855f7");
  }
  const output = buildEngineOutputScene(project), viewer = createOutputViewerModel(output);
  assert.equal(output.wires.length, 0);
  assert.equal(jumpNodeStatusDotColor(viewer.scene.getDevice("a")), "#a855f7");
  const mesh = engineOutputPrimitives(viewer.scene, output).jumps.find(item => item.id === "a");
  assert.ok(mesh.vertices.some(value => Math.abs(value - 168 / 255) < 1e-6), "purple status dot is present in the shared vector mesh");
});

test("a later cable can enter either empty pair end and incompatible peer connections are rejected", () => {
  const project = bidirectionalJumpFixture("input", "output"); project.connections = [];
  project.jumpLinks = [{ id: "empty", outputJumpId: "a", inputJumpId: "b", deviceIndependent: true }];
  let scene = sceneFor(project);
  const source = { device: scene.getDevice("source"), connector: scene.getConnector("source", "port") };
  assert.equal(jumpDeviceAttachmentCompatibility(scene, "a", source, { compatibilitySummary: engineCompatibilitySummary }).valid, true);
  project.connections.push({ id: "late-a", cableType: "hdmi", from: { jumpNodeId: "a" }, to: { deviceId: "source", connectorId: "port" } });
  scene = sceneFor(project);
  assert.equal(scene.jumpNodeRole("a").role, "input");
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("a")), "");
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("b")), "#a855f7");
  const peer = { device: scene.getDevice("destination"), connector: scene.getConnector("destination", "port") };
  assert.equal(jumpDeviceAttachmentCompatibility(scene, "b", peer, { compatibilitySummary: engineCompatibilitySummary }).valid, true);
  assert.equal(jumpDeviceAttachmentCompatibility(scene, "b", { ...peer, connector: { ...peer.connector, type: "sdi" } },
    { compatibilitySummary: engineCompatibilitySummary }).valid, false);
  assert.equal(jumpDeviceAttachmentCompatibility(scene, "b", { ...peer, connector: { ...peer.connector, direction: "input", signalDirection: "input" } },
    { compatibilitySummary: engineCompatibilitySummary }).valid, false);
  scene.deleteWire("late-a"); scene.removeInvalidJumpLinksForJumps(["a"]);
  assert.equal(scene.jumpLinks.length, 1);
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("a")), "#a855f7");
});
