import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { engineConnectorInfoFields, engineConnectorCanvasLabelLines } from "../src/engine/connectorCompatibility.js";
import { isTransceiverCage } from "../src/engine/transceiverModules.js";
import { legacyConnectorLabelMetrics } from "../src/engine/legacyZoomDetail.js";
import { attachedConnectorLabelPosition } from "../src/engine/attachedConnectorOrientation.js";
import { adapterWorldPoint } from "../src/engine/adapterRotation.js";

const source = readFileSync(new URL("../src/engine/renderer.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf("\nfunction ", start);
  return source.slice(start, end < 0 ? undefined : end);
}

function rendererFunctions(names, bindings = {}) {
  const context = vm.createContext({ attachedConnectorLabelPosition, adapterWorldPoint, ...bindings });
  vm.runInContext(functionSource("connectorAnchorRenderPoint"), context);
  names.forEach(name => vm.runInContext(functionSource(name), context));
  return context;
}

test("shared-bus captions use standalone scale and offsets from their field anchor", () => {
  const labels = rendererFunctions([
    "drawConnectorWorldLabel", "drawSharedBusConnectorWorldLabel", "sharedBusConnectorLabel"
  ], {
    legacyConnectorLabelMetrics,
    engineConnectorCanvasLabelLines, isTransceiverCage,
    engineConnectorPlugTypeLabel: connector => connector.label,
    SHARED_BUS_LABEL_OFFSET: 8,
    SHARED_BUS_LABEL_Y_OFFSET: 18
  });
  const captions = [];
  const ctx = {
    globalAlpha: 1,
    save() {}, restore() {},
    strokeText() {},
    fillText(_text, x, y) { captions.push({ x, y, size: Number(this.font.match(/ ([\d.]+)px /)[1]) }); }
  };
  for (const zoom of [0.34, 0.55, 1, 1.5]) for (const count of [2, 3, 4]) for (const side of ["left", "right"]) {
    const camera = { x: 0, y: 0, zoom };
    const maxY = (count - 1) * 18;
    const fieldAnchorX = 80 + (side === "left" ? 8 : -8), centerY = maxY / 2;
    labels.drawConnectorWorldLabel(ctx, { x: fieldAnchorX, y: centerY }, { side }, "SFP", camera);
    labels.drawSharedBusConnectorWorldLabel(ctx, {
      side: side === "left" ? "input" : "output", connectorX: 80, fieldAnchorX, centerY, maxY,
      members: Array.from({ length: count }, () => ({ label: "SFP" }))
    }, 0, 0, camera);
    const expected = legacyConnectorLabelMetrics(zoom).screenFontSize;
    assert.equal(captions.at(-2).size, expected);
    assert.deepEqual(captions.at(-1), captions.at(-2));
  }
  assert.ok(captions[1].size < 9, "the shared-bus caption must shrink below nine pixels when zoomed out");
});

test("shared-bus info boxes omit empty fields and close the gaps", () => {
  const entries = [];
  const bus = {
    id: "bus-a", type: "hdmi", direction: "input", nameText: "Bus name",
    resolutionFrameRate: "  ", customText: "Long shared field value"
  };
  const ordinary = {
    id: "ordinary", type: "hdmi", direction: "input", nameText: "Ordinary",
    resolutionFrameRate: "", customText: ""
  };
  const device = { id: "device", x: 0, y: 0 };
  const functions = rendererFunctions([
    "drawVisibleConnectorInfoBoxes", "visibleConnectorInfoFields", "connectorInfoBoxKey"
  ], {
    DEFAULT_RENDER_OPTIONS: {}, INFO_BOX_MAGNIFY_ZOOM: 0.8,
    legacyConnectorInfoBoxMode: () => "full",
    visibleDevices: () => [device],
    deviceVisible: () => true, deviceUsesTextureLayer: () => true, isLedSurfaceKind: () => false,
    connectorDisplayLayoutForRender: () => ({
      byConnectorId: new Map([[bus.id, true]]),
      groups: [{ representative: bus, side: "input", fieldAnchorX: 30, centerY: 20, relationshipId: "bus" }]
    }),
    deviceConnectorsForRender: () => [ordinary, bus],
    connectorDisplayAnchors: () => [{ id: "left", side: "left", x: 0, y: 5 }],
    connectorAnchorRenderOpacity: () => 1,
    engineConnectorInfoFields,
    drawConnectorInfoBox: (_ctx, entry) => {
      entries.push(entry);
      return { rect: { x: 0, y: 0, width: 10, height: 10 } };
    },
    zoomDetailStatsForCamera: () => ({})
  });
  const stats = functions.drawVisibleConnectorInfoBoxes({}, {}, { zoom: 1 }, {
    connectorMarkers: true, hideLabels: false
  }, null, { width: 300, height: 200 });
  assert.equal(stats.visible, 3);
  assert.deepEqual(entries.filter(entry => entry.connectorId === "bus-a").map(entry => [entry.field, entry.index]), [
    ["nameText", 0], ["customText", 1]
  ]);
  assert.deepEqual(entries.filter(entry => entry.connectorId === "ordinary").map(entry => entry.field), ["nameText"]);

  entries.length = 0;
  bus.nameText = "";
  bus.customText = "";
  functions.drawVisibleConnectorInfoBoxes({}, {}, { zoom: 1 }, { connectorMarkers: true, hideLabels: false });
  assert.equal(entries.filter(entry => entry.connectorId === "bus-a").length, 0);

  entries.length = 0;
  bus.nameText = "Bus name";
  bus.resolutionFrameRate = "4K60";
  bus.customText = "Custom value";
  functions.drawVisibleConnectorInfoBoxes({}, {}, { zoom: 1 }, { connectorMarkers: true, hideLabels: false });
  assert.deepEqual(entries.filter(entry => entry.connectorId === "bus-a").map(entry => entry.index), [0, 1, 2]);
});

test("shared-bus cages reuse installed-module captions and keep low-zoom detail compact", () => {
  const functions = rendererFunctions(["drawSharedBusConnectorWorldLabel", "sharedBusConnectorLabel", "fitCanvasText"], {
    legacyConnectorLabelMetrics, engineConnectorCanvasLabelLines,
    engineConnectorPlugTypeLabel: () => "SDI", SHARED_BUS_LABEL_OFFSET: 8, SHARED_BUS_LABEL_Y_OFFSET: 18
  });
  const drawn = [], ctx = { save() {}, restore() {}, strokeText() {}, fillText(text) { drawn.push(text); }, measureText(text) { return { width: text.length * 4 }; } };
  const layout = { side: "input", connectorX: 0, centerY: 100, members: [0, 1].map(id => ({ id,
    type: "sfp-plus-cage", installedModuleType: "sfp-sdi-12g-rx" })) };
  const before = structuredClone(layout);
  functions.drawSharedBusConnectorWorldLabel(ctx, layout, 0, 0, { x: 0, y: 0, zoom: 1 }, 180);
  assert.deepEqual(drawn, ["Installed Module", "SFP SDI 12G RX"]);
  drawn.length = 0;
  functions.drawSharedBusConnectorWorldLabel(ctx, layout, 0, 0, { x: 0, y: 0, zoom: 0.34 }, 180);
  assert.deepEqual(drawn, ["SFP SDI 12G RX"]);
  assert.deepEqual(layout, before);
});

test("info-box values wrap long words using their rendered font and stay inside the box", () => {
  const functions = rendererFunctions(["drawScreenInfoBoxText", "wrapScreenInfoBoxLines", "fitScreenText"]);
  const drawn = [];
  const ctx = {
    save() {}, restore() {}, strokeText() {},
    fillText(text) { drawn.push({ text, font: this.font }); },
    measureText(text) {
      const size = Number(this.font.match(/ ([\d.]+)px /)[1]);
      return { width: String(text).length * size * 0.56 };
    }
  };
  const rect = { x: 0, y: 0, width: 44, height: 15.5 };
  const availableWidth = rect.width - 7;
  functions.drawScreenInfoBoxText(ctx, rect, 1, "Custom", "VeryLongUnbrokenIdentifierWithNoSpaces");
  const valueLines = drawn.slice(1);
  assert.equal(valueLines.length, 2);
  assert.ok(valueLines[0].text.startsWith("VeryLong"));
  assert.ok(valueLines[1].text.endsWith("..."));
  valueLines.forEach(line => {
    assert.match(line.font, /700 4\.65px/);
    ctx.font = line.font;
    assert.ok(ctx.measureText(line.text).width <= availableWidth, `${line.text} overflows`);
  });
  drawn.length = 0;
  functions.drawScreenInfoBoxText(ctx, rect, 1, "Name", "One two three four five six seven");
  assert.equal(drawn.slice(1).length, 2);
  drawn.slice(1).forEach(line => {
    ctx.font = line.font;
    assert.ok(ctx.measureText(line.text).width <= availableWidth);
  });
});
