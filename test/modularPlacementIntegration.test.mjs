import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPreviewDeviceFromDraft } from "../src/engine/enginePreview.js";
import { resolveModularDeviceLayout } from "../src/engine/modularDeviceLayout.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const SLOT_HEIGHT = 54;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repoRoot, "fixtures/modular-card-placement-project.avd");

function readFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function modularTemplate(root) {
  const template = root.state.deviceLibrary.find(item => item.id === "fixture-tall-modular-chassis");
  assert.ok(template, "fixture modular chassis template should exist");
  return template;
}

function normalizedFixture(root = readFixture()) {
  const project = normalizeAvDesignerProject(root);
  const device = project.devices.find(item => item.id === "fixture-modular");
  assert.ok(device, "normalized modular fixture device should exist");
  return { project, device };
}

function connectorById(device, id) {
  const connector = device.connectors.find(item => item.id === id);
  assert.ok(connector, `expected connector ${id}`);
  return connector;
}

function visualCardById(device, id) {
  const card = device.visual.visualCards.find(item => item.id === id);
  assert.ok(card, `expected visual card ${id}`);
  return card;
}

function displayedSideConnector(id, side, direction, y) {
  const x = side === "right" ? 420 : 0;
  return {
    id,
    schemaVersion: 2,
    type: "hdmi",
    direction,
    signalDirection: direction,
    displaySide: side,
    primaryAnchorId: side,
    x,
    y,
    anchors: [
      { id: side, side, x, y, primary: true }
    ]
  };
}

function displaySideParityTemplate() {
  return {
    id: "display-side-parity-template",
    schemaVersion: 2,
    deviceDefinitionVersion: 2,
    name: "Display Side Parity",
    width: 420,
    height: 520,
    hasSwappableCards: true,
    connectors: [
      displayedSideConnector("chassis-output-left", "left", "output", 152)
    ],
    cardTypes: [
      {
        id: "left-input-card",
        name: "Left Input Card",
        kind: "input",
        connectors: [
          displayedSideConnector("card-input", "left", "input", 40)
        ]
      }
    ],
    cardSlots: [
      {
        id: "slot-left-input",
        installedCardTypeId: "left-input-card",
        y: 152,
        connectorOverrides: {
          "card-input": { nameText: "Installed Input" }
        }
      }
    ]
  };
}

function displaySideParityProject(template = displaySideParityTemplate()) {
  return {
    format: "av-designer-project",
    version: 2,
    state: {
      projectName: "Display Side Parity Project",
      nodeLibrary: [],
      deviceLibrary: [
        {
          id: "source-template",
          name: "Source",
          schemaVersion: 2,
          deviceDefinitionVersion: 2,
          width: 420,
          height: 220,
          connectors: [
            displayedSideConnector("source-output", "right", "output", 80)
          ]
        },
        template
      ],
      devices: [
        { instanceId: "source-device", templateId: "source-template", x: 0, y: 0 },
        { instanceId: "parity-device", templateId: template.id, x: 500, y: 0 }
      ],
      connections: [
        {
          id: "wire-to-generated-input",
          cableType: "hdmi",
          from: { deviceId: "source-device", connectorId: "source-output" },
          to: { deviceId: "parity-device", connectorId: "slot-left-input__card-input" }
        }
      ]
    }
  };
}

test("explicit blank New Device preview does not synthesize fallback connector nodes", () => {
  const template = {
    id: "blank-new-device-template",
    schemaVersion: 2,
    deviceDefinitionVersion: 2,
    name: "New Device",
    model: "CUSTOM",
    category: "Misc.",
    width: 380,
    height: 190,
    faceplateDeleted: false,
    connectors: [],
    hasSwappableCards: false,
    cardTypes: [],
    cardSlots: []
  };
  const previewDevice = createPreviewDeviceFromDraft({
    template,
    projectData: {
      state: {
        deviceLibrary: [template],
        nodeLibrary: []
      }
    },
    instance: {
      instanceId: "blank-new-device",
      templateId: template.id,
      name: "New Device",
      x: 0,
      y: 0
    }
  });

  assert.equal(previewDevice.label, "New Device", "blank new device should keep its generic name");
  assert.equal(previewDevice.connectors.length, 0, "blank new device should not gain real connectors");
  assert.equal(previewDevice.portCount, 0, "blank new device should not advertise fallback ports");

  const scene = new SceneGraph();
  scene.setData({ devices: [previewDevice], wires: [], racks: [], meta: {} });
  const sceneDevice = scene.getDevice("blank-new-device");
  assert.ok(sceneDevice, "blank new device should enter SceneGraph");
  assert.equal(sceneDevice.connectors.length, 0, "SceneGraph should preserve the blank connector list");
  assert.equal(sceneDevice.portCount, 0, "SceneGraph should preserve the zero fallback-port count");
});

test("V2 display-side placement agrees across project normalization and Engine preview", () => {
  const template = displaySideParityTemplate();
  const sourceCardSnapshot = JSON.stringify(template.cardTypes);
  const projectData = displaySideParityProject(template);
  const normalized = normalizeAvDesignerProject(projectData);
  const device = normalized.devices.find(item => item.id === "parity-device");
  assert.ok(device, "normalized parity device should exist");
  const previewDevice = createPreviewDeviceFromDraft({
    template,
    instance: {
      instanceId: "parity-preview",
      templateId: template.id,
      x: 0,
      y: 0
    },
    projectData
  });
  const directLayout = resolveModularDeviceLayout({
    startY: 0,
    slotHeight: SLOT_HEIGHT,
    deviceWidth: 420,
    connectors: template.connectors,
    cardTypes: template.cardTypes,
    cardSlots: template.cardSlots,
    preserveRequestedY: true,
    cardSlotY: slot => Number(slot.y) || 0
  });

  const normalizedCard = visualCardById(device, "slot-left-input");
  const previewCard = visualCardById(previewDevice, "slot-left-input");
  const chassisConnector = connectorById(device, "chassis-output-left");
  const generatedConnector = connectorById(device, "slot-left-input__card-input");
  const previewGeneratedConnector = connectorById(previewDevice, "slot-left-input__card-input");

  assert.equal(directLayout.connectorPositions.get("chassis-output-left").sideMask, "left");
  assert.equal(directLayout.cardSlotPositions.get("slot-left-input").y, 206);
  assert.equal(normalizedCard.slotY, 206, "Engine project normalization should displace the card slot");
  assert.equal(previewCard.slotY, 206, "Engine preview draft should use the same displaced card slot");
  assert.equal(chassisConnector.x, 0, "output signal displayed left should remain on the left edge");
  assert.equal(chassisConnector.y, 152);
  assert.equal(chassisConnector.displaySide, "left");
  assert.equal(generatedConnector.y, normalizedCard.slotY + SLOT_HEIGHT);
  assert.equal(previewGeneratedConnector.y, generatedConnector.y);
  assert.deepEqual(previewGeneratedConnector.anchors, generatedConnector.anchors);
  assert.deepEqual(
    normalized.wires.map(wire => [wire.id, wire.fromConnectorId, wire.toConnectorId]),
    [["wire-to-generated-input", "source-output", "slot-left-input__card-input"]],
    "stable generated connector endpoint should survive normalization"
  );
  assert.equal(normalized.meta.skippedWires, 0, "wire to generated connector should not be skipped");
  assert.equal(JSON.stringify(template.cardTypes), sourceCardSnapshot, "normalization must not mutate reusable card definitions");

  const repeated = normalizeAvDesignerProject(JSON.parse(JSON.stringify(projectData)));
  const repeatedDevice = repeated.devices.find(item => item.id === "parity-device");
  assert.equal(visualCardById(repeatedDevice, "slot-left-input").slotY, normalizedCard.slotY);
  assert.deepEqual(
    repeated.wires.map(wire => [wire.id, wire.fromConnectorId, wire.toConnectorId]),
    normalized.wires.map(wire => [wire.id, wire.fromConnectorId, wire.toConnectorId]),
    "repeated normalization should keep generated IDs and wire endpoints stable"
  );
});

function assertInstalledConnector(device, slotId, sourceConnectorId, expected = {}) {
  const id = `${slotId}__${sourceConnectorId}`;
  const connector = connectorById(device, id);
  const visualCard = visualCardById(device, slotId);
  const visualConnector = visualCard.connectors.find(item => item.id === id);
  assert.ok(visualConnector, `expected visual card connector ${id}`);
  const expectedY = visualCard.slotY + SLOT_HEIGHT + Number(expected.rowIndex || 0) * SLOT_HEIGHT;
  assert.equal(connector.cardSlotId, slotId, `${id} should keep its installed slot id`);
  assert.equal(connector.sourceConnectorId, sourceConnectorId, `${id} should keep its source connector id`);
  assert.equal(connector.generatedFromCard, true, `${id} should be marked as generated from a card`);
  assert.equal(connector.rowIndex, expected.rowIndex, `${id} row index`);
  assert.equal(connector.y, expectedY, `${id} should sit on the installed card row`);
  assert.equal(visualConnector.y, connector.y, `${id} visual card y parity`);
  assert.equal(visualConnector.x, connector.x, `${id} visual card x parity`);
  assert.deepEqual(visualConnector.anchors, connector.anchors, `${id} visual card anchor parity`);
  const primary = connector.anchors.find(anchor => anchor.id === connector.primaryAnchorId) || connector.anchors[0];
  assert.ok(primary, `${id} should have a primary anchor`);
  assert.equal(connector.x, primary.x, `${id} top-level x should match primary anchor`);
  assert.equal(connector.y, primary.y, `${id} top-level y should match primary anchor`);
  connector.anchors.forEach(anchor => {
    if (anchor.side === "right") assert.equal(anchor.x, device.width, `${id} right anchor uses installed device width`);
    else assert.equal(anchor.x, 0, `${id} left anchor uses installed device left edge`);
  });
  if (expected.side) assert.equal(connector.side, expected.side, `${id} side`);
  if (expected.displaySide) assert.equal(connector.displaySide, expected.displaySide, `${id} display side`);
  return connector;
}

test("repo modular fixture resolves installed card rows and anchors consistently across Engine consumers", () => {
  const root = readFixture();
  const sourceCardSnapshot = JSON.stringify(modularTemplate(root).cardTypes);
  const { project, device } = normalizedFixture(root);
  const scene = new SceneGraph();
  scene.setData(project);
  const previewDevice = createPreviewDeviceFromDraft({
    template: modularTemplate(root),
    instance: {
      instanceId: "fixture-preview",
      templateId: "fixture-tall-modular-chassis",
      name: "Fixture Preview",
      x: 0,
      y: 0
    },
    projectData: root
  });

  const expectedSlotY = new Map([
    ["slot-alpha", 234],
    ["slot-beta", 558],
    ["slot-gamma", 774]
  ]);
  for (const [slotId, slotY] of expectedSlotY) {
    assert.equal(visualCardById(device, slotId).slotY, slotY, `${slotId} resolved slot row`);
    assert.equal(visualCardById(previewDevice, slotId).slotY, slotY, `${slotId} preview resolved slot row`);
  }

  const alphaInput = assertInstalledConnector(device, "slot-alpha", "io-in-a", { rowIndex: 0, side: "left", displaySide: "left" });
  const alphaOutput = assertInstalledConnector(device, "slot-alpha", "io-out-a", { rowIndex: 0, side: "right", displaySide: "right" });
  const alphaBoth = assertInstalledConnector(device, "slot-alpha", "io-both-a", { rowIndex: 1, side: "left", displaySide: "both" });
  const betaBoth = assertInstalledConnector(device, "slot-beta", "io-both-a", { rowIndex: 1, side: "left", displaySide: "both" });
  assert.equal(alphaInput.nameText, "Alpha In Override", "per-slot connector overrides should remain applied");
  assert.notEqual(alphaInput.y, connectorById(device, "slot-beta__io-in-a").y, "same source connector in repeated slots must not collapse onto one row");
  assert.notEqual(alphaBoth.y, betaBoth.y, "both-side connectors from repeated slots must not collapse onto one row");

  for (const connector of [alphaInput, alphaOutput, alphaBoth, betaBoth]) {
    const previewConnector = connectorById(previewDevice, connector.id);
    assert.equal(previewConnector.x, connector.x, `${connector.id} preview x parity`);
    assert.equal(previewConnector.y, connector.y, `${connector.id} preview y parity`);
    assert.deepEqual(previewConnector.anchors, connector.anchors, `${connector.id} preview anchor parity`);
    const graphConnector = scene.getConnector("fixture-modular", connector.id);
    assert.ok(graphConnector, `${connector.id} should be available through SceneGraph lookup`);
    assert.equal(graphConnector.y, connector.y, `${connector.id} SceneGraph y parity`);
  }

  assert.equal(project.meta.skippedWires, 0, "wires to generated card connectors should remain valid");
  assert.deepEqual(project.wires.map(wire => wire.id).sort(), [
    "fixture-generated-both-wire",
    "fixture-generated-input-wire",
    "fixture-generated-output-wire"
  ], "all generated connector wires should survive normalization");
  assert.equal(JSON.stringify(modularTemplate(root).cardTypes), sourceCardSnapshot, "normalization must not mutate reusable card definitions");
});

test("coordinate-only card reordering does not invalidate wires, while removing a connector ID does", () => {
  const root = readFixture();
  const original = normalizedFixture(root).project;
  const reordered = readFixture();
  const slots = modularTemplate(reordered).cardSlots;
  slots.find(slot => slot.id === "slot-alpha").y = 612;
  slots.find(slot => slot.id === "slot-beta").y = 180;
  const reorderedProject = normalizedFixture(reordered).project;
  assert.equal(reorderedProject.meta.skippedWires, 0, "moving card slots should not invalidate stable connector IDs");
  assert.deepEqual(
    reorderedProject.wires.map(wire => wire.id).sort(),
    original.wires.map(wire => wire.id).sort(),
    "coordinate-only reordering should preserve all wire IDs"
  );

  const removedConnector = readFixture();
  modularTemplate(removedConnector).cardTypes
    .find(card => card.id === "fixture-v2-io-card")
    .connectors = modularTemplate(removedConnector).cardTypes
      .find(card => card.id === "fixture-v2-io-card")
      .connectors
      .filter(connector => connector.id !== "io-out-a");
  const removedProject = normalizedFixture(removedConnector).project;
  assert.ok(removedProject.meta.skippedWires >= 1, "removing a source connector should invalidate wires using that generated ID");
  assert.ok(!removedProject.wires.some(wire => wire.id === "fixture-generated-output-wire"), "wire using removed generated connector ID should be skipped");
});

test("repo fixture keeps saved technical specs and feature toggle fields intact", () => {
  const root = readFixture();
  const before = modularTemplate(root);
  const after = modularTemplate(JSON.parse(JSON.stringify(root)));
  for (const key of [
    "techSpecs",
    "hasSwappableCards",
    "isLedProcessor",
    "ledOutputCount",
    "isEthernetSwitch",
    "switchPortCount",
    "switchPortType",
    "isMatrixRouter",
    "isPartOfPair",
    "pairedTemplateId",
    "pairPlaceFirst"
  ]) {
    assert.deepEqual(after[key], before[key], `${key} should round-trip through saved project data`);
  }
});
