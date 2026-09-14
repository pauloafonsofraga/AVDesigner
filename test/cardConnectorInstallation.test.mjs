import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAvDesignerDevice } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const SLOT_HEIGHT = 54;
const DEVICE_WIDTH = 420;

function normalizeFixtureDevice(template) {
  const instance = {
    instanceId: `${template.id}-instance`,
    templateId: template.id,
    name: template.name,
    x: 100,
    y: 80
  };
  const projectData = {
    state: {
      devices: [instance],
      deviceLibrary: [template],
      nodeLibrary: []
    }
  };
  return normalizeAvDesignerDevice(projectData, instance, 0);
}

function connectorById(device, id) {
  const connector = device.connectors.find(item => item.id === id);
  assert.ok(connector, `expected connector ${id}`);
  return connector;
}

function visualConnectorById(device, cardSlotId, sourceConnectorId) {
  const card = device.visual.visualCards.find(item => item.id === cardSlotId);
  assert.ok(card, `expected visual card ${cardSlotId}`);
  const connector = card.connectors.find(item => item.sourceConnectorId === sourceConnectorId);
  assert.ok(connector, `expected visual card connector ${cardSlotId}/${sourceConnectorId}`);
  return connector;
}

test("generated card connector anchors are rebased from card-local rows into installed slot rows", () => {
  const reusableCardConnectors = [
    {
      id: "shared-input",
      schemaVersion: 2,
      type: "hdmi",
      physicalType: "hdmi",
      connectorType: "hdmi",
      direction: "input",
      signalDirection: "input",
      displaySide: "both",
      primaryAnchorId: "left",
      x: 0,
      y: 24,
      anchors: [
        { id: "left", side: "left", x: 0, y: 24, primary: true },
        { id: "right", side: "right", x: 380, y: 30 }
      ],
      nameText: "SHARED IN",
      customText: "source metadata"
    },
    {
      id: "input-two",
      schemaVersion: 2,
      type: "dvi",
      physicalType: "dvi",
      connectorType: "dvi",
      direction: "input",
      signalDirection: "input",
      displaySide: "left",
      primaryAnchorId: "left",
      x: 0,
      y: 78,
      anchors: [{ id: "left", side: "left", x: 0, y: 78, primary: true }],
      nameText: "DVI IN"
    },
    {
      id: "output-one",
      schemaVersion: 2,
      type: "sdi",
      physicalType: "sdi",
      connectorType: "sdi",
      direction: "output",
      signalDirection: "output",
      displaySide: "right",
      primaryAnchorId: "right",
      x: 380,
      y: 132,
      anchors: [{ id: "right", side: "right", x: 380, y: 132, primary: true }],
      nameText: "SDI OUT"
    }
  ];
  const sourceSnapshot = JSON.stringify(reusableCardConnectors);
  const template = {
    id: "card-anchor-regression-device",
    name: "Card Anchor Regression",
    schemaVersion: 2,
    deviceDefinitionVersion: 2,
    width: DEVICE_WIDTH,
    height: 640,
    hasSwappableCards: true,
    connectors: [],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "shared-card", y: 120 },
      {
        id: "slot-b",
        name: "Slot B",
        installedCardTypeId: "shared-card",
        y: 360,
        connectorOverrides: {
          "input-two": {
            nameText: "DVI IN OVERRIDE",
            customText: "slot override"
          }
        }
      }
    ],
    cardTypes: [{
      id: "shared-card",
      name: "Reusable Shared Card",
      kind: "io",
      connectors: reusableCardConnectors
    }]
  };

  const device = normalizeFixtureDevice(template);
  const scene = new SceneGraph();
  scene.setData({ devices: [device], wires: [], meta: {} });
  const expectedRows = new Map([
    ["slot-a__shared-input", 120 + SLOT_HEIGHT],
    ["slot-a__input-two", 120 + SLOT_HEIGHT * 2],
    ["slot-a__output-one", 120 + SLOT_HEIGHT],
    ["slot-b__shared-input", 360 + SLOT_HEIGHT],
    ["slot-b__input-two", 360 + SLOT_HEIGHT * 2],
    ["slot-b__output-one", 360 + SLOT_HEIGHT]
  ]);

  expectedRows.forEach((expectedY, connectorId) => {
    const connector = connectorById(device, connectorId);
    const primaryAnchor = connector.anchors.find(anchor => anchor.id === connector.primaryAnchorId)
      || connector.anchors.find(anchor => anchor.primary)
      || connector.anchors[0];
    assert.equal(connector.y, expectedY, `${connectorId} should use its installed slot row`);
    assert.equal(primaryAnchor.y, connector.y, `${connectorId} primary anchor y should match connector y`);
    assert.equal(primaryAnchor.x, connector.x, `${connectorId} primary anchor x should match connector x`);
    connector.anchors.forEach(anchor => {
      assert.equal(anchor.x, anchor.side === "right" ? DEVICE_WIDTH : 0, `${connectorId}/${anchor.id} should sit on the installed chassis edge`);
    });
    const sceneConnector = scene.getConnector(device.id, connectorId);
    assert.equal(sceneConnector?.x, connector.x, `${connectorId} scene x should match normalized connector`);
    assert.equal(sceneConnector?.y, connector.y, `${connectorId} scene y should match normalized connector`);
  });

  const slotAShared = connectorById(device, "slot-a__shared-input");
  const slotBShared = connectorById(device, "slot-b__shared-input");
  assert.equal(slotAShared.displaySide, "both", "both-side card connector should keep both display anchors");
  assert.equal(slotAShared.primaryAnchorId, "left", "primary anchor id should survive installation");
  assert.equal(slotAShared.anchors.length, 2, "both-side generated connector should keep two anchors");
  assert.equal(slotAShared.anchors.find(anchor => anchor.id === "right")?.y, slotAShared.y + 6, "relative anchor y offsets should survive rebasing");
  assert.notEqual(slotAShared.y, slotBShared.y, "same card type installed in different slots must not collapse onto one row");

  const overridden = connectorById(device, "slot-b__input-two");
  assert.equal(overridden.nameText, "DVI IN OVERRIDE", "slot connector override should be preserved");
  assert.equal(overridden.customText, "slot override", "slot metadata override should be preserved");
  assert.equal(overridden.sourceConnectorId, "input-two", "source connector id should be preserved");
  assert.equal(overridden.cardSlotId, "slot-b", "card slot id should be preserved");
  assert.equal(overridden.cardTypeId, "shared-card", "card type id should be preserved");
  assert.equal(overridden.generatedFromCard, true, "generated card marker should be preserved");

  ["shared-input", "input-two", "output-one"].forEach(sourceConnectorId => {
    ["slot-a", "slot-b"].forEach(slotId => {
      const connector = connectorById(device, `${slotId}__${sourceConnectorId}`);
      const visualConnector = visualConnectorById(device, slotId, sourceConnectorId);
      assert.equal(visualConnector.x, connector.x, `${slotId}/${sourceConnectorId} visual x should match live connector x`);
      assert.equal(visualConnector.y, connector.y, `${slotId}/${sourceConnectorId} visual y should match live connector y`);
    });
  });

  assert.equal(JSON.stringify(reusableCardConnectors), sourceSnapshot, "normalization must not mutate reusable card-local connectors");
});

test("legacy card connectors without V2 anchors still install at slot rows", () => {
  const template = {
    id: "legacy-card-regression-device",
    name: "Legacy Card Regression",
    width: DEVICE_WIDTH,
    height: 360,
    hasSwappableCards: true,
    connectors: [],
    cardSlots: [{ id: "legacy-slot", installedCardTypeId: "legacy-card", y: 210 }],
    cardTypes: [{
      id: "legacy-card",
      name: "Legacy Output Card",
      kind: "output",
      connectors: [
        { id: "legacy-out", type: "hdmi", direction: "output", label: "HDMI" }
      ]
    }]
  };

  const device = normalizeFixtureDevice(template);
  const connector = connectorById(device, "legacy-slot__legacy-out");
  assert.equal(connector.x, DEVICE_WIDTH, "legacy output card connector should use installed device width");
  assert.equal(connector.y, 210 + SLOT_HEIGHT, "legacy card connector should use installed slot row");
  assert.equal(connector.anchors[0]?.x, DEVICE_WIDTH, "legacy generated primary anchor should use installed right edge");
  assert.equal(connector.anchors[0]?.y, connector.y, "legacy generated primary anchor should match installed y");
});
