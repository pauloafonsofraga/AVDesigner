import assert from "node:assert/strict";
import test from "node:test";
import { DragSession } from "../src/engine/dragSession.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import {
  attachedJumpIdsForDevices, directDeviceIdsForJump, eligibleDeviceForJump,
  reconcileJumpAttachment
} from "../src/engine/jumpAttachment.js";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

function fixture() {
  const project = jumpHoldFixture();
  project.jumpNodes.find(node => node.id === "a").attachedDeviceId = "source";
  project.jumpNodes.find(node => node.id === "b").attachedDeviceId = "destination";
  return project;
}

test("direct physical endpoint is the only attachment eligibility source", () => {
  const project = fixture();
  assert.deepEqual(directDeviceIdsForJump(project, "a"), ["source"]);
  assert.deepEqual(directDeviceIdsForJump(project, "b"), ["destination"]);
  assert.equal(eligibleDeviceForJump(project, "neutral"), "");
  project.jumpLinks.push({ id: "portal", outputJumpId: "a", inputJumpId: "b" });
  assert.deepEqual(directDeviceIdsForJump(project, "a"), ["source"]);
  project.connections.push({ id: "ambiguous", from: { jumpNodeId: "a" }, to: { deviceId: "destination", connectorId: "port" } });
  assert.deepEqual(new Set(directDeviceIdsForJump(project, "a")), new Set(["source", "destination"]));
  assert.equal(eligibleDeviceForJump(project, "a"), "");
  project.connections.push({ id: "broken", from: { jumpNodeId: "neutral" }, to: { deviceId: "source" } });
  assert.equal(eligibleDeviceForJump(project, "neutral"), "", "a missing real connector is not a physical attachment");
});

test("old projects remain independent by default", () => {
  const project = jumpHoldFixture();
  assert.deepEqual(attachedJumpIdsForDevices(project, ["source"]), []);
  assert.equal(project.devices[0].autoAttachJumpNodes, undefined);
  assert.equal(project.jumpNodes[0].attachedDeviceId, undefined);
});

test("existing manual attachment remains valid when auto-attach is off", () => {
  const project = fixture();
  assert.equal(reconcileJumpAttachment(project, "a"), "source");
  assert.equal(project.jumpNodes[0].attachedDeviceId, "source");
});

test("auto-attach applies to current and future direct connections but disabling preserves existing links", () => {
  const project = fixture();
  const adapter = new ProjectMutationAdapter({ projectData: project }, { cloneProjectData: false });
  delete project.jumpNodes[0].attachedDeviceId;
  adapter.setDeviceAutoAttach("source", true);
  assert.equal(project.jumpNodes[0].attachedDeviceId, "source");
  adapter.setDeviceAutoAttach("source", false);
  assert.equal(project.jumpNodes[0].attachedDeviceId, "source");
  project.jumpNodes.push({ id: "new", x: 300, y: 300 });
  project.connections.push({ id: "new-wire", from: { deviceId: "source", connectorId: "port" }, to: { jumpNodeId: "new" } });
  adapter.rebuildIndexes();
  adapter.reconcileJumpAttachments(["new"]);
  assert.equal(project.jumpNodes.at(-1).attachedDeviceId, undefined);
  adapter.setDeviceAutoAttach("source", true);
  assert.equal(project.jumpNodes.at(-1).attachedDeviceId, "source");
});

test("rewire, ambiguity, cable removal, and device removal clear or transfer attachments", () => {
  const project = fixture();
  const adapter = new ProjectMutationAdapter({ projectData: project }, { cloneProjectData: false });
  project.connections[0].from.connectorId = "other-port";
  adapter.reconcileJumpAttachments(["a"]);
  assert.equal(project.jumpNodes[0].attachedDeviceId, "source");
  project.connections[0].from.deviceId = "destination";
  adapter.reconcileJumpAttachments(["a"]);
  assert.equal(project.jumpNodes[0].attachedDeviceId, undefined);
  adapter.setDeviceAutoAttach("destination", true);
  assert.equal(project.jumpNodes[0].attachedDeviceId, "destination");
  project.connections.push({ id: "ambiguous", from: { deviceId: "source", connectorId: "port" }, to: { jumpNodeId: "a" } });
  adapter.reconcileJumpAttachments(["a"]);
  assert.equal(project.jumpNodes[0].attachedDeviceId, undefined);
  project.connections = project.connections.filter(wire => wire.id !== "ambiguous" && wire.id !== "wire-a");
  adapter.reconcileJumpAttachments(["a"]);
  assert.equal(project.jumpNodes[0].attachedDeviceId, undefined);
  project.devices = project.devices.filter(device => device.instanceId !== "destination");
  adapter.rebuildIndexes();
  adapter.reconcileJumpAttachments(["b"]);
  assert.equal(project.jumpNodes.find(node => node.id === "b").attachedDeviceId, undefined);
});

test("group drag previews and commits followers exactly once without selecting them", () => {
  const project = fixture();
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  scene.selectOnly("source");
  const movedIds = [...new Set(["source", ...attachedJumpIdsForDevices(project, ["source"])])];
  assert.deepEqual(movedIds, ["source", "a"]);
  const drag = new DragSession({ scene, selectedIds: movedIds, startWorld: { x: 0, y: 0 } });
  const before = { device: scene.getDevice("source").x, jump: scene.getDevice("a").x, other: scene.getDevice("b").x };
  drag.update({ x: 100, y: 40 }, { snappingEnabled: false });
  assert.equal(drag.offsetMap().get("a").dx, 100);
  assert.equal(scene.getDevice("a").x, before.jump, "preview does not mutate saved geometry");
  assert.deepEqual([...scene.selectedIds], ["source"]);
  drag.commit();
  assert.equal(scene.getDevice("source").x, before.device + 100);
  assert.equal(scene.getDevice("a").x, before.jump + 100);
  assert.equal(scene.getDevice("b").x, before.other);
  const explicit = [...new Set(["source", "a", ...attachedJumpIdsForDevices(project, ["source", "a"])])];
  assert.deepEqual(explicit, ["source", "a"]);
});

test("multiple devices move only their own Jump followers and paired Jumps stay independent", () => {
  const project = fixture();
  project.jumpNodes.push({ id: "a2", x: 340, y: 310, attachedDeviceId: "source" });
  project.connections.push({ id: "wire-a2", from: { deviceId: "source", connectorId: "port" }, to: { jumpNodeId: "a2" } });
  project.jumpLinks.push({ id: "portal", outputJumpId: "a", inputJumpId: "b" });
  assert.deepEqual(attachedJumpIdsForDevices(project, ["source"]), ["a", "a2"]);
  assert.deepEqual(new Set(attachedJumpIdsForDevices(project, ["source", "destination"])), new Set(["a", "b", "a2"]));
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  const otherBefore = scene.getDevice("b").x;
  const drag = new DragSession({ scene, selectedIds: ["source", "a", "a2"], startWorld: { x: 0, y: 0 } });
  drag.update({ x: 50, y: 0 }, { snappingEnabled: false });
  drag.commit();
  assert.equal(scene.getDevice("b").x, otherBefore);
});

test("save/reload retains project-instance attachment and auto setting", () => {
  const project = fixture();
  project.devices[0].autoAttachJumpNodes = true;
  const saved = JSON.parse(JSON.stringify(project));
  assert.equal(saved.jumpNodes[0].attachedDeviceId, "source");
  assert.equal(saved.devices[0].autoAttachJumpNodes, true);
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(saved));
  assert.equal(scene.getDevice("a").attachedDeviceId, "source");
  assert.equal(scene.getDevice("source").autoAttachJumpNodes, true);
});
