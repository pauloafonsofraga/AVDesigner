import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { normalizeLoom, normalizeLoomLabelColor, DEFAULT_LOOM_LABEL_TEXT_COLOR, DEFAULT_LOOM_LABEL_BACKGROUND_COLOR } from "../src/engine/loomModel.js";
import { rebaseLoomPortalAttachments } from "../src/engine/loomGeometry.js";

const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
function method(name) {
  const start = source.indexOf(`\n  ${name}(`); assert(start >= 0);
  const tail = source.slice(start + 1);
  return tail.slice(0, tail.slice(1).search(/\n  (?:async )?[a-zA-Z]\w*\(/) + 1);
}
function harness() {
  const project = { devices: [], connections: [], looms: [{ id: "loom-1", name: "LM-001",
    sideA: { x: 0, y: 0 }, sideB: { x: 400, y: 0 } }] };
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project));
  const root = scene.loomProject, commands = [];
  const bridge = vm.runInNewContext(`({${["previewManagedLoomLabelStyle", "getManagedLoomLabelStyle", "captureLoomState", "commitLoomEdit", "updateManagedLoom", "applyLoomState"].map(method).join(",\n")}})`, {
    structuredClone, performance, normalizeLoom, normalizeLoomLabelColor,
    DEFAULT_LOOM_LABEL_TEXT_COLOR, DEFAULT_LOOM_LABEL_BACKGROUND_COLOR, rebaseLoomPortalAttachments
  });
  Object.assign(bridge, { ready: true, scene, mutations: { root, record() {} }, api: {},
    refreshLoomComposition: () => scene.rebuildLoomGeometry(), beginProductionCommit() {}, markCommitted() {},
    recordCommand: command => commands.push(command), scheduleRender() {} });
  return { bridge, root, commands };
}

for (const field of ["labelTextColor", "labelBackgroundColor"]) test(`${field}: preview on a rebuilt scene cannot mutate saved data or consume the commit`, () => {
  const { bridge, root, commands } = harness(), before = structuredClone(root);
  assert.equal(bridge.scene.looms[0], root.looms[0], "exercise the real normalized shared-record ownership");
  assert.equal(bridge.previewManagedLoomLabelStyle("loom-1", { [field]: "#ff00ff" }), true);
  assert.equal(bridge.scene.looms[0][field], "#ff00ff");
  assert.deepEqual(root, before, "preview is not canonical and cannot leak into Save/export");
  assert.equal(commands.length, 0);
  assert.equal(bridge.updateManagedLoom("loom-1", { [field]: "#ff00ff" }), true);
  assert.equal(root.looms[0][field], "#ff00ff"); assert.equal(commands.length, 1);
  commands[0].undo(bridge); assert.deepEqual(root.looms, before.looms);
  commands[0].redo(bridge); assert.equal(root.looms[0][field], "#ff00ff");
  const saved = structuredClone(root);
  bridge.previewManagedLoomLabelStyle("loom-1", { [field]: "#112233" });
  bridge.previewManagedLoomLabelStyle("loom-1", bridge.getManagedLoomLabelStyle("loom-1"));
  assert.deepEqual(root, saved); assert.equal(bridge.scene.looms[0][field], "#ff00ff");
  assert.equal(commands.length, 1);
});
