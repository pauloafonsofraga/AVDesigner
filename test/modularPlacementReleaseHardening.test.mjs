import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { createPreviewDeviceFromDraft } from "../src/engine/enginePreview.js";
import { resolveModularDeviceLayout } from "../src/engine/modularDeviceLayout.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";

const INDEX_HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const FIXTURE = new URL("../fixtures/modular-placement-release-hardening.avd", import.meta.url);
const SLOT_HEIGHT = 54;

function readFixture() {
  return JSON.parse(readFileSync(FIXTURE, "utf8"));
}

function fixtureTemplate(root = readFixture()) {
  const template = root.state.deviceLibrary.find(item => item.id === "release-modular-chassis");
  assert.ok(template, "release-hardening fixture template should exist");
  return template;
}

function fixtureInstance(root = readFixture()) {
  const instance = root.state.devices.find(item => item.instanceId === "release-modular-instance");
  assert.ok(instance, "release-hardening fixture instance should exist");
  return instance;
}

function normalizedDevice(root = readFixture()) {
  const project = normalizeAvDesignerProject(root);
  const device = project.devices.find(item => item.id === "release-modular-instance");
  assert.ok(device, "normalized release-hardening device should exist");
  return { project, device };
}

function connectorGeometry(connector) {
  return {
    id: connector.id,
    x: connector.x,
    y: connector.y,
    displaySide: connector.displaySide,
    primaryAnchorId: connector.primaryAnchorId,
    anchors: (connector.anchors || []).map(anchor => ({
      id: anchor.id,
      side: anchor.side,
      x: anchor.x,
      y: anchor.y,
      primary: anchor.id === connector.primaryAnchorId
    })),
    cardSlotId: connector.cardSlotId || "",
    sourceConnectorId: connector.sourceConnectorId || ""
  };
}

function cardGeometry(card) {
  return {
    id: card.id,
    slotY: card.slotY,
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
    rowCount: card.rowCount
  };
}

function standaloneViewerGeometryApi() {
  const start = INDEX_HTML.indexOf("function faceAspectHeight(t)");
  const endNeedle = "function effectiveConnectors(template){return[...((template&&template.connectors)||[]),...generatedCardConnectors(template)]}";
  const end = INDEX_HTML.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, "standalone viewer modular geometry block should exist");
  const source = INDEX_HTML.slice(start, end + endNeedle.length);
  const context = {
    Map,
    Set,
    Math,
    Number,
    String,
    Object,
    Array,
    DEVICE_WIDTH: 380,
    ADAPTER_START_Y: 28,
    FACE_MARGIN: 12,
    FACE_TOP_Y: 42,
    FACE_HEIGHT: 86,
    SLOT_HEIGHT,
    cableTypes: {
      hdmi: { label: "HDMI" },
      sdi: { label: "SDI" },
      dvi: { label: "DVI" },
      cat6a: { label: "Cat6A" }
    },
    isAdapterTemplate: () => false,
    powerFaceRect: () => ({ x: 12, y: 42, width: 356, height: 86 })
  };
  return vm.runInNewContext(`${source}; ({ exportResolveLayout, resolvedCardSlotY, cardBandGeometry, generatedCardConnectors })`, context);
}

function semanticSnapshot(root) {
  const template = fixtureTemplate(root);
  const { project, device } = normalizedDevice(root);
  const layout = resolveModularDeviceLayout({
    startY: 0,
    slotHeight: SLOT_HEIGHT,
    deviceWidth: template.width,
    connectors: template.connectors,
    cardTypes: template.cardTypes,
    cardSlots: template.cardSlots,
    preserveRequestedY: true,
    cardSlotY: slot => Number(slot.y) || 0
  });
  return {
    connectorIds: device.connectors.map(connector => connector.id).sort(),
    connectors: device.connectors.map(connectorGeometry).sort((a, b) => a.id.localeCompare(b.id)),
    cards: device.visual.visualCards.map(cardGeometry).sort((a, b) => a.id.localeCompare(b.id)),
    lanes: [...layout.items].map(item => [item.id, item.lane, item.span, item.sideMask]),
    relationships: template.connectorRelationships,
    height: device.height,
    settings: {
      hasSwappableCards: template.hasSwappableCards,
      isLedProcessor: template.isLedProcessor,
      ledOutputCount: template.ledOutputCount,
      isEthernetSwitch: template.isEthernetSwitch,
      switchPortCount: template.switchPortCount,
      switchPortType: template.switchPortType,
      isMatrixRouter: template.isMatrixRouter
    },
    wires: project.wires.map(wire => [wire.id, wire.fromConnectorId, wire.toConnectorId]).sort()
  };
}

test("release-hardening fixture owns every modular placement category with stable explicit IDs", () => {
  const root = readFixture();
  const template = fixtureTemplate(root);
  const connectorIds = new Set(template.connectors.map(connector => connector.id));
  const cardIds = new Set(template.cardTypes.map(card => card.id));
  const slotIds = new Set(template.cardSlots.map(slot => slot.id));

  assert.equal(connectorIds.size, template.connectors.length, "chassis connector IDs should be unique");
  assert.equal(cardIds.size, template.cardTypes.length, "card type IDs should be unique");
  assert.equal(slotIds.size, template.cardSlots.length, "card slot IDs should be unique");
  assert.ok(template.connectors.some(connector => connector.displaySide === "left"));
  assert.ok(template.connectors.some(connector => connector.displaySide === "right"));
  assert.ok(template.connectors.some(connector => connector.displaySide === "both"));
  assert.ok(template.connectors.some(connector => connector.faceplateSide === true));
  assert.ok(template.connectors.some(connector => connector.generatedByLedProcessor === true));
  assert.ok(template.connectors.some(connector => connector.generatedByEthernetSwitch === true));
  assert.ok(template.connectors.some(connector => connector.powerPlug?.manual === true));
  assert.ok(template.connectorRelationships.some(relationship => relationship.type === "through"));
  assert.ok(template.connectorRelationships.some(relationship => relationship.type === "exclusive"));
  assert.deepEqual(template.cardTypes.map(card => card.kind).sort(), ["input", "io", "output"]);
  assert.deepEqual(template.cardTypes.map(card => Math.max(
    card.connectors.filter(connector => connector.direction === "input").length,
    card.connectors.filter(connector => connector.direction !== "input").length
  )).sort((a, b) => a - b), [1, 2, 3], "fixture should cover one-, two-, and three-row card spans");
  assert.ok(template.cardSlots.some(slot => !slot.installedCardTypeId), "fixture should include an empty slot");
  assert.match(template.faceImage, /^data:image\/png;base64,/);
  assert.equal(template.connectors.find(connector => connector.id === "release-both").anchors[1].y - template.connectors.find(connector => connector.id === "release-both").anchors[0].y, 8);
});

test("release-hardening geometry matches Engine preview and standalone exported viewer", () => {
  const root = readFixture();
  const template = fixtureTemplate(root);
  const sourceCards = JSON.stringify(template.cardTypes);
  const instance = fixtureInstance(root);
  const { project, device } = normalizedDevice(root);
  const preview = createPreviewDeviceFromDraft({ template, instance, projectData: root });
  const standalone = standaloneViewerGeometryApi();
  const standaloneConnectors = standalone.generatedCardConnectors(structuredClone(template));

  const engineGenerated = device.connectors.filter(connector => connector.generatedFromCard).map(connectorGeometry).sort((a, b) => a.id.localeCompare(b.id));
  const previewGenerated = preview.connectors.filter(connector => connector.generatedFromCard).map(connectorGeometry).sort((a, b) => a.id.localeCompare(b.id));
  const viewerGenerated = standaloneConnectors.map(connectorGeometry).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(previewGenerated, engineGenerated, "Device Editor Engine preview should match normalized Engine geometry");
  assert.deepEqual(
    JSON.parse(JSON.stringify(viewerGenerated)),
    engineGenerated,
    "standalone viewer should match normalized Engine generated connector geometry"
  );

  const engineCards = device.visual.visualCards.map(cardGeometry).sort((a, b) => a.id.localeCompare(b.id));
  const previewCards = preview.visual.visualCards.map(cardGeometry).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(previewCards, engineCards, "Engine preview card artwork should align with main Engine card bands");
  template.cardSlots.forEach(slot => {
    const engineCard = device.visual.visualCards.find(card => card.id === slot.id);
    assert.ok(engineCard, `Engine card ${slot.id} should exist`);
    const viewerBand = standalone.cardBandGeometry(template, slot);
    assert.equal(viewerBand.y, engineCard.y, `${slot.id} viewer card-band y parity`);
    assert.equal(viewerBand.height, engineCard.height, `${slot.id} viewer card-band span parity`);
  });

  const both = device.connectors.find(connector => connector.id === "release-both");
  assert.equal(both.anchors[1].y - both.anchors[0].y, 8, "authored chassis anchor offset should survive normalization");
  const installedBoth = device.connectors.find(connector => connector.id === "release-slot-io__io-both");
  assert.equal(installedBoth.anchors[1].y - installedBoth.anchors[0].y, 6, "card-local anchor offset should survive installation");
  assert.equal(JSON.stringify(template.cardTypes), sourceCards, "all consumers must leave reusable card definitions unchanged");
  assert.equal(project.meta.skippedWires, 0, "all stable fixture wire endpoints should resolve");
});

test("release-hardening save reload preserves placement semantics and only missing IDs invalidate wires", () => {
  const root = readFixture();
  const before = semanticSnapshot(root);
  const reloaded = JSON.parse(JSON.stringify(root));
  assert.deepEqual(semanticSnapshot(reloaded), before, "JSON save/reload should preserve the complete semantic snapshot");

  const moved = JSON.parse(JSON.stringify(root));
  const movedTemplate = fixtureTemplate(moved);
  movedTemplate.cardSlots.find(slot => slot.id === "release-slot-input").y += SLOT_HEIGHT;
  movedTemplate.connectors.find(connector => connector.id === "release-right").y += SLOT_HEIGHT;
  const movedProject = normalizeAvDesignerProject(moved);
  assert.equal(movedProject.meta.skippedWires, 0, "coordinate-only edits must not invalidate stable wire endpoints");
  assert.deepEqual(
    movedProject.wires.map(wire => wire.id).sort(),
    before.wires.map(wire => wire[0]).sort(),
    "coordinate-only edits should preserve every fixture wire"
  );

  const removed = JSON.parse(JSON.stringify(root));
  const outputCard = fixtureTemplate(removed).cardTypes.find(card => card.id === "release-output-card");
  outputCard.connectors = outputCard.connectors.filter(connector => connector.id !== "output-a");
  const removedProject = normalizeAvDesignerProject(removed);
  assert.equal(removedProject.meta.skippedWires, 1, "removing one stable connector ID should invalidate only its wire");
  assert.deepEqual(removedProject.wires.map(wire => wire.id), ["release-wire-input-card"]);
});
