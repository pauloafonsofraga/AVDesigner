import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connectorPlugCaptionFixture } from "../fixtures/connector-plug-captions.mjs";
import { modularIntegrationFixture } from "../fixtures/modular-integration.mjs";
import { powerCatalogProject, POWER_CATALOG } from "../fixtures/power-distro-catalog.mjs";
import { relationshipMetadataFixture } from "../fixtures/relationship-metadata.mjs";
import { engineConnectorPlugTypeLabel, engineConnectorDisplayLabel, engineConnectorTypeDisplayName } from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { WebglGraphRenderer, DEFAULT_RENDER_OPTIONS, drawEngineOutputLabels } from "../src/engine/renderer.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { buildEngineViewerHtml } from "../src/engine/outputViewerHtml.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import * as clipboard from "../src/engine/canvasClipboard.js";

function sceneFor(project) {
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project)); return scene;
}
function context() {
  const ctx = new OutputSvgContext(); ctx.draws = [];
  const fill = ctx.fillText;
  ctx.fillText = function(text, x, y) {
    this.draws.push({ text, x, y, font: this.font, stroke: this.strokeStyle, fill: this.fillStyle });
    fill.call(this, text, x, y);
  };
  ctx.setTransform = () => {};
  ctx.clearRect = () => { ctx.draws = []; };
  return ctx;
}
const captions = ctx => ctx.draws.filter(d => /^([89]00) /.test(d.font) && d.stroke === "rgba(0,0,0,.84)");
const values = ctx => ctx.draws.filter(d => /^700 /.test(d.font) && d.fill === "#edf2f7").map(d => d.text);
function liveLabels(scene, options = {}) {
  const ctx = context(), renderer = Object.create(WebglGraphRenderer.prototype);
  Object.assign(renderer, { labelContext: ctx, labelCanvas: {}, resolution: { width: 5000, height: 5000 }, renderOptions: DEFAULT_RENDER_OPTIONS });
  const previous = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try { renderer.drawLabels(scene, { x: 0, y: 0, zoom: 1 }, options); }
  finally { if (previous) globalThis.window = previous; else delete globalThis.window; }
  return ctx;
}
const singleDevice = template => ({ deviceLibrary: [template], devices: [{ instanceId: "d", templateId: template.id, x: 100, y: 100 }], connections: [] });

test("plug catalog handles standard, audio, network, USB, fiber, cages and neutral custom captions without using names", () => {
  const cases = { hdmi: "HDMI", dvi: "DVI", sdi: "SDI", bnc: "BNC", "display-port": "Display Port", vga: "VGA",
    cat6a: "CAT6A", ethernet: "Ethernet", ethercon: "etherCON", "rs-422": "RS-422", "usb-c": "USB-C",
    "xlr-3pin": "XLR 3-pin", "speakon-nl4": "speakON NL4", "fiber-lc": "Fiber LC", "fiber-mpo": "Fiber MPO",
    "sfp-cage": "SFP Cage", "sfp-plus-cage": "SFP+ Cage", "qsfp-cage": "QSFP Cage", qsfp: "QSFP", misc: "Misc.", custom: "Misc.", "": "Misc." };
  for (const [type, expected] of Object.entries(cases)) {
    const connector = { type, name: "User name", displayName: "Display name", displayLabel: "Display label", nameText: "IN 1", label: "Alias", alias: "Other", fiberMode: "om4" };
    const before = structuredClone(connector);
    assert.equal(engineConnectorPlugTypeLabel(connector), expected, type);
    assert.equal(engineConnectorDisplayLabel(connector), "User name", "identity resolver unchanged");
    assert.deepEqual(connector, before);
  }
  assert.equal(engineConnectorPlugTypeLabel(null), "Misc.");
  for (const type of ["fiber-lc", "fiber-sc", "fiber-st", "fiber-mpo", "opticalcon", "fiberfox"]) {
    for (const fiberMode of ["single-mode", "om1-om2", "om3", "om4", "om5"]) {
      assert.equal(engineConnectorPlugTypeLabel({ type, fiberMode, nameText: "Fiber feed" }), engineConnectorTypeDisplayName(type));
    }
  }
});

test("live label layer separates bold plug captions from information values and refreshes them independently", () => {
  const project = connectorPlugCaptionFixture(), before = structuredClone(project), scene = sceneFor(project);
  let ctx = liveLabels(scene);
  assert.deepEqual(captions(ctx).map(d => d.text), [...Array(8).fill("HDMI"), ...Array(8).fill("SDI"), "CAT6A"]);
  for (const text of ["IN 1", "OUT 1", "LAN"]) assert.ok(values(ctx).includes(text), text);
  const geometry = scene.getDevice("matrix").connectors.map(c => ({ id: c.id, x: c.x, y: c.y, anchors: c.anchors }));
  scene.updateConnector("matrix", "in-1", { nameText: "CAMERA 1" });
  ctx = liveLabels(scene);
  assert.ok(values(ctx).includes("CAMERA 1")); assert.ok(!values(ctx).includes("IN 1"));
  assert.equal(captions(ctx)[0].text, "HDMI");
  scene.updateConnector("matrix", "in-1", { type: "dvi" });
  ctx = liveLabels(scene);
  assert.equal(captions(ctx)[0].text, "DVI"); assert.ok(values(ctx).includes("CAMERA 1"));
  assert.deepEqual(scene.getDevice("matrix").connectors.map(c => ({ id: c.id, x: c.x, y: c.y, anchors: c.anchors })), geometry);
  assert.deepEqual(project, before);
});

test("cage installation and removal update live captions from effective module type, not stale displayLabel", () => {
  const scene = sceneFor(connectorPlugCaptionFixture());
  for (const cage of ["sfp-cage", "sfp-plus-cage", "qsfp-cage"]) {
    for (const [module, expected] of [["", engineConnectorTypeDisplayName(cage)], ["rj45", "CAT6A"], ["lc-multimode-om4", "Fiber LC"], ["mpo", "Fiber MPO"], ["", engineConnectorTypeDisplayName(cage)]]) {
      scene.updateConnector("matrix", "in-1", { type: cage, installedModuleType: module, displayLabel: "Stale node name" });
      const ctx = liveLabels(scene);
      assert.equal(captions(ctx)[0].text, expected);
      assert.ok(values(ctx).includes("IN 1"));
    }
  }
});

test("shared buses deduplicate canonical types and join mixed types deterministically, leaving LOOP metadata alone", () => {
  const template = relationshipMetadataFixture();
  template.connectors.forEach(c => { c.type = "hdmi"; c.operationalStatus = "working"; });
  let scene = sceneFor(singleDevice(template)), ctx = liveLabels(scene);
  assert.deepEqual(captions(ctx).filter(d => d.font.startsWith("900 ")).map(d => d.text), ["HDMI"]);
  template.connectors[1].type = "sdi";
  scene = sceneFor(singleDevice(template)); ctx = liveLabels(scene);
  assert.deepEqual(captions(ctx).filter(d => d.font.startsWith("900 ")).map(d => d.text), ["HDMI / SDI"]);
  assert.ok(values(ctx).includes("LOOP"));
});

test("all Power Distro catalog plugs render canonical labels, not internal IDs or node metadata", () => {
  const project = powerCatalogProject(), scene = sceneFor(project), drawn = captions(liveLabels(scene)).map(d => d.text);
  for (const type of Object.keys(POWER_CATALOG)) {
    const expected = engineConnectorTypeDisplayName(type);
    assert.ok(drawn.includes(expected), type);
    assert.ok(!drawn.includes(`${type} input`));
  }
  assert.ok(drawn.includes("IEC")); assert.ok(drawn.includes("63A 3ph")); assert.ok(drawn.includes("powerCON TRUE1"));
});

test("installed cards, bidirectional anchors and generated switch ports use plug types without mutating source cards", () => {
  const template = modularIntegrationFixture();
  template.cardTypes[0].connectors[0].type = "hdmi";
  Object.assign(template.cardTypes[1].connectors[0], { type: "qsfp-cage", installedModuleType: "mpo" });
  template.connectors.find(c => c.id === "both").type = "usb-c";
  const project = singleDevice(template), before = structuredClone(project), scene = sceneFor(project);
  const device = scene.getDevice("d"), ctx = liveLabels(scene);
  assert.ok(device.connectors.some(c => c.id === "input-slot__in-0" && c.nameText === "Installed input"));
  assert.equal(captions(ctx).filter(d => d.text === "HDMI").length, 1, "installed input caption");
  assert.equal(captions(ctx).filter(d => d.text === "Fiber MPO").length, 1, "installed output cage module caption");
  assert.equal(captions(ctx).filter(d => d.text === "USB-C").length, 2, "both-side connector captions");
  assert.ok(!captions(ctx).some(d => /Installed|12G/.test(d.text)));
  assert.deepEqual(project, before);
  const matrix = sceneFor(connectorPlugCaptionFixture());
  matrix.updateConnector("matrix", "lan", { generatedByEthernetSwitch: true, nameText: "PORT 7", label: "Switch 7" });
  assert.equal(captions(liveLabels(matrix)).at(-1).text, "CAT6A");
});

test("moving devices and connectors draw exactly one current caption per visible anchor with no stale position", () => {
  const scene = sceneFor(connectorPlugCaptionFixture()), still = captions(liveLabels(scene));
  const dragSession = { selectedIds: ["matrix"], offsetMap: () => new Map([["matrix", { dx: 57, dy: 31 }]]) };
  const moved = captions(liveLabels(scene, { dragSession }));
  assert.deepEqual(moved, still.map(d => ({ ...d, x: d.x + 57, y: d.y + 31 })));
  const connector = scene.getDevice("matrix").connectorsById.get("in-1");
  scene.updateConnector("matrix", connector.id, { y: connector.y + 20, anchors: connector.anchors.map(a => ({ ...a, y: a.y + 20 })) });
  const changed = captions(liveLabels(scene));
  assert.equal(changed.length, still.length); assert.equal(changed[0].y, still[0].y + 20);
});

test("save/reload, duplication and cross-project clipboard preserve names and types independently", () => {
  const project = connectorPlugCaptionFixture(), selection = [{ type: "device", id: "matrix" }];
  const payload = clipboard.createCanvasClipboardPayload(project, selection, { x: 100, y: 100, width: 380, height: 656 });
  const decoded = clipboard.parseCanvasClipboard(clipboard.serializeCanvasClipboard(payload));
  for (const destination of [project, {}]) {
    const plan = clipboard.prepareCanvasClipboardPaste(decoded, destination, { x: 1000, y: 100 });
    const saved = JSON.parse(JSON.stringify(clipboard.applyCanvasClipboardPlan(destination, plan)));
    const scene = sceneFor(saved), pasted = scene.getDevice(plan.additions.devices[0].instanceId);
    assert.deepEqual(pasted.connectors.slice(0, 2).map(c => [c.nameText, c.type]), [["IN 1", "hdmi"], ["IN 2", "hdmi"]]);
    assert.ok(captions(liveLabels(scene)).every(d => ["HDMI", "SDI", "CAT6A"].includes(d.text)));
  }
});

test("live Engine, downloaded HTML, hosted Publish and vector PDF share caption roles and independent information fields", () => {
  const project = connectorPlugCaptionFixture(), scene = sceneFor(project), contract = buildEngineOutputScene(project);
  const bundle = JSON.parse(readFileSync(new URL("../src/engine/generated/outputViewerBundle.json", import.meta.url)));
  for (const title of ["Download", "Hosted"]) {
    const html = buildEngineViewerHtml({ engineScene: contract }, { bundle, title });
    const payload = JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
    const output = createOutputViewerModel(payload.engineScene).scene;
    assert.deepEqual(captions(liveLabels(output)), captions(liveLabels(scene)));
  }
  const ctx = context(); drawEngineOutputLabels(ctx, scene, contract.bounds);
  assert.deepEqual(captions(ctx).map(d => d.text), captions(liveLabels(scene)).map(d => d.text));
  const printed = renderEngineOutputSvg(contract).svg;
  for (const text of ["IN 1", "OUT 1", "LAN"]) assert.match(printed, new RegExp(`font-weight="700"[^>]*>${text}</text>`));
  for (const text of ["HDMI", "SDI", "CAT6A"]) assert.match(printed, new RegExp(`font-weight="800"[^>]*>${text}</text>`));
  assert.doesNotMatch(printed, /font-weight="800"[^>]*>(IN 1|OUT 1|LAN)<\/text>/);
  assert.equal(renderEngineOutputSvg(contract).svg, printed);
});
