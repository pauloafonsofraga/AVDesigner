import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { buildEngineViewerHtml } from "../src/engine/outputViewerHtml.js";
import { CLIPBOARD_PREFIX, CLIPBOARD_STORAGE_KEY, parseCanvasClipboard } from "../src/engine/canvasClipboard.js";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const html = read("index.html");
function shellFunction(name, context) {
  const source = html.match(new RegExp(`^    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))?.[0];
  assert.ok(source, name);
  return vm.runInNewContext(`(${source})`, context);
}

test("all shipped UI text, reports and accessibility labels use WireNexus", () => {
  for (const file of ["index.html", "viewer.html", "engine-prototype.html", "api/publish.js", "api/project.js",
    "src/engine/productionBridge.js", "src/engine/outputViewerApp.js", "src/engine/outputViewerHtml.js", "src/engine/canvasClipboard.js"]) {
    assert.doesNotMatch(read(file), /AV Designer|Untitled AV Wirechart/i, file);
  }
  assert.match(html, /<span>WireNexus by Video Core<\/span>/);
  assert.match(html, /WireNexus project report/);
  assert.match(html, /WireNexus Report/);
});

test("default project title is rebranded without rewriting a user's existing project name", () => {
  const context = { state: { projectName: "" }, document: {}, projectNameInput: { value: "" } };
  context.projectDisplayName = shellFunction("projectDisplayName", context);
  const update = shellFunction("updateProjectNameControl", context);
  assert.equal(context.projectDisplayName(), "Untitled WireNexus Project");
  update();
  assert.equal(context.document.title, "Untitled WireNexus Project - WireNexus by Video Core");
  context.state.projectName = "AV Designer Launch Event";
  update();
  assert.equal(context.projectNameInput.value, "AV Designer Launch Event");
  assert.equal(context.document.title, "AV Designer Launch Event - WireNexus by Video Core");
});

test("save and open pickers use the new name but keep the same extensions and project contents", async () => {
  const pickers = [], writes = [], loads = [], file = { name: "existing.avd" };
  const handle = { name: file.name, getFile: async () => file };
  const context = { window: {
    showSaveFilePicker: async options => { pickers.push(options); return handle; },
    showOpenFilePicker: async options => { pickers.push(options); return [handle]; }
  }, projectJsonPayload: () => '{"projectName":"Existing"}', suggestedProjectFileName: () => "existing.avd",
  supportsNativeProjectSave: () => true, writeProjectFile: async (...args) => writes.push(args),
  loadProjectFile: (...args) => loads.push(args), setStatus() {}, alert(message) { throw new Error(message); } };
  await shellFunction("saveProjectAs", context)();
  await shellFunction("openProjectFile", context)();
  for (const picker of pickers) {
    assert.equal(picker.types[0].description, "WireNexus Project");
    assert.deepEqual([...picker.types[0].accept["application/json"]], [".avd", ".json"]);
  }
  assert.equal(writes[0][1], '{"projectName":"Existing"}');
  assert.equal(loads[0][0], file);
  assert.equal(loads[0][1].fileHandle, handle);
});

test("library downloads get new filenames without changing the library payload format", () => {
  const downloads = [], nodes = [{ id: "custom-node" }], devices = [{ id: "custom-device" }];
  const context = { editorDraft: devices, structuredClone, syncEditorFieldsToDraft() {}, enforceDevicePairFirstChoice() {},
    validateEditorTemplateForApply() {}, serializeNodeLibrary: () => nodes,
    downloadBlob: (...args) => downloads.push(args), alert(message) { throw new Error(message); } };
  shellFunction("exportNodeLibraryJson", context)();
  shellFunction("exportDeviceLibraryJson", context)();
  assert.deepEqual(downloads.map(d => d[1]), ["wirenexus-node-library.json", "wirenexus-device-library.json"]);
  for (const [payload, , mime] of downloads) {
    assert.equal(mime, "application/json");
    assert.equal(JSON.parse(payload).version, 1);
    assert.deepEqual(JSON.parse(payload).nodes, nodes);
  }
  assert.deepEqual(JSON.parse(downloads[1][0]).devices, devices);
});

test("HTML and hosted output use WireNexus while preserving canonical data and user titles", () => {
  const scene = buildEngineOutputScene({ projectName: "Client Event" });
  const before = JSON.stringify(scene), bundle = JSON.parse(read("src/engine/generated/outputViewerBundle.json"));
  for (const title of [undefined, "Client <Event> & Crew", "AV Designer Launch Event"]) {
    const output = buildEngineViewerHtml({ engineScene: scene }, { bundle, title });
    assert.match(output, / - WireNexus<\/title>/);
    assert.doesNotMatch(bundle.javascript, /AV Designer/);
    const payload = JSON.parse(output.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
    assert.equal(payload.title, title || "WireNexus");
    assert.deepEqual(payload.engineScene, scene);
  }
  assert.equal(JSON.stringify(scene), before);
});

test("clipboard and remembered settings retain their compatibility keys while errors use the new name", () => {
  assert.equal(CLIPBOARD_PREFIX, "AVDESIGNER_SELECTION_V2:");
  assert.equal(CLIPBOARD_STORAGE_KEY, "avdesigner.canvas-clipboard.v2");
  assert.throws(() => parseCanvasClipboard("plain text"), /not a WireNexus selection/);
  assert.match(html, /NODE_LIBRARY_STORAGE_KEY = "av-designer-node-library-v1"/);
  assert.match(html, /DEVICE_FAVORITES_STORAGE_KEY = "av-designer-device-favorites-v1"/);
  assert.match(read("src/engine/localUserSettings.js"), /av-designer:user-settings:v1/);
  assert.match(read("src/companyLogoCore.js"), /av-designer:company-logo:v1/);
  assert.match(read("api/publish.js"), /avdesigner\/projects/);
});
