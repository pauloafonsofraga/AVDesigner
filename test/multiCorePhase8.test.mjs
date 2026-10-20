import test from "node:test";
import assert from "node:assert/strict";
import { MultiCoreEditor } from "../src/engine/multiCoreEditor.js";
import { MultiCoreEditorDraft } from "../src/engine/multiCoreEditorDraft.js";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { multiCoreInvalidCases } from "../fixtures/multi-core-invalid.mjs";
import { buildMultiCoreReports } from "../src/engine/multiCoreReports.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { normalizeMultiCore } from "../src/engine/multiCoreModel.js";

for (const [state, reservation, expected] of [["spare", undefined, "Spare"], ["available", "Backup camera", "Reserved"]]) {
  test(`editor distinguishes ${expected} without changing channel data`, () => {
    const project = connectedMultiCoreProject(), mc = project.multiCores[0];
    const circuit = mc.circuits[1]; circuit.administrativeState = state;
    if (reservation) circuit.reservation = reservation;
    const status = {}, diagnostics = { dataset: {} }, controls = {};
    const editor = Object.create(MultiCoreEditor.prototype);
    Object.assign(editor, { session: new MultiCoreEditorDraft(mc, { project }), bridge: { mutations: { root: project } }, root: {
      querySelector: selector => selector === ".mc-diagnostics" ? diagnostics : controls,
      querySelectorAll: selector => selector === "[data-circuit-id]" ? [{ dataset: { circuitId: circuit.id }, querySelector: () => status }] : []
    } });
    const before = structuredClone(project);
    editor.validate(); assert.equal(status.textContent, expected); assert.deepEqual(project, before);
  });
}

for (const { name, project } of multiCoreInvalidCases) test(`negative ${name}: report/projection retain original data and unrelated equipment`, () => {
  const p = project(), before = structuredClone(p);
  const reports = buildMultiCoreReports(p); assert(reports.diagnostics.length);
  const scene = buildEngineOutputScene(p); assert(scene.devices.some(d => d.id === "server"));
  assert.deepEqual(p, before); assert.deepEqual(JSON.parse(JSON.stringify(p)), before);
  for (const mc of p.multiCores) {
    const a = normalizeMultiCore(mc).value; assert.deepEqual(normalizeMultiCore(a).value, a);
    const draft = new MultiCoreEditorDraft(mc, { project: p }); draft.validate(p);
    assert.deepEqual(p, before);
  }
});
