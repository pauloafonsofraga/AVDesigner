import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MODULAR_LAYOUT_SLOT_HEIGHT,
  resolveInstalledCardConnectors,
  resolveModularDeviceLayout
} from "../src/engine/modularDeviceLayout.js";
import { normalizeAvDesignerDevice } from "../src/engine/projectAdapter.js";

const INDEX_HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const SLOT = MODULAR_LAYOUT_SLOT_HEIGHT;
const START_Y = 180;
const DEVICE_WIDTH = 420;

function editorPanel(name) {
  const match = INDEX_HTML.match(new RegExp(`<section class="editor-panel[^"]*" data-editor-panel="${name}">([\\s\\S]*?)</section>`));
  return match?.[1] || "";
}

function cardTypes() {
  return [
    {
      id: "input-card",
      name: "Input Card",
      kind: "input",
      connectors: [
        { id: "in-a", type: "hdmi", direction: "input", y: 40 },
        { id: "in-b", type: "sdi", direction: "input", y: 94 }
      ]
    },
    {
      id: "output-card",
      name: "Output Card",
      kind: "output",
      connectors: [
        { id: "out-a", type: "hdmi", direction: "output", y: 40 },
        { id: "out-b", type: "sdi", direction: "output", y: 94 }
      ]
    },
    {
      id: "io-card",
      name: "I/O Card",
      kind: "io",
      connectors: [
        { id: "io-in", type: "dvi", direction: "input", y: 40 },
        { id: "io-out", type: "dvi", direction: "output", y: 40 }
      ]
    }
  ];
}

function modularTemplate(overrides = {}) {
  return {
    id: "device-editor-card-workflow",
    name: "Device Editor Card Workflow",
    schemaVersion: 2,
    deviceDefinitionVersion: 2,
    width: DEVICE_WIDTH,
    height: 640,
    hasSwappableCards: true,
    connectors: [],
    cardTypes: cardTypes(),
    cardSlots: [],
    ...overrides
  };
}

function expand(template) {
  return resolveInstalledCardConnectors({
    connectors: template.connectors || [],
    cardSlots: template.cardSlots || [],
    cardTypes: template.cardTypes || [],
    deviceWidth: DEVICE_WIDTH,
    sourceDeviceWidth: 380,
    slotHeight: SLOT,
    startY: START_Y,
    preserveRequestedY: true,
    mergeConnector: (slot, connector) => ({
      ...connector,
      ...(slot.connectorOverrides?.[connector.id] || {})
    })
  });
}

function projectDevice(template) {
  return normalizeAvDesignerDevice({
    state: {
      devices: [{ instanceId: "device-1", templateId: template.id, x: 0, y: 0 }],
      deviceLibrary: [template],
      nodeLibrary: []
    }
  }, { instanceId: "device-1", templateId: template.id, x: 0, y: 0 }, 0);
}

function assertNoSideOverlap(layout) {
  const occupied = new Set();
  layout.items.forEach(item => {
    const sides = item.sideMask === "both" ? ["left", "right"] : [item.sideMask];
    sides.forEach(side => {
      for (let lane = item.lane; lane < item.endLane; lane += 1) {
        const key = `${side}:${lane}`;
        assert.equal(occupied.has(key), false, `${item.id} overlaps ${key}`);
        occupied.add(key);
      }
    });
  });
}

test("Device Editor exposes card slot workflow in Connectors instead of a Slots tab", () => {
  const connectorsPanel = editorPanel("connectors");
  const cardsPanel = editorPanel("cards");
  const toolbarOrder = [
    'id="addInputNode"',
    'id="addOutputNode"',
    'connector-toolbar-separator"',
    'id="addCardSlot"',
    'id="cardPalette"'
  ];
  const cardToolbarOrder = [
    'id="editorCardSelect"',
    'id="newCardType"',
    'id="duplicateCardType"',
    'id="deleteCardType"',
    'connector-toolbar-separator"',
    'id="addCardInputNode"',
    'id="addCardOutputNode"'
  ];
  let previousToolbarIndex = -1;
  let previousCardToolbarIndex = -1;

  assert.doesNotMatch(INDEX_HTML, /data-editor-tab="slots"/);
  assert.doesNotMatch(INDEX_HTML, /data-editor-panel="slots"/);
  assert.doesNotMatch(INDEX_HTML, /editorActiveTab\s*[!=]==\s*"slots"/);
  assert.match(connectorsPanel, /connector-authoring-toolbar/);
  assert.match(connectorsPanel, /connector-card-tools/);
  assert.match(connectorsPanel, /id="addInputNode"/);
  assert.match(connectorsPanel, /id="addOutputNode"/);
  assert.match(connectorsPanel, /id="slotsDisabled"/);
  assert.match(connectorsPanel, /id="addCardSlot"/);
  assert.match(connectorsPanel, /id="cardPalette"/);
  assert.match(connectorsPanel, /id="cardSlotList"/);
  toolbarOrder.forEach(needle => {
    const index = connectorsPanel.indexOf(needle, previousToolbarIndex + 1);
    assert.ok(index >= 0, `${needle} should exist in the Connectors toolbar`);
    assert.ok(index > previousToolbarIndex, `${needle} should be ordered in the Connectors toolbar`);
    previousToolbarIndex = index;
  });
  assert.match(connectorsPanel, /connector-toolbar-separator[\s\S]*>\|</);
  assert.doesNotMatch(connectorsPanel, /editor-panel-note/);
  assert.doesNotMatch(connectorsPanel, /These are fixed chassis connectors|Drag an available card|Drop a card into the preview/);
  assert.doesNotMatch(connectorsPanel, /<label>Available Cards<\/label>/);
  assert.match(INDEX_HTML, /const SWAPPABLE_CARD_ICON_DATA_URI = "data:image\/png;base64,/);
  assert.match(INDEX_HTML, /<img class="card-chip-icon" src="\$\{SWAPPABLE_CARD_ICON_DATA_URI\}" alt="" aria-hidden="true" draggable="false">/);
  assert.doesNotMatch(INDEX_HTML, /\.card-chip::before/);
  assert.doesNotMatch(cardsPanel, /id="addCardSlot"|id="cardPalette"|id="cardSlotList"/);
  assert.match(cardsPanel, /card-editor-toolbar/);
  assert.match(cardsPanel, /id="newCardType"/);
  assert.match(cardsPanel, /id="addCardInputNode"/);
  assert.match(cardsPanel, /id="addCardOutputNode"/);
  cardToolbarOrder.forEach(needle => {
    const index = cardsPanel.indexOf(needle, previousCardToolbarIndex + 1);
    assert.ok(index >= 0, `${needle} should exist in the Cards toolbar`);
    assert.ok(index > previousCardToolbarIndex, `${needle} should be ordered in the Cards toolbar`);
    previousCardToolbarIndex = index;
  });
  assert.doesNotMatch(cardsPanel, /editor-panel-note/);
  assert.doesNotMatch(cardsPanel, /id="cardConnectorList"|id="editorCardName"|id="editorCardKind"|id="editorCardCaptionTextColor"|id="editorCardCaptionBackgroundColor"/);
  assert.match(INDEX_HTML, /id="cardInspectorPanel"/);
  assert.match(INDEX_HTML, /id="cardConnectorList"/);
});

test("card type drops create installed preview slots or replace selected bands", () => {
  assert.match(INDEX_HTML, /application\/x-av-card-type/);
  assert.match(INDEX_HTML, /editorPreviewCanCreateCardSlotFromDrop/);
  assert.match(INDEX_HTML, /addEditorCardSlot\(\{ cardTypeId, y: point\.y \}\)/);
  assert.match(INDEX_HTML, /installCardInSlot\(Number\(cardSlot\.dataset\.editorCardSlot\), cardTypeId\)/);
  assert.match(INDEX_HTML, /function editorResolvedCardSlotY[\s\S]*resolveEditorModularLayout/);
  assert.match(INDEX_HTML, /function reorderCardSlot[\s\S]*normalizeMixedDeviceRows/);
});

test("old projects with saved card slots load with generated connector and visual parity", () => {
  const template = modularTemplate({
    cardSlots: [{
      id: "old-slot",
      name: "Old Slot",
      installedCardTypeId: "input-card",
      y: START_Y + SLOT,
      connectorOverrides: {
        "in-a": { nameText: "Camera A", customText: "Rack 1" }
      }
    }]
  });
  const normalized = projectDevice(template);
  const generated = normalized.connectors.find(connector => connector.id === "old-slot__in-a");
  const visualConnector = normalized.visual.visualCards[0]?.connectors.find(connector => connector.id === "old-slot__in-a");

  assert.ok(generated);
  assert.ok(visualConnector);
  assert.equal(generated.nameText, "Camera A");
  assert.equal(visualConnector.nameText, "Camera A");
  assert.equal(visualConnector.x, generated.x);
  assert.equal(visualConnector.y, generated.y);
});

test("direct drop data creates a stable slot and installed connector IDs", () => {
  const template = modularTemplate({
    cardSlots: [{
      id: "card-slot-1",
      name: "Card Slot 1",
      installedCardTypeId: "io-card",
      y: START_Y + SLOT * 2,
      connectorOverrides: {}
    }]
  });
  const expansion = expand(template);
  const ids = expansion.connectors.map(connector => connector.id).sort();

  assert.deepEqual(ids, ["card-slot-1__io-in", "card-slot-1__io-out"]);
  assert.equal(expansion.layout.cardSlotPositions.get("card-slot-1").y, START_Y + SLOT * 2);
  expansion.connectors.forEach(connector => {
    assert.equal(connector.cardSlotId, "card-slot-1");
    assert.equal(connector.generatedFromCard, true);
  });
});

test("replacing an installed card preserves the slot ID and uses the new card connectors", () => {
  const slot = {
    id: "replace-slot",
    name: "Replace Slot",
    installedCardTypeId: "input-card",
    y: START_Y,
    connectorOverrides: { "in-a": { nameText: "Preserved only when connector exists" } }
  };
  const before = expand(modularTemplate({ cardSlots: [slot] })).connectors.map(connector => connector.id).sort();
  slot.installedCardTypeId = "output-card";
  const after = expand(modularTemplate({ cardSlots: [slot] })).connectors.map(connector => connector.id).sort();

  assert.equal(slot.id, "replace-slot");
  assert.deepEqual(before, ["replace-slot__in-a", "replace-slot__in-b"]);
  assert.deepEqual(after, ["replace-slot__out-a", "replace-slot__out-b"]);
});

test("dragging an existing slot resolves through fixed nodes and other cards without overlap", () => {
  const layout = resolveModularDeviceLayout({
    startY: START_Y,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: [
      { id: "fixed-left", type: "hdmi", direction: "input", y: START_Y },
      { id: "fixed-right", type: "hdmi", direction: "output", y: START_Y + SLOT }
    ],
    cardTypes: cardTypes(),
    cardSlots: [
      { id: "moving-slot", installedCardTypeId: "io-card", y: START_Y },
      { id: "lower-slot", installedCardTypeId: "input-card", y: START_Y + SLOT * 5 }
    ]
  });

  assert.equal(layout.connectorPositions.get("fixed-left").y, START_Y);
  assert.ok(layout.cardSlotPositions.get("moving-slot").y > START_Y);
  assert.ok(layout.connectorPositions.get("fixed-right").y > layout.cardSlotPositions.get("moving-slot").y);
  assert.equal(layout.cardSlotPositions.has("lower-slot"), true);
  assertNoSideOverlap(layout);
});

test("deleting a slot removes its installed connectors while preserving unrelated slot IDs", () => {
  const template = modularTemplate({
    cardSlots: [
      { id: "delete-slot", installedCardTypeId: "input-card", y: START_Y, connectorOverrides: {} },
      { id: "keep-slot", installedCardTypeId: "output-card", y: START_Y + SLOT * 4, connectorOverrides: {} }
    ]
  });
  const before = expand(template).connectors.map(connector => connector.id).sort();
  template.cardSlots = template.cardSlots.filter(slot => slot.id !== "delete-slot");
  const after = expand(template).connectors.map(connector => connector.id).sort();

  assert.deepEqual(before, ["delete-slot__in-a", "delete-slot__in-b", "keep-slot__out-a", "keep-slot__out-b"]);
  assert.deepEqual(after, ["keep-slot__out-a", "keep-slot__out-b"]);
  assert.equal(template.cardSlots[0].id, "keep-slot");
});

test("slot IDs and overrides survive save/reload and Has Card Slots off/on", () => {
  const template = modularTemplate({
    cardSlots: [{
      id: "stable-slot",
      installedCardTypeId: "input-card",
      y: START_Y,
      connectorOverrides: { "in-a": { nameText: "Reloaded Name" } }
    }]
  });
  const reloaded = JSON.parse(JSON.stringify(template));
  const generated = projectDevice(reloaded).connectors.find(connector => connector.id === "stable-slot__in-a");
  const toggleHandler = INDEX_HTML.match(/editorHasCards\.addEventListener\("change", \(\) => \{([\s\S]*?)\n    \}\);/)?.[1] || "";

  assert.equal(generated?.nameText, "Reloaded Name");
  assert.deepEqual(reloaded.cardSlots, template.cardSlots);
  assert.doesNotMatch(toggleHandler, /cardSlots\s*=/);
  assert.doesNotMatch(toggleHandler, /cardTypes\s*=/);
});
