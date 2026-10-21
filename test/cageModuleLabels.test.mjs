import test from "node:test";
import assert from "node:assert/strict";
import { engineConnectorCanvasLabelLines as labels, engineConnectorInfoFields } from "../src/engine/connectorCompatibility.js";
import { transceiverModulePatch } from "../src/engine/transceiverModules.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { WebglGraphRenderer, DEFAULT_RENDER_OPTIONS } from "../src/engine/renderer.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";

const cage = (extra = {}) => ({ id: "stable", type: "sfp-plus-cage", physicalType: "sfp-plus-cage",
  x: 0, y: 160, side: "left", direction: "input", nameText: "Camera feed", customText: "Keep me", ...extra });
for (const [type, name] of [["sfp-cage", "SFP Cage"], ["sfp-plus-cage", "SFP+ Cage"], ["sfp28-cage", "SFP28 Cage"], ["qsfp-cage", "QSFP Cage"]]) {
  test(`empty ${type} retains physical caption`, () => assert.deepEqual(labels(cage({ type, physicalType: type })), [name]));
}
for (const [value, name] of [["sfp-sdi-12g-rx", "SFP SDI 12G RX"], ["sfp-sdi-3g-tx", "SFP SDI 3G TX"],
  ["lc-singlemode", "LC Single Mode"], ["rj45-ethernet", "RJ45 Ethernet"], ["dac-sfp28", "SFP28 DAC 25G"]]) {
  test(`derived ${name} supports historical representations without mutation`, () => {
    for (const extra of [{ installedModuleType: value }, { installedModuleId: value }, { installedModule: { type: value } },
      { module: { value } }, { transceiverModule: { id: value } }, { moduleId: value }, { transceiverModuleId: value }]) {
      const c = cage(extra), before = structuredClone(c);
      assert.deepEqual(labels(c), ["Installed Module", name]);
      assert.deepEqual(c, before);
      assert(!engineConnectorInfoFields(c).some(field => /Installed Module/.test(JSON.stringify(field))), "Derived text is not an editable saved field");
    }
  });
}
test("unknown module does not invent rates/direction; known historical aliases remain readable", () => {
  assert.deepEqual(labels(cage({ installedModuleType: "vendor-private-thing" })), ["Installed Module", "Unknown module"]);
  assert.deepEqual(labels(cage({ installedModule: { type: "vendor-private-thing", name: "Authored module" } })), ["Installed Module", "Authored module"]);
  assert.deepEqual(labels(cage({ installedModuleType: "sdi" })), ["Installed Module", "SDI"]);
  assert.deepEqual(labels({ type: "hdmi", nameText: "Camera" }), ["HDMI"]);
});
test("module replace/remove/save/reload keeps authored fields and geometry intact", () => {
  const c = cage({ name: "Authored", label: "Alias", alias: "Custom", anchors: [{ id: "a", x: 0, y: 160 }], cardSlotId: "slot" });
  const before = structuredClone(c);
  for (const value of ["sfp-sdi-12g-rx", "lc-singlemode", ""]) {
    Object.assign(c, transceiverModulePatch(c, value));
    for (const [key, expected] of Object.entries(before)) assert.deepEqual(c[key], expected);
    assert.deepEqual(labels(JSON.parse(JSON.stringify(c))), labels(c));
  }
  assert.deepEqual(labels(c), ["SFP+ Cage"]);
});
test("live and vector label layer uses two compact lines, hides details at low zoom and preserves geometry", () => {
  const connector = cage({ installedModuleType: "sfp-sdi-12g-rx" });
  const project = { deviceLibrary: [{ id: "t", name: "Receiver", width: 380, height: 300, connectors: [connector] }],
    devices: [{ instanceId: "d", templateId: "t", x: 100, y: 100 }], connections: [] };
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project));
  const before = structuredClone(scene.getDevice("d").connectors);
  for (const zoom of [0.08, 0.34, 1, 3]) {
    const ctx = new OutputSvgContext(), draws = [];
    const fill = ctx.fillText;
    ctx.fillText = function(text, x, y) { draws.push({ text, x, y }); fill.call(this, text, x, y); };
    ctx.setTransform = () => {}; ctx.clearRect = () => {};
    const renderer = Object.create(WebglGraphRenderer.prototype);
    Object.assign(renderer, { labelContext: ctx, labelCanvas: {}, resolution: { width: 5000, height: 5000 }, renderOptions: DEFAULT_RENDER_OPTIONS });
    const previous = globalThis.window; globalThis.window = { devicePixelRatio: 1 };
    try { renderer.drawLabels(scene, { x: 0, y: 0, zoom }); }
    finally { if (previous) globalThis.window = previous; else delete globalThis.window; }
    assert.equal(draws.some(d => d.text === "Installed Module"), zoom >= 0.5);
    if (zoom >= 1) assert(draws.some(d => d.text === "SFP SDI 12G RX"));
    assert.deepEqual(scene.getDevice("d").connectors, before);
  }
});

test("Output Viewer and vector PDF retain derived module captions and authored fields", () => {
  const c = cage({ installedModuleType: "sfp-sdi-12g-rx" });
  const project = { deviceLibrary: [{ id: "t", name: "Receiver", width: 380, height: 300, connectors: [c] }],
    devices: [{ instanceId: "d", templateId: "t", x: 100, y: 100 }], connections: [] };
  const before = structuredClone(project), contract = buildEngineOutputScene(project);
  const viewer = createOutputViewerModel(JSON.parse(JSON.stringify(contract))).scene;
  const connector = viewer.getDevice("d").connectors[0];
  assert.deepEqual(labels(connector), ["Installed Module", "SFP SDI 12G RX"]);
  assert.equal(connector.nameText, "Camera feed");
  const svg = renderEngineOutputSvg(contract).svg;
  for (const value of ["Installed Module", "SFP SDI 12G RX", "Camera feed"]) assert(svg.includes(`>${value}</text>`));
  assert.deepEqual(project, before);
});
