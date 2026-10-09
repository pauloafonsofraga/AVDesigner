import assert from "node:assert/strict";
import test from "node:test";
import { outputPdfJumpFixture } from "../fixtures/output-pdf-jumps.mjs";
import { JUMP_NODE_ROLE_COLORS } from "../src/engine/jumpNodeModel.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { engineOutputPrimitives, jumpNodeBodyGlowEnabled, jumpNodeBodyGlowScale, jumpNodeInnerRingEnabled } from "../src/engine/renderer.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";

test("Jump body glow follows connection and pairing, not role or color", () => {
  const cases = [
    ["unconnected", {}, true],
    ["connected and unpaired", { jumpLocalWireId: "wire-a" }, false],
    ["connected and paired", { jumpLocalWireId: "wire-a", jumpPairedId: "jump-b" }, true],
    ["pair removed", { jumpLocalWireId: "wire-a", jumpPairedId: "" }, false],
    ["device wire removed", { jumpLocalWireId: "", jumpPairedId: "" }, true]
  ];
  for (const [label, visual, expected] of cases) {
    assert.equal(jumpNodeBodyGlowEnabled({ visual: { jumpRole: "output", jumpColor: "#32b6ff", ...visual } }), expected, label);
    assert.equal(jumpNodeBodyGlowScale({ visual }), label === "connected and paired" ? 2.4 : 1, `${label} glow contrast`);
    assert.equal(jumpNodeInnerRingEnabled({ visual }), Boolean(visual.jumpPairedId), `${label} inner ring`);
  }
  assert.equal(jumpNodeBodyGlowEnabled(null), true, "generic and placement-ghost state keeps the default glow");
});

test("Engine output mesh suppresses only normal role glow for connected unpaired Jumps", () => {
  const project = outputPdfJumpFixture();
  const pairedContract = buildEngineOutputScene(project);
  const pairedModel = createOutputViewerModel(pairedContract);
  const pairedMesh = engineOutputPrimitives(pairedModel.scene, pairedContract).jumps.find(item => item.id === "strict-a");

  const unpairedContract = buildEngineOutputScene({ ...project, jumpLinks: [] });
  const unpairedModel = createOutputViewerModel(unpairedContract);
  const unpairedMesh = engineOutputPrimitives(unpairedModel.scene, unpairedContract).jumps.find(item => item.id === "strict-a");
  const pairedNode = pairedModel.scene.getDevice("strict-a");
  const unpairedNode = unpairedModel.scene.getDevice("strict-a");

  assert.equal(pairedNode.visual.jumpRole, "output");
  assert.equal(unpairedNode.visual.jumpRole, "output");
  assert.equal(pairedNode.visual.jumpColor, unpairedNode.visual.jumpColor);
  assert.equal(jumpNodeBodyGlowEnabled(pairedNode), true);
  assert.equal(jumpNodeBodyGlowEnabled(unpairedNode), false);
  assert.equal(jumpNodeInnerRingEnabled(pairedNode), true);
  assert.equal(jumpNodeInnerRingEnabled(unpairedNode), false);
  assert.ok(pairedMesh.vertices.length > unpairedMesh.vertices.length, "paired output retains two role-glow circles");
  assert.ok(pairedMesh.vertices[5] > 0.2, "paired output uses a clearly visible outer role-glow opacity");
  assert.notDeepEqual(pairedMesh.vertices, unpairedMesh.vertices,
    "paired output includes the inner ring and glow while unpaired output omits both");
  assert.equal(pairedModel.scene.getDevice("bidi-a").visual.jumpBaseRole, "bidirectional");
  assert.equal(jumpNodeBodyGlowEnabled(pairedModel.scene.getDevice("bidi-a")), true);
  assert.equal(unpairedModel.scene.getDevice("bidi-a").visual.jumpRole, "bidirectional");
  assert.equal(unpairedModel.scene.getDevice("bidi-a").visual.jumpColor, JUMP_NODE_ROLE_COLORS.bidirectional);
  assert.equal(jumpNodeBodyGlowEnabled(unpairedModel.scene.getDevice("bidi-a")), false);

  const unconnectedProject = { ...project, connections: project.connections.filter(wire => wire.id !== "physical-1"), jumpLinks: [] };
  const unconnectedContract = buildEngineOutputScene(unconnectedProject);
  const unconnectedModel = createOutputViewerModel(unconnectedContract);
  const unconnectedNode = unconnectedModel.scene.getDevice("strict-a");
  assert.equal(unconnectedNode.visual.jumpRole, "neutral");
  assert.equal(jumpNodeBodyGlowEnabled(unconnectedNode), true);
  assert.equal(JSON.stringify(unpairedContract).includes("bodyGlow"), false, "render state is not persisted in the scene contract");
});
