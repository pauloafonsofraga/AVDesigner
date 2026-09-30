import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { engineConnectorColor, engineSignalLineColor } from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { createPreviewDeviceFromDraft } from "../src/engine/enginePreview.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { ledRackPortsFixture } from "../fixtures/led-rack-ports.mjs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { isLedSurfaceCompatibleCableType } from "../src/engine/ledSurfaceModel.js";
import { ledProcessorOutputsInRect, restoreProjectLedProcessorSignalTypes,
  selectedLedProcessorOutputs } from "../src/engine/ledProcessorConnections.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const functionSource = name => html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0];
const shellColor = vm.runInNewContext(`(${functionSource("colorForConnector")})`, { signalLineColor: engineSignalLineColor });

test("LED connector overrides agree between editor and Engine; empty overrides retain all palette defaults", () => {
  for (let signalIndex = 1; signalIndex <= 20; signalIndex++) {
    for (const customColor of [undefined, "", "#12ab34", "#ff7800"]) {
      const connector = { type: "led-signal", direction: "output", signalIndex, customColor };
      const expected = customColor || engineSignalLineColor(signalIndex);
      assert.equal(engineConnectorColor(connector), expected);
      assert.equal(shellColor(connector), expected);
    }
  }
});

test("custom LED colors survive project serialization, rack normalization, preview and output scene", () => {
  const project = ledRackPortsFixture();
  const source = project.devices[0].templateOverride;
  source.connectors[0].customColor = "#12ab34";
  source.connectors[1].customColor = "#ab34cd";
  const saved = JSON.stringify(project);
  const normalized = normalizeAvDesignerProject(JSON.parse(saved)).devices.find(d => d.id === "main");
  const preview = createPreviewDeviceFromDraft({ template: source });
  const output = buildEngineOutputScene(JSON.parse(saved)).devices.find(d => d.id === "main");
  for (const device of [normalized, preview, output]) {
    assert.equal(device.connectors[0].color, "#12ab34");
    assert.equal(device.connectors[0].customColor, "#12ab34");
    assert.equal(device.connectors[1].color, "#ab34cd");
    assert.equal(device.connectors[2].color, engineSignalLineColor(3));
  }
  assert.equal(JSON.stringify(project), saved, "normalizing and exporting never mutates source data");
});

test("orphaned personal LED signal aliases recover colors, marquee sources and LED surface targets", () => {
  const project = ledRackPortsFixture();
  const alias = "led-signal-personal-f00a0e90-2";
  const processor = project.devices[0].templateOverride;
  processor.connectors.slice(0, 3).forEach(connector => {
    connector.type = alias;
    connector.physicalType = alias;
    connector.connectorType = alias;
  });
  processor.connectors[1].customColor = "#123456";
  project.deviceLibrary = [structuredClone(processor)];
  const sibling = project.devices[1].templateOverride.connectors[0];
  sibling.type = alias;
  const originalIndexes = processor.connectors.map(connector => connector.signalIndex);
  assert.equal(restoreProjectLedProcessorSignalTypes(project), 6);
  assert.equal(restoreProjectLedProcessorSignalTypes(project), 0);
  assert.deepEqual(processor.connectors.map(connector => connector.signalIndex), originalIndexes);
  assert.equal(sibling.type, alias, "an unrelated device's custom connector is untouched");
  assert.deepEqual(processor.connectors.slice(0, 3).map(connector =>
    [connector.type, connector.physicalType, connector.connectorType]),
  Array.from({ length: 3 }, () => ["led-signal", "led-signal", "led-signal"]));
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  const device = scene.getDevice("main");
  assert.equal(scene.getConnector("main", "out-1").color, engineSignalLineColor(1));
  assert.equal(scene.getConnector("main", "out-2").color, "#123456");
  assert.equal(scene.getConnector("main", "out-3").color, engineSignalLineColor(3));
  const points = [1, 2, 3].map(index => scene.connectorWorldPoint(device, scene.getConnector("main", `out-${index}`)));
  const rect = { x: Math.min(...points.map(point => point.x)) - 2,
    y: Math.min(...points.map(point => point.y)) - 2, width: 4,
    height: Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)) + 4 };
  assert.deepEqual(ledProcessorOutputsInRect(scene, rect).map(output => output.connectorId), ["out-1", "out-2", "out-3"]);
  assert.deepEqual(selectedLedProcessorOutputs(scene, ["main:out-1", "main:out-2"]).map(output => output.connectorId), ["out-1", "out-2"]);
  assert.equal(isLedSurfaceCompatibleCableType(scene.getConnector("main", "out-1").type), true);
});

test("LED override handling does not change ordinary and fiber connector colors", () => {
  assert.equal(engineConnectorColor({ type: "misc", customColor: "#12ab34" }), "#12ab34");
  for (const type of ["hdmi", "sdi", "fiber-lc"]) {
    assert.equal(engineConnectorColor({ type, customColor: "#12ab34" }), engineConnectorColor({ type }));
  }
});

test("Apply validation retains LED colors instead of stripping non-Misc overrides", () => {
  const validate = vm.runInNewContext(`(${functionSource("validateDeviceTemplate")})`, {
    validateDraftDefaults() {}, isAdapterTemplate: () => false, DEVICE_WIDTH: 280,
    ensureModularDefaults() {}, deviceTemplateWidth: () => 280, deviceHeightForSlotCounts: () => 480,
    cableTypes: { misc: { color: "#888888" } }
  });
  const template = structuredClone(ledRackPortsFixture().devices[0].templateOverride);
  Object.assign(template, { model: "Test", category: "LED Processors", cardTypes: [], cardSlots: [] });
  template.connectors[0].customColor = "#12ab34";
  validate(template);
  assert.equal(template.connectors[0].customColor, "#12ab34");
  assert.equal(template.connectors[1].customColor, "");
});
