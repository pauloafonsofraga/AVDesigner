import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function harness({ owned = false, engine = true } = {}) {
  const listeners = new Map(), history = [], undo = [], previews = [];
  const control = {
    value: "Original", addEventListener: (type, fn) => listeners.set(type, fn),
    blur: () => listeners.get("blur")(),
    input(value) { this.value = value; listeners.get("input")({ target: this }); }
  };
  const c = vm.createContext({ structuredClone,
    deviceLibrary: [{ id: "template", name: "Original", model: "Original", owned }],
    state: { devices: [{ instanceId: "device", templateId: "template", name: "Original" }], connections: [] },
    instanceById: id => c.state.devices.find(d => d.instanceId === id),
    templateForInstance: d => d && (d.templateOverride || c.deviceLibrary.find(t => t.id === d.templateId)),
    projectCustomTemplateRecordForInstance: d => c.deviceLibrary.find(t => t.id === d.templateId && t.owned),
    deviceEditorEngineSnapshot: () => structuredClone({ deviceLibrary: c.deviceLibrary, ...c.state }),
    projectSnapshot: () => structuredClone(c.state),
    pushUndo: snapshot => undo.push(snapshot),
    activeEngineBridge: () => engine ? {
      previewObjectInspectorFields: (id, fields) => previews.push({ id, ...fields }),
      synchronizeMonitorNames: () => c.monitorRefreshes++
    } : null,
    commitDeviceEditorApplyToEngineBridge: (before, after) => {
      history.push({ before, after });
      c.state = structuredClone({ devices: after.devices, connections: after.connections });
      c.deviceLibrary = structuredClone(after.deviceLibrary);
      return engine;
    },
    projectCustomTemplateFromEditedLibraryTemplate: source => ({ ...source, id: "custom", owned: true }),
    markProjectCustomDeviceTemplate() {}, normalizeProjectCustomTemplates() {}, hydrateDeviceInstance() {},
    renderDeviceLibrary() {}, renderProjectCustomDevices() {}, renderRackBuilderSources() {},
    renderInspector: () => c.inspectorRenders++, render() {}, updateUndoRedoButtons() {}, setStatus() {},
    monitorRefreshes: 0, inspectorRenders: 0
  });
  for (const name of ["bindDeferredCanvasTextCommit", "bindCanvasDeviceNameInput", "commitCanvasDeviceInspectorName", "projectCustomSourceTemplateForCanvasRename"]) {
    vm.runInContext(html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0], c);
  }
  c.bindCanvasDeviceNameInput(control, "device");
  return { c, control, history, undo, previews, listeners };
}

test("typing stores each name in project snapshots and updates Engine without rebuilding the inspector", () => {
  const { c, control, history, previews } = harness();
  for (const name of ["C", "Cam", "Camera Left"]) {
    control.input(name);
    assert.equal(c.instanceById("device").name, name);
    assert.equal(c.projectSnapshot().devices[0].name, name);
    assert.equal(previews.at(-1).name, name);
  }
  assert.equal(control.value, "Camera Left");
  assert.equal(c.inspectorRenders, 0);
  assert.equal(c.monitorRefreshes, 3);
  assert.equal(history.length, 0, "no per-keystroke template rebuild or history entries");
});

for (const finish of ["blur", "change", "flush", "Enter"]) {
  test(`${finish} finalizes one rename with its original undo baseline, without requiring Enter`, () => {
    const { c, control, history, undo, listeners } = harness();
    control.input("Camera"); control.input("Camera Left");
    if (finish === "flush") control.__avDesignerCommitPending();
    else if (finish === "Enter") listeners.get("keydown")({ key: "Enter", preventDefault() {} });
    else listeners.get(finish)();
    control.blur();
    assert.equal(history.length, 1);
    assert.equal(undo.length, 1);
    assert.equal(history[0].before.devices[0].name, "Original");
    assert.equal(undo[0].devices[0].name, "Original");
    assert.equal(history[0].after.devices[0].name, "Camera Left");
    assert.equal(c.deviceLibrary[0].name, "Original", "built-in device unchanged");
    assert.equal(c.deviceLibrary[1].name, "Camera Left");
    assert.equal(c.instanceById("device").templateOverride.name, "Camera Left");
  });
}

test("owned templates update once with the final name and keep the pre-typing undo baseline", () => {
  const { c, control, history } = harness({ owned: true });
  control.input("Stage"); control.input("Stage Screen"); control.blur();
  assert.equal(c.deviceLibrary.length, 1);
  assert.equal(c.deviceLibrary[0].name, "Stage Screen");
  assert.equal(c.deviceLibrary[0].model, "Stage Screen");
  assert.equal(history[0].before.deviceLibrary[0].name, "Original");
  assert.equal(history[0].before.devices[0].name, "Original");
});

test("blank and unchanged edits keep the template fallback without creating undo entries", () => {
  const { c, control, history } = harness();
  control.input("   "); assert.equal(c.instanceById("device").name, "Original");
  control.blur();
  control.input("Original"); control.blur();
  assert.equal(history.length, 0);
  assert.equal(c.deviceLibrary.length, 1);
});

test("typing without an Engine still stores the name and captures a single shell undo baseline", () => {
  const { c, control, undo } = harness({ engine: false });
  control.input("Screen"); assert.equal(c.projectSnapshot().devices[0].name, "Screen");
  control.blur(); assert.equal(undo.length, 1); assert.equal(undo[0].devices[0].name, "Original");
});
