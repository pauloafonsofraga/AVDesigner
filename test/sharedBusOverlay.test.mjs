import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { engineConnectorInfoFields } from "../src/engine/connectorCompatibility.js";
import { legacyConnectorLabelMetrics } from "../src/engine/legacyZoomDetail.js";

const source = readFileSync(new URL("../src/engine/renderer.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf("\nfunction ", start);
  return source.slice(start, end < 0 ? undefined : end);
}

function rendererFunctions(names, bindings = {}) {
  const context = vm.createContext(bindings);
  names.forEach(name => vm.runInContext(functionSource(name), context));
  return context;
}

test("shared-bus labels use the standalone connector zoom scale", () => {
  const labels = rendererFunctions([
    "drawConnectorWorldLabel", "drawSharedBusConnectorWorldLabel", "sharedBusConnectorLabel"
  ], {
    legacyConnectorLabelMetrics,
    engineConnectorPlugTypeLabel: connector => connector.label,
    SHARED_BUS_LABEL_OFFSET: 8,
    SHARED_BUS_LABEL_Y_OFFSET: 18
  });
  const fontSizes = [];
  const ctx = {
    globalAlpha: 1,
    save() {}, restore() {},
    strokeText() {},
    fillText() { fontSizes.push(Number(this.font.match(/ ([\d.]+)px /)[1])); }
  };
  for (const zoom of [0.34, 0.55, 1, 1.5]) {
    const camera = { x: 0, y: 0, zoom };
    labels.drawConnectorWorldLabel(ctx, { x: 0, y: 0 }, { side: "left" }, "SFP", camera);
    labels.drawSharedBusConnectorWorldLabel(ctx, {
      side: "input", connectorX: 0, centerY: 0, members: [{ label: "SFP" }]
    }, 0, 0, camera);
    const expected = legacyConnectorLabelMetrics(zoom).screenFontSize;
    assert.equal(fontSizes.at(-2), expected);
    assert.equal(fontSizes.at(-1), expected);
  }
  assert.ok(fontSizes[1] < 9, "the shared-bus caption must shrink below nine pixels when zoomed out");
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
