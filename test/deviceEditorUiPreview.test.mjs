import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  createPreviewDeviceFromDraft,
  fitCameraToBounds,
  previewDeviceVisualKey
} from "../src/engine/enginePreview.js";
import * as placementMotionModule from "../src/engine/deviceEditorPlacementMotion.js";
import {
  connectorPlacementSideMask,
  createModularCompositeInsertionDragSession,
  createModularInsertionDragSession,
  isValidModularCompositeInsertionResult,
  isValidModularInsertionResult,
  resolveModularCompositeInsertionDrag,
  resolveModularInsertionDrag,
  targetLaneWithHysteresis,
  resolveModularPlacementItems
} from "../src/engine/modularDeviceLayout.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";

const INDEX_HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ENGINE_PREVIEW_SOURCE = readFileSync(new URL("../src/engine/enginePreview.js", import.meta.url), "utf8");
const DEVICE_VISUAL_BUILDER_SOURCE = readFileSync(new URL("../src/engine/deviceVisualBuilder.js", import.meta.url), "utf8");
const PRODUCTION_BRIDGE_SOURCE = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
const PROJECT_MUTATIONS_SOURCE = readFileSync(new URL("../src/engine/projectMutations.js", import.meta.url), "utf8");

function editorPanel(name) {
  const match = INDEX_HTML.match(new RegExp(`<section class="editor-panel[^"]*" data-editor-panel="${name}">([\\s\\S]*?)</section>`));
  return match?.[1] || "";
}

function deviceFeaturePane() {
  const match = INDEX_HTML.match(/<aside class="device-feature-pane[^"]*" id="deviceFeaturePane"[\s\S]*?<\/aside>/);
  return match?.[0] || "";
}

function functionSource(functionName) {
  const namePattern = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`function\\s+${namePattern}\\s*\\([^)]*\\)\\s*\\{`).exec(INDEX_HTML);
  assert.ok(match, `Missing function ${functionName}`);
  const start = match.index;
  const bodyStart = start + match[0].lastIndexOf("{");
  let depth = 0;
  for (let index = bodyStart; index < INDEX_HTML.length; index += 1) {
    const char = INDEX_HTML[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return INDEX_HTML.slice(start, index + 1);
    }
  }
  assert.fail(`Unterminated function ${functionName}`);
}

function sourceSlice(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} should exist`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `${endNeedle} should follow ${startNeedle}`);
  return source.slice(start, end);
}

function groupContaining(panelSource, id) {
  const idIndex = panelSource.indexOf(`id="${id}"`);
  assert.ok(idIndex >= 0, `${id} should exist`);
  const groupStart = panelSource.lastIndexOf('<div class="editor-feature-group', idIndex);
  assert.ok(groupStart >= 0, `${id} should be inside a feature group`);
  const nextSeparator = panelSource.indexOf('<span class="editor-feature-separator"', idIndex);
  const nextGroup = panelSource.indexOf('<div class="editor-feature-group', idIndex);
  const candidates = [nextSeparator, nextGroup, panelSource.length].filter(index => index >= 0);
  const groupEnd = Math.min(...candidates);
  return panelSource.slice(groupStart, groupEnd);
}

function assertOrder(source, needles, message) {
  let previous = -1;
  needles.forEach(needle => {
    const index = source.indexOf(needle, previous + 1);
    assert.ok(index >= 0, `${message}: ${needle} should exist`);
    assert.ok(index > previous, `${message}: ${needle} should be ordered`);
    previous = index;
  });
}

function close(a, b, tolerance = 0.000001) {
  return Math.abs(a - b) <= tolerance;
}

function screenBounds(camera, bounds) {
  const left = (bounds.x - camera.x) * camera.zoom;
  const top = (bounds.y - camera.y) * camera.zoom;
  const right = left + bounds.width * camera.zoom;
  const bottom = top + bounds.height * camera.zoom;
  return { left, top, right, bottom };
}

function assertCameraContains(camera, bounds, viewportWidth, viewportHeight, padding, label) {
  const screen = screenBounds(camera, bounds);
  assert.ok(screen.left >= padding - 0.000001, `${label} should leave left padding`);
  assert.ok(screen.top >= padding - 0.000001, `${label} should leave top padding`);
  assert.ok(screen.right <= viewportWidth - padding + 0.000001, `${label} should leave right padding`);
  assert.ok(screen.bottom <= viewportHeight - padding + 0.000001, `${label} should leave bottom padding`);
  assert.ok(close((screen.left + screen.right) / 2, viewportWidth / 2), `${label} should center horizontally`);
  assert.ok(close((screen.top + screen.bottom) / 2, viewportHeight / 2), `${label} should center vertically`);
}

function runnableIndexFunction(functionName, context = {}) {
  return vm.runInNewContext(`(${functionSource(functionName)})`, context);
}

function sideParityConnector(id, side, direction, y = 152) {
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

function stableDragHarness(template) {
  const context = {
    console,
    JSON,
    Map,
    Number,
    Object,
    String,
    structuredClone,
    SLOT_HEIGHT: 54,
    DEVICE_BOTTOM_PAD: 48,
    editorNodeDrag: null,
    editorCardSlotDrag: null,
    editorConnectorSnapGuide: null,
    editorDragPointerReleaseInProgress: false,
    releaseCount: 0,
    renderCount: 0,
    releaseEditorPointerCapture: () => {
      context.releaseCount += 1;
    },
    rollbackCount: 0,
    rollbackEditorPlacementMotionForDrag: () => {
      context.rollbackCount += 1;
      return false;
    },
    renderDeviceEditorPreview: () => {
      context.renderCount += 1;
    },
    editorLaneMapsEqual: (left = new Map(), right = new Map()) => {
      if (left.size !== right.size) return false;
      for (const [id, lane] of left) {
        if (right.get(id) !== lane) return false;
      }
      return true;
    },
    requireDeviceEditorPlacementModule: () => ({
      createModularCompositeInsertionDragSession,
      createModularInsertionDragSession,
      isValidModularCompositeInsertionResult,
      resolveModularInsertionDrag,
      resolveModularCompositeInsertionDrag,
      targetLaneWithHysteresis,
      isValidModularInsertionResult,
      resolveModularPlacementItems
    }),
    connectorStartYForTemplate: device => Number(device?.startY) || 100,
    laneY: (lane, startY = 100) => startY + Math.max(0, lane) * 54,
    captureTemplateConfiguration: device => structuredClone(device),
    deviceTemplateWidth: device => Number(device?.width) || 420,
    connectorSideKey: connector => connector?.direction === "output" ? "output" : "input",
    isEditorV2ConnectorCandidate: connector => Array.isArray(connector?.anchors),
    editorConnectorAnchors: connector => Array.isArray(connector?.anchors) ? structuredClone(connector.anchors) : [],
    deviceHeightForSlotCounts: device => {
      const connectorBottom = Math.max(0, ...(device.connectors || []).map(connector => Number(connector.y) || 0));
      const slotBottom = Math.max(0, ...(device.cardSlots || []).map(slot => (Number(slot.y) || 0) + (Number(slot.span) || 1) * 54));
      return Math.max(240, connectorBottom + 102, slotBottom + 102);
    },
    syncEditorConnectorAnchorsToPosition: (device, connector) => {
      if (!Array.isArray(connector.anchors)) return;
      const width = Number(device?.width) || 420;
      connector.anchors = connector.anchors.map(anchor => ({
        ...anchor,
        x: anchor.side === "right" ? width : 0,
        y: connector.y
      }));
    },
    resolveEditorModularLayout: device => {
      const startY = Number(device?.startY) || 100;
      const connectorItems = (device.connectors || []).map((connector, index) => ({
        id: `connector:${connector.id}`,
        kind: "connector",
        itemType: "chassis-connector",
        sideMask: connector.sideMask || (connector.displaySide === "both" ? "both" : connector.direction === "output" ? "right" : "left"),
        requestedY: Number(connector.y) || startY,
        requestedLane: Math.max(0, Math.round(((Number(connector.y) || startY) - startY) / 54)),
        span: 1,
        order: index,
        ref: connector
      }));
      const cardItems = (device.cardSlots || []).map((slot, index) => ({
        id: `card:${slot.id}`,
        kind: "card",
        itemType: "card-slot",
        sideMask: slot.sideMask || "both",
        requestedY: Number(slot.y) || startY,
        requestedLane: Math.max(0, Math.round(((Number(slot.y) || startY) - startY) / 54)),
        span: Math.max(1, Number(slot.span) || 3),
        order: connectorItems.length + index,
        ref: slot
      }));
      return resolveModularPlacementItems([...connectorItems, ...cardItems], { startY, slotHeight: 54 });
    }
  };
  context.normalizeMixedDeviceRows = device => {
    const layout = context.resolveEditorModularLayout(device);
    layout.items.forEach(item => {
      if (item.kind === "connector") {
        item.ref.y = item.y;
        item.ref.x = item.ref.direction === "output" ? context.deviceTemplateWidth(device) : 0;
        context.syncEditorConnectorAnchorsToPosition(device, item.ref);
      } else if (item.kind === "card") {
        item.ref.y = item.y;
      }
    });
  };
  const helpers = [
    "editorStableDragLayout",
    "editorActiveStableDragLayout",
    "editorStableDragItemId",
    "editorStableLayoutItemKind",
    "editorStableDragSourceId",
    "editorStableDragLayoutPositions",
    "editorStableDragLaneMap",
    "editorPlacementItemByStableId",
    "createEditorStablePlacementDragSession",
    "createEditorCompositeConnectorDragSession",
    "resolveEditorStablePlacementDragMove",
    "applyEditorStableResolvedLayout",
    "commitEditorStablePlacementDrag",
    "cancelEditorStableDrags"
  ];
  const script = `${helpers.map(functionSource).join("\n")}
    ({
      createEditorStablePlacementDragSession,
      createEditorCompositeConnectorDragSession,
      resolveEditorStablePlacementDragMove,
      applyEditorStableResolvedLayout,
      commitEditorStablePlacementDrag,
      editorStableDragLayoutPositions,
      editorStableDragLaneMap,
      editorPlacementItemByStableId,
      cancelEditorStableDrags
    })`;
  const api = vm.runInNewContext(script, context);
  return { api, context, template };
}

function placementMotionIntegrationHarness(now = 0) {
  const context = {
    console,
    Map,
    Math,
    Number,
    String,
    Boolean,
    deviceEditorPlacementMotionModule: placementMotionModule,
    editorPlacementMotionState: null,
    editorPlacementMotionScheduler: null,
    editorPlacementMotionSampleCache: null,
    editorPlacementMotionClearWhenSettled: false,
    editorEngineDynamicCardArtworkActive: false,
    editorEngineDynamicCardArtworkTextureRefreshPending: false,
    scheduledFrames: 0,
    dynamicTransitions: [],
    now,
    performance: { now: () => context.now },
    window: { matchMedia: () => ({ matches: false }) },
    requireDeviceEditorPlacementMotionModule: () => placementMotionModule,
    scheduleEditorPlacementMotionFrame: () => {
      context.scheduledFrames += 1;
    },
    setEditorEngineDynamicCardArtworkActive: active => {
      const next = Boolean(active);
      if (context.editorEngineDynamicCardArtworkActive === next) return false;
      context.editorEngineDynamicCardArtworkActive = next;
      context.editorEngineDynamicCardArtworkTextureRefreshPending = true;
      context.dynamicTransitions.push(next);
      return true;
    },
    editorStableLayoutItemKind: item => {
      const id = String(item?.id || "");
      if (item?.kind === "card" || item?.itemType === "card-slot" || id.startsWith("card:")) return "card";
      return "connector";
    },
    editorPlacementItemByStableId: (layout, itemId) => {
      if (!layout || !itemId) return null;
      if (layout.byId instanceof Map) return layout.byId.get(itemId) || null;
      return (layout.items || []).find(item => item.id === itemId) || null;
    }
  };
  const helpers = [
    "editorPlacementMotionNow",
    "editorPlacementReducedMotion",
    "ensureEditorPlacementMotionState",
    "editorPlacementMotionHasEntries",
    "editorPlacementMotionHasCardEntries",
    "editorMotionLayoutForDrag",
    "beginEditorPlacementMotion",
    "pinEditorCompositeDraggedMotionEntries",
    "retargetEditorPlacementMotionForDrag"
  ];
  const script = `${helpers.map(functionSource).join("\n")}
    ({
      beginEditorPlacementMotion,
      retargetEditorPlacementMotionForDrag,
      editorPlacementMotionHasCardEntries
    })`;
  const api = vm.runInNewContext(script, context);
  return { api, context };
}

function testConnector(id, sideMask, lane, options = {}) {
  const direction = sideMask === "right" || options.direction === "output" ? "output" : "input";
  const x = direction === "output" ? 420 : 0;
  const y = 100 + lane * 54;
  const connector = {
    id,
    direction,
    x,
    y,
    sideMask,
    type: "hdmi",
    ...options
  };
  if (options.v2 === true) {
    connector.schemaVersion = 2;
    connector.displaySide = sideMask === "both" ? "both" : sideMask;
    connector.primaryAnchorId = sideMask === "right" ? "right" : "left";
    connector.anchors = sideMask === "both"
      ? [
          { id: "left", side: "left", x: 0, y, primary: true },
          { id: "right", side: "right", x: 420, y }
        ]
      : [{ id: connector.primaryAnchorId, side: connector.primaryAnchorId, x, y, primary: true }];
  }
  return connector;
}

function itemLaneMap(layout) {
  return Object.fromEntries((layout?.items || []).map(item => [item.id, item.lane]));
}

test("Device tab uses compact feature groups with dependent controls beside toggles", () => {
  const devicePanel = editorPanel("device");
  const featurePane = deviceFeaturePane();
  const expectedLabels = [
    "Adapter / Breakout",
    "HAS SWAPPABLE CARDS",
    "Is an LED Processor",
    "Is an Ethernet Switch",
    "Is a PD",
    "Is a Matrix",
    "Part of a Pair"
  ];

  assert.match(devicePanel, /editor-device-command-row/);
  assert.match(INDEX_HTML, /grid-template-columns: minmax\(170px, 280px\) minmax\(120px, 220px\) minmax\(150px, 260px\) minmax\(132px, 172px\);/);
  assert.match(INDEX_HTML, /editor-device-power-field \.power-input-row/);
  assertOrder(devicePanel, [
    "editor-primary-action",
    "newDeviceTemplate",
    "duplicateEditorDevice",
    "deleteEditorDevice",
    "editor-device-basics",
    "editorDeviceName",
    "editorDeviceBrand",
    "editorDeviceCategory",
    "editorPowerConsumption"
  ], "Device actions and basic fields should share the command row");
  assert.doesNotMatch(devicePanel, /editor-feature-strip/, "feature toggles should live in the left feature pane");

  assert.match(featurePane, /Device Options/);
  expectedLabels.forEach(label => assert.match(featurePane, new RegExp(`>${label}<`), `${label} label`));
  assert.equal((featurePane.match(/editor-feature-separator/g) || []).length, 6, "feature groups should be separated");
  assert.doesNotMatch(devicePanel, />Object Type</);
  assert.doesNotMatch(devicePanel, />Swappable Cards</);
  assert.doesNotMatch(devicePanel, />LED Processor</);
  assert.doesNotMatch(devicePanel, />Enable LED outputs</);
  assert.doesNotMatch(devicePanel, />Ethernet Switch</);
  assert.doesNotMatch(devicePanel, />Enable switch ports</);
  assert.doesNotMatch(devicePanel, />Power Distro</);
  assert.doesNotMatch(devicePanel, />Device is a PD</);
  assert.doesNotMatch(devicePanel, />Device Pair</);
  assert.doesNotMatch(devicePanel, />Part of pair</);

  assert.match(groupContaining(featurePane, "editorLedProcessor"), /id="editorLedOutputCount"/);
  const switchGroup = groupContaining(featurePane, "editorEthernetSwitch");
  assert.match(switchGroup, /id="editorSwitchPortCount"/);
  assert.match(switchGroup, /id="editorSwitchPortType"/);
  assert.match(switchGroup, /id="addEthernetSwitchPorts"/);
  assert.match(switchGroup, />Add<\/button>/);
  assert.match(switchGroup, /editor-switch-count-field/);
  assert.match(switchGroup, /editor-switch-type-field/);
  assert.match(switchGroup, /editor-switch-add-button/);
  const pairGroup = groupContaining(featurePane, "editorPartOfPair");
  assert.match(pairGroup, /id="editorPairTemplate"/);
  assert.match(pairGroup, /id="editorPairPlaceFirst"/);
  assert.match(featurePane, /class="visually-hidden" for="editorLedOutputCount"/);
  assert.match(featurePane, /aria-label="Switch port count"/);
});

test("Create New Device starts as a named blank device with no starter connectors", () => {
  const blankTemplate = functionSource("createBlankDeviceTemplate");
  assert.match(blankTemplate, /name:\s*"New Device"/);
  assert.match(blankTemplate, /connectors:\s*\[\]/);
  assert.match(blankTemplate, /faceplateDeleted:\s*false/);

  const createNewDevice = functionSource("openDeviceEditorWithNewDevice");
  assert.match(createNewDevice, /markMasterDeviceTemplate\(createBlankDeviceTemplate\(\)\)/);
  assert.doesNotMatch(createNewDevice, /Custom Device/);
});

test("Device Editor workspace sidebars are scoped to their tabs", () => {
  const workspaceMarkup = sourceSlice(
    INDEX_HTML,
    '<div class="editor-workspace">',
    '<div class="device-authoring-debug-panel hidden"'
  );
  assert.match(workspaceMarkup, /device-feature-pane hidden/);
  assert.match(workspaceMarkup, /connector-inspector-sidebar/);
  assert.match(workspaceMarkup, /id="cardInspectorPanel"/);
  assert.match(workspaceMarkup, /device-tech-specs-panel hidden/);
  assert.ok(workspaceMarkup.indexOf("device-feature-pane") < workspaceMarkup.indexOf("editor-preview-column"), "device options should occupy the left workspace column");
  assert.ok(workspaceMarkup.indexOf("connector-inspector-sidebar") < workspaceMarkup.indexOf("device-tech-specs-panel"), "technical specs should occupy the right column after the inspector");

  const renderTabs = functionSource("renderEditorTabs");
  assert.match(renderTabs, /const showConnectorInspector = editorActiveTab === "connectors" \|\| editorActiveTab === "cards";/);
  assert.match(renderTabs, /const showCardInspector = editorActiveTab === "cards";/);
  assert.match(renderTabs, /const showTechSpecs = editorActiveTab === "device";/);
  assert.match(renderTabs, /if \(template\?\.hasSwappableCards !== true\) disabledTabs\.add\("cards"\);/);
  assert.match(renderTabs, /const showDeviceFeaturePane = editorDeviceFeaturePaneActive\(\);/);
  assert.match(renderTabs, /connectorInspectorPanel\?\.classList\.toggle\("hidden", !showConnectorInspector \|\| showCardInspector\);/);
  assert.match(renderTabs, /cardInspectorPanel\?\.classList\.toggle\("hidden", !showCardInspector\);/);
  assert.match(renderTabs, /deviceFeaturePane\?\.classList\.toggle\("hidden", !showDeviceFeaturePane\);/);
  assert.match(renderTabs, /workspace\?\.classList\.toggle\("side-column-hidden", !showConnectorInspector && !showTechSpecs\);/);
  assert.match(renderTabs, /workspace\?\.classList\.toggle\("node-library-hidden", !editorNodePaletteActive\(\) && !showDeviceFeaturePane\);/);
  assert.match(renderTabs, /editorDeviceTechSpecsPanel\.classList\.toggle\("hidden", !showTechSpecs\);/);

  const nodePaletteGate = functionSource("editorNodePaletteActive");
  assert.match(nodePaletteGate, /editorActiveTab === "connectors" \|\| editorActiveTab === "cards"/);
  assert.match(functionSource("editorDeviceFeaturePaneActive"), /editorActiveTab === "device"/);
  assert.match(functionSource("renderNodePalette"), /const active = editorNodePaletteActive\(\);/);
  assert.match(functionSource("renderNodePalette"), /deviceFeaturePane\.classList\.toggle\("hidden", !featurePaneActive\);/);
});

test("Cards tab uses compact toolbar and right-side card inspector", () => {
  const cardsPanel = editorPanel("cards");
  const workspaceMarkup = sourceSlice(
    INDEX_HTML,
    '<div class="editor-workspace">',
    '<div class="device-authoring-debug-panel hidden"'
  );
  const renderCardEditor = functionSource("renderCardEditor");
  const renderCardConnectorInspector = functionSource("renderCardConnectorInspector");
  const cardFieldHandler = functionSource("handleCardConnectorFieldChange");

  assert.match(cardsPanel, /card-editor-toolbar/);
  assertOrder(cardsPanel, [
    'id="editorCardSelect"',
    'id="newCardType"',
    'id="duplicateCardType"',
    'id="deleteCardType"',
    'connector-toolbar-separator"',
    'id="addCardInputNode"',
    'id="addCardOutputNode"'
  ], "Cards toolbar should mirror the compact Connectors toolbar");
  assert.match(INDEX_HTML, /\.card-editor-toolbar\s*\{[\s\S]*?flex-wrap: nowrap;/);
  assert.match(INDEX_HTML, /\.card-editor-toolbar > button,/);
  assert.doesNotMatch(cardsPanel, /editor-panel-note|cardConnectorList|editorCardName|editorCardKind|editorCardCaptionTextColor|editorCardCaptionBackgroundColor/);
  assertOrder(workspaceMarkup, [
    'id="cardInspectorPanel"',
    'id="editorCardName"',
    'id="editorCardKind"',
    'id="editorCardCaptionTextColor"',
    'id="editorCardCaptionBackgroundColor"',
    'id="cardConnectorList"'
  ], "Card definition fields should live in the right-side card inspector");
  assert.match(renderCardEditor, /cardConnectorList\.innerHTML = renderCardConnectorInspector\(template, card\);/);
  assert.doesNotMatch(renderCardEditor, /card-connector-row|data-card-node-row/);
  assert.match(renderCardConnectorInspector, /Selected Card Connector/);
  assert.match(renderCardConnectorInspector, /data-card-physical-type/);
  assert.match(renderCardConnectorInspector, /data-card-field/);
  assert.match(renderCardConnectorInspector, /Delete Card Connector/);
  assert.match(cardFieldHandler, /data-card-physical-type/);
  assert.match(cardFieldHandler, /operationalStatus/);
});

test("Cards tab supports marquee and additive card-node selection", () => {
  assert.match(INDEX_HTML, /let editorSelectedCardNodeIds = new Set\(\);/);
  assert.match(functionSource("syncEditorCardNodeSelection"), /editorSelectedCardNodeIds = new Set/);
  assert.match(functionSource("setEditorCardNodeSelection"), /options\.toggle/);
  assert.match(functionSource("selectEditorCardNodesInRect"), /editorCardConnectorLayout\(card\)/);
  assert.match(functionSource("startEditorNodeMarquee"), /editorActiveTab !== "connectors" && editorActiveTab !== "cards"/);
  assert.match(functionSource("startEditorNodeMarquee"), /mode: isCardMarquee \? "cards" : "connectors"/);
  assert.match(functionSource("moveEditorNode"), /selectEditorCardNodesInRect\(card, rectFromPoints\(editorNodeMarquee\.start, point\), \{ baseIds: editorNodeMarquee\.baseIds \}\)/);
  assert.match(functionSource("stopEditorNodeDrag"), /if \(mode === "cards" && moved\) editorSuppressPreviewClickUntil = Date\.now\(\) \+ 150;/);
  assert.match(functionSource("renderCardEditorPreview"), /const selected = editorSelectedCardNodeIds\.has\(connectorIndex\) \|\| editorSelectedCardNodeIndex === connectorIndex;/);
  assert.match(functionSource("renderCardEditorPreview"), /drawEditorNodeMarquee\(deviceEditorPreview\);/);
});

test("Device Editor modal omits visible helper copy", () => {
  const modalMarkup = sourceSlice(
    INDEX_HTML,
    '<div class="modal-backdrop hidden" id="deviceEditorModal"',
    '<div class="modal-backdrop hidden" id="rackBuilderModal"'
  );
  const renderSelectedConnectorSettings = functionSource("renderSelectedConnectorSettings");
  const renderCardConnectorInspector = functionSource("renderCardConnectorInspector");
  const renderConnectorRelationshipsPanel = functionSource("renderConnectorRelationshipsPanel");

  assert.doesNotMatch(modalMarkup, /editor-panel-note/);
  assert.doesNotMatch(modalMarkup, /Front face images|Turn on Has Card Slots|saved system default|Manufacturer specs|editorPowerEquivalent|0 W \/ 0 A/);
  assert.doesNotMatch(modalMarkup, /Drag a node type into an empty slot|Drop a card into the preview|Select a connector|Open the Connectors tab/);
  assert.doesNotMatch(renderSelectedConnectorSettings, /Open the Connectors tab|Select a connector|Shift-click|Use the relationship controls|Only checked input\/output ports|faceplate symbol follows/);
  assert.doesNotMatch(renderCardConnectorInspector, /No card selected|No card connector selected|No card connectors/);
  assert.doesNotMatch(renderConnectorRelationshipsPanel, /Shift-click|Available for two|Select exactly two|Select the exact group|No relationship assigned/);
});

test("Device Editor placement delegates to the shared modular layout module", () => {
  const placementLoader = functionSource("loadDeviceEditorPlacementModule");
  const placementRequire = functionSource("requireDeviceEditorPlacementModule");
  const placementReady = functionSource("ensureDeviceEditorPlacementModuleReady");
  const motionLoader = functionSource("loadDeviceEditorPlacementMotionModule");
  const motionRequire = functionSource("requireDeviceEditorPlacementMotionModule");
  const combinedReady = functionSource("ensureDeviceEditorPlacementModulesReady");
  const resolver = functionSource("resolveEditorPlacementItems");
  const layoutItems = functionSource("editorLayoutItems");
  const nextPlacement = functionSource("nextEditorPlacementY");
  const nextConnector = functionSource("nextAvailableConnectorY");
  const nextSlot = functionSource("nextEditorSlotY");
  const openEditor = functionSource("openDeviceEditor");
  const openNew = functionSource("openDeviceEditorWithNewDevice");
  const openProject = functionSource("openDeviceEditorForProjectTemplateDraft");
  const openInstance = functionSource("openDeviceEditorForCanvasInstanceLegacy");

  assert.match(placementLoader, /engineImportUrl\("\.\/src\/engine\/modularDeviceLayout\.js"\)/);
  assert.doesNotMatch(placementLoader, /engineEditorRequestedByUrl/);
  assert.match(placementLoader, /connectorPlacementSideMask/);
  assert.match(placementLoader, /createModularInsertionDragSession/);
  assert.match(placementLoader, /resolveModularInsertionDrag/);
  assert.match(placementLoader, /createModularCompositeInsertionDragSession/);
  assert.match(placementLoader, /resolveModularCompositeInsertionDrag/);
  assert.match(placementLoader, /targetLaneWithHysteresis/);
  assert.match(placementLoader, /isValidModularInsertionResult/);
  assert.match(placementLoader, /isValidModularCompositeInsertionResult/);
  assert.match(placementRequire, /throw new Error\("Device Editor placement module is not loaded\."\)/);
  assert.match(placementReady, /await loadDeviceEditorPlacementModule\(\)/);
  assert.match(placementReady, /createModularInsertionDragSession/);
  assert.match(placementReady, /createModularCompositeInsertionDragSession/);
  assert.match(INDEX_HTML, /loadDeviceEditorPlacementModule\("Device Editor placement"\);/);
  assert.match(motionLoader, /engineImportUrl\("\.\/src\/engine\/deviceEditorPlacementMotion\.js"\)/);
  assert.match(motionLoader, /createPlacementMotionState/);
  assert.match(motionLoader, /retargetPlacementMotion/);
  assert.match(motionLoader, /createPlacementMotionFrameScheduler/);
  assert.match(motionRequire, /throw new Error\("Device Editor placement motion module is not loaded\."\)/);
  assert.match(combinedReady, /loadDeviceEditorPlacementModule\(\)/);
  assert.match(combinedReady, /loadDeviceEditorPlacementMotionModule\(\)/);

  assert.match(functionSource("editorConnectorPlacementSideMask"), /connectorPlacementSideMask\(connector, width\)/);
  assert.match(resolver, /requireDeviceEditorPlacementModule\(\)/);
  assert.match(resolver, /resolveModularPlacementItems\(normalized, \{\s*startY,\s*slotHeight: SLOT_HEIGHT\s*\}\)/);
  assert.doesNotMatch(resolver, /while\s*\(/);
  assert.doesNotMatch(resolver, /hasCollision|reserve\(/);
  assert.match(layoutItems, /order: index/);
  assert.doesNotMatch(layoutItems, /100000 \+ index|isPairedNetworkConnector\(connector\) \? 100000/);

  assert.match(nextPlacement, /resolveEditorPlacementItems\(/);
  assert.doesNotMatch(nextPlacement, /while\s*\(/);
  assert.match(nextConnector, /nextEditorPlacementY\(template, placementSide/);
  assert.match(nextSlot, /nextEditorPlacementY\(template, side/);
  assert.doesNotMatch(INDEX_HTML, /function compactConnectorSide|nonNetworkMaxY|pairedNetworkTypeRank|pairedNetworkTypeOrder/);
  assert.doesNotMatch(INDEX_HTML, /while \(hasCollision|while \(layout\.occupied/);

  assert.match(openEditor, /await ensureDeviceEditorPlacementModulesReady\(\)/);
  assert.match(openNew, /await ensureDeviceEditorPlacementModulesReady\(\)/);
  assert.match(openProject, /await ensureDeviceEditorPlacementModulesReady\(\)/);
  assert.match(openInstance, /await ensureDeviceEditorPlacementModulesReady\(\)/);

  assert.match(functionSource("bindEditorInteractionSvg"), /pointercancel", cancelEditorInteraction/);
  assert.match(functionSource("bindEditorInteractionSvg"), /lostpointercapture", cancelEditorStableDrags/);
  assert.match(functionSource("cancelEditorInteraction"), /if \(cancelEditorStableDrags\(event\)\) return;/);
  assert.match(functionSource("stopEditorNodeDrag"), /commitEditorStablePlacementDrag\(template, completedDrag/);
  assert.match(functionSource("startEditorNodeDrag"), /createEditorCompositeConnectorDragSession\(template/);
  assert.match(functionSource("moveEditorNode"), /resolveEditorStablePlacementDragMove\(editorNodeDrag, point\.y\)/);
  assert.doesNotMatch(functionSource("moveEditorNode"), /maxY - maxStartY|editorNodeDrag\.deltaY = deltaY/);
  assert.doesNotMatch(functionSource("editorPreviewPositions"), /connectorYOverrides|resolveEditorModularLayout\(template, \{ connectorYOverrides \}\)/);
});

test("Device Editor placement adapter follows shared V2 visual-side lane semantics", () => {
  const editorConnectorMask = runnableIndexFunction("editorConnectorPlacementSideMask", {
    requireDeviceEditorPlacementModule: () => ({ connectorPlacementSideMask }),
    deviceTemplateWidth: template => Number(template?.width) || 420
  });
  const editorResolver = runnableIndexFunction("resolveEditorPlacementItems", {
    requireDeviceEditorPlacementModule: () => ({ resolveModularPlacementItems }),
    normalizeEditorPlacementSideMask: value => {
      const raw = String(value || "").trim().toLowerCase();
      if (raw === "right" || raw === "output") return "right";
      if (raw === "both" || raw === "full" || raw === "io") return "both";
      return "left";
    },
    laneIndexForY: (y, startY = 152) => Math.max(0, Math.round(((Number(y) || startY) - startY) / 54)),
    editorPlacementItemId: item => `${item.kind}:${item.ref?.id || item.index}`,
    SLOT_HEIGHT: 54
  });
  const template = { width: 420 };
  const chassisConnector = sideParityConnector("chassis-output-left", "left", "output");
  const adapterItems = [
    {
      kind: "connector",
      ref: chassisConnector,
      index: 0,
      requestedY: 152,
      sideMask: editorConnectorMask(template, chassisConnector),
      span: 1,
      order: 0
    },
    {
      kind: "card",
      ref: { id: "slot-left-input" },
      index: 0,
      requestedY: 152,
      sideMask: "left",
      span: 3,
      order: 1
    }
  ];
  const adapterLayout = editorResolver(adapterItems, 152);
  const sharedLayout = resolveModularPlacementItems([
    { id: "connector:chassis-output-left", itemType: "chassis-connector", sideMask: "left", requestedY: 152, requestedLane: 0, span: 1, order: 0 },
    { id: "card:slot-left-input", itemType: "card-slot", sideMask: "left", requestedY: 152, requestedLane: 0, span: 3, order: 1 }
  ], { startY: 152, slotHeight: 54 });

  assert.equal(adapterItems[0].sideMask, "left");
  assert.deepEqual(
    Object.fromEntries(adapterLayout.items.map(item => [item.id, item.y])),
    Object.fromEntries(sharedLayout.items.map(item => [item.id, item.y]))
  );
  assert.equal(adapterLayout.byId.get("card:slot-left-input").y, 206);
});

test("Device Editor placement motion is persistent and shared by Engine and Legacy previews", () => {
  const previewPositions = functionSource("editorPreviewPositions");
  const cardSlotDisplayY = functionSource("cardSlotDisplayY");
  const previewClone = functionSource("editorEnginePreviewTemplateClone");
  const legacyRender = functionSource("renderDeviceEditorPreview");
  const engineRender = functionSource("renderDeviceEditorEnginePreview");
  const syncEngine = functionSource("syncDeviceEditorEnginePreview");
  const nodeMove = functionSource("moveEditorNode");
  const stopDrag = functionSource("stopEditorNodeDrag");
  const cancelDrags = functionSource("cancelEditorStableDrags");
  const displayAnchors = functionSource("editorDisplayAnchorsForConnector");
  const setPreviewY = functionSource("setConnectorPreviewY");

  assert.match(previewPositions, /editorPlacementMotionConnectorPositions\(\)/);
  assert.match(cardSlotDisplayY, /editorPlacementMotionVisualY\(`card:\$\{slot\?\.id\}`/);
  assert.match(previewClone, /applyEditorPlacementVisualsToPreviewTemplate\(draft, template\)/);
  assert.match(legacyRender, /applyEditorPlacementVisualsToPreviewTemplate\(previewTemplate, template\)/);
  assert.doesNotMatch(legacyRender, /animateTransform/);
  assert.match(engineRender, /motionOnly: options\.motionFrame === true \|\| editorPlacementMotionHasEntries\(\)/);
  assert.match(syncEngine, /options\.motionOnly === true/);
  assert.match(nodeMove, /retargetEditorPlacementMotionForDrag\(editorNodeDrag/);
  assert.match(nodeMove, /draggedIds\.length > 1/);
  assert.match(nodeMove, /retargetEditorPlacementMotionForDrag\(editorCardSlotDrag/);
  assert.match(functionSource("retargetEditorPlacementMotionForDrag"), /pinEditorCompositeDraggedMotionEntries\(drag, draggedY/);
  assert.match(stopDrag, /settleEditorPlacementMotionToLayout\(completedDrag\.lastValidResolvedLayout/);
  assert.match(cancelDrags, /rollbackEditorPlacementMotionForDrag/);
  assert.match(displayAnchors, /deltaY = y - baseY/);
  assert.match(setPreviewY, /deltaY = nextY - currentY/);
});

test("Device Editor card-slot drag seeds motion in the card handler, not face resize", () => {
  const cardDrag = functionSource("startEditorCardSlotDrag");
  const faceResize = functionSource("startEditorFaceImageResize");

  assert.doesNotMatch(faceResize, /beginEditorPlacementMotion\(/, "face image resize should not seed modular card motion");
  assertOrder(cardDrag, [
    "editorCardSlotDrag = {",
    "setEditorPointerCapture(event);",
    "beginEditorPlacementMotion(editorCardSlotDrag, { pointerY: point.y });",
    "renderDeviceEditorPreview();"
  ], "card slot drag should seed motion immediately after creating the drag session and before first render");
  assert.match(cardDrag, /kind:\s*"card"/);
  assert.match(cardDrag, /pointerY:\s*point\.y/);
});

test("Device Editor card motion integration animates first displacement and interrupted drags from sampled positions", () => {
  const { api, context } = placementMotionIntegrationHarness(0);
  const baseline = {
    items: [
      { id: "connector:top", kind: "connector", y: 100, span: 1, lane: 0 },
      { id: "card:slot-a", kind: "card", y: 154, span: 3, lane: 1 },
      { id: "connector:bottom", kind: "connector", y: 316, span: 1, lane: 4 }
    ]
  };
  const displaced = {
    items: [
      { id: "connector:top", kind: "connector", y: 100, span: 1, lane: 0 },
      { id: "card:slot-a", kind: "card", y: 208, span: 3, lane: 2 },
      { id: "connector:bottom", kind: "connector", y: 370, span: 1, lane: 5 }
    ]
  };
  const drag = {
    itemId: "card:slot-a",
    baselineResolvedLayout: baseline,
    lastValidResolvedLayout: displaced,
    offsetY: 20,
    currentY: 154
  };

  api.beginEditorPlacementMotion(drag, { pointerY: 174 });
  assert.equal(context.editorPlacementMotionState.entries.size, 3, "baseline seed should include connectors and cards");
  assert.equal(context.editorEngineDynamicCardArtworkActive, true);
  assert.equal(context.editorEngineDynamicCardArtworkTextureRefreshPending, true);

  api.retargetEditorPlacementMotionForDrag(drag, { pointerY: 250 });
  const firstSample = placementMotionModule.samplePlacementMotion(context.editorPlacementMotionState, { now: 0 });
  assert.equal(firstSample.positions.get("card:slot-a"), 230, "dragged card should retain pointer offset");
  assert.equal(firstSample.positions.get("connector:bottom"), 316, "stationary item starts from baseline visual position");
  assert.equal(firstSample.entries.find(entry => entry.id === "connector:bottom").settled, false);

  const halfway = placementMotionModule.samplePlacementMotion(context.editorPlacementMotionState, { now: 75 });
  const bottomY = halfway.positions.get("connector:bottom");
  assert.ok(bottomY > 316 && bottomY < 370, "stationary connector should ease instead of snapping on first move");
  assert.notEqual(bottomY, 370);

  const interruptedDrag = {
    itemId: "connector:bottom",
    baselineResolvedLayout: baseline,
    lastValidResolvedLayout: baseline,
    offsetY: 0,
    currentY: 316
  };
  context.now = 75;
  api.beginEditorPlacementMotion(interruptedDrag, { pointerY: bottomY + 11 });
  const interruptedEntry = context.editorPlacementMotionState.entries.get("connector:bottom");
  assert.ok(Math.abs(interruptedEntry.currentY - bottomY) < 0.000001, "new drag should begin from sampled onscreen Y");
  assert.equal(interruptedDrag.offsetY, 11, "new drag pointer offset should be based on sampled onscreen Y");
  assert.equal(interruptedEntry.targetY, 316, "new solver baseline remains the committed model");
});

test("Engine Device Editor card motion uses dynamic overlay ownership without per-frame texture refresh", () => {
  const template = {
    id: "motion-card-device",
    name: "Motion Card Device",
    width: 420,
    height: 420,
    hasSwappableCards: true,
    connectors: [
      { id: "fixed-in", type: "hdmi", direction: "input", x: 0, y: 100 }
    ],
    cardTypes: [{
      id: "card-a",
      name: "Span Card",
      kind: "io",
      captionTextColor: "#32b6ff",
      captionBackgroundColor: "#17212b",
      connectors: [
        { id: "in-a", type: "hdmi", direction: "input", x: 0, y: 54, nameText: "IN" },
        { id: "out-a", type: "hdmi", direction: "output", x: 420, y: 108, nameText: "OUT" }
      ]
    }],
    cardSlots: [{ id: "slot-a", name: "Slot A", installedCardTypeId: "card-a", y: 154 }]
  };
  const previewPayload = slotY => {
    const draft = {
      ...structuredClone(template),
      cardSlots: [{ ...template.cardSlots[0], y: slotY }]
    };
    return {
      template: draft,
      projectData: { state: { deviceLibrary: [draft], nodeLibrary: [] } },
      instance: {
        instanceId: "preview-device",
        id: "preview-device",
        templateId: draft.id,
        templateOverride: draft,
        name: draft.name,
        x: 0,
        y: 0
      }
    };
  };
  const normalDevice = createPreviewDeviceFromDraft(previewPayload(154), 0);
  const suppressedPayload = previewPayload(208);
  suppressedPayload.template.suppressCardAreasInTexture = true;
  suppressedPayload.instance.templateOverride = suppressedPayload.template;
  const suppressedDevice = createPreviewDeviceFromDraft(suppressedPayload, 0);

  assert.equal(normalDevice.visual.suppressCardAreasInTexture, false);
  assert.equal(suppressedDevice.visual.suppressCardAreasInTexture, true);
  assert.equal(normalDevice.visual.visualCards.length, 1, "normal visual card metadata should remain available");
  assert.equal(suppressedDevice.visual.visualCards.length, 1, "suppressed textures must preserve visual card metadata");
  assert.notEqual(
    previewDeviceVisualKey(normalDevice, { detailedDeviceTextures: true }),
    previewDeviceVisualKey(suppressedDevice, { detailedDeviceTextures: true }),
    "texture cache identity should include card-artwork suppression"
  );
  assert.equal(suppressedDevice.visual.visualCards[0].slotY, 208);
  assert.deepEqual(
    suppressedDevice.visual.visualCards[0].connectors.map(connector => connector.y),
    [262, 262],
    "generated card connector rows should use the same sampled slot Y"
  );

  const syncEngine = functionSource("syncDeviceEditorEnginePreview");
  const renderEngine = functionSource("renderDeviceEditorEnginePreview");
  const dynamicArtwork = functionSource("drawEditorEngineDynamicCardArtwork");
  const previewClone = functionSource("editorEnginePreviewTemplateClone");
  const clearMotion = functionSource("clearEditorPlacementMotion");
  const scheduler = functionSource("ensureEditorPlacementMotionScheduler");
  const legacyRender = functionSource("renderDeviceEditorPreview");

  assert.match(DEVICE_VISUAL_BUILDER_SOURCE, /visual\.suppressCardAreasInTexture \? "suppress-card-areas" : ""/);
  assert.match(DEVICE_VISUAL_BUILDER_SOURCE, /!visual\.suppressCardAreasInTexture\) \{\s*drawCardAreas/);
  assert.match(DEVICE_VISUAL_BUILDER_SOURCE, /drawConnectorBands\(ctx, device, width, height, face\.bottom \+ 12\);/);
  assert.match(PRODUCTION_BRIDGE_SOURCE, /ENGINE_BRIDGE_VERSION = "iteration54-7-2-atomic-device-editor-group-drag"/);

  assert.match(previewClone, /draft\.suppressCardAreasInTexture = true/);
  assert.match(syncEngine, /suppressCardAreasInTexture: options\.dynamicCardArtwork === true/);
  assert.match(syncEngine, /const mustRefreshTexture = options\.dynamicCardArtwork === true/);
  assert.match(syncEngine, /editorEngineDynamicCardArtworkTextureRefreshPending = false/);
  assert.match(renderEngine, /const dynamicCardArtwork = editorEngineDynamicCardArtworkActive && editorPlacementMotionHasCardEntries\(\)/);
  assert.match(renderEngine, /refreshTexture,\s*motionOnly:[\s\S]*dynamicCardArtwork/);
  assertOrder(renderEngine, [
    "drawEditorEngineDynamicCardArtwork(deviceEditorPreview, previewTemplate);",
    "drawEditorEngineCardSlotOverlay(deviceEditorPreview, previewTemplate);",
    "drawEditorEngineConnectorOverlay(deviceEditorPreview, previewTemplate);"
  ], "dynamic card artwork should render below hit overlays and connector overlays");
  assert.match(dynamicArtwork, /drawCardSlotBands\(group, template, \{ editor: false \}\)/);
  assert.match(dynamicArtwork, /editorPlacementMotionHasCardEntries\(\)/);
  assert.match(legacyRender, /drawEditorCardSlotBands\(deviceEditorPreview, previewTemplate\)/);
  assert.doesNotMatch(legacyRender, /animateTransform/);
  assert.match(scheduler, /renderDeviceEditorPreview\(\{ refreshTexture: false, motionFrame: true \}\)/);
  assert.match(clearMotion, /renderDeviceEditorPreview\(\{ refreshTexture: true, motionFrame: false \}\)/);
});

test("Device Editor stable connector drag resolves from an immutable snapshot and commits the displayed map", () => {
  const template = {
    width: 420,
    startY: 100,
    connectors: [
      { id: "A", direction: "input", y: 100, x: 0, sideMask: "left", anchors: [{ id: "left", side: "left", x: 0, y: 100 }] },
      { id: "B", direction: "input", y: 154, x: 0, sideMask: "left", anchors: [{ id: "left", side: "left", x: 0, y: 154 }] },
      { id: "C", direction: "input", y: 208, x: 0, sideMask: "left", anchors: [{ id: "left", side: "left", x: 0, y: 208 }] }
    ],
    cardSlots: []
  };
  const { api } = stableDragHarness(template);
  const before = structuredClone(template);
  const drag = api.createEditorStablePlacementDragSession(template, {
    kind: "connector",
    id: "C",
    pointerId: 4,
    pointerY: 228
  });
  const snapshotBefore = JSON.stringify(drag.session.snapshot);

  assert.equal(Object.isFrozen(drag.session.snapshot), true);
  assert.equal(drag.offsetY, 20);
  api.resolveEditorStablePlacementDragMove(drag, 232);
  assert.deepEqual(template, before, "pointer movement should not mutate the live template");
  assert.equal(JSON.stringify(drag.session.snapshot), snapshotBefore, "session snapshot should remain unchanged");
  assert.equal(drag.currentTargetLane, 2, "small movement around the original row should stay in-lane");

  api.resolveEditorStablePlacementDragMove(drag, 120);
  const previewLanes = Object.fromEntries(api.editorStableDragLaneMap(drag.lastValidResolvedLayout));
  assert.deepEqual(previewLanes, {
    "connector:A": 1,
    "connector:B": 2,
    "connector:C": 0
  });
  const previewPositions = api.editorStableDragLayoutPositions(drag.lastValidResolvedLayout, "connector");
  api.commitEditorStablePlacementDrag(template, drag, { includeConnectors: true, includeCards: true });

  assert.deepEqual(
    Object.fromEntries(template.connectors.map(connector => [connector.id, connector.y])),
    Object.fromEntries(previewPositions),
    "commit should apply the exact displayed connector positions"
  );
  template.connectors.forEach(connector => {
    assert.equal(connector.anchors[0].y, connector.y, `${connector.id} anchor should sync to committed y`);
  });
});

test("Device Editor stable drag cancellation leaves the live template untouched", () => {
  const template = {
    width: 420,
    startY: 100,
    connectors: [
      { id: "A", direction: "input", y: 100, x: 0, sideMask: "left" },
      { id: "B", direction: "input", y: 154, x: 0, sideMask: "left" }
    ],
    cardSlots: []
  };
  const { api, context } = stableDragHarness(template);
  const before = structuredClone(template);
  const drag = api.createEditorStablePlacementDragSession(template, {
    kind: "connector",
    id: "B",
    pointerId: 9,
    pointerY: 154
  });

  api.resolveEditorStablePlacementDragMove(drag, 100);
  context.editorNodeDrag = drag;
  assert.equal(drag.currentTargetLane, 0);
  assert.deepEqual(template, before, "preview movement should remain read-only before cancellation");

  assert.equal(api.cancelEditorStableDrags({ pointerId: 9, type: "pointercancel" }), true);
  assert.equal(context.editorNodeDrag, null);
  assert.deepEqual(template, before, "pointercancel should not commit drag changes");
  assert.equal(context.releaseCount, 1);
  assert.equal(context.rollbackCount, 1);
  assert.equal(context.renderCount, 1);
});

test("Device Editor stable card-slot drag preserves pointer offset and moves as one span", () => {
  const template = {
    width: 420,
    startY: 100,
    connectors: [
      { id: "L", direction: "input", y: 100, x: 0, sideMask: "left" },
      { id: "R", direction: "output", y: 100, x: 420, sideMask: "right" }
    ],
    cardSlots: [
      { id: "slot-1", y: 154, span: 3, sideMask: "both" }
    ]
  };
  const { api } = stableDragHarness(template);
  const before = structuredClone(template);
  const drag = api.createEditorStablePlacementDragSession(template, {
    kind: "card",
    id: "slot-1",
    pointerId: 7,
    pointerY: 130
  });

  assert.equal(drag.offsetY, -24, "card drag should preserve where the user grabbed the band");
  api.resolveEditorStablePlacementDragMove(drag, 134);
  assert.equal(drag.currentTargetLane, 1, "small movement after an edge grab should not jump rows");
  assert.deepEqual(template, before, "card preview movement should not mutate the live template");

  api.resolveEditorStablePlacementDragMove(drag, 76);
  const cardItem = api.editorPlacementItemByStableId(drag.lastValidResolvedLayout, "card:slot-1");
  assert.equal(cardItem.lane, 0);
  assert.equal(cardItem.span, 3, "card slot should remain atomic while dragging");
  api.applyEditorStableResolvedLayout(template, drag.lastValidResolvedLayout);
  assert.equal(template.cardSlots[0].y, cardItem.y);
  assert.ok(template.height >= cardItem.bottomY, "commit should recalculate height to contain the moved card band");
});

test("Device Editor composite connector drag commits the solver lane map as one atomic layout", () => {
  const template = {
    width: 420,
    startY: 100,
    height: 418,
    connectors: [
      testConnector("A", "left", 0),
      testConnector("B", "left", 1),
      testConnector("C", "left", 2),
      testConnector("D", "left", 3),
      testConnector("E", "left", 4)
    ],
    cardSlots: []
  };
  const { api } = stableDragHarness(template);
  const drag = api.createEditorCompositeConnectorDragSession(template, {
    connectorIds: ["A", "B"],
    primaryConnectorId: "A",
    pointerId: 44,
    pointerY: 100
  });

  assert.equal(Object.isFrozen(drag.session.snapshot), true);
  assert.deepEqual(Array.from(drag.selectedDraggedItemIds), ["connector:A", "connector:B"]);
  api.resolveEditorStablePlacementDragMove(drag, 208);
  const expected = {
    "connector:A": 2,
    "connector:B": 3,
    "connector:C": 0,
    "connector:D": 1,
    "connector:E": 4
  };
  assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), expected);
  assert.equal(drag.lastValidResolvedLayout.endLane, 5, "moving within occupied rows should not grow the layout");

  const repeated = structuredClone(drag.lastValidResolvedLayout);
  api.resolveEditorStablePlacementDragMove(drag, 208, { force: true });
  assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), itemLaneMap(repeated), "repeat resolution should be idempotent");

  const beforeHeight = template.height;
  assert.equal(api.commitEditorStablePlacementDrag(template, drag, { includeConnectors: true, includeCards: true }), true);
  assert.deepEqual(
    Object.fromEntries(template.connectors.map(connector => [connector.id, Math.round((connector.y - 100) / 54)])),
    {
      A: 2,
      B: 3,
      C: 0,
      D: 1,
      E: 4
    }
  );
  assert.equal(template.height, beforeHeight, "same-extent composite drag should preserve required height");
});

test("Device Editor composite connector drag supports mixed sides and V2 both-side items as logical placements", () => {
  const mixedTemplate = {
    width: 420,
    startY: 100,
    connectors: [
      testConnector("A", "left", 0),
      testConnector("B", "right", 0),
      testConnector("L", "left", 1),
      testConnector("R", "right", 1)
    ],
    cardSlots: []
  };
  const { api: mixedApi } = stableDragHarness(mixedTemplate);
  const mixedDrag = mixedApi.createEditorCompositeConnectorDragSession(mixedTemplate, {
    connectorIds: ["A", "B"],
    primaryConnectorId: "A",
    pointerY: 100
  });
  mixedApi.resolveEditorStablePlacementDragMove(mixedDrag, 154);
  assert.deepEqual(itemLaneMap(mixedDrag.lastValidResolvedLayout), {
    "connector:A": 1,
    "connector:B": 1,
    "connector:L": 0,
    "connector:R": 0
  });
  assert.equal(mixedDrag.selectedItemOffsets.get("connector:B"), 0, "mixed side members on the same row should remain rigid");

  const v2Template = {
    width: 420,
    startY: 100,
    connectors: [
      testConnector("IO", "both", 0, { v2: true }),
      testConnector("NEXT", "left", 1),
      testConnector("RIGHT", "right", 1)
    ],
    cardSlots: []
  };
  const { api: v2Api } = stableDragHarness(v2Template);
  const v2Drag = v2Api.createEditorCompositeConnectorDragSession(v2Template, {
    connectorIds: ["IO", "NEXT"],
    primaryConnectorId: "IO",
    pointerY: 100
  });
  assert.deepEqual(Array.from(v2Drag.selectedDraggedItemIds), ["connector:IO", "connector:NEXT"]);
  assert.equal(v2Drag.session.snapshot.byId["connector:IO"].sideMask, "both");
  assert.equal(v2Drag.session.draggedItemIds.filter(id => id === "connector:IO").length, 1, "both-side V2 connector should be one logical selected item");
});

test("Device Editor composite connector drag preserves selected gaps and displaces card slots as atomic spans", () => {
  const gapTemplate = {
    width: 420,
    startY: 100,
    connectors: [
      testConnector("A", "left", 0),
      testConnector("B", "left", 1),
      testConnector("C", "left", 2),
      testConnector("D", "left", 3),
      testConnector("E", "left", 4)
    ],
    cardSlots: []
  };
  const { api: gapApi } = stableDragHarness(gapTemplate);
  const gapDrag = gapApi.createEditorCompositeConnectorDragSession(gapTemplate, {
    connectorIds: ["A", "C"],
    primaryConnectorId: "A",
    pointerY: 100
  });
  gapApi.resolveEditorStablePlacementDragMove(gapDrag, 154);
  assert.deepEqual(itemLaneMap(gapDrag.lastValidResolvedLayout), {
    "connector:A": 1,
    "connector:B": 0,
    "connector:C": 3,
    "connector:D": 2,
    "connector:E": 4
  });
  assert.equal(gapDrag.selectedItemOffsets.get("connector:C"), 108, "non-contiguous selection should preserve the internal gap");

  const cardTemplate = {
    width: 420,
    startY: 100,
    connectors: [
      testConnector("A", "left", 0),
      testConnector("B", "left", 1),
      testConnector("C", "left", 5)
    ],
    cardSlots: [{ id: "slot-1", y: 208, span: 3, sideMask: "both" }]
  };
  const { api: cardApi } = stableDragHarness(cardTemplate);
  const cardDrag = cardApi.createEditorCompositeConnectorDragSession(cardTemplate, {
    connectorIds: ["A", "B"],
    primaryConnectorId: "A",
    pointerY: 100
  });
  cardApi.resolveEditorStablePlacementDragMove(cardDrag, 208);
  assert.deepEqual(itemLaneMap(cardDrag.lastValidResolvedLayout), {
    "connector:A": 2,
    "connector:B": 3,
    "card:slot-1": 4,
    "connector:C": 7
  });
  const cardItem = cardApi.editorPlacementItemByStableId(cardDrag.lastValidResolvedLayout, "card:slot-1");
  assert.equal(cardItem.span, 3, "stationary card should move as one interval");
  assert.equal(cardApi.commitEditorStablePlacementDrag(cardTemplate, cardDrag, { includeConnectors: true, includeCards: true }), true);
  assert.equal(cardTemplate.cardSlots[0].y, 316, "committed card slot should match the previewed solved row");
  assert.ok(cardTemplate.height >= 100 + 8 * 54 + 48, "height should grow only enough to contain the solved layout");
});

test("Device Editor composite connector drag can grow below the old device bottom and cancel exactly", () => {
  const template = {
    width: 420,
    startY: 100,
    height: 304,
    connectors: [
      testConnector("A", "left", 0),
      testConnector("B", "left", 1),
      testConnector("C", "left", 2)
    ],
    cardSlots: []
  };
  const { api, context } = stableDragHarness(template);
  const before = structuredClone(template);
  const drag = api.createEditorCompositeConnectorDragSession(template, {
    connectorIds: ["A", "B"],
    primaryConnectorId: "A",
    pointerId: 81,
    pointerY: 100
  });
  api.resolveEditorStablePlacementDragMove(drag, 316);
  assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), {
    "connector:A": 4,
    "connector:B": 5,
    "connector:C": 2
  });
  assert.equal(drag.lastValidResolvedLayout.endLane, 6, "composite drag may grow below the previous device bottom");
  assert.deepEqual(template, before, "preview resolution should remain read-only");

  context.editorNodeDrag = drag;
  assert.equal(api.cancelEditorStableDrags({ pointerId: 81, type: "pointercancel" }), true);
  assert.deepEqual(template, before, "cancel should restore the precise pre-drag logical layout");
  assert.equal(context.rollbackCount, 1);
});

test("Device Editor composite placement motion keeps selected members rigid while displaced items animate", () => {
  const { api, context } = placementMotionIntegrationHarness(0);
  const baseline = {
    items: [
      { id: "connector:A", kind: "connector", y: 100, span: 1, lane: 0 },
      { id: "connector:B", kind: "connector", y: 154, span: 1, lane: 1 },
      { id: "connector:C", kind: "connector", y: 208, span: 1, lane: 2 },
      { id: "card:slot-1", kind: "card", y: 262, span: 3, lane: 3 }
    ]
  };
  const solved = {
    items: [
      { id: "connector:A", kind: "connector", y: 208, span: 1, lane: 2 },
      { id: "connector:B", kind: "connector", y: 262, span: 1, lane: 3 },
      { id: "connector:C", kind: "connector", y: 100, span: 1, lane: 0 },
      { id: "card:slot-1", kind: "card", y: 316, span: 3, lane: 4 }
    ]
  };
  const drag = {
    itemId: "connector:A",
    compositeDrag: true,
    selectedDraggedItemIds: ["connector:A", "connector:B"],
    selectedItemOffsets: new Map([["connector:A", 0], ["connector:B", 54]]),
    baselineResolvedLayout: baseline,
    lastValidResolvedLayout: solved,
    offsetY: 8,
    currentY: 100
  };

  api.beginEditorPlacementMotion(drag, { pointerY: 108 });
  api.retargetEditorPlacementMotionForDrag(drag, { draggedY: 208 });
  const firstSample = placementMotionModule.samplePlacementMotion(context.editorPlacementMotionState, { now: 0 });
  assert.equal(firstSample.positions.get("connector:A"), 208);
  assert.equal(firstSample.positions.get("connector:B"), 262, "secondary selected member should share the primary delta immediately");
  assert.equal(firstSample.positions.get("connector:B") - firstSample.positions.get("connector:A"), 54);
  assert.equal(firstSample.positions.get("card:slot-1"), 262, "displaced card starts from its sampled baseline");
  assert.equal(context.editorPlacementMotionState.entries.get("connector:B").dragged, true);
  assert.deepEqual(context.dynamicTransitions, [true], "card artwork should activate once when a node group can displace card slots");

  const halfway = placementMotionModule.samplePlacementMotion(context.editorPlacementMotionState, { now: 75 });
  assert.equal(halfway.positions.get("connector:B") - halfway.positions.get("connector:A"), 54, "selected group should remain rigid during animation sampling");
  assert.ok(halfway.positions.get("card:slot-1") > 262 && halfway.positions.get("card:slot-1") < 316, "displaced card should animate smoothly");

  context.now = 75;
  drag.lastValidResolvedLayout = baseline;
  api.retargetEditorPlacementMotionForDrag(drag, { draggedY: 100 });
  const interrupted = context.editorPlacementMotionState.entries.get("card:slot-1");
  assert.ok(interrupted.startY > 262 && interrupted.startY < 316, "direction reversal should retarget from the sampled visual card position");
});

test("standalone exported viewer side helper follows V2 visual-side semantics", () => {
  const exportSideMaskForConnector = runnableIndexFunction("exportSideMaskForConnector", {
    DEVICE_WIDTH: 420,
    Number,
    String,
    Array,
    Set
  });

  assert.equal(exportSideMaskForConnector(sideParityConnector("output-left", "left", "output"), { width: 420 }), "left");
  assert.equal(exportSideMaskForConnector(sideParityConnector("input-right", "right", "input"), { width: 420 }), "right");
  assert.equal(exportSideMaskForConnector({
    ...sideParityConnector("both", "left", "input"),
    displaySide: "both",
    anchors: [
      { id: "left", side: "left", x: 0, y: 152, primary: true },
      { id: "right", side: "right", x: 420, y: 152 }
    ]
  }, { width: 420 }), "both");
  assert.equal(exportSideMaskForConnector({ id: "legacy-output", direction: "output", y: 152 }, { width: 420 }), "right");
  assert.equal(exportSideMaskForConnector({ id: "legacy-input", direction: "input", y: 152 }, { width: 420 }), "left");
});

test("Device Editor preview renders from detached normalized drafts", () => {
  const readonlyClone = functionSource("readonlyDeviceEditorPreviewTemplate");
  const renderPreview = functionSource("renderDeviceEditorPreview");
  const renderEnginePreview = functionSource("renderDeviceEditorEnginePreview");
  const engineClone = functionSource("editorEnginePreviewTemplateClone");

  assert.match(readonlyClone, /const draft = structuredClone\(template\);/);
  assert.match(readonlyClone, /validateDraftDefaults\(draft\);/);
  assert.doesNotMatch(readonlyClone, /validateDraftDefaults\(template\)/);

  assert.match(renderPreview, /const previewTemplate = readonlyDeviceEditorPreviewTemplate\(template\);/);
  assert.doesNotMatch(renderPreview, /validateDraftDefaults\(template\);/);
  assert.match(renderPreview, /deviceTemplateWidth\(previewTemplate\)/);
  assert.match(renderPreview, /editorActivePreviewBounds\(previewTemplate\)/);
  assert.match(renderPreview, /previewTemplate\.connectors\.forEach/);
  assert.match(renderPreview, /generatedCardConnectors\(previewTemplate\)/);

  assert.match(renderEnginePreview, /const previewTemplate = readonlyDeviceEditorPreviewTemplate\(template\);/);
  assert.doesNotMatch(renderEnginePreview, /validateDraftDefaults\(template\);/);
  assert.match(renderEnginePreview, /syncDeviceEditorEnginePreview\(previewTemplate/);
  assert.match(renderEnginePreview, /drawEditorEngineConnectorOverlay\(deviceEditorPreview, previewTemplate\)/);
  assert.match(engineClone, /readonlyDeviceEditorPreviewTemplate\(template\)/);
});

test("Matrix routing separates compact inspector routes from full modal crosspoints", () => {
  const matrixMarkup = functionSource("matrixRoutingMarkup");
  const bindMatrixRouting = functionSource("bindMatrixRoutingInspector");
  const renderMatrixModal = functionSource("renderMatrixRoutingModalBody");
  const renderDeviceInspector = functionSource("renderDeviceInspector");
  const filterMatrix = functionSource("applyMatrixInspectorFilter");
  const matrixCss = sourceSlice(INDEX_HTML, ".matrix-route-row {", ".selected-connector-settings {");

  assert.match(INDEX_HTML, /const MATRIX_CROSSPOINT_DEFAULT_LIMIT = 256;/);
  assert.match(matrixCss, /grid-template-columns: minmax\(110px, 240px\) minmax\(130px, 360px\);/);
  assert.match(matrixCss, /max-width: 360px;/);
  assert.match(matrixCss, /width: min\(85vw, calc\(100vw - 44px\)\);/);
  assert.match(matrixCss, /height: min\(85vh, calc\(100vh - 44px\)\);/);
  assert.match(matrixCss, /grid-template-rows: auto auto auto minmax\(0, 1fr\);/);
  assert.match(matrixCss, /\.matrix-routing-modal \.matrix-toolbar \{/);
  assert.match(matrixCss, /width: min\(420px, 100%\);/);
  assert.match(matrixCss, /grid-template-columns: repeat\(3, minmax\(260px, 1fr\)\);/);
  assert.match(matrixCss, /column-gap: 14px;/);
  assert.match(matrixCss, /grid-template-columns: minmax\(88px, 118px\) minmax\(126px, 220px\);/);
  assert.match(matrixCss, /height: 100%;/);
  assert.match(INDEX_HTML, /modal: \{ filter: "", routedOnly: false, viewByDeviceId: \{\}, bodyScrollTop: 0, routeScrollTop: 0, gridScrollTop: 0, gridScrollLeft: 0 \}/);
  assert.match(matrixMarkup, /const presentation = options\.presentation === "modal" \? "modal" : "inspector";/);
  assert.match(matrixMarkup, /matrixRoutingViewForInstance\(instance, inputs, outputs, \{ presentation, view: options\.view \}\)/);
  assert.match(matrixMarkup, /selectedView === "crosspoint" \? grid : routeTable/);
  assert.match(matrixMarkup, /data-matrix-presentation="\$\{presentation\}"/);
  assert.match(matrixMarkup, /data-matrix-view-current="\$\{escapeAttr\(selectedView\)\}"/);
  assert.match(matrixMarkup, /data-matrix-open-modal/);
  assert.match(matrixMarkup, /data-matrix-view="routes"/);
  assert.match(matrixMarkup, /data-matrix-view="crosspoint"/);
  assert.match(matrixMarkup, /data-matrix-output-select/);
  assert.match(matrixMarkup, /data-matrix-output/);
  assert.match(matrixMarkup, /data-matrix-input/);

  assert.match(renderDeviceInspector, /matrixRoutingMarkup\(instance, \{ presentation: "inspector" \}\)/);
  assert.match(renderDeviceInspector, /bindMatrixRoutingInspector\(instance, inspectorBody, \{ presentation: "inspector" \}\)/);
  assert.match(renderMatrixModal, /matrixRoutingCaptureState\(matrixRoutingModalBody, "modal"\)/);
  assert.match(renderMatrixModal, /matrixRoutingMarkup\(instance, \{\s*heading: "Matrix Routing",\s*presentation: "modal"\s*\}\)/);
  assert.match(renderMatrixModal, /matrixRoutingRestoreState\(matrixRoutingModalBody, "modal", snapshot\)/);

  assert.match(bindMatrixRouting, /matrixRoutingUiState\.modal\.viewByDeviceId\[key\] = view;/);
  assert.match(bindMatrixRouting, /wrapper\.dataset\.matrixViewCurrent = view;/);
  assert.match(bindMatrixRouting, /engineBridge\.commitMatrixRoute\?\./);
  assert.match(bindMatrixRouting, /pushUndo\(\);/);
  assert.match(filterMatrix, /row\.dataset\.matrixRouted === "1"/);
  assert.match(functionSource("matrixRoutingRestoreState"), /data-matrix-view="\$\{CSS\.escape\(snapshot\.focusedView\)\}"/);

  const inspectorOnlyMarkup = sourceSlice(matrixMarkup, 'const viewToggle = presentation === "modal"', "const openFull = presentation === \"inspector\"");
  assert.doesNotMatch(inspectorOnlyMarkup, /data-matrix-view-current="\$\{escapeAttr\(selectedView\)\}"/, "view selection should be stored on the section, not duplicated in the inspector toggle");
});

test("Canvas connector inspector exposes editable node fields", () => {
  const renderConnectorInspector = functionSource("renderConnectorInspector");
  const fieldSection = functionSource("canvasConnectorFieldSectionMarkup");
  const fieldBinding = functionSource("bindCanvasConnectorFieldInputs");

  assert.match(renderConnectorInspector, /canvasConnectorFieldSectionMarkup\(connector\)/);
  assert.match(renderConnectorInspector, /bindCanvasConnectorFieldInputs\(deviceId, connectorId\)/);
  assert.doesNotMatch(renderConnectorInspector, /Connector editing rules will be added/);
  assert.match(fieldSection, /connectorInfoFields\(connector\)/);
  assert.match(fieldSection, /data-canvas-connector-field/);
  assert.match(fieldBinding, /commitConnectorInspectorFields\?\.\(deviceId, connectorId, patch\)/);
  assert.match(fieldBinding, /setConnectorFieldsForEndpoint\(deviceId, connectorId, patch\)/);

  assert.match(PRODUCTION_BRIDGE_SOURCE, /engineConnectorInfoFields/);
  assert.match(PRODUCTION_BRIDGE_SOURCE, /connectorFieldInputsMarkup\(selected\.connector\)/);
  assert.match(PRODUCTION_BRIDGE_SOURCE, /data-engine-connector-field/);
  assert.match(PRODUCTION_BRIDGE_SOURCE, /commitConnectorInspectorFields\(deviceId, connectorId, patch\)/);
  assert.match(PROJECT_MUTATIONS_SOURCE, /"nameCustom"/);

  const projectData = {
    state: {
      devices: [{ instanceId: "device-a", connectorOverrides: {} }],
      connections: []
    }
  };
  const mutations = new ProjectMutationAdapter({ projectData }, { cloneProjectData: false });
  mutations.updateConnectorFields("device-a", "out-1", {
    nameText: "OUT 42",
    nameCustom: true,
    resolutionFrameRate: "4K60",
    customText: "Preview"
  });
  assert.deepEqual(projectData.state.devices[0].connectorOverrides["out-1"], {
    nameText: "OUT 42",
    nameCustom: true,
    resolutionFrameRate: "4K60",
    customText: "Preview"
  });
});

test("Device Editor instance mode reflects canvas connector field overrides", () => {
  const openInstanceEditor = functionSource("openDeviceEditorForCanvasInstanceLegacy");
  const applyEditor = functionSource("applyDeviceEditor");
  const hydrateOverrides = functionSource("hydrateEditorDraftFromInstanceConnectorOverrides");
  const pruneOverrides = functionSource("pruneEditorOwnedInstanceConnectorOverrides");

  assert.match(openInstanceEditor, /hydrateEditorDraftFromInstanceConnectorOverrides\(editorDraft\[0\], instance\)/);
  assert.match(applyEditor, /pruneEditorOwnedInstanceConnectorOverrides\(instance, editedTemplate\)/);
  assert.match(hydrateOverrides, /instance\?\.connectorOverrides/);
  assert.match(hydrateOverrides, /editorOwnedConnectorOverridePatch\(override\)/);
  assert.match(hydrateOverrides, /Object\.assign\(connector, patch\)/);
  assert.match(hydrateOverrides, /effectiveTemplateConnectors\(template\)[\s\S]*generatedFromCard/);
  assert.match(hydrateOverrides, /slot\.connectorOverrides\[generated\.sourceConnectorId\]/);
  assert.match(hydrateOverrides, /normalizeMixedDeviceRows\(template\)/);
  assert.match(pruneOverrides, /effectiveTemplateConnectors\(editedTemplate\)/);
  assert.match(pruneOverrides, /EDITOR_INSTANCE_CONNECTOR_OVERRIDE_FIELDS/);
  assert.match(pruneOverrides, /EDITOR_INSTANCE_DERIVED_CONNECTOR_OVERRIDE_FIELDS/);
  assert.match(INDEX_HTML, /const EDITOR_INSTANCE_CONNECTOR_OVERRIDE_FIELDS = new Set\(CARD_SLOT_OVERRIDE_FIELDS\);/);
  assert.match(INDEX_HTML, /"displayLabel",[\s\S]*"colorSegments",[\s\S]*"installedModuleEffectiveType"/);
});

test("Faceplate tab keeps image controls together in one compact row", () => {
  const faceplatePanel = editorPanel("faceplate");

  assert.match(faceplatePanel, /faceplate-control-row/);
  assert.match(faceplatePanel, /faceplate-button-row/);
  assertOrder(faceplatePanel, [
    'id="editorFaceUpload"',
    'id="removeEditorFaceImage"',
    'id="deleteEditorFaceplate"'
  ], "Faceplate image actions should sit together");
  assert.match(faceplatePanel, /id="editorFaceUpload"[^>]+aria-label="Front face image"/);
  assert.doesNotMatch(faceplatePanel, />\s*Front Face\s*</);
  assert.doesNotMatch(faceplatePanel, /<label>&nbsp;<\/label>/);
});

test("Cards tab uses the authoring schematic before the Engine full-device branch", () => {
  const renderPreview = functionSource("renderDeviceEditorPreview");
  assertOrder(renderPreview, [
    'if (editorActiveTab === "cards")',
    "setDeviceEditorCardAuthoringMode(true);",
    "renderCardEditorPreview();",
    "return;",
    "setDeviceEditorCardAuthoringMode(false);",
    "if (deviceEditorActivePreviewUsesEngine())",
    "renderDeviceEditorEnginePreview(template, options);",
    "return;",
    "editorEnginePreviewLegacyVisualDraws += 1;"
  ], "Cards authoring preview must precede Engine full-device preview");

  const cardMode = functionSource("setDeviceEditorCardAuthoringMode");
  assert.match(cardMode, /restoreDeviceEditorPreviewSvgHome\(\)/);
  assert.match(cardMode, /aria-hidden", active \? "true" : "false"/);
  assert.match(INDEX_HTML, /\.editor-preview\.card-authoring-mode \.engine-preview-surface/);
  assert.match(functionSource("disposeDeviceEditorEnginePreviewSurface"), /restoreDeviceEditorPreviewSvgHome\(\);/);
});

test("Fit uses active bounds and tab switches auto-fit the active preview", () => {
  assert.match(ENGINE_PREVIEW_SOURCE, /setSceneData\(sceneData = \{\}, \{ fit = true, fitOptions = null \} = \{\}\)/);
  assert.match(ENGINE_PREVIEW_SOURCE, /if \(fit\) this\.fitToContent\(fitOptions \|\| undefined\);/);

  const syncPreview = functionSource("syncDeviceEditorEnginePreview");
  assert.match(syncPreview, /const fitBounds = options\.fitBounds \|\| editorActivePreviewBounds\(template\);/);
  assert.match(syncPreview, /fitOptions: \{ padding: 34, bounds: fitBounds \}/);

  const fitPreview = functionSource("fitDeviceEditorPreview");
  assert.match(fitPreview, /const bounds = editorActivePreviewBounds\(template\);/);
  assert.match(fitPreview, /surface\.fitToContent\(\{ padding: 34, bounds \}\);/);
  assert.match(fitPreview, /editorPreviewFitZoomForBounds\(bounds, deviceEditorPreview, 34\)/);

  const renderPreview = functionSource("renderDeviceEditorPreview");
  assert.match(renderPreview, /editorPreviewViewBox\(width, height, editorPreviewZoom, editorPreviewPan, deviceEditorPreview, editorActivePreviewBounds\(previewTemplate\)\)/);
  assert.match(functionSource("renderCardEditorPreview"), /editorPreviewViewBox\(width, height, editorPreviewZoom, editorPreviewPan, deviceEditorPreview, editorCardPreviewBounds\(card\)\)/);

  const tabHandler = sourceSlice(INDEX_HTML, 'editorTabs.addEventListener("click"', 'connectorRelationshipsPanel?.addEventListener("click"');
  assertOrder(tabHandler, [
    "const previousTab = editorActiveTab;",
    "const nextTab = tab.dataset.editorTab;",
    "if (previousTab !== nextTab) clearEditorPlacementMotion();",
    "editorActiveTab = nextTab;",
    "renderDeviceEditorPreview();",
    "if (previousTab !== editorActiveTab) scheduleDeviceEditorPreviewFit(editorActiveTab);"
  ], "Every tab switch should schedule an active-preview fit after rendering");
  assert.match(functionSource("scheduleDeviceEditorPreviewFit"), /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) =>/);
  assert.match(functionSource("scheduleDeviceEditorPreviewFit"), /fitDeviceEditorPreview\(\);/);
});

test("Editor preview wheel zoom matches the main canvas modifier rule", () => {
  const mainCanvasGate = functionSource("canvasWheelZoomModifierActive");
  assert.match(mainCanvasGate, /IS_APPLE_POINTER_PLATFORM \? event\?\.metaKey : event\?\.ctrlKey/);

  const activePreviewGate = functionSource("deviceEditorActivePreviewUsesEngine");
  assert.match(activePreviewGate, /deviceEditorUsesEnginePreview\(\) && editorActiveTab !== "cards"/);
  assert.match(functionSource("editorPreviewWheelZoomFactor"), /event\?\.deltaY < 0 \? 1\.12 : 1 \/ 1\.12/);
  assert.doesNotMatch(INDEX_HTML, /function\s+editorPreviewWheelAltModifierActive/);
  const editorGate = functionSource("editorPreviewWheelZoomModifierActive");
  assert.match(editorGate, /return canvasWheelZoomModifierActive\(event\);/);
  assert.match(functionSource("zoomEditorPreviewSvg"), /svg === deviceEditorPreview && deviceEditorActivePreviewUsesEngine\(\)/);
  assert.match(functionSource("handleEditorPreviewWheel"), /if \(!editorPreviewWheelZoomModifierActive\(event\)\) return;/);
  assert.match(functionSource("handleEditorPreviewWheel"), /event\.preventDefault\(\);/);
  assert.match(functionSource("handleEditorPreviewWheel"), /zoomEditorPreviewSvg\(targetSvg, editorPreviewWheelZoomFactor\(event\), event\);/);
  assert.match(functionSource("bindEditorPreviewNavigation"), /bindEditorPreviewWheelTarget\(svg, svg\);/);
  assert.match(functionSource("bindEditorPreviewNavigation"), /bindEditorPreviewWheelTarget\(previewHost, svg\);/);
  assert.match(functionSource("handleRackBuilderPreviewWheel"), /if \(!editorPreviewWheelZoomModifierActive\(event\)\) return;/);
  assert.match(functionSource("handleRackBuilderPreviewWheel"), /setRackBuilderPreviewZoom\(rackBuilderPreviewZoom \* editorPreviewWheelZoomFactor\(event\), event\);/);
  assert.match(functionSource("handleNodeBuilderPreviewWheel"), /if \(!editorPreviewWheelZoomModifierActive\(event\)\) return;/);
  assert.match(functionSource("handleNodeBuilderPreviewWheel"), /zoomEnginePreviewSurfaceAt\(surface, editorPreviewWheelZoomFactor\(event\), event\);/);
  assert.match(functionSource("handleTitleBlockPreviewWheel"), /if \(!editorPreviewWheelZoomModifierActive\(event\)\) return;/);
  assert.match(functionSource("handleTitleBlockPreviewWheel"), /zoomEnginePreviewSurfaceAt\(surface, editorPreviewWheelZoomFactor\(event\), event\);/);
  assert.match(INDEX_HTML, /nodeCanvasAppearancePreview\?\.addEventListener\("wheel", handleNodeBuilderPreviewWheel, \{ passive: false \}\);/);
  assert.match(INDEX_HTML, /titleBlockPreviewHost\.addEventListener\("wheel", handleTitleBlockPreviewWheel, \{ passive: false \}\);/);
});

test("Engine preview fit contains both width-limited and height-limited bounds", () => {
  const wideBounds = { x: 10, y: 20, width: 1600, height: 240 };
  const tallBounds = { x: -80, y: 30, width: 220, height: 1500 };
  const wideCamera = fitCameraToBounds(wideBounds, 1000, 700, 50);
  const tallCamera = fitCameraToBounds(tallBounds, 1000, 700, 50);

  assert.ok(close(wideCamera.zoom, 900 / wideBounds.width), "wide fit should use viewport width");
  assert.ok(close(tallCamera.zoom, 600 / tallBounds.height), "tall fit should use viewport height");
  assertCameraContains(wideCamera, wideBounds, 1000, 700, 50, "wide fit");
  assertCameraContains(tallCamera, tallBounds, 1000, 700, 50, "tall fit");
});

test("Engine preview camera-only operations do not rebuild scene data or textures", () => {
  const setCamera = sourceSlice(ENGINE_PREVIEW_SOURCE, "  setCamera(", "  setSceneData(");
  const fitToContent = sourceSlice(ENGINE_PREVIEW_SOURCE, "  fitToContent(", "  screenToWorld(");
  const resize = sourceSlice(ENGINE_PREVIEW_SOURCE, "  resize(", "  render() {");

  for (const [label, source] of [
    ["setCamera", setCamera],
    ["fitToContent", fitToContent],
    ["resize", resize]
  ]) {
    assert.doesNotMatch(source, /setSceneData|setStaticScene|updateDirty|refreshDeviceTextures/, `${label} should not rebuild scene data or refresh textures`);
  }
  assert.match(setCamera, /if \(render\) this\.render\(\);/, "setCamera should only request a render");
  assert.match(fitToContent, /fitCameraToBounds/, "Fit should update camera from bounds");
  assert.match(resize, /this\.renderer\.resize\(\);/, "resize without fit should only resize the renderer");
});

test("Matrix and LED Processor flags do not draw automatic faceplate tags", () => {
  assert.doesNotMatch(DEVICE_VISUAL_BUILDER_SOURCE, /LED PROCESSOR/);
  assert.doesNotMatch(DEVICE_VISUAL_BUILDER_SOURCE, /drawDeviceTag\(ctx,\s*"MATRIX"/);
  assert.doesNotMatch(DEVICE_VISUAL_BUILDER_SOURCE, /function\s+drawDeviceTag/);
});
