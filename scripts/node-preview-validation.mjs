import assert from "node:assert/strict";

import { connectorDisplayAnchors, createConnectorDisplayLayout } from "../src/engine/connectorDisplayLayout.js";
import {
  createNodeBuilderPreviewDevice,
  createNodeBuilderPreviewScene,
  nodeBuilderPreviewSummary,
  NODE_PREVIEW_BUILD_ID,
  NODE_PREVIEW_CONNECTOR_ID,
  NODE_PREVIEW_DEVICE_ID,
  NODE_PREVIEW_TEMPLATE_ID
} from "../src/engine/nodePreview.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const nodeLibrary = [
  nodeType("hdmi", "HDMI", "#FFD400", { videoCable: true }),
  nodeType("dvi", "DVI", "#22C55E", { videoCable: true }),
  nodeType("sdi", "SDI", "#38BDF8"),
  nodeType("cat6a", "CAT6A", "#6B7280"),
  nodeType("ethercon", "EtherCON", "#A855F7"),
  nodeType("fiber-lc", "Fiber LC", "#FFFF00", { direction: "two-way" }),
  nodeType("fiber-mpo", "Fiber MPO", "#FFFF00", { direction: "two-way" }),
  nodeType("xlr-3pin", "XLR", "#8B5CF6"),
  nodeType("speakon-nl4", "speakON", "#06B6D4"),
  nodeType("power", "Power", "#94A3B8"),
  nodeType("powerlock", "PowerLock", "#03E300", {
    colors: ["#03E300", "#2A7FFF", "#A05A2C", "#4A4A4A", "#999999"]
  }),
  nodeType("sfp-cage", "SFP Cage", "#94A3B8", { direction: "two-way" }),
  nodeType("qsfp-cage", "QSFP Cage", "#94A3B8", { direction: "two-way" })
];

const representativeTypes = [
  "hdmi",
  "dvi",
  "sdi",
  "cat6a",
  "ethercon",
  "fiber-lc",
  "fiber-mpo",
  "xlr-3pin",
  "speakon-nl4",
  "power",
  "powerlock",
  "sfp-cage",
  "qsfp-cage"
];

const results = {
  buildId: NODE_PREVIEW_BUILD_ID,
  representativeTypes: [],
  persistentIdentity: null,
  segmented: null,
  cages: null,
  fiberModes: null
};

for (const typeId of representativeTypes) {
  const connectorType = nodeLibrary.find(node => node.id === typeId);
  const scene = createNodeBuilderPreviewScene({ typeId, connectorType, nodeLibrary });
  assert.equal(scene.meta.previewBuildId, NODE_PREVIEW_BUILD_ID, `${typeId} exposes preview build id`);
  assert.equal(scene.meta.source, "node-builder-canvas-appearance", `${typeId} scene source is explicit`);
  assert.equal(scene.devices.length, 1, `${typeId} preview creates one synthetic device`);
  assert.equal(scene.wires.length, 0, `${typeId} preview does not create wires`);
  assert.equal(scene.racks.length, 0, `${typeId} preview does not create racks`);

  const device = scene.devices[0];
  assert.equal(device.id, NODE_PREVIEW_DEVICE_ID, `${typeId} uses stable preview device id`);
  assert.equal(device.templateId, NODE_PREVIEW_TEMPLATE_ID, `${typeId} uses stable preview template id`);
  assert.equal(device.connectors.length, 1, `${typeId} preview device contains one connector`);
  assert.equal(device.connectors[0].id, NODE_PREVIEW_CONNECTOR_ID, `${typeId} uses stable preview connector id`);
  assert.equal(device.connectors[0].x, 0, `${typeId} connector is attached to a real device edge`);

  const graph = new SceneGraph();
  graph.setData(scene);
  const normalizedDevice = graph.getDevice(NODE_PREVIEW_DEVICE_ID);
  assert.ok(normalizedDevice, `${typeId} normalized preview device enters SceneGraph`);
  const layout = createConnectorDisplayLayout(normalizedDevice);
  const anchors = connectorDisplayAnchors(normalizedDevice, normalizedDevice.connectors[0], layout);
  assert.ok(anchors.length >= 1, `${typeId} production connector layout yields an anchor`);
  assert.equal(anchors[0].side, "left", `${typeId} default preview anchor is on the left edge`);

  const summary = nodeBuilderPreviewSummary(scene);
  assert.equal(summary.source, "EnginePreviewSurface", `${typeId} summary reports Engine preview source`);
  assert.equal(summary.productionVisual, true, `${typeId} summary reports production visual`);
  assert.equal(summary.cropPreview, "authoring-only", `${typeId} crop remains classified separately`);
  assert.equal(summary.connectorId, NODE_PREVIEW_CONNECTOR_ID, `${typeId} summary preserves connector id`);

  results.representativeTypes.push({
    typeId,
    effectiveType: summary.effectiveType,
    color: summary.color,
    segments: summary.colorSegments.length,
    label: summary.label
  });
}

const firstDevice = createNodeBuilderPreviewDevice({
  typeId: "hdmi",
  connectorType: nodeLibrary.find(node => node.id === "hdmi"),
  nodeLibrary
});
const secondDevice = createNodeBuilderPreviewDevice({
  typeId: "sdi",
  connectorType: nodeLibrary.find(node => node.id === "sdi"),
  nodeLibrary
});
assert.equal(firstDevice.id, secondDevice.id, "selection changes reuse the same preview device identity");
assert.equal(firstDevice.connectors[0].id, secondDevice.connectors[0].id, "selection changes reuse the same connector identity");
results.persistentIdentity = {
  deviceId: firstDevice.id,
  connectorId: firstDevice.connectors[0].id
};

const powerlock = createNodeBuilderPreviewScene({
  typeId: "powerlock",
  connectorType: nodeLibrary.find(node => node.id === "powerlock"),
  nodeLibrary
});
const powerlockSummary = nodeBuilderPreviewSummary(powerlock);
assert.equal(powerlockSummary.effectiveType, "powerlock", "PowerLock effective type stays PowerLock");
assert.ok(powerlockSummary.colorSegments.length >= 4, "PowerLock preview exposes segmented Engine connector colors");
results.segmented = powerlockSummary.colorSegments;

const sfpSummary = nodeBuilderPreviewSummary(createNodeBuilderPreviewScene({
  typeId: "sfp-cage",
  connectorType: nodeLibrary.find(node => node.id === "sfp-cage"),
  nodeLibrary
}));
const qsfpSummary = nodeBuilderPreviewSummary(createNodeBuilderPreviewScene({
  typeId: "qsfp-cage",
  connectorType: nodeLibrary.find(node => node.id === "qsfp-cage"),
  nodeLibrary
}));
assert.equal(sfpSummary.effectiveType, "fiber-lc", "SFP cage preview resolves the installed LC module");
assert.equal(qsfpSummary.effectiveType, "fiber-mpo", "QSFP cage preview resolves the installed MPO module");
assert.equal(sfpSummary.fiberMode, "single-mode", "SFP cage preview carries fiber mode");
assert.equal(qsfpSummary.fiberMode, "single-mode", "QSFP cage preview carries fiber mode");
results.cages = {
  sfp: sfpSummary,
  qsfp: qsfpSummary
};

const fiberModes = ["single-mode", "om1-om2", "om3", "om4", "om5"];
results.fiberModes = fiberModes.map(fiberMode => {
  const scene = createNodeBuilderPreviewScene({
    typeId: "fiber-lc",
    connectorType: nodeLibrary.find(node => node.id === "fiber-lc"),
    nodeLibrary,
    fiberMode
  });
  const summary = nodeBuilderPreviewSummary(scene);
  assert.equal(summary.effectiveType, "fiber-lc", `${fiberMode} preview remains Fiber LC`);
  assert.equal(summary.fiberMode, fiberMode, `${fiberMode} preview carries the requested fiber mode`);
  return { fiberMode, color: summary.color };
});

console.info("Node Builder preview validation passed", results);

function nodeType(id, label, color, options = {}) {
  return {
    id,
    label,
    color,
    direction: options.direction || "one-way",
    thumbnail: "",
    tags: options.tags || [],
    videoCable: options.videoCable === true,
    custom: options.custom === true,
    colors: Array.isArray(options.colors) ? options.colors.slice() : []
  };
}
