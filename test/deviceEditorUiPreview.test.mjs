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
  createModularStructuralEditSession,
  isValidModularCompositeInsertionResult,
  isValidModularInsertionResult,
  isValidModularStructuralEditResult,
  resolveModularCompositeInsertionDrag,
  resolveModularInsertionDrag,
  resolveModularStructuralEdit,
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
      createModularStructuralEditSession,
      isValidModularCompositeInsertionResult,
      resolveModularInsertionDrag,
      resolveModularCompositeInsertionDrag,
      resolveModularStructuralEdit,
      targetLaneWithHysteresis,
      isValidModularInsertionResult,
      isValidModularStructuralEditResult,
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

function structuralEditorHarness(inputTemplate = {}) {
  const template = structuredClone({
    id: "structural-editor-device",
    name: "Structural Editor Device",
    width: 420,
    startY: 100,
    manualHeight: 0,
    deviceDefinitionVersion: 2,
    schemaVersion: 2,
    connectors: [],
    hasSwappableCards: true,
    cardTypes: [],
    cardSlots: [],
    connectorRelationships: [],
    ...inputTemplate
  });
  const counters = {
    structuralSessions: 0,
    solverCalls: 0,
    validationCalls: 0,
    normalizationCalls: 0,
    previewRenders: 0,
    editorRenders: 0,
    selectedSettingsRenders: 0,
    relationshipRenders: 0,
    debugRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0,
    alerts: [],
    edits: [],
    selectedIndexes: []
  };
  const placementModule = {
    connectorPlacementSideMask,
    resolveModularPlacementItems,
    createModularStructuralEditSession: (...args) => {
      counters.structuralSessions += 1;
      return createModularStructuralEditSession(...args);
    },
    resolveModularStructuralEdit: (...args) => {
      counters.solverCalls += 1;
      counters.edits.push(structuredClone(args[1]));
      return resolveModularStructuralEdit(...args);
    },
    isValidModularStructuralEditResult: (...args) => {
      counters.validationCalls += 1;
      return placementModule.forceInvalid === true ? false : isValidModularStructuralEditResult(...args);
    }
  };
  const context = {
    console,
    JSON,
    Map,
    Set,
    Number,
    Object,
    String,
    Boolean,
    Math,
    Date,
    RegExp,
    structuredClone,
    EDITOR_DEVICE_DEFINITION_SCHEMA_VERSION: 2,
    FACE_TOP_Y: 20,
    SLOT_HEIGHT: 54,
    DEVICE_BOTTOM_PAD: 48,
    DEVICE_WIDTH: 420,
    CONNECTOR_START_Y: 100,
    DEFAULT_FIBER_MODE: "singlemode",
    cableTypes: {
      hdmi: { label: "HDMI", color: "#ffcc00" },
      dvi: { label: "DVI", color: "#22cc88" },
      ethernet: { label: "Ethernet", color: "#25a6f7" },
      cat5e: { label: "Cat5e", color: "#6B7280" },
      cat6a: { label: "Cat6A", color: "#6B7280" },
      "sfp-cage": { label: "SFP Cage", color: "#9aa2aa" },
      "sfp-plus-cage": { label: "SFP+ Cage", color: "#9aa2aa" },
      "qsfp-cage": { label: "QSFP Cage", color: "#9aa2aa" },
      "led-signal": { label: "LED Signal", color: "#32b6ff" },
      misc: { label: "Misc.", color: "#999999" }
    },
    switchPortOptions: [
      { value: "1g-rj45", label: "1G RJ45", connectorType: "cat5e" },
      { value: "10g-rj45", label: "10G RJ45", connectorType: "cat6a" },
      { value: "sfp", label: "SFP", connectorType: "sfp-cage" },
      { value: "sfp-plus", label: "SFP+", connectorType: "sfp-plus-cage" },
      { value: "qsfp", label: "QSFP", connectorType: "qsfp-cage" }
    ],
    pairedNetworkTypes: new Set(["cat5e", "cat6", "cat6a", "ethercon", "sfp-cage", "sfp-plus-cage", "qsfp-cage", "ethernet"]),
    cageConnectorTypes: new Set(),
    editorDraft: [template],
    editorIndex: 0,
    editorFaceplateUploadRevision: 0,
    editorSlotIndex: null,
    editorCardIndex: 0,
    editorSelectedNodeIndex: null,
    editorSelectedNodeIds: new Set(),
    editorSelectedCardNodeIndex: null,
    editorSelectedCardNodeIds: new Set(),
    editorLedProcessor: { checked: inputTemplate.isLedProcessor === true },
    editorLedOutputCount: { value: String(inputTemplate.ledOutputCount || 16), disabled: inputTemplate.isLedProcessor !== true },
    editorEthernetSwitch: { checked: inputTemplate.isEthernetSwitch === true },
    editorSwitchPortCount: { value: String(inputTemplate.switchPortCount || 8), disabled: inputTemplate.isEthernetSwitch !== true },
    editorSwitchPortType: { value: inputTemplate.switchPortType || "1g-rj45", disabled: inputTemplate.isEthernetSwitch !== true },
    addEthernetSwitchPorts: { disabled: inputTemplate.isEthernetSwitch !== true },
    editorPowerDistro: { checked: inputTemplate.isPowerDistro === true },
    removeEditorFaceImage: { textContent: "Remove Custom Faceplate", disabled: false },
    deleteEditorFaceplate: { disabled: false },
    deviceEditorModal: { classList: { contains: () => false } },
    prepareFrontFaceImage: async dataUrl => ({
      dataUrl,
      thumbnailDataUrl: `${dataUrl}-thumb`,
      width: 800,
      height: 400
    }),
    CARD_SLOT_OVERRIDE_FIELDS: [
      "nameText",
      "nameCustom",
      "resolutionFrameRate",
      "customText",
      "nameTextCaption",
      "resolutionFrameRateCaption",
      "customTextCaption",
      "includeInMatrix",
      "matrixPortTouched",
      "fiberMode",
      "customColor",
      "installedModuleType",
      "schemaVersion",
      "physicalType",
      "connectorType",
      "signalDirection",
      "displaySide",
      "anchors",
      "primaryAnchorId",
      "operationalStatus",
      "infoFields",
      "moduleCapability",
      "fiberCapability",
      "powerMetadata"
    ],
    requireDeviceEditorPlacementModule: () => placementModule,
    requireDeviceEditorPlacementMotionModule: () => placementMotionModule,
    connectorStartYForTemplate: device => {
      const baseStartY = Number(device?.startY) || 100;
      if (device?.faceImage) {
        const explicitStartY = Number(device.faceImageStartY);
        if (Number.isFinite(explicitStartY)) return explicitStartY;
        const width = Number(device.faceImageNaturalWidth);
        const height = Number(device.faceImageNaturalHeight);
        return width > 0 && height > 0 ? baseStartY + Math.round(height / width * 100) : baseStartY;
      }
      if (device?.faceplateDeleted) return Number(device.deletedFaceStartY) || baseStartY;
      if (!device?.isPowerDistro) return baseStartY;
      const explicitStartY = Number(device.powerDistroStartY);
      if (Number.isFinite(explicitStartY)) return explicitStartY;
      const powerPlugCount = (device.connectors || []).filter(connector => String(connector?.type || "").startsWith("power-")).length;
      return baseStartY + Math.max(0, powerPlugCount - 1) * 54;
    },
    laneIndexForY: (y, startY = 100) => Math.max(0, Math.round(((Number(y) || startY) - startY) / 54)),
    laneY: (lane, startY = 100) => startY + Math.max(0, Math.round(Number(lane) || 0)) * 54,
    deviceTemplateWidth: device => Number(device?.width) || 420,
    connectorSideKey: connector => connector?.direction === "output" ? "output" : "input",
    currentEditorTemplate: () => context.editorDraft[context.editorIndex],
    syncEditorFieldsToDraft: () => {},
    uniqueConnectorId: (device, baseId = "connector") => {
      const existing = new Set((device.connectors || []).map(connector => connector.id));
      let id = baseId || "connector";
      let suffix = 2;
      while (existing.has(id)) id = `${baseId}-${suffix++}`;
      return id;
    },
    slugify: value => String(value || "item").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item",
    oppositeConnectorDirection: direction => direction === "output" ? "input" : "output",
    normalizeEditorSignalDirection: (value, direction) => String(value || direction || "input"),
    normalizeEditorDisplaySide: (value, direction) => {
      const raw = String(value || "").toLowerCase();
      if (raw === "both" || raw === "left" || raw === "right") return raw;
      return direction === "output" ? "right" : "left";
    },
    normalizeEditorPhysicalConnectorType: connector => String(connector?.physicalType || connector?.type || ""),
    normalizeEditorConnectorOperationalStatus: value => value === "not-working" ? "not-working" : "working",
    normalizeColor: value => String(value || "#000000"),
    isAdapterTemplate: device => device?.objectType === "adapter",
    isDeviceDefinitionV2ForEditor: device => Number(device?.deviceDefinitionVersion || device?.schemaVersion || 0) >= 2,
    isFaceplateSideDropTarget: (device, y) => device?.allowFaceplateSide === true && Number(y) < 80,
    faceplateSideConnectorBounds: device => {
      if (!device || (device.faceplateDeleted && !device.faceImage)) return null;
      const y = 20;
      const startY = context.connectorStartYForTemplate(device);
      return { x: 12, y, width: (Number(device.width) || 420) - 24, height: Math.max(24, startY - y - 36) };
    },
    faceplateSideConnectorY: device => {
      const bounds = context.faceplateSideConnectorBounds(device);
      return bounds ? bounds.y + bounds.height / 2 : context.connectorStartYForTemplate(device);
    },
    moveConnectorBelowFaceplate: (device, connector) => {
      connector.faceplateSide = false;
      connector.y = 100 + (device.connectors || []).filter(item => !item.faceplateSide && item !== connector).length * 54;
    },
    isAdapterCenterDropTarget: () => false,
    isEditorV2ConnectorCandidate: connector => Array.isArray(connector?.anchors),
    editorConnectorAnchors: (connector, width = 420) => {
      if (Array.isArray(connector?.anchors)) return structuredClone(connector.anchors);
      const side = connector?.displaySide === "right" || connector?.direction === "output" ? "right" : "left";
      return [{ id: side, side, x: side === "right" ? width : 0, y: Number(connector?.y) || 100, primary: true }];
    },
    ensureConnectorV2Defaults: (device, connector) => {
      const width = Number(device?.width) || 420;
      const displaySide = connector.displaySide === "both"
        ? "both"
        : connector.displaySide === "right" || connector.direction === "output"
          ? "right"
          : "left";
      connector.displaySide = displaySide;
      connector.primaryAnchorId = displaySide === "right" ? "right" : "left";
      connector.anchors = displaySide === "both"
        ? [
            { id: "left", side: "left", x: 0, y: connector.y, primary: true },
            { id: "right", side: "right", x: width, y: connector.y }
          ]
        : [{ id: connector.primaryAnchorId, side: connector.primaryAnchorId, x: displaySide === "right" ? width : 0, y: connector.y, primary: true }];
    },
    isPairedNetworkConnector: connector => context.pairedNetworkTypes.has(connector?.type),
    isCageConnector: () => false,
    isFiberCableType: () => false,
    isPowerPlugConnector: () => false,
    clearPowerPlugPlacements: device => {
      (device?.connectors || []).forEach(connector => {
        delete connector.powerPlug;
      });
    },
    powerPlugCanExistOnSide: type => type !== "hdmi",
    resetMatrixPortDefault: connector => {
      connector.includeInMatrix = false;
      connector.matrixPortTouched = false;
    },
    ensureModularDefaults: device => {
      device.connectors = Array.isArray(device.connectors) ? device.connectors : [];
      device.cardTypes = Array.isArray(device.cardTypes) ? device.cardTypes : [];
      device.cardSlots = Array.isArray(device.cardSlots) ? device.cardSlots : [];
    },
    cardTypeById: (device, cardTypeId) => device?.cardTypes?.find(card => card.id === cardTypeId) || null,
    cardSlotLaneCount: (device, slot) => {
      const card = context.cardTypeById(device, slot?.installedCardTypeId);
      if (!card) return 1;
      const inputs = (card.connectors || []).filter(connector => connector.direction === "input" && !connector.empty).length;
      const outputs = (card.connectors || []).filter(connector => connector.direction !== "input" && !connector.empty).length;
      return Math.max(1, inputs, outputs) + 2;
    },
    ensureCardSlotConnectorOverrides: (device, slot) => {
      slot.connectorOverrides = slot.connectorOverrides && typeof slot.connectorOverrides === "object" ? slot.connectorOverrides : {};
      const card = context.cardTypeById(device, slot?.installedCardTypeId);
      if (!card) {
        slot.connectorOverrides = {};
        return slot.connectorOverrides;
      }
      const validConnectorIds = new Set((card.connectors || []).map(connector => connector.id));
      Object.keys(slot.connectorOverrides).forEach(connectorId => {
        if (!validConnectorIds.has(connectorId)) delete slot.connectorOverrides[connectorId];
      });
      return slot.connectorOverrides;
    },
    normalizeConnectorRows: device => {
      counters.normalizationCalls += 1;
      context.normalizeMixedDeviceRows(device);
    },
    normalizeEditorConnectorRelationships: () => {},
    normalizeMatrixPortFlag: connector => {
      connector.includeInMatrix = connector.includeInMatrix === true;
      connector.matrixPortTouched = connector.matrixPortTouched === true;
    },
    effectiveConnectorType: connector => String(connector?.type || connector?.physicalType || connector?.connectorType || ""),
    activeFiberModeForCageConnector: () => "",
    hasOwn: (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key),
    applyTransceiverModule: (connector, value) => {
      connector.installedModuleType = String(value || "");
    },
    editorCardSlotDisplayOverrides: () => ({}),
    cardSlotDisplayY: (_device, slot) => Number(slot?.y) || 100,
    editorLaneMapsEqual: (left = new Map(), right = new Map()) => {
      if (left.size !== right.size) return false;
      for (const [id, lane] of left) {
        if (right.get(id) !== lane) return false;
      }
      return true;
    },
    deviceHeightForSlotCounts: device => {
      if (context.failDeviceHeightForSlotCounts === true) {
        throw new Error("forced device height failure");
      }
      const startY = context.connectorStartYForTemplate(device);
      const connectorBottom = Math.max(startY, ...(device.connectors || []).filter(connector => !connector.faceplateSide).map(connector => (Number(connector.y) || startY) + 54));
      const slotBottom = Math.max(startY, ...(device.cardSlots || []).map(slot => (Number(slot.y) || startY) + context.cardSlotLaneCount(device, slot) * 54));
      return Math.max(240, Number(device?.manualHeight) || 0, connectorBottom + 48, slotBottom + 48);
    },
    setEditorNodeSelection: (device, index) => {
      context.editorSelectedNodeIndex = index;
      const connector = device.connectors[index];
      context.editorSelectedNodeIds = connector ? new Set([connector.id]) : new Set();
      counters.selectedIndexes.push(index);
    },
    clearEditorNodeSelection: () => {
      context.editorSelectedNodeIndex = null;
      context.editorSelectedNodeIds = new Set();
      counters.selectedIndexes.push(null);
    },
    syncEditorNodeSelection: (device = template) => {
      if (!device?.connectors) {
        context.clearEditorNodeSelection();
        return;
      }
      const validIds = new Set(device.connectors.map(connector => connector.id));
      context.editorSelectedNodeIds = new Set([...context.editorSelectedNodeIds].filter(id => validIds.has(id)));
      const indexedConnector = device.connectors[context.editorSelectedNodeIndex];
      if (indexedConnector && !context.editorSelectedNodeIds.size) {
        context.editorSelectedNodeIds.add(indexedConnector.id);
      }
      if (!context.editorSelectedNodeIds.size) {
        context.editorSelectedNodeIndex = null;
        return;
      }
      const currentConnector = device.connectors[context.editorSelectedNodeIndex];
      if (!currentConnector || !context.editorSelectedNodeIds.has(currentConnector.id)) {
        const firstId = context.editorSelectedNodeIds.values().next().value;
        context.editorSelectedNodeIndex = device.connectors.findIndex(connector => connector.id === firstId);
      }
    },
    clamp: (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max),
    renderDeviceEditorPreview: () => { counters.previewRenders += 1; },
    renderDeviceEditor: () => { counters.editorRenders += 1; },
    renderSelectedConnectorSettings: () => { counters.selectedSettingsRenders += 1; },
    renderConnectorRelationshipsPanel: () => { counters.relationshipRenders += 1; },
    renderDeviceAuthoringDebugPanel: () => { counters.debugRenders += 1; },
    beginEditorPlacementMotion: drag => {
      counters.animationSeeds += 1;
      counters.lastAnimationItem = drag?.itemId || "";
    },
    settleEditorPlacementMotionToLayout: layout => {
      counters.animationRetargets += 1;
      counters.lastAnimationLayout = layout;
    },
    alert: message => counters.alerts.push(String(message))
  };
  const helpers = [
    "normalizeEditorPlacementSideMask",
    "editorConnectorPlacementSideMask",
    "editorCardPlacementSideMask",
    "editorPlacementItemId",
    "resolveEditorPlacementItems",
    "editorLayoutItems",
    "resolveEditorModularLayout",
    "syncEditorConnectorAnchorsToPosition",
    "editorStableLayoutItemKind",
    "editorStableDragSourceId",
    "editorStableDragLaneMap",
    "editorPlacementItemByStableId",
    "applyEditorStableResolvedLayout",
    "normalizeMixedDeviceRows",
    "editorStructuralLayoutItems",
    "editorStructuralTargetMap",
    "editorStructuralUpsertForItem",
    "replaceEditorTemplateContents",
    "animateEditorStructuralEdit",
    "rebaseEditorStructuralDraftFromBaseline",
    "reconcileEditorFaceplateSideMembership",
    "rebaseEditorFaceplateSideConnectors",
    "commitEditorStructuralEdit",
    "syncEditorFaceplateActionControls",
    "commitEditorFaceplateOriginMutation",
    "resetEditorFaceImageFields",
    "resetEditorPowerDistroFaceState",
    "captureEditorFaceplateUploadTarget",
    "invalidateEditorFaceplateUploadTarget",
    "isEditorFaceplateUploadTargetCurrent",
    "commitPreparedEditorFaceplateUpload",
    "prepareAndCommitEditorFaceplateUpload",
    "applyEditorFaceImageRemoval",
    "applyEditorFaceplateDeletion",
    "editorNodeSelectionSnapshot",
    "restoreEditorNodeSelectionByStableIds",
    "pairedNetworkGroupId",
    "ensurePairedNetworkPair",
    "nextEditorPlacementY",
    "nextEditorSlotY",
    "ledProcessorSignalIndex",
    "isLegacyLedProcessorGeneratedConnector",
    "isLedProcessorGeneratedConnector",
    "applyLedProcessorGeneratedDefaults",
    "createLedProcessorConnector",
    "applyLedProcessorSettings",
    "applyPowerDistroSettings",
    "selectedSwitchPortOption",
    "applyEthernetSwitchSettings",
    "switchPortOptionByValue",
    "switchPortProfileForConnector",
    "switchPortIndexForConnector",
    "nextSwitchPortIndex",
    "uniqueNetworkGroupId",
    "createEthernetSwitchConnectorPair",
    "addEthernetSwitchPortBatch",
    "addEditorNode",
    "defaultConnectorNameFor",
    "applyAutomaticConnectorName",
    "applyEditorConnectorTypeToDraft",
    "fillEditorSlot",
    "removeEditorNode",
    "normalizeCardConnector",
    "createCardType",
    "uniqueCardTypeId",
    "uniqueCardConnectorId",
    "currentEditorCard",
    "clearEditorCardNodeSelection",
    "syncEditorCardNodeSelection",
    "setEditorCardNodeSelection",
    "editorCardConnectorSelectionSnapshot",
    "restoreEditorCardSelectionByStableIds",
    "pruneInstalledCardSlotOverridesForCard",
    "commitEditorCardCollectionEdit",
    "commitEditorCardDefinitionEdit",
    "applyCardConnectorPhysicalTypeToDraft",
    "addCardConnector",
    "fillCardConnector",
    "removeCardConnector",
    "changeEditorCardKind",
    "deleteCurrentCardType",
    "createNewEditorCardType",
    "duplicateCurrentCardType",
    "mergedCardConnectorForSlot",
    "defaultEditorAnchorForSide",
    "editorConnectorAnchors",
    "generatedCardConnectors",
    "applyInstalledCardConnectorAnchors",
    "normalizeCardSlots",
    "createCardSlot",
    "uniqueCardSlotId",
    "installCardInSlot",
    "addEditorCardSlot",
    "removeCardSlot"
  ];
  const script = `${helpers.map(functionSource).join("\n")}
    ({
      resolveEditorModularLayout,
      editorStructuralLayoutItems,
      commitEditorStructuralEdit,
      commitEditorFaceplateOriginMutation,
      captureEditorFaceplateUploadTarget,
      invalidateEditorFaceplateUploadTarget,
      isEditorFaceplateUploadTargetCurrent,
      commitPreparedEditorFaceplateUpload,
      prepareAndCommitEditorFaceplateUpload,
      applyEditorFaceImageRemoval,
      applyEditorFaceplateDeletion,
      editorNodeSelectionSnapshot,
      restoreEditorNodeSelectionByStableIds,
      applyLedProcessorSettings,
      applyPowerDistroSettings,
      applyEthernetSwitchSettings,
      addEthernetSwitchPortBatch,
      addEditorNode,
      fillEditorSlot,
      removeEditorNode,
      addCardConnector,
      fillCardConnector,
      removeCardConnector,
      changeEditorCardKind,
      deleteCurrentCardType,
      createNewEditorCardType,
      duplicateCurrentCardType,
      generatedCardConnectors,
      setEditorCardNodeSelection,
      installCardInSlot,
      addEditorCardSlot,
      removeCardSlot
    })`;
  const api = vm.runInNewContext(script, context);
  return { api, context, template, counters, placementModule };
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

function editorCounterSnapshot(counters) {
  return {
    structuralSessions: counters.structuralSessions,
    solverCalls: counters.solverCalls,
    previewRenders: counters.previewRenders,
    editorRenders: counters.editorRenders,
    animationSeeds: counters.animationSeeds,
    animationRetargets: counters.animationRetargets
  };
}

function editorCounterDelta(counters, before) {
  const after = editorCounterSnapshot(counters);
  return Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - before[key]]));
}

function selectedCardConnectorIndexes(context) {
  return [...context.editorSelectedCardNodeIds]
    .map(index => Number(index))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

function selectedCardConnectorIds(template, context) {
  const card = template.cardTypes?.[context.editorCardIndex];
  return selectedCardConnectorIndexes(context)
    .map(index => card?.connectors?.[index]?.id)
    .filter(Boolean);
}

function selectedNodeConnectorIds(context) {
  return [...context.editorSelectedNodeIds].sort();
}

function selectedNodePrimaryConnectorId(template, context) {
  return Number.isInteger(context.editorSelectedNodeIndex)
    ? template.connectors?.[context.editorSelectedNodeIndex]?.id || ""
    : "";
}

function generatedLedConnectors(template) {
  return (template.connectors || [])
    .filter(connector => connector.generatedByLedProcessor === true)
    .sort((a, b) => Number(a.signalIndex || 0) - Number(b.signalIndex || 0));
}

function generatedSwitchConnectors(template, profile = "") {
  return (template.connectors || [])
    .filter(connector => connector.generatedByEthernetSwitch === true)
    .filter(connector => !profile || connector.switchPortProfile === profile)
    .sort((a, b) => {
      const indexDelta = Number(a.switchPortIndex || 0) - Number(b.switchPortIndex || 0);
      if (indexDelta) return indexDelta;
      return String(a.direction).localeCompare(String(b.direction));
    });
}

function switchGeneratedPairs(template, profile = "") {
  const connectors = generatedSwitchConnectors(template, profile);
  const byId = new Map(connectors.map(connector => [connector.id, connector]));
  return connectors
    .filter(connector => connector.direction === "output")
    .map(output => ({ output, input: byId.get(output.pairedConnectorId) }))
    .sort((a, b) => Number(a.output.switchPortIndex || 0) - Number(b.output.switchPortIndex || 0));
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
  const structuralItems = functionSource("editorStructuralLayoutItems");
  const structuralCommit = functionSource("commitEditorStructuralEdit");
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
  assert.match(placementLoader, /createModularStructuralEditSession/);
  assert.match(placementLoader, /resolveModularStructuralEdit/);
  assert.match(placementLoader, /isValidModularStructuralEditResult/);
  assert.match(placementRequire, /throw new Error\("Device Editor placement module is not loaded\."\)/);
  assert.match(placementReady, /await loadDeviceEditorPlacementModule\(\)/);
  assert.match(placementReady, /createModularInsertionDragSession/);
  assert.match(placementReady, /createModularCompositeInsertionDragSession/);
  assert.match(placementReady, /createModularStructuralEditSession/);
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
  assert.match(structuralItems, /editorLayoutItems\(template, \{ useDragPreview: false \}\)/);
  assert.match(structuralItems, /editorPlacementItemId\(item\)/);
  assert.match(structuralCommit, /createModularStructuralEditSession\(baselineLayout\.items/);
  assert.match(structuralCommit, /resolveModularStructuralEdit\(session, edit/);
  assert.match(structuralCommit, /isValidModularStructuralEditResult\(session, edit, solvedLayout/);
  assert.match(structuralCommit, /replaceEditorTemplateContents\(template, draft\)/);
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

test("Device Editor direct structural operations use the shared atomic transaction", () => {
  const addNode = functionSource("addEditorNode");
  const fillSlot = functionSource("fillEditorSlot");
  const typeDraft = functionSource("applyEditorConnectorTypeToDraft");
  const removeNode = functionSource("removeEditorNode");
  const applyLed = functionSource("applyLedProcessorSettings");
  const applyPowerDistro = functionSource("applyPowerDistroSettings");
  const applyEthernet = functionSource("applyEthernetSwitchSettings");
  const addEthernet = functionSource("addEthernetSwitchPortBatch");
  const nodeSelectionSnapshot = functionSource("editorNodeSelectionSnapshot");
  const restoreNodeSelection = functionSource("restoreEditorNodeSelectionByStableIds");
  const ensureNetworkPair = functionSource("ensurePairedNetworkPair");
  const installCard = functionSource("installCardInSlot");
  const addCardSlot = functionSource("addEditorCardSlot");
  const removeCardSlot = functionSource("removeCardSlot");
  const addCardConnector = functionSource("addCardConnector");
  const fillCardConnector = functionSource("fillCardConnector");
  const removeCardConnector = functionSource("removeCardConnector");
  const changeCardKind = functionSource("changeEditorCardKind");
  const deleteCardType = functionSource("deleteCurrentCardType");
  const cardCollectionCommit = functionSource("commitEditorCardCollectionEdit");
  const cardDefinitionCommit = functionSource("commitEditorCardDefinitionEdit");
  const displaySideHandler = functionSource("renderSelectedConnectorSettings");

  [addNode, fillSlot, removeNode, applyLed, applyPowerDistro, addEthernet, installCard, addCardSlot, removeCardSlot].forEach(source => {
    assert.match(source, /commitEditorStructuralEdit\(template/);
  });
  assert.doesNotMatch(applyEthernet, /commitEditorStructuralEdit\(template/);
  assert.match(ensureNetworkPair, /options\.normalize !== false/);
  assert.match(ensureNetworkPair, /options\.groupId/);
  assert.doesNotMatch(applyLed, /template\.connectors = template\.connectors\.filter\(connector => connector\.type !== "led-signal"\)/);
  assert.match(applyLed, /isLedProcessorGeneratedConnector\(connector\)/);
  assert.match(applyLed, /const selectionSnapshot = editorNodeSelectionSnapshot\(template\);/);
  assert.match(applyLed, /restoreEditorNodeSelectionByStableIds\(committedTemplate, selectionSnapshot\);/);
  assert.match(applyPowerDistro, /return \{ rebaseStartY: true \};/);
  assert.match(applyPowerDistro, /const selectionSnapshot = editorNodeSelectionSnapshot\(template\);/);
  assert.match(applyPowerDistro, /restoreEditorNodeSelectionByStableIds\(committedTemplate, selectionSnapshot\);/);
  assert.match(applyPowerDistro, /editorPowerDistro\.checked = template\.isPowerDistro === true;/);
  assert.doesNotMatch(applyPowerDistro, /normalizeConnectorRows|normalizeMixedDeviceRows|shiftRowsAfterFaceChange|renderDeviceEditorPreview/);
  assert.match(INDEX_HTML, /editorPowerDistro\.addEventListener\("change", applyPowerDistroSettings\);/);
  assert.doesNotMatch(addEthernet, /for[\s\S]*ensurePairedNetworkPair\(template, connector\)/);
  assert.doesNotMatch(addEthernet, /normalizeConnectorRows\(template\)/);
  assert.match(addEthernet, /const selectionSnapshot = editorNodeSelectionSnapshot\(template\);/);
  assert.match(addEthernet, /restoreEditorNodeSelectionByStableIds\(committedTemplate, selectionSnapshot\);/);
  assert.match(nodeSelectionSnapshot, /Object\.freeze\(\{[\s\S]*selectedConnectorIds: Object\.freeze/);
  assert.doesNotMatch(nodeSelectionSnapshot, /selectedNodeIndex|primaryIndex|new Map/);
  assert.match(restoreNodeSelection, /editorSelectedNodeIndex = null;/);
  assert.doesNotMatch(restoreNodeSelection, /syncEditorNodeSelection/);
  assert.match(addCardConnector, /commitEditorCardCollectionEdit\(template/);
  [fillCardConnector, removeCardConnector, changeCardKind, deleteCardType].forEach(source => {
    assert.match(source, /commitEditorCardDefinitionEdit\(template, cardTypeId/);
  });
  assert.match(addNode, /hardTargets: \{ \[`connector:\$\{connector\.id\}`\]: targetLane \}/);
  assert.match(addNode, /applyEditorConnectorTypeToDraft\(draft, connector\.id, requestedType/);
  assert.doesNotMatch(addNode, /fillEditorSlot\(createdIndex, options\.type\)/);
  assert.match(addCardSlot, /hardTargets: \{ \[`card:\$\{slot\.id\}`\]: targetLane \}/);
  assert.match(removeNode, /removeIds: \[\.{3}idsToRemove\]\.map\(id => `connector:\$\{id\}`\)/);
  assert.match(removeCardSlot, /removeIds: \[`card:\$\{slotId\}`\]/);
  assert.match(fillSlot, /applyEditorConnectorTypeToDraft\(draft, connectorId, type/);
  assert.match(typeDraft, /ensurePairedNetworkPair\(draft, draftConnector, \{ normalize: false \}\)/);
  assert.match(typeDraft, /hardTargets\[`connector:\$\{pair\.id\}`\] = targetLane/);
  assert.match(installCard, /upsertIds: \[`card:\$\{slotId\}`\]/);
  assert.match(cardDefinitionCommit, /commitEditorCardCollectionEdit\(template, \{/);
  assert.match(cardCollectionCommit, /commitEditorStructuralEdit\(template, \{/);
  assert.match(cardCollectionCommit, /restoreEditorCardSelectionByStableIds\(committedTemplate/);
  assert.match(displaySideHandler, /commitEditorStructuralEdit\(template, \{\s*primaryItemId: `connector:\$\{connectorId\}`/);
  assert.doesNotMatch(addNode, /template\.connectors\.push\(connector\);\s*normalizeConnectorRows\(template\)/);
  assert.doesNotMatch(removeNode, /template\.connectors = template\.connectors\.filter[\s\S]*normalizeConnectorRows\(template\)/);
  assert.doesNotMatch(installCard, /slot\.installedCardTypeId = cardTypeId[\s\S]*normalizeCardSlots\(template\)/);
  assert.doesNotMatch(changeCardKind, /normalizeCardSlots\(template\)/);
  assert.doesNotMatch(deleteCardType, /renderDeviceEditor\(\);\s*$/);
});

test("Device Editor discrete faceplate actions delegate to one atomic origin transaction", () => {
  const transaction = functionSource("commitEditorFaceplateOriginMutation");
  const preparedUpload = functionSource("commitPreparedEditorFaceplateUpload");
  const prepareAndCommit = functionSource("prepareAndCommitEditorFaceplateUpload");
  const removeImage = functionSource("applyEditorFaceImageRemoval");
  const deleteFaceplate = functionSource("applyEditorFaceplateDeletion");
  const uploadHandlers = sourceSlice(
    INDEX_HTML,
    'editorFaceUpload.addEventListener("change"',
    'document.getElementById("addInputNode")'
  );

  assert.match(transaction, /commitEditorStructuralEdit\(template/);
  assert.match(transaction, /rebaseStartY: true/);
  assert.match(transaction, /reconcileFaceplateSide: true/);
  assert.match(transaction, /const selectionSnapshot = editorNodeSelectionSnapshot\(template\);/);
  assert.match(transaction, /restoreEditorNodeSelectionByStableIds\(committedTemplate, selectionSnapshot\);/);
  assert.match(preparedUpload, /commitEditorFaceplateOriginMutation\(target\.template/);
  assert.match(removeImage, /commitEditorFaceplateOriginMutation\(template/);
  assert.match(deleteFaceplate, /commitEditorFaceplateOriginMutation\(template/);
  assert.match(prepareAndCommit, /Promise\.resolve\(prepareFrontFaceImage\(dataUrl, file\)\)[\s\S]*commitPreparedEditorFaceplateUpload\(target, prepared\)/);
  assert.match(uploadHandlers, /await prepareAndCommitEditorFaceplateUpload\(uploadTarget, reader\.result, file\);/);
  assert.match(uploadHandlers, /removeEditorFaceImage\.addEventListener\("click", applyEditorFaceImageRemoval\);/);
  assert.match(uploadHandlers, /deleteEditorFaceplate\?\.addEventListener\("click", applyEditorFaceplateDeletion\);/);
  [preparedUpload, prepareAndCommit, removeImage, deleteFaceplate, uploadHandlers].forEach(source => {
    assert.doesNotMatch(source, /shiftRowsAfterFaceChange|shiftTemplateRowsForStartChange|normalizeConnectorRows|normalizeMixedDeviceRows|renderDeviceEditorPreview|renderDeviceEditor\(/);
  });
});

test("Device Editor structural transactions derive membership and ignore special-only remove hints", () => {
  const { api, template, counters } = structuralEditorHarness({
    allowFaceplateSide: true,
    connectors: [
      { id: "faceplate", direction: "input", type: "hdmi", displaySide: "left", x: 0, y: 62, faceplateSide: true, anchors: [{ id: "left", side: "left", x: 0, y: 62, primary: true }] },
      testConnector("row-a", "left", 0, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 100, primary: true }] })
    ]
  });

  api.removeEditorNode(0);

  assert.deepEqual(template.connectors.map(connector => connector.id), ["row-a"]);
  assert.equal(counters.structuralSessions, 1, "special-only removal still creates one transaction session");
  assert.equal(counters.solverCalls, 0, "faceplate-only removal should not call the structural solver");
  assert.equal(counters.animationSeeds, 0, "faceplate-only removal should not animate modular placement");
  assert.equal(counters.animationRetargets, 0);
  assert.equal(counters.previewRenders, 1, "transaction owns the single preview render");
  assert.equal(counters.selectedSettingsRenders, 1);
  assert.deepEqual(counters.selectedIndexes, [null]);
});

test("Device Editor paired deletion filters non-layout IDs but removes modular companions", () => {
  const { api, template, counters } = structuralEditorHarness({
    allowFaceplateSide: true,
    deviceDefinitionVersion: 1,
    schemaVersion: 1,
    connectors: [
      { id: "faceplate", direction: "input", type: "ethernet", displaySide: "left", x: 0, y: 62, faceplateSide: true, pairedConnectorId: "pair", anchors: [{ id: "left", side: "left", x: 0, y: 62, primary: true }] },
      { id: "pair", direction: "output", type: "ethernet", displaySide: "right", x: 420, y: 100, pairedConnectorId: "faceplate", anchors: [{ id: "right", side: "right", x: 420, y: 100, primary: true }] },
      testConnector("keep", "right", 1, { direction: "output", displaySide: "right", schemaVersion: 2, anchors: [{ id: "right", side: "right", x: 420, y: 154, primary: true }] })
    ]
  });

  api.removeEditorNode(0);

  assert.deepEqual(template.connectors.map(connector => connector.id), ["keep"]);
  assert.equal(counters.solverCalls, 1, "modular companion removal should call the solver once");
  assert.deepEqual(counters.edits[0].removeIds, ["connector:pair"]);
  assert.equal(counters.animationSeeds, 1);
  assert.equal(counters.animationRetargets, 1);
  assert.equal(counters.previewRenders, 1);
});

test("Device Editor typed add fills the connector in one atomic structural transaction", () => {
  const { api, template, counters } = structuralEditorHarness({
    connectors: [
      testConnector("A", "left", 0, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 100, primary: true }] }),
      testConnector("B", "left", 2, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 208, primary: true }] })
    ]
  });

  api.addEditorNode("input", { type: "hdmi", y: 154 });
  const created = template.connectors.find(connector => connector.id.startsWith("input-slot"));
  const lanes = itemLaneMap(api.resolveEditorModularLayout(template));

  assert.ok(created, "typed add should create one connector");
  assert.equal(created.type, "hdmi");
  assert.equal(created.empty, false);
  assert.equal(created.nameText, "IN 3");
  assert.deepEqual(lanes, {
    "connector:A": 0,
    [`connector:${created.id}`]: 1,
    "connector:B": 2
  });
  assert.equal(counters.structuralSessions, 1);
  assert.equal(counters.solverCalls, 1);
  assert.equal(counters.previewRenders, 1);
  assert.equal(counters.animationSeeds, 1);
  assert.equal(counters.animationRetargets, 1);
  assert.equal(counters.selectedSettingsRenders, 1);
  assert.equal(counters.relationshipRenders, 1);
  assert.deepEqual(counters.edits[0].upserts.map(item => item.id), [`connector:${created.id}`]);
});

test("Device Editor typed paired add and paired removal are each one structural transaction", () => {
  const { api, template, counters } = structuralEditorHarness({
    deviceDefinitionVersion: 1,
    schemaVersion: 1,
    connectors: []
  });

  api.addEditorNode("input", { type: "ethernet", y: 100 });
  assert.equal(template.connectors.length, 2);
  const [primary, pair] = template.connectors;
  assert.equal(primary.pairedConnectorId, pair.id);
  assert.equal(pair.pairedConnectorId, primary.id);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), {
    [`connector:${primary.id}`]: 0,
    [`connector:${pair.id}`]: 0
  });
  assert.equal(counters.structuralSessions, 1);
  assert.equal(counters.solverCalls, 1);
  assert.equal(counters.previewRenders, 1);
  assert.equal(counters.animationSeeds, 1);
  assert.deepEqual(counters.edits[0].upserts.map(item => item.id).sort(), [`connector:${pair.id}`, `connector:${primary.id}`].sort());

  api.removeEditorNode(0);
  assert.deepEqual(template.connectors, []);
  assert.equal(counters.structuralSessions, 2);
  assert.equal(counters.solverCalls, 2);
  assert.equal(counters.previewRenders, 2);
  assert.deepEqual(counters.edits[1].removeIds.sort(), [`connector:${pair.id}`, `connector:${primary.id}`].sort());
});

test("Device Editor fill, validation failure, and mutation failure preserve rollback boundaries", () => {
  const { api, template, counters, placementModule } = structuralEditorHarness({
    isPowerDistro: true,
    connectors: [
      { id: "blank", direction: "input", label: "Input Slot 1", displaySide: "left", x: 0, y: 100, type: "", empty: true, anchors: [{ id: "left", side: "left", x: 0, y: 100, primary: true }] }
    ]
  });
  const before = structuredClone(template);

  api.addEditorNode("input", { type: "hdmi", y: 154 });
  assert.deepEqual(template, before, "invalid typed add should not leave a blank connector");
  assert.equal(counters.alerts.length, 1);
  assert.equal(counters.structuralSessions, 0);
  assert.equal(counters.previewRenders, 0);

  api.fillEditorSlot(0, "ethernet");
  assert.equal(template.connectors[0].type, "ethernet");
  assert.equal(counters.structuralSessions, 1);
  assert.equal(counters.solverCalls, 0, "simple V2 field fill should not run structural solver");
  assert.equal(counters.previewRenders, 1);
  assert.equal(counters.selectedSettingsRenders, 1);

  const afterFill = structuredClone(template);
  assert.throws(() => api.commitEditorStructuralEdit(template, {
    mutate(draft) {
      draft.connectors[0].label = "Should Roll Back";
      return { removeIds: ["connector:blank"] };
    }
  }), /requested removal/);
  assert.equal(JSON.stringify(template), JSON.stringify(afterFill), "explicit remove hint for a still-present modular item should roll back");
  assert.equal(counters.previewRenders, 1, "failed transaction should not render");

  placementModule.forceInvalid = true;
  assert.throws(() => api.commitEditorStructuralEdit(template, {
    mutate(draft) {
      draft.connectors.push(testConnector("new-validating", "left", 1, { displaySide: "left" }));
      return { upsertIds: ["connector:new-validating"] };
    }
  }), /invalid layout/);
  placementModule.forceInvalid = false;
  assert.equal(JSON.stringify(template), JSON.stringify(afterFill), "validation failure should preserve the committed template");

  assert.throws(() => api.commitEditorStructuralEdit(template, {
    mutate(draft) {
      draft.connectors[0].label = "Throw Rollback";
      throw new Error("boom");
    }
  }), /boom/);
  assert.equal(JSON.stringify(template), JSON.stringify(afterFill), "mutation throw should not touch the live template");

  assert.equal(api.commitEditorStructuralEdit(template, {
    mutate(draft) {
      draft.connectors[0].label = "Cancelled";
      return { cancelled: true };
    }
  }), null);
  assert.equal(JSON.stringify(template), JSON.stringify(afterFill), "cancelled mutation should remain read-only");
});

test("Device Editor structural card-slot edits keep IDs stable and use renderEditor once", () => {
  const { api, template, counters } = structuralEditorHarness({
    cardTypes: [
      {
        id: "input-card",
        name: "Input Card",
        kind: "input",
        connectors: [
          { id: "in-1", direction: "input", type: "hdmi", empty: false }
        ]
      },
      {
        id: "io-card",
        name: "I/O Card",
        kind: "io",
        connectors: [
          { id: "in-1", direction: "input", type: "hdmi", empty: false },
          { id: "in-2", direction: "input", type: "hdmi", empty: false },
          { id: "out-1", direction: "output", type: "hdmi", empty: false }
        ]
      }
    ],
    connectors: [
      testConnector("out-a", "right", 0, { direction: "output", displaySide: "right", schemaVersion: 2, anchors: [{ id: "right", side: "right", x: 420, y: 100, primary: true }] })
    ],
    cardSlots: []
  });

  assert.equal(api.addEditorCardSlot({ cardTypeId: "input-card", y: 100 }), true);
  const slotId = template.cardSlots[0].id;
  assert.equal(template.cardSlots[0].installedCardTypeId, "input-card");
  assert.equal(itemLaneMap(api.resolveEditorModularLayout(template))[`card:${slotId}`], 0, "input-only card can share a row with right-only connector");
  assert.equal(counters.editorRenders, 1);
  assert.equal(counters.previewRenders, 0);
  assert.equal(counters.solverCalls, 1);

  assert.equal(api.installCardInSlot(0, "io-card"), true);
  const replacedLaneMap = itemLaneMap(api.resolveEditorModularLayout(template));
  assert.equal(template.cardSlots[0].id, slotId, "replacing a card should preserve slot ID");
  assert.equal(template.cardSlots[0].installedCardTypeId, "io-card");
  assert.equal(replacedLaneMap[`card:${slotId}`], 0, "replacement should preserve the selected slot row when possible");
  assert.ok(replacedLaneMap["connector:out-a"] > 0, "I/O replacement should move the right-side connector away from the collision");
  assert.equal(counters.editorRenders, 2);
  assert.equal(counters.solverCalls, 2);

  api.removeCardSlot(0);
  assert.deepEqual(template.cardSlots, []);
  assert.equal(counters.editorRenders, 3);
  assert.equal(counters.solverCalls, 3);
  assert.deepEqual(counters.edits[2].removeIds, [`card:${slotId}`]);
});

test("Device Editor card definition add, fill, and type-change fan out through one atomic edit", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    cardTypes: [{
      id: "card-a",
      name: "Installed Input Card",
      kind: "input",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false, nameText: "IN 1" }
      ]
    }],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-a", y: 100, connectorOverrides: {} },
      { id: "slot-b", name: "Slot B", installedCardTypeId: "card-a", y: 262, connectorOverrides: {} }
    ]
  });
  context.editorCardIndex = 0;
  const initialMap = itemLaneMap(api.resolveEditorModularLayout(template));

  let before = editorCounterSnapshot(counters);
  api.addCardConnector("input");
  const emptyConnector = template.cardTypes[0].connectors[1];
  assert.ok(emptyConnector?.id, "add should create a stable source connector");
  assert.equal(emptyConnector.empty, true, "new card connectors start empty");
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), initialMap, "empty source nodes do not move installed slots");
  assert.equal(context.editorSelectedCardNodeIndex, 1, "new source connector should be selected by stable ID");

  before = editorCounterSnapshot(counters);
  api.fillCardConnector(1, "hdmi");
  assert.equal(template.cardTypes[0].connectors[1].id, emptyConnector.id, "fill preserves source connector ID");
  assert.equal(template.cardTypes[0].connectors[1].empty, false);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), {
    "card:slot-a": 0,
    "card:slot-b": 4
  }, "all installed copies grow in one solved layout");
  assert.deepEqual(template.cardSlots.map(slot => slot.id), ["slot-a", "slot-b"], "slot IDs remain stable");

  const generatedAfterFill = api.generatedCardConnectors(template);
  assert.deepEqual(Array.from(generatedAfterFill.map(connector => connector.id).sort()), [
    `slot-a__${emptyConnector.id}`,
    "slot-a__in-1",
    `slot-b__${emptyConnector.id}`,
    "slot-b__in-1"
  ].sort());
  assert.deepEqual(
    Object.fromEntries(generatedAfterFill.map(connector => [connector.id, connector.y])),
    {
      "slot-a__in-1": 154,
      [`slot-a__${emptyConnector.id}`]: 208,
      "slot-b__in-1": 370,
      [`slot-b__${emptyConnector.id}`]: 424
    },
    "generated connector rows follow each installed slot"
  );

  template.cardSlots[0].connectorOverrides[emptyConnector.id] = { nameText: "Override A" };
  const idsBeforeTypeChange = Array.from(api.generatedCardConnectors(template).map(connector => connector.id).sort());
  before = editorCounterSnapshot(counters);
  api.fillCardConnector(1, "dvi");
  const generatedAfterTypeChange = api.generatedCardConnectors(template);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
  assert.deepEqual(Array.from(generatedAfterTypeChange.map(connector => connector.id).sort()), idsBeforeTypeChange, "active type changes keep generated IDs stable");
  assert.equal(generatedAfterTypeChange.find(connector => connector.id === `slot-b__${emptyConnector.id}`)?.type, "dvi");
  assert.equal(template.cardSlots[0].connectorOverrides[emptyConnector.id].nameText, "Override A", "surviving overrides stay attached to source IDs");
});

test("Device Editor creates the first card connector atomically from an empty card library", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    hasSwappableCards: true,
    cardTypes: [],
    cardSlots: []
  });

  const before = editorCounterSnapshot(counters);
  api.addCardConnector("input");

  assert.equal(template.hasSwappableCards, true);
  assert.equal(template.cardTypes.length, 1);
  const card = template.cardTypes[0];
  assert.ok(card.id, "created card should have a stable ID");
  assert.equal(card.connectors.length, 1);
  const connector = card.connectors[0];
  assert.ok(connector.id, "created connector should have a stable source ID");
  assert.equal(connector.direction, "input");
  assert.equal(connector.empty, true);
  assert.deepEqual(selectedCardConnectorIds(template, context), [connector.id]);
  assert.equal(context.editorSelectedCardNodeIndex, 0);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
});

test("Device Editor first-card connector creation rolls back cleanly on commit failure", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    hasSwappableCards: true,
    cardTypes: [],
    cardSlots: []
  });
  context.editorCardIndex = 7;
  context.editorSelectedCardNodeIndex = 3;
  context.editorSelectedCardNodeIds = new Set([1, 3]);
  const beforeTemplate = structuredClone(template);
  const beforeSelection = {
    cardIndex: context.editorCardIndex,
    primaryIndex: context.editorSelectedCardNodeIndex,
    selectedIndexes: selectedCardConnectorIndexes(context)
  };
  const beforeCounts = editorCounterSnapshot(counters);

  context.failDeviceHeightForSlotCounts = true;
  assert.throws(() => api.addCardConnector("input"), /forced device height failure/);
  context.failDeviceHeightForSlotCounts = false;

  assert.equal(JSON.stringify(template), JSON.stringify(beforeTemplate));
  assert.equal(context.editorCardIndex, beforeSelection.cardIndex);
  assert.equal(context.editorSelectedCardNodeIndex, beforeSelection.primaryIndex);
  assert.deepEqual(selectedCardConnectorIndexes(context), beforeSelection.selectedIndexes);
  assert.deepEqual(editorCounterDelta(counters, beforeCounts), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });
});

test("Device Editor card edits preserve multi-selection by stable source connector IDs", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    cardTypes: [{
      id: "card-a",
      name: "Selectable Card",
      kind: "input",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false },
        { id: "in-2", direction: "input", type: "dvi", empty: false },
        { id: "in-3", direction: "input", type: "hdmi", empty: false }
      ]
    }]
  });
  context.editorCardIndex = 0;
  api.setEditorCardNodeSelection(0);
  api.setEditorCardNodeSelection(2, { add: true });

  const before = editorCounterSnapshot(counters);
  api.fillCardConnector(2, "dvi");

  assert.deepEqual(selectedCardConnectorIds(template, context), ["in-1", "in-3"]);
  assert.equal(template.cardTypes[0].connectors[2].type, "dvi");
  assert.equal(context.editorSelectedCardNodeIndex, 2, "primary selected connector should survive");
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
});

test("Device Editor card definition removal prunes overrides and compacts deterministic vacancies", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    cardTypes: [{
      id: "card-a",
      name: "Two Input Card",
      kind: "input",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false, nameText: "IN 1" },
        { id: "in-2", direction: "input", type: "hdmi", empty: false, nameText: "IN 2" }
      ]
    }],
    connectors: [
      testConnector("fixed-left", "left", 8, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 532, primary: true }] })
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-a", y: 100, connectorOverrides: { "in-1": { nameText: "Keep A" }, "in-2": { nameText: "Remove A" } } },
      { id: "slot-b", name: "Slot B", installedCardTypeId: "card-a", y: 316, connectorOverrides: { "in-2": { nameText: "Remove B" } } }
    ]
  });
  context.editorCardIndex = 0;
  api.setEditorCardNodeSelection(1);

  const before = editorCounterSnapshot(counters);
  api.removeCardConnector(1);

  assert.deepEqual(template.cardTypes[0].connectors.map(connector => connector.id), ["in-1"]);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), {
    "card:slot-a": 0,
    "card:slot-b": 3,
    "connector:fixed-left": 6
  });
  assert.equal(template.cardSlots[0].connectorOverrides["in-1"].nameText, "Keep A");
  assert.equal(template.cardSlots[0].connectorOverrides["in-2"], undefined);
  assert.equal(template.cardSlots[1].connectorOverrides["in-2"], undefined);
  assert.deepEqual(Array.from(api.generatedCardConnectors(template).map(connector => connector.id).sort()), ["slot-a__in-1", "slot-b__in-1"]);
  assert.equal(context.editorSelectedCardNodeIndex, 0, "removing selected connector falls back deterministically");
});

test("Device Editor removing one selected card connector preserves surviving multi-selection", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    cardTypes: [{
      id: "card-a",
      name: "Triple Input Card",
      kind: "input",
      connectors: [
        { id: "in-a", direction: "input", type: "hdmi", empty: false },
        { id: "in-b", direction: "input", type: "dvi", empty: false },
        { id: "in-c", direction: "input", type: "hdmi", empty: false }
      ]
    }],
    connectors: [
      testConnector("fixed-left", "left", 7, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 478, primary: true }] })
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-a", y: 100, connectorOverrides: {
        "in-a": { nameText: "Keep A" },
        "in-b": { nameText: "Remove B" },
        "in-c": { nameText: "Keep C" }
      } }
    ]
  });
  context.editorCardIndex = 0;
  api.setEditorCardNodeSelection(0);
  api.setEditorCardNodeSelection(1, { add: true });
  api.setEditorCardNodeSelection(2, { add: true });

  const before = editorCounterSnapshot(counters);
  api.removeCardConnector(1);

  assert.deepEqual(template.cardTypes[0].connectors.map(connector => connector.id), ["in-a", "in-c"]);
  assert.deepEqual(selectedCardConnectorIds(template, context), ["in-a", "in-c"]);
  assert.deepEqual(selectedCardConnectorIndexes(context), [0, 1]);
  assert.equal(context.editorSelectedCardNodeIndex, 1, "surviving primary should remap to its new index");
  assert.equal(template.cardSlots[0].connectorOverrides["in-b"], undefined);
  assert.equal(template.cardSlots[0].connectorOverrides["in-a"].nameText, "Keep A");
  assert.equal(template.cardSlots[0].connectorOverrides["in-c"].nameText, "Keep C");
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
});

test("Device Editor card connector-count changes skip placement when span is unchanged", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    cardTypes: [{
      id: "card-io",
      name: "Balanced I/O",
      kind: "io",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false },
        { id: "in-2", direction: "input", type: "dvi", empty: false },
        { id: "out-1", direction: "output", type: "hdmi", empty: false },
        { id: "out-2", direction: "output", type: "dvi", empty: false }
      ]
    }],
    connectors: [
      testConnector("fixed-left", "left", 4, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 316, primary: true }] })
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-io", y: 100, connectorOverrides: { "in-2": { nameText: "Pruned" }, "out-1": { nameText: "Keep" } } }
    ]
  });
  context.editorCardIndex = 0;
  const initialMap = itemLaneMap(api.resolveEditorModularLayout(template));

  const before = editorCounterSnapshot(counters);
  api.removeCardConnector(1);

  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), initialMap, "same max row count should keep placement fixed");
  assert.equal(template.cardSlots[0].connectorOverrides["in-2"], undefined);
  assert.equal(template.cardSlots[0].connectorOverrides["out-1"].nameText, "Keep");
  assert.deepEqual(Array.from(api.generatedCardConnectors(template).map(connector => connector.id).sort()), [
    "slot-a__in-1",
    "slot-a__out-1",
    "slot-a__out-2"
  ]);
});

test("Device Editor card kind changes resolve installed slot side masks atomically", () => {
  const inputTransition = structuralEditorHarness({
    cardTypes: [{
      id: "card-io",
      name: "I/O Card",
      kind: "io",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false },
        { id: "out-1", direction: "output", type: "hdmi", empty: false }
      ]
    }],
    connectors: [
      testConnector("right-a", "right", 3, { direction: "output", displaySide: "right", schemaVersion: 2, anchors: [{ id: "right", side: "right", x: 420, y: 262, primary: true }] }),
      testConnector("left-a", "left", 3, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 262, primary: true }] })
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-io", y: 100, connectorOverrides: { "out-1": { nameText: "Prune" } } }
    ]
  });
  inputTransition.context.editorCardIndex = 0;
  let before = editorCounterSnapshot(inputTransition.counters);
  inputTransition.api.changeEditorCardKind("input");
  assert.deepEqual(editorCounterDelta(inputTransition.counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
  assert.equal(inputTransition.template.cardTypes[0].kind, "input");
  assert.deepEqual(inputTransition.template.cardTypes[0].connectors.map(connector => connector.id), ["in-1"]);
  assert.deepEqual(itemLaneMap(inputTransition.api.resolveEditorModularLayout(inputTransition.template)), {
    "card:slot-a": 0,
    "connector:right-a": 0,
    "connector:left-a": 3
  }, "right-side vacancy can be reused without disturbing left-side order");
  assert.deepEqual(inputTransition.template.cardSlots[0].connectorOverrides, {});

  const ioTransition = structuralEditorHarness({
    cardTypes: [{
      id: "card-input",
      name: "Input Card",
      kind: "input",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false }
      ]
    }],
    connectors: [
      testConnector("right-a", "right", 0, { direction: "output", displaySide: "right", schemaVersion: 2, anchors: [{ id: "right", side: "right", x: 420, y: 100, primary: true }] })
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-input", y: 100, connectorOverrides: {} }
    ]
  });
  ioTransition.context.editorCardIndex = 0;
  before = editorCounterSnapshot(ioTransition.counters);
  ioTransition.api.changeEditorCardKind("io");
  assert.deepEqual(editorCounterDelta(ioTransition.counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
  assert.equal(ioTransition.template.cardTypes[0].kind, "io");
  assert.deepEqual(itemLaneMap(ioTransition.api.resolveEditorModularLayout(ioTransition.template)), {
    "card:slot-a": 0,
    "connector:right-a": 3
  }, "both-side conversion displaces connected right-side conflicts once");
});

test("Device Editor card kind filtering preserves surviving selected connectors only", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    cardTypes: [{
      id: "card-io",
      name: "Mixed Card",
      kind: "io",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false },
        { id: "out-1", direction: "output", type: "dvi", empty: false }
      ]
    }],
    connectors: [
      testConnector("left-a", "left", 3, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 262, primary: true }] }),
      testConnector("right-a", "right", 3, { direction: "output", displaySide: "right", schemaVersion: 2, anchors: [{ id: "right", side: "right", x: 420, y: 262, primary: true }] })
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-io", y: 100, connectorOverrides: { "out-1": { nameText: "Prune Output" } } }
    ]
  });
  context.editorCardIndex = 0;
  api.setEditorCardNodeSelection(0);
  api.setEditorCardNodeSelection(1, { add: true });

  const before = editorCounterSnapshot(counters);
  api.changeEditorCardKind("input");

  assert.equal(template.cardTypes[0].kind, "input");
  assert.deepEqual(template.cardTypes[0].connectors.map(connector => connector.id), ["in-1"]);
  assert.deepEqual(selectedCardConnectorIds(template, context), ["in-1"]);
  assert.deepEqual(selectedCardConnectorIndexes(context), [0]);
  assert.equal(context.editorSelectedCardNodeIndex, 0);
  assert.deepEqual(template.cardSlots[0].connectorOverrides, {});
  assert.deepEqual(Array.from(api.generatedCardConnectors(template).map(connector => connector.id)), ["slot-a__in-1"]);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
});

test("Device Editor card type deletion keeps slots stable and skips solver for unused cards", () => {
  const installed = structuralEditorHarness({
    cardTypes: [{
      id: "card-a",
      name: "Installed Card",
      kind: "input",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false }
      ]
    }],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-a", y: 100, connectorOverrides: { "in-1": { nameText: "A" } } },
      { id: "slot-b", name: "Slot B", installedCardTypeId: "card-a", y: 262, connectorOverrides: { "in-1": { nameText: "B" } } }
    ]
  });
  installed.context.editorCardIndex = 0;
  let before = editorCounterSnapshot(installed.counters);
  installed.api.deleteCurrentCardType();
  assert.deepEqual(editorCounterDelta(installed.counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
  assert.deepEqual(installed.template.cardTypes, []);
  assert.deepEqual(installed.template.cardSlots.map(slot => [slot.id, slot.installedCardTypeId, slot.connectorOverrides]), [
    ["slot-a", "", {}],
    ["slot-b", "", {}]
  ]);

  const unused = structuralEditorHarness({
    cardTypes: [
      { id: "card-a", name: "Installed Card", kind: "input", connectors: [{ id: "in-1", direction: "input", type: "hdmi", empty: false }] },
      { id: "card-unused", name: "Unused Card", kind: "input", connectors: [{ id: "in-unused", direction: "input", type: "hdmi", empty: false }] }
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-a", y: 100, connectorOverrides: {} }
    ]
  });
  unused.context.editorCardIndex = 1;
  before = editorCounterSnapshot(unused.counters);
  unused.api.deleteCurrentCardType();
  assert.deepEqual(editorCounterDelta(unused.counters, before), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
  assert.deepEqual(unused.template.cardTypes.map(card => card.id), ["card-a"]);
  assert.equal(unused.template.cardSlots[0].installedCardTypeId, "card-a");
});

test("Device Editor new, duplicate, rollback, and fixed-point card definition behavior stays stable", () => {
  const creation = structuralEditorHarness();
  creation.api.createNewEditorCardType();
  creation.api.duplicateCurrentCardType();
  assert.equal(creation.counters.structuralSessions, 0);
  assert.equal(creation.counters.solverCalls, 0);
  assert.equal(creation.counters.animationSeeds, 0);
  assert.equal(creation.counters.editorRenders, 2);
  assert.equal(new Set(creation.template.cardTypes.map(card => card.id)).size, 2, "new and duplicate card IDs are unique");

  const rollback = structuralEditorHarness({
    cardTypes: [{
      id: "card-a",
      name: "Rollback Card",
      kind: "input",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false },
        { id: "in-2", direction: "input", type: "", empty: true }
      ]
    }],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-a", y: 100, connectorOverrides: { "in-1": { nameText: "Keep" } } },
      { id: "slot-b", name: "Slot B", installedCardTypeId: "card-a", y: 262, connectorOverrides: {} }
    ]
  });
  rollback.context.editorCardIndex = 0;
  rollback.api.setEditorCardNodeSelection(0);
  const beforeTemplate = structuredClone(rollback.template);
  const beforeSelection = rollback.context.editorSelectedCardNodeIndex;
  const beforeCounts = editorCounterSnapshot(rollback.counters);
  const beforeMap = itemLaneMap(rollback.api.resolveEditorModularLayout(rollback.template));
  rollback.placementModule.forceInvalid = true;
  assert.throws(() => rollback.api.fillCardConnector(1, "hdmi"), /invalid layout/);
  rollback.placementModule.forceInvalid = false;
  assert.deepEqual(rollback.template, beforeTemplate, "failed card definition edit rolls back all draft changes");
  assert.equal(rollback.context.editorSelectedCardNodeIndex, beforeSelection, "failed edit preserves selection");
  assert.deepEqual(editorCounterDelta(rollback.counters, beforeCounts), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });
  assert.deepEqual(itemLaneMap(rollback.api.resolveEditorModularLayout(rollback.template)), beforeMap);

  rollback.api.fillCardConnector(1, "hdmi");
  const committedMap = itemLaneMap(rollback.api.resolveEditorModularLayout(rollback.template));
  assert.deepEqual(itemLaneMap(rollback.api.resolveEditorModularLayout(rollback.template)), committedMap, "fresh static layout is a fixed point after commit");
  assert.deepEqual(itemLaneMap(rollback.api.resolveEditorModularLayout(rollback.template)), itemLaneMap(rollback.api.resolveEditorModularLayout(rollback.template)), "repeated static resolution is deterministic");
});

test("Device Editor failed span-changing card edit preserves multi-selection and template state", () => {
  const { api, template, counters, context, placementModule } = structuralEditorHarness({
    cardTypes: [{
      id: "card-a",
      name: "Rollback Multi Card",
      kind: "input",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false },
        { id: "in-2", direction: "input", type: "", empty: true },
        { id: "in-3", direction: "input", type: "dvi", empty: false }
      ]
    }],
    connectors: [
      testConnector("fixed-left", "left", 7, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 478, primary: true }] })
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-a", y: 100, connectorOverrides: { "in-1": { nameText: "Keep A" }, "in-3": { nameText: "Keep C" } } },
      { id: "slot-b", name: "Slot B", installedCardTypeId: "card-a", y: 316, connectorOverrides: { "in-3": { customText: "Keep B" } } }
    ]
  });
  context.editorCardIndex = 0;
  api.setEditorCardNodeSelection(0);
  api.setEditorCardNodeSelection(2, { add: true });
  const beforeTemplate = structuredClone(template);
  const beforePrimary = context.editorSelectedCardNodeIndex;
  const beforeSelectedIndexes = selectedCardConnectorIndexes(context);
  const beforeSelectedIds = selectedCardConnectorIds(template, context);
  const beforeMap = itemLaneMap(api.resolveEditorModularLayout(template));
  const beforeCounts = editorCounterSnapshot(counters);

  placementModule.forceInvalid = true;
  assert.throws(() => api.fillCardConnector(1, "hdmi"), /invalid layout/);
  placementModule.forceInvalid = false;

  assert.equal(JSON.stringify(template), JSON.stringify(beforeTemplate));
  assert.deepEqual(template.cardTypes[0].connectors.map(connector => connector.id), ["in-1", "in-2", "in-3"]);
  assert.equal(context.editorSelectedCardNodeIndex, beforePrimary);
  assert.deepEqual(selectedCardConnectorIndexes(context), beforeSelectedIndexes);
  assert.deepEqual(selectedCardConnectorIds(template, context), beforeSelectedIds);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), beforeMap);
  assert.equal(template.cardSlots[0].connectorOverrides["in-1"].nameText, "Keep A");
  assert.equal(template.cardSlots[0].connectorOverrides["in-3"].nameText, "Keep C");
  assert.equal(template.cardSlots[1].connectorOverrides["in-3"].customText, "Keep B");
  assert.deepEqual(editorCounterDelta(counters, beforeCounts), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });
});

test("Device Editor new and duplicate unused card definitions leave installed lane maps stable", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    cardTypes: [{
      id: "card-installed",
      name: "Installed Card",
      kind: "input",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false },
        { id: "in-2", direction: "input", type: "dvi", empty: false }
      ]
    }],
    connectors: [
      testConnector("fixed-left", "left", 5, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 370, primary: true }] }),
      testConnector("fixed-right", "right", 0, { direction: "output", displaySide: "right", schemaVersion: 2, anchors: [{ id: "right", side: "right", x: 420, y: 100, primary: true }] })
    ],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "card-installed", y: 100, connectorOverrides: {} }
    ]
  });
  const initialMap = itemLaneMap(api.resolveEditorModularLayout(template));

  let before = editorCounterSnapshot(counters);
  api.createNewEditorCardType();
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), initialMap);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 0,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
  assert.equal(context.editorCardIndex, 1);

  before = editorCounterSnapshot(counters);
  api.duplicateCurrentCardType();
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), initialMap);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 0,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
  assert.equal(new Set(template.cardTypes.map(card => card.id)).size, template.cardTypes.length);
});

test("Device Editor structural display-side upserts synchronize anchors with solved lanes", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    connectors: [
      testConnector("in-a", "left", 0, { direction: "input", displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 100, primary: true }] }),
      testConnector("out-a", "right", 0, { direction: "output", displaySide: "right", schemaVersion: 2, anchors: [{ id: "right", side: "right", x: 420, y: 100, primary: true }] })
    ]
  });

  api.commitEditorStructuralEdit(template, {
    primaryItemId: "connector:in-a",
    mutate(draft) {
      const connector = draft.connectors.find(item => item.id === "in-a");
      connector.displaySide = "both";
      context.ensureConnectorV2Defaults?.(draft, connector);
      return { upsertIds: ["connector:in-a"] };
    }
  });

  const laneMap = itemLaneMap(api.resolveEditorModularLayout(template));
  assert.deepEqual(laneMap, {
    "connector:in-a": 0,
    "connector:out-a": 1
  });
  assert.deepEqual(template.connectors[0].anchors.map(anchor => [anchor.side, anchor.y]), [["left", 100], ["right", 100]]);
  assert.equal(template.connectors[1].anchors[0].y, 154);
  assert.equal(counters.solverCalls, 1);
  assert.equal(counters.animationSeeds, 1);
  assert.equal(counters.previewRenders, 1);
});

test("Device Editor Power Distro origin rebases mixed modular content atomically and without drift", () => {
  const both = testConnector("both-v2", "both", 1, { v2: true, displaySide: "both" });
  both.anchors[1].y += 12;
  const faceplate = testConnector("faceplate-side", "left", 0, {
    v2: true,
    faceplateSide: true,
    y: 42,
    anchors: [{ id: "left", side: "left", x: 0, y: 42, primary: true }]
  });
  const { api, template, counters, context } = structuralEditorHarness({
    height: 0,
    powerDistroFaceY: 31,
    powerDistroFaceHeight: 220,
    cardTypes: [{
      id: "io-card",
      name: "I/O Card",
      kind: "io",
      connectors: [
        { id: "card-in", direction: "input", type: "hdmi", empty: false, schemaVersion: 2, displaySide: "left", primaryAnchorId: "left", anchors: [{ id: "left", side: "left", x: 0, y: 40, primary: true }] },
        { id: "card-out", direction: "output", type: "hdmi", empty: false, schemaVersion: 2, displaySide: "right", primaryAnchorId: "right", anchors: [{ id: "right", side: "right", x: 420, y: 40, primary: true }] }
      ]
    }],
    cardSlots: [
      { id: "slot-io", name: "Slot I/O", installedCardTypeId: "io-card", y: 316, connectorOverrides: { "card-in": { nameText: "Installed In" } } }
    ],
    connectors: [
      testConnector("left-only", "left", 0, { v2: true }),
      testConnector("right-only", "right", 0, { v2: true, direction: "output" }),
      both,
      testConnector("network-in", "left", 2, { v2: true, type: "cat6a", networkGroupId: "pair-a", pairedConnectorId: "network-out" }),
      testConnector("network-out", "right", 2, { v2: true, direction: "output", type: "cat6a", networkGroupId: "pair-a", pairedConnectorId: "network-in" }),
      testConnector("led-output", "right", 3, { v2: true, direction: "output", type: "led-signal", generatedByLedProcessor: true, signalIndex: 1 }),
      testConnector("power-a", "left", 7, { v2: true, type: "power-a", powerPlug: { manual: true, x: 70, y: 58 } }),
      testConnector("power-b", "left", 8, { v2: true, type: "power-b" }),
      testConnector("power-c", "left", 9, { v2: true, type: "power-c" }),
      testConnector("power-d", "left", 10, { v2: true, type: "power-d" }),
      faceplate
    ],
    connectorRelationships: [{ id: "relationship-a", connectorIds: ["left-only", "both-v2"], type: "shared-bus" }]
  });
  template.connectors.forEach(connector => {
    if (connector.faceplateSide !== true) connector.faceplateSide = false;
    (connector.anchors || []).forEach(anchor => {
      anchor.label = String(anchor.label || "");
      anchor.primary = anchor.id === connector.primaryAnchorId;
    });
  });
  const committedFaceplateConnector = template.connectors.find(connector => connector.id === "faceplate-side");
  committedFaceplateConnector.y = 42;
  committedFaceplateConnector.anchors[0].y = 42;
  template.height = context.deviceHeightForSlotCounts(template);
  const originalHeight = template.height;
  const originalConnectors = structuredClone(template.connectors);
  const originalSlots = structuredClone(template.cardSlots);
  const originalPowerPlug = structuredClone(template.connectors.find(connector => connector.id === "power-a").powerPlug);
  const originalRelationships = structuredClone(template.connectorRelationships);
  const originalIds = template.connectors.map(connector => connector.id);
  const originalLayout = api.resolveEditorModularLayout(template);
  const originalLaneMap = itemLaneMap(originalLayout);
  const originalYById = Object.fromEntries(originalLayout.items.map(item => [item.id, item.y]));
  const originalAnchorYById = Object.fromEntries(template.connectors
    .filter(connector => !connector.faceplateSide && Array.isArray(connector.anchors))
    .map(connector => [connector.id, connector.anchors.map(anchor => anchor.y)]));
  const originalFaceplateY = template.connectors.find(connector => connector.id === "faceplate-side").y;
  const originalGenerated = api.generatedCardConnectors(template);
  context.editorSelectedNodeIds = new Set(["left-only", "both-v2", "led-output"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "both-v2");

  const validationBefore = counters.validationCalls;
  const normalizationBefore = counters.normalizationCalls;
  let countsBefore = editorCounterSnapshot(counters);
  context.editorPowerDistro.checked = true;
  const enabled = api.applyPowerDistroSettings();
  const enabledLayout = api.resolveEditorModularLayout(template);
  const originDelta = enabled.committedStartY - enabled.baselineStartY;

  assert.equal(enabled.baselineStartY, 100);
  assert.equal(enabled.committedStartY, 262);
  assert.equal(enabled.startYChanged, true);
  assert.equal(originDelta, 162);
  assert.deepEqual(itemLaneMap(enabledLayout), originalLaneMap);
  enabledLayout.items.forEach(item => {
    assert.equal(item.y, originalYById[item.id] + originDelta, `${item.id} should move by the origin delta`);
  });
  template.connectors.filter(connector => !connector.faceplateSide && Array.isArray(connector.anchors)).forEach(connector => {
    assert.deepEqual(
      connector.anchors.map(anchor => anchor.y),
      originalAnchorYById[connector.id].map(y => y + originDelta),
      `${connector.id} anchors should preserve offsets through the rebase`
    );
  });
  assert.equal(template.connectors.find(connector => connector.id === "both-v2").anchors[1].y
    - template.connectors.find(connector => connector.id === "both-v2").anchors[0].y, 12);
  assert.equal(template.cardSlots[0].y, originalSlots[0].y + originDelta);
  assert.equal(enabledLayout.byId.get("connector:network-in").lane, enabledLayout.byId.get("connector:network-out").lane);
  assert.equal(enabledLayout.byId.get("card:slot-io").span, 3);
  assert.deepEqual(template.connectors.find(connector => connector.id === "power-a").powerPlug, originalPowerPlug);
  assert.deepEqual(template.connectorRelationships, originalRelationships);
  assert.equal(template.powerDistroFaceY, 31);
  assert.equal(template.powerDistroFaceHeight, 220);
  assert.deepEqual(template.connectors.map(connector => connector.id), originalIds);
  assert.deepEqual(selectedNodeConnectorIds(context), ["both-v2", "led-output", "left-only"]);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "both-v2");
  const enabledFaceplateY = template.connectors.find(connector => connector.id === "faceplate-side").y;
  assert.notEqual(enabledFaceplateY, originalFaceplateY);
  assert.equal(enabledFaceplateY, context.faceplateSideConnectorY(template));
  assert.equal(template.connectors.find(connector => connector.id === "faceplate-side").anchors[0].y, enabledFaceplateY);
  assert.equal(template.connectors.find(connector => connector.id === "faceplate-side").faceplateSide, true);
  assert.equal(enabledLayout.items.some(item => item.id === "connector:faceplate-side"), false);
  const enabledGenerated = api.generatedCardConnectors(template);
  assert.deepEqual(enabledGenerated.map(connector => connector.id), originalGenerated.map(connector => connector.id));
  assert.equal(enabledGenerated.find(connector => connector.sourceConnectorId === "card-in").y, template.cardSlots[0].y + 54);
  assert.equal(enabledGenerated.find(connector => connector.sourceConnectorId === "card-out").y, template.cardSlots[0].y + 54);
  assert.ok(template.height > originalHeight);
  assert.equal(counters.validationCalls - validationBefore, 1);
  assert.equal(counters.normalizationCalls, normalizationBefore);
  assert.deepEqual(editorCounterDelta(counters, countsBefore), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), itemLaneMap(api.resolveEditorModularLayout(template)));

  countsBefore = editorCounterSnapshot(counters);
  context.editorPowerDistro.checked = false;
  const disabled = api.applyPowerDistroSettings();
  assert.equal(disabled.baselineStartY, 262);
  assert.equal(disabled.committedStartY, 100);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), originalLaneMap);
  assert.deepEqual(JSON.parse(JSON.stringify(template.connectors)), originalConnectors);
  assert.deepEqual(JSON.parse(JSON.stringify(template.cardSlots)), originalSlots);
  assert.equal(template.height, originalHeight);
  assert.deepEqual(editorCounterDelta(counters, countsBefore), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });

  for (let cycle = 0; cycle < 2; cycle += 1) {
    context.editorPowerDistro.checked = true;
    api.applyPowerDistroSettings();
    assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), originalLaneMap);
    assert.deepEqual(template.connectors.map(connector => connector.id), originalIds);
    context.editorPowerDistro.checked = false;
    api.applyPowerDistroSettings();
    assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), originalLaneMap);
    assert.deepEqual(JSON.parse(JSON.stringify(template.connectors)), originalConnectors);
    assert.deepEqual(JSON.parse(JSON.stringify(template.cardSlots)), originalSlots);
    assert.equal(template.height, originalHeight);
  }
});

test("Device Editor Power Distro no-origin and empty transactions avoid solver work", () => {
  for (const inputTemplate of [
    {
      faceImage: "data:image/png;base64,face",
      faceImageStartY: 180,
      connectors: [testConnector("custom-face-node", "left", 0, { v2: true, y: 180, anchors: [{ id: "left", side: "left", x: 0, y: 180, primary: true }] })]
    },
    {
      faceplateDeleted: true,
      connectors: [testConnector("deleted-face-node", "left", 0, { v2: true })]
    }
  ]) {
    const { api, template, counters, context } = structuralEditorHarness(inputTemplate);
    template.height = context.deviceHeightForSlotCounts(template);
    const coordinates = template.connectors.map(connector => ({ id: connector.id, x: connector.x, y: connector.y, anchors: structuredClone(connector.anchors) }));
    const before = editorCounterSnapshot(counters);
    context.editorPowerDistro.checked = true;
    const result = api.applyPowerDistroSettings();

    assert.equal(result.startYChanged, false);
    assert.equal(template.isPowerDistro, true);
    assert.deepEqual(template.connectors.map(connector => ({ id: connector.id, x: connector.x, y: connector.y, anchors: structuredClone(connector.anchors) })), coordinates);
    assert.deepEqual(editorCounterDelta(counters, before), {
      structuralSessions: 1,
      solverCalls: 0,
      previewRenders: 1,
      editorRenders: 0,
      animationSeeds: 0,
      animationRetargets: 0
    });
  }

  const empty = structuralEditorHarness({ connectors: [], cardSlots: [], powerDistroStartY: 262 });
  const emptyBefore = editorCounterSnapshot(empty.counters);
  empty.context.editorPowerDistro.checked = true;
  const emptyResult = empty.api.applyPowerDistroSettings();
  assert.equal(emptyResult.startYChanged, true);
  assert.equal(empty.template.isPowerDistro, true);
  assert.equal(empty.counters.validationCalls, 0);
  assert.deepEqual(editorCounterDelta(empty.counters, emptyBefore), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });

  const manual = structuralEditorHarness({
    manualHeight: 1200,
    connectors: [
      testConnector("manual-height-node", "left", 0, { v2: true }),
      testConnector("manual-height-power-a", "left", 1, { v2: true, type: "power-a" }),
      testConnector("manual-height-power-b", "left", 2, { v2: true, type: "power-b" })
    ]
  });
  manual.template.height = manual.context.deviceHeightForSlotCounts(manual.template);
  manual.context.editorPowerDistro.checked = true;
  manual.api.applyPowerDistroSettings();
  assert.equal(manual.template.manualHeight, 1200);
  assert.equal(manual.template.height, 1200);
  manual.context.editorPowerDistro.checked = false;
  manual.api.applyPowerDistroSettings();
  assert.equal(manual.template.manualHeight, 1200);
  assert.equal(manual.template.height, 1200);
});

test("Device Editor Power Distro rollback restores template, selection, checkbox, and motion boundary", () => {
  const { api, template, counters, context, placementModule } = structuralEditorHarness({
    connectors: [
      testConnector("selected", "left", 0, { v2: true }),
      testConnector("power-a", "left", 1, { v2: true, type: "power-a", powerPlug: { manual: true, x: 44, y: 55 } }),
      testConnector("power-b", "left", 2, { v2: true, type: "power-b" })
    ]
  });
  template.height = context.deviceHeightForSlotCounts(template);
  context.editorSelectedNodeIds = new Set(["selected", "power-b"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "power-b");
  const beforeTemplate = structuredClone(template);
  const beforeSelection = selectedNodeConnectorIds(context);
  const beforePrimary = selectedNodePrimaryConnectorId(template, context);
  const beforeCounts = editorCounterSnapshot(counters);
  context.editorPowerDistro.checked = true;
  placementModule.forceInvalid = true;
  assert.throws(() => api.applyPowerDistroSettings(), /invalid layout/);
  placementModule.forceInvalid = false;

  assert.equal(JSON.stringify(template), JSON.stringify(beforeTemplate));
  assert.deepEqual(selectedNodeConnectorIds(context), beforeSelection);
  assert.equal(selectedNodePrimaryConnectorId(template, context), beforePrimary);
  assert.equal(context.editorPowerDistro.checked, false);
  assert.equal(counters.validationCalls, 1);
  assert.deepEqual(editorCounterDelta(counters, beforeCounts), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });
});

test("Device Editor structural transactions reject silent modular-origin changes", () => {
  const { api, template, counters } = structuralEditorHarness({
    connectors: [testConnector("fixed", "left", 0, { v2: true })]
  });
  const before = structuredClone(template);

  assert.throws(() => api.commitEditorStructuralEdit(template, {
    mutate(draft) {
      draft.startY = 208;
      return {};
    }
  }), /without authorising an origin rebase/);
  assert.deepEqual(template, before);
  assert.equal(counters.solverCalls, 0);
  assert.equal(counters.previewRenders, 0);
  assert.equal(counters.animationSeeds, 0);
});

test("Device Editor custom face upload, replacement, and removal rebase lanes atomically", () => {
  const faceplateConnector = testConnector("faceplate-side", "left", 0, { v2: true, faceplateSide: true });
  faceplateConnector.powerPlug = { manual: true, x: 24, y: 36 };
  const { api, template, counters, context } = structuralEditorHarness({
    isPowerDistro: true,
    powerDistroFaceY: 34,
    powerDistroFaceHeight: 260,
    cardTypes: [{
      id: "io-card",
      name: "I/O Card",
      kind: "io",
      connectors: [
        { id: "card-in", direction: "input", type: "hdmi", empty: false },
        { id: "card-out", direction: "output", type: "hdmi", empty: false }
      ]
    }],
    cardSlots: [{ id: "slot-io", installedCardTypeId: "io-card", y: 316 }],
    connectors: [
      testConnector("left", "left", 0, { v2: true }),
      testConnector("right", "right", 0, { v2: true, direction: "output" }),
      testConnector("power-a", "left", 4, { v2: true, type: "power-a", powerPlug: { manual: true, x: 50, y: 60 } }),
      testConnector("power-b", "left", 5, { v2: true, type: "power-b" }),
      testConnector("power-c", "left", 6, { v2: true, type: "power-c" }),
      testConnector("power-d", "left", 7, { v2: true, type: "power-d" }),
      faceplateConnector
    ],
    connectorRelationships: [{ id: "through-a", type: "through", members: ["left", "right"] }]
  });
  template.height = context.deviceHeightForSlotCounts(template);
  context.editorSelectedNodeIds = new Set(["left", "faceplate-side", "power-c"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "faceplate-side");
  const ids = template.connectors.map(connector => connector.id);
  const relationships = structuredClone(template.connectorRelationships);
  const initialLayout = api.resolveEditorModularLayout(template);
  const initialLanes = itemLaneMap(initialLayout);
  const initialGeneratedIds = api.generatedCardConnectors(template).map(connector => connector.id);
  const initialCounters = editorCounterSnapshot(counters);
  const initialValidationCalls = counters.validationCalls;

  const firstTarget = api.captureEditorFaceplateUploadTarget();
  const first = api.commitPreparedEditorFaceplateUpload(firstTarget, {
    dataUrl: "data:image/png;base64,first",
    thumbnailDataUrl: "data:image/png;base64,first-thumb",
    width: 800,
    height: 200
  });
  assert.equal(first.baselineStartY, 262);
  assert.equal(first.committedStartY, 125);
  assert.equal(first.startYChanged, true);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), initialLanes);
  assert.equal(template.faceImage, "data:image/png;base64,first");
  assert.equal(template.thumbnailImage, "data:image/png;base64,first-thumb");
  assert.equal(template.faceImageNaturalWidth, 800);
  assert.equal(template.faceImageNaturalHeight, 200);
  assert.equal(template.faceplateDeleted, false);
  assert.equal(template.powerDistroFaceY, 20);
  assert.equal(template.powerDistroFaceHeight, 0);
  assert.equal(template.connectors.some(connector => connector.powerPlug), false);
  assert.deepEqual(template.connectors.map(connector => connector.id), ids);
  assert.deepEqual(template.connectorRelationships, relationships);
  assert.deepEqual(api.generatedCardConnectors(template).map(connector => connector.id), initialGeneratedIds);
  assert.deepEqual(selectedNodeConnectorIds(context), ["faceplate-side", "left", "power-c"]);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "faceplate-side");
  assert.equal(template.connectors.find(connector => connector.id === "faceplate-side").faceplateSide, true);
  assert.equal(template.connectors.find(connector => connector.id === "faceplate-side").y, context.faceplateSideConnectorY(template));
  assert.equal(counters.validationCalls - initialValidationCalls, 1);
  assert.equal(counters.normalizationCalls, 0);
  assert.deepEqual(editorCounterDelta(counters, initialCounters), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });

  let before = editorCounterSnapshot(counters);
  const replacement = api.commitPreparedEditorFaceplateUpload(api.captureEditorFaceplateUploadTarget(), {
    dataUrl: "data:image/jpeg;base64,replacement",
    thumbnailDataUrl: "data:image/png;base64,replacement-thumb",
    width: 800,
    height: 400
  });
  assert.equal(replacement.baselineStartY, 125);
  assert.equal(replacement.committedStartY, 150);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), initialLanes);
  assert.equal(template.faceImage, "data:image/jpeg;base64,replacement");
  assert.equal(template.thumbnailImage, "data:image/png;base64,replacement-thumb");
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });

  before = editorCounterSnapshot(counters);
  const removed = api.applyEditorFaceImageRemoval();
  assert.equal(removed.baselineStartY, 150);
  assert.equal(removed.committedStartY, 262);
  assert.equal(template.faceImage, "");
  assert.equal(template.thumbnailImage, "");
  assert.equal(template.faceplateDeleted, false);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), initialLanes);
  assert.equal(api.resolveEditorModularLayout(template).byId.get("connector:right").lane, initialLanes["connector:right"]);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
});

test("Device Editor ordinary face removal returns to the default origin without changing lanes", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    faceImage: "data:image/png;base64,custom",
    thumbnailImage: "data:image/png;base64,thumb",
    faceImageNaturalWidth: 500,
    faceImageNaturalHeight: 250,
    connectors: [
      testConnector("left", "left", 0, { v2: true }),
      testConnector("right", "right", 1, { v2: true, direction: "output" })
    ]
  });
  template.height = context.deviceHeightForSlotCounts(template);
  const originalLanes = itemLaneMap(api.resolveEditorModularLayout(template));
  context.editorSelectedNodeIds = new Set(["left", "right"]);
  context.editorSelectedNodeIndex = 1;
  const before = editorCounterSnapshot(counters);
  const result = api.applyEditorFaceImageRemoval();

  assert.equal(result.baselineStartY, 150);
  assert.equal(result.committedStartY, 100);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), originalLanes);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), itemLaneMap(api.resolveEditorModularLayout(template)));
  assert.deepEqual(selectedNodeConnectorIds(context), ["left", "right"]);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "right");
  assert.equal(counters.normalizationCalls, 0);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });
});

test("Device Editor origin-preserving face replacement and empty removal skip solver motion", () => {
  const sameAspect = structuralEditorHarness({
    faceImage: "data:image/png;base64,old",
    thumbnailImage: "data:image/png;base64,old-thumb",
    faceImageNaturalWidth: 800,
    faceImageNaturalHeight: 400,
    connectors: [testConnector("row", "left", 0, { v2: true })]
  });
  const sameAspectCoordinates = structuredClone(sameAspect.template.connectors);
  const sameAspectBefore = editorCounterSnapshot(sameAspect.counters);
  const replacement = sameAspect.api.commitPreparedEditorFaceplateUpload(
    sameAspect.api.captureEditorFaceplateUploadTarget(),
    {
      dataUrl: "data:image/png;base64,new",
      thumbnailDataUrl: "data:image/png;base64,new-thumb",
      width: 1600,
      height: 800
    }
  );
  assert.equal(replacement.startYChanged, false);
  assert.deepEqual(sameAspect.template.connectors, sameAspectCoordinates);
  assert.equal(sameAspect.template.faceImage, "data:image/png;base64,new");
  assert.deepEqual(editorCounterDelta(sameAspect.counters, sameAspectBefore), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });

  const empty = structuralEditorHarness({
    faceImage: "data:image/png;base64,empty",
    thumbnailImage: "data:image/png;base64,empty-thumb",
    faceImageNaturalWidth: 800,
    faceImageNaturalHeight: 400,
    connectors: [],
    cardSlots: []
  });
  const emptyBefore = editorCounterSnapshot(empty.counters);
  const removal = empty.api.applyEditorFaceImageRemoval();
  assert.equal(removal.startYChanged, true);
  assert.equal(empty.template.faceImage, "");
  assert.deepEqual(editorCounterDelta(empty.counters, emptyBefore), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });
});

test("Device Editor faceplate deletion demotes faceplate connectors and restore keeps them modular", () => {
  const faceplate = testConnector("faceplate-io", "both", 0, {
    v2: true,
    displaySide: "both",
    faceplateSide: true,
    nameText: "Front I/O",
    operationalStatus: "not-working"
  });
  const { api, template, counters, context } = structuralEditorHarness({
    faceImage: "data:image/png;base64,custom",
    thumbnailImage: "data:image/png;base64,thumb",
    faceImageNaturalWidth: 800,
    faceImageNaturalHeight: 400,
    deletedFaceStartY: 46,
    manualHeight: 900,
    cardTypes: [{
      id: "span-card",
      name: "Span Card",
      kind: "io",
      connectors: [
        { id: "span-in", direction: "input", type: "hdmi", empty: false },
        { id: "span-out", direction: "output", type: "hdmi", empty: false }
      ]
    }],
    cardSlots: [{ id: "slot-span", installedCardTypeId: "span-card", y: 262 }],
    connectors: [
      testConnector("left", "left", 0, { v2: true }),
      testConnector("right", "right", 1, { v2: true, direction: "output" }),
      faceplate
    ],
    connectorRelationships: [{ id: "front-through", type: "through", members: ["faceplate-io", "right"] }]
  });
  template.height = context.deviceHeightForSlotCounts(template);
  const originalIds = template.connectors.map(connector => connector.id);
  const originalRelationships = structuredClone(template.connectorRelationships);
  const baselineLayout = api.resolveEditorModularLayout(template);
  const baselineLanes = itemLaneMap(baselineLayout);
  context.editorSelectedNodeIds = new Set(["left", "faceplate-io"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "faceplate-io");
  let before = editorCounterSnapshot(counters);
  const validationBefore = counters.validationCalls;
  const deleted = api.applyEditorFaceplateDeletion();
  const deletedLayout = api.resolveEditorModularLayout(template);
  const demoted = template.connectors.find(connector => connector.id === "faceplate-io");

  assert.equal(deleted.baselineStartY, 150);
  assert.equal(deleted.committedStartY, 46);
  assert.deepEqual(Array.from(deleted.mutation.demotedFaceplateConnectorIds), ["connector:faceplate-io"]);
  assert.equal(template.faceplateDeleted, true);
  assert.equal(template.manualHeight, 0);
  assert.equal(template.faceImage, "");
  assert.equal(template.connectors.some(connector => connector.faceplateSide), false);
  assert.equal(demoted.faceplateSide, false);
  assert.equal(demoted.nameText, "Front I/O");
  assert.equal(demoted.operationalStatus, "not-working");
  assert.equal(demoted.anchors.find(anchor => anchor.id === demoted.primaryAnchorId)?.y, demoted.y);
  assert.deepEqual(template.connectors.map(connector => connector.id), originalIds);
  assert.deepEqual(template.connectorRelationships, originalRelationships);
  Object.entries(baselineLanes).forEach(([id, lane]) => {
    assert.equal(deletedLayout.byId.get(id)?.lane, lane, `${id} should keep its baseline lane`);
  });
  assert.ok(deletedLayout.byId.has("connector:faceplate-io"));
  assert.deepEqual(selectedNodeConnectorIds(context), ["faceplate-io", "left"]);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "faceplate-io");
  assert.equal(counters.validationCalls - validationBefore, 1);
  assert.equal(counters.normalizationCalls, 0);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });

  const engineDevice = createPreviewDeviceFromDraft({
    template,
    projectData: { state: { deviceLibrary: [template], nodeLibrary: [] } },
    instance: {
      instanceId: "faceplate-parity-preview",
      id: "faceplate-parity-preview",
      templateId: template.id,
      templateOverride: template,
      name: template.name,
      x: 0,
      y: 0
    }
  }, 0);
  const engineConnectorById = new Map(engineDevice.connectors.map(connector => [connector.id, connector]));
  template.connectors.forEach(connector => {
    const engineConnector = engineConnectorById.get(connector.id);
    assert.ok(engineConnector, `${connector.id} should exist in the Engine preview`);
    assert.equal(engineConnector.y, connector.y, `${connector.id} should share committed Engine and Legacy Y`);
    assert.deepEqual(
      engineConnector.anchors.map(anchor => ({ id: anchor.id, side: anchor.side, x: anchor.x, y: anchor.y })),
      connector.anchors.map(anchor => ({ id: anchor.id, side: anchor.side, x: anchor.x, y: anchor.y }))
    );
  });
  assert.equal(engineDevice.visual.faceplateDeleted, true);
  assert.equal(engineDevice.visual.visualCards[0].slotY, template.cardSlots[0].y);

  const deletedLanes = itemLaneMap(deletedLayout);
  const deletedHeight = template.height;
  before = editorCounterSnapshot(counters);
  const restored = api.applyEditorFaceImageRemoval();
  assert.equal(restored.baselineStartY, 46);
  assert.equal(restored.committedStartY, 100);
  assert.equal(template.faceplateDeleted, false);
  assert.equal(template.connectors.find(connector => connector.id === "faceplate-io").faceplateSide, false);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), deletedLanes);
  assert.notEqual(template.height, deletedHeight);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 1,
    animationSeeds: 1,
    animationRetargets: 1
  });

  const restoredHeight = template.height;
  for (let cycle = 0; cycle < 2; cycle += 1) {
    api.commitPreparedEditorFaceplateUpload(api.captureEditorFaceplateUploadTarget(), {
      dataUrl: `data:image/png;base64,cycle-${cycle}`,
      thumbnailDataUrl: `data:image/png;base64,cycle-thumb-${cycle}`,
      width: 800,
      height: 400
    });
    api.applyEditorFaceImageRemoval();
    api.applyEditorFaceplateDeletion();
    api.applyEditorFaceImageRemoval();
    assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), deletedLanes);
    assert.deepEqual(template.connectors.map(connector => connector.id), originalIds);
    assert.equal(template.connectors.some(connector => connector.faceplateSide), false);
    assert.equal(template.height, restoredHeight);
  }
});

test("Device Editor faceplate mutations roll back fully and reject stale uploads", async () => {
  const rollbackCases = [
    {
      name: "upload",
      input: {
        isPowerDistro: true,
        powerDistroStartY: 262,
        connectors: [testConnector("row", "left", 0, { v2: true, type: "power-a", powerPlug: { manual: true, x: 10, y: 20 } })]
      },
      run(api) {
        return api.commitPreparedEditorFaceplateUpload(api.captureEditorFaceplateUploadTarget(), {
          dataUrl: "data:image/png;base64,new",
          thumbnailDataUrl: "data:image/png;base64,new-thumb",
          width: 800,
          height: 200
        });
      }
    },
    {
      name: "remove",
      input: {
        faceImage: "data:image/png;base64,old",
        thumbnailImage: "data:image/png;base64,old-thumb",
        faceImageNaturalWidth: 800,
        faceImageNaturalHeight: 400,
        connectors: [testConnector("row", "left", 0, { v2: true, powerPlug: { manual: true, x: 10, y: 20 } })]
      },
      run(api) { return api.applyEditorFaceImageRemoval(); }
    },
    {
      name: "delete",
      input: {
        faceImage: "data:image/png;base64,old",
        thumbnailImage: "data:image/png;base64,old-thumb",
        faceImageNaturalWidth: 800,
        faceImageNaturalHeight: 400,
        deletedFaceStartY: 46,
        manualHeight: 880,
        connectors: [testConnector("row", "left", 0, { v2: true }), testConnector("front", "right", 0, { v2: true, faceplateSide: true })]
      },
      run(api) { return api.applyEditorFaceplateDeletion(); }
    },
    {
      name: "restore",
      input: {
        faceplateDeleted: true,
        deletedFaceStartY: 46,
        connectors: [testConnector("row", "left", 0, { v2: true })]
      },
      run(api) { return api.applyEditorFaceImageRemoval(); }
    }
  ];

  rollbackCases.forEach(testCase => {
    const { api, template, counters, context, placementModule } = structuralEditorHarness(testCase.input);
    template.height = context.deviceHeightForSlotCounts(template);
    context.editorSelectedNodeIds = new Set(template.connectors.map(connector => connector.id));
    context.editorSelectedNodeIndex = template.connectors.length - 1;
    const beforeTemplate = structuredClone(template);
    const beforeSelection = selectedNodeConnectorIds(context);
    const beforePrimary = selectedNodePrimaryConnectorId(template, context);
    const beforeCounters = editorCounterSnapshot(counters);
    placementModule.forceInvalid = true;
    assert.throws(() => testCase.run(api), /invalid layout/, `${testCase.name} should reject invalid layout`);
    placementModule.forceInvalid = false;
    assert.equal(JSON.stringify(template), JSON.stringify(beforeTemplate), `${testCase.name} should restore the exact template`);
    assert.deepEqual(selectedNodeConnectorIds(context), beforeSelection);
    assert.equal(selectedNodePrimaryConnectorId(template, context), beforePrimary);
    assert.equal(counters.validationCalls, 1);
    assert.deepEqual(editorCounterDelta(counters, beforeCounters), {
      structuralSessions: 1,
      solverCalls: 1,
      previewRenders: 0,
      editorRenders: 0,
      animationSeeds: 0,
      animationRetargets: 0
    });
  });

  const stale = structuralEditorHarness({
    faceImage: "data:image/png;base64,existing",
    faceImageNaturalWidth: 800,
    faceImageNaturalHeight: 400,
    connectors: [testConnector("row", "left", 0, { v2: true })]
  });
  const staleBefore = structuredClone(stale.template);
  let completePreparation;
  stale.context.prepareFrontFaceImage = () => new Promise(resolve => {
    completePreparation = resolve;
  });
  const staleTarget = stale.api.captureEditorFaceplateUploadTarget();
  const pendingStaleUpload = stale.api.prepareAndCommitEditorFaceplateUpload(
    staleTarget,
    "data:image/png;base64,stale-source",
    { type: "image/png", name: "stale.png" }
  );
  stale.api.invalidateEditorFaceplateUploadTarget();
  completePreparation({
    dataUrl: "data:image/png;base64,stale",
    thumbnailDataUrl: "data:image/png;base64,stale-thumb",
    width: 200,
    height: 800
  });
  assert.equal(await pendingStaleUpload, null);
  assert.deepEqual(stale.template, staleBefore);
  assert.equal(stale.counters.structuralSessions, 0);
  assert.equal(stale.counters.solverCalls, 0);
  assert.equal(stale.counters.animationSeeds, 0);
  assert.equal(stale.counters.editorRenders, 0);

  stale.context.prepareFrontFaceImage = async () => {
    throw new Error("forced preparation failure");
  };
  const failedPreparationTarget = stale.api.captureEditorFaceplateUploadTarget();
  await assert.rejects(
    stale.api.prepareAndCommitEditorFaceplateUpload(
      failedPreparationTarget,
      "data:image/png;base64,broken",
      { type: "image/png", name: "broken.png" }
    ),
    /forced preparation failure/
  );
  assert.deepEqual(stale.template, staleBefore);
  assert.equal(stale.counters.structuralSessions, 0);
  assert.equal(stale.counters.solverCalls, 0);
  assert.equal(stale.counters.animationSeeds, 0);
  assert.equal(stale.counters.editorRenders, 0);

  const invalidTarget = stale.api.captureEditorFaceplateUploadTarget();
  assert.throws(() => stale.api.commitPreparedEditorFaceplateUpload(invalidTarget, {
    dataUrl: "",
    width: 0,
    height: 0
  }), /metadata is incomplete/);
  assert.deepEqual(stale.template, staleBefore);
  assert.equal(stale.counters.structuralSessions, 0);
  assert.equal(stale.counters.solverCalls, 0);
  assert.equal(stale.counters.animationSeeds, 0);
  assert.equal(stale.counters.editorRenders, 0);
});

test("Device Editor LED Processor generation is owned, atomic, and selection-stable", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    connectors: [
      testConnector("manual-led", "right", 0, {
        direction: "output",
        displaySide: "right",
        type: "led-signal",
        label: "Manual LED",
        signalIndex: 99,
        customText: "manual coordinates",
        schemaVersion: 2,
        anchors: [{ id: "right", side: "right", x: 420, y: 100, primary: true }]
      })
    ],
    cardTypes: [{
      id: "span-card",
      name: "Wide Card",
      kind: "io",
      connectors: [
        { id: "card-in-1", direction: "input", type: "hdmi", empty: false },
        { id: "card-out-1", direction: "output", type: "hdmi", empty: false }
      ]
    }],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "span-card", y: 154, connectorOverrides: {} }
    ]
  });

  context.editorLedProcessor.checked = true;
  context.editorLedOutputCount.value = "3";
  let before = editorCounterSnapshot(counters);
  api.applyLedProcessorSettings();

  let generated = generatedLedConnectors(template);
  assert.deepEqual(generated.map(connector => connector.signalIndex), [1, 2, 3]);
  assert.equal(template.connectors.find(connector => connector.id === "manual-led")?.generatedByLedProcessor, undefined);
  assert.equal(template.connectors.find(connector => connector.id === "manual-led")?.customText, "manual coordinates");
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });
  const firstGeneratedId = generated[0].id;
  const secondGeneratedId = generated[1].id;
  generated[0].customText = "tile A";
  generated[0].customTextCaption = "Tile Map";
  generated[0].operationalStatus = "not-working";
  generated[1].nameText = "SIG B";
  generated[1].nameTextCaption = "Signal";
  context.editorSelectedNodeIds = new Set([firstGeneratedId, secondGeneratedId, "manual-led"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === secondGeneratedId);

  context.editorLedOutputCount.value = "5";
  before = editorCounterSnapshot(counters);
  api.applyLedProcessorSettings();

  generated = generatedLedConnectors(template);
  assert.deepEqual(generated.map(connector => connector.signalIndex), [1, 2, 3, 4, 5]);
  assert.equal(generated[0].id, firstGeneratedId, "surviving signal index 1 keeps its stable ID");
  assert.equal(generated[1].id, secondGeneratedId, "surviving signal index 2 keeps its stable ID");
  assert.equal(generated[0].customText, "tile A");
  assert.equal(generated[0].customTextCaption, "Tile Map");
  assert.equal(generated[0].operationalStatus, "not-working");
  assert.equal(generated[1].nameText, "SIG B");
  assert.equal(generated[1].nameTextCaption, "Signal");
  assert.deepEqual(selectedNodeConnectorIds(context), ["manual-led", firstGeneratedId, secondGeneratedId].sort());
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });

  const removedGeneratedId = generated[4].id;
  context.editorSelectedNodeIds = new Set([firstGeneratedId, removedGeneratedId, "manual-led"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === removedGeneratedId);
  context.editorLedOutputCount.value = "2";
  before = editorCounterSnapshot(counters);
  api.applyLedProcessorSettings();

  generated = generatedLedConnectors(template);
  assert.deepEqual(generated.map(connector => connector.signalIndex), [1, 2]);
  assert.equal(generated[0].id, firstGeneratedId);
  assert.equal(generated[1].id, secondGeneratedId);
  assert.ok(!template.connectors.some(connector => connector.id === removedGeneratedId));
  assert.ok(template.connectors.some(connector => connector.id === "manual-led"), "manual led-signal connector survives count reduction");
  assert.deepEqual(selectedNodeConnectorIds(context), ["manual-led", firstGeneratedId].sort());
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });

  before = editorCounterSnapshot(counters);
  api.applyLedProcessorSettings();
  assert.deepEqual(generatedLedConnectors(template).map(connector => connector.id), [firstGeneratedId, secondGeneratedId]);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 0,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });

  context.editorLedProcessor.checked = false;
  before = editorCounterSnapshot(counters);
  api.applyLedProcessorSettings();
  assert.deepEqual(generatedLedConnectors(template), []);
  assert.ok(template.connectors.some(connector => connector.id === "manual-led"), "turning LED Processor off removes only generator-owned outputs");
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });
});

test("Device Editor LED removal does not transfer selection through a stale numeric index", () => {
  const { api, template, context } = structuralEditorHarness({
    isLedProcessor: true,
    ledOutputCount: 3,
    connectors: [
      testConnector("ordinary-before", "left", 0, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 100, primary: true }] }),
      testConnector("signal-line-1", "right", 0, {
        direction: "output",
        displaySide: "right",
        type: "led-signal",
        label: "Signal Line 1",
        signalIndex: 1,
        generatedByLedProcessor: true,
        schemaVersion: 2,
        anchors: [{ id: "right", side: "right", x: 420, y: 100, primary: true }]
      }),
      testConnector("signal-line-2", "right", 1, {
        direction: "output",
        displaySide: "right",
        type: "led-signal",
        label: "Signal Line 2",
        signalIndex: 2,
        generatedByLedProcessor: true,
        schemaVersion: 2,
        anchors: [{ id: "right", side: "right", x: 420, y: 154, primary: true }]
      }),
      testConnector("signal-line-3", "right", 2, {
        direction: "output",
        displaySide: "right",
        type: "led-signal",
        label: "Signal Line 3",
        signalIndex: 3,
        generatedByLedProcessor: true,
        schemaVersion: 2,
        anchors: [{ id: "right", side: "right", x: 420, y: 208, primary: true }]
      }),
      testConnector("ordinary-after", "left", 3, { displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 262, primary: true }] })
    ]
  });
  context.editorLedProcessor.checked = true;
  context.editorLedOutputCount.value = "2";
  context.editorSelectedNodeIds = new Set(["signal-line-3"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "signal-line-3");

  api.applyLedProcessorSettings();

  assert.deepEqual(selectedNodeConnectorIds(context), []);
  assert.equal(context.editorSelectedNodeIndex, null);
  assert.ok(!context.editorSelectedNodeIds.has("ordinary-after"));
});

test("Device Editor chassis connector selection snapshots contain only frozen stable IDs", () => {
  const { api, template, context } = structuralEditorHarness({
    connectors: [
      testConnector("selected-a", "left", 0),
      testConnector("selected-b", "right", 0, { direction: "output" })
    ]
  });
  context.editorSelectedNodeIds = new Set(["selected-a", "selected-b"]);
  context.editorSelectedNodeIndex = 1;

  const snapshot = api.editorNodeSelectionSnapshot(template);

  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.selectedConnectorIds));
  assert.deepEqual([...snapshot.selectedConnectorIds], ["selected-a", "selected-b"]);
  assert.equal(snapshot.primaryConnectorId, "selected-b");
  assert.deepEqual(Object.keys(snapshot).sort(), ["primaryConnectorId", "selectedConnectorIds"]);
  assert.throws(() => snapshot.selectedConnectorIds.push("other"), /object is not extensible|read only/i);
  template.connectors[0].id = "changed-after-snapshot";
  assert.deepEqual([...snapshot.selectedConnectorIds], ["selected-a", "selected-b"]);
});

test("Device Editor disabling LED Processor clears removed selection without selecting a shifted connector", () => {
  const { api, template, context } = structuralEditorHarness({
    isLedProcessor: true,
    ledOutputCount: 2,
    connectors: [
      testConnector("ordinary-before", "left", 0),
      testConnector("signal-line-1", "right", 0, { direction: "output", type: "led-signal", signalIndex: 1, generatedByLedProcessor: true }),
      testConnector("signal-line-2", "right", 1, { direction: "output", type: "led-signal", signalIndex: 2, generatedByLedProcessor: true }),
      testConnector("ordinary-after", "left", 1),
      testConnector("ordinary-tail", "left", 2)
    ]
  });
  context.editorSelectedNodeIds = new Set(["signal-line-2"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "signal-line-2");
  context.editorLedProcessor.checked = false;

  api.applyLedProcessorSettings();

  assert.deepEqual(selectedNodeConnectorIds(context), []);
  assert.equal(context.editorSelectedNodeIndex, null);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "");
  assert.ok(!context.editorSelectedNodeIds.has("ordinary-tail"));
});

test("Device Editor LED count reduction promotes the first surviving stable selection", () => {
  const { api, template, context } = structuralEditorHarness({
    isLedProcessor: true,
    ledOutputCount: 3,
    connectors: [
      testConnector("signal-line-1", "right", 0, { direction: "output", type: "led-signal", signalIndex: 1, generatedByLedProcessor: true }),
      testConnector("signal-line-2", "right", 1, { direction: "output", type: "led-signal", signalIndex: 2, generatedByLedProcessor: true }),
      testConnector("signal-line-3", "right", 2, { direction: "output", type: "led-signal", signalIndex: 3, generatedByLedProcessor: true }),
      testConnector("ordinary-after", "left", 3)
    ]
  });
  context.editorSelectedNodeIds = new Set(["signal-line-1", "signal-line-3"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "signal-line-3");
  context.editorLedProcessor.checked = true;
  context.editorLedOutputCount.value = "2";

  api.applyLedProcessorSettings();

  assert.deepEqual(selectedNodeConnectorIds(context), ["signal-line-1"]);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "signal-line-1");
  assert.equal(context.editorSelectedNodeIndex, template.connectors.findIndex(connector => connector.id === "signal-line-1"));
});

test("Device Editor LED reconciliation preserves non-contiguous stable selections only", () => {
  const { api, template, context } = structuralEditorHarness({
    isLedProcessor: true,
    ledOutputCount: 3,
    connectors: [
      testConnector("ordinary-a", "left", 0),
      testConnector("signal-line-1", "right", 0, { direction: "output", type: "led-signal", signalIndex: 1, generatedByLedProcessor: true }),
      testConnector("ordinary-b", "left", 1),
      testConnector("signal-line-2", "right", 1, { direction: "output", type: "led-signal", signalIndex: 2, generatedByLedProcessor: true }),
      testConnector("signal-line-3", "right", 2, { direction: "output", type: "led-signal", signalIndex: 3, generatedByLedProcessor: true }),
      testConnector("ordinary-c", "left", 2)
    ]
  });
  context.editorSelectedNodeIds = new Set(["ordinary-a", "signal-line-1", "signal-line-3"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "signal-line-3");
  context.editorLedProcessor.checked = true;
  context.editorLedOutputCount.value = "2";

  api.applyLedProcessorSettings();

  assert.deepEqual(selectedNodeConnectorIds(context), ["ordinary-a", "signal-line-1"]);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "ordinary-a");
  assert.ok(!context.editorSelectedNodeIds.has("ordinary-c"));
});

test("Device Editor LED Processor adopts legacy generated outputs and rolls back failed reconciliation", () => {
  const { api, template, counters, context, placementModule } = structuralEditorHarness({
    isLedProcessor: true,
    ledOutputCount: 2,
    connectors: [
      testConnector("signal-line-1", "right", 0, {
        direction: "output",
        displaySide: "right",
        type: "led-signal",
        label: "Signal Line 1",
        signalIndex: 1,
        customText: "legacy map",
        customTextCaption: "Legacy Caption",
        schemaVersion: 2,
        anchors: [{ id: "right", side: "right", x: 420, y: 100, primary: true }]
      }),
      testConnector("manual-signal-2", "right", 1, {
        direction: "output",
        displaySide: "right",
        type: "led-signal",
        label: "Manual Signal 2",
        signalIndex: 2,
        customText: "manual keep",
        schemaVersion: 2,
        anchors: [{ id: "right", side: "right", x: 420, y: 154, primary: true }]
      })
    ]
  });
  context.editorLedProcessor.checked = true;
  context.editorLedOutputCount.value = "2";

  api.applyLedProcessorSettings();
  const generated = generatedLedConnectors(template);
  assert.deepEqual(generated.map(connector => connector.id), ["signal-line-1", "signal-line-2"]);
  assert.equal(generated[0].customText, "legacy map");
  assert.equal(generated[0].customTextCaption, "Legacy Caption");
  assert.equal(template.connectors.find(connector => connector.id === "manual-signal-2")?.generatedByLedProcessor, undefined);
  assert.equal(template.connectors.find(connector => connector.id === "manual-signal-2")?.customText, "manual keep");
  const laneMap = itemLaneMap(api.resolveEditorModularLayout(template));
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), laneMap, "second static normalization is a fixed point");

  context.editorSelectedNodeIds = new Set(["signal-line-1", "manual-signal-2"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "signal-line-1");
  const beforeTemplate = structuredClone(template);
  const beforeSelection = selectedNodeConnectorIds(context);
  const beforePrimary = selectedNodePrimaryConnectorId(template, context);
  const beforePrimaryIndex = context.editorSelectedNodeIndex;
  const beforeCounts = editorCounterSnapshot(counters);
  const beforeSettingsRenders = counters.selectedSettingsRenders;
  const beforeRelationshipRenders = counters.relationshipRenders;
  context.editorLedOutputCount.value = "3";
  placementModule.forceInvalid = true;
  assert.throws(() => api.applyLedProcessorSettings(), /invalid layout/);
  placementModule.forceInvalid = false;

  assert.equal(JSON.stringify(template), JSON.stringify(beforeTemplate));
  assert.deepEqual(selectedNodeConnectorIds(context), beforeSelection);
  assert.equal(selectedNodePrimaryConnectorId(template, context), beforePrimary);
  assert.equal(context.editorSelectedNodeIndex, beforePrimaryIndex);
  assert.equal(counters.selectedSettingsRenders, beforeSettingsRenders);
  assert.equal(counters.relationshipRenders, beforeRelationshipRenders);
  assert.deepEqual(editorCounterDelta(counters, beforeCounts), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });
});

test("Device Editor Ethernet Switch settings are nonstructural and Add Ports batches atomically", () => {
  const { api, template, counters, context } = structuralEditorHarness({
    cardTypes: [{
      id: "io-card",
      name: "I/O Card",
      kind: "io",
      connectors: [
        { id: "in-1", direction: "input", type: "hdmi", empty: false },
        { id: "out-1", direction: "output", type: "hdmi", empty: false }
      ]
    }],
    cardSlots: [
      { id: "slot-a", name: "Slot A", installedCardTypeId: "io-card", y: 100, connectorOverrides: {} }
    ],
    connectors: [
      testConnector("fixed-left", "left", 4, { direction: "input", displaySide: "left", schemaVersion: 2, anchors: [{ id: "left", side: "left", x: 0, y: 316, primary: true }] })
    ]
  });

  context.editorEthernetSwitch.checked = true;
  context.editorSwitchPortCount.value = "3";
  context.editorSwitchPortType.value = "1g-rj45";
  let before = editorCounterSnapshot(counters);
  api.applyEthernetSwitchSettings();
  assert.equal(template.isEthernetSwitch, true);
  assert.equal(template.switchPortCount, 3);
  assert.equal(template.switchPortType, "1g-rj45");
  assert.equal(context.editorSwitchPortCount.disabled, false);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 0,
    solverCalls: 0,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });

  context.editorSelectedNodeIds = new Set(["fixed-left"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "fixed-left");
  const normalizationBefore = counters.normalizationCalls;
  before = editorCounterSnapshot(counters);
  api.addEthernetSwitchPortBatch();

  let pairs = switchGeneratedPairs(template, "1g-rj45");
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs.map(pair => pair.output.switchPortIndex), [1, 2, 3]);
  const lanes = itemLaneMap(api.resolveEditorModularLayout(template));
  pairs.forEach(({ output, input }) => {
    assert.ok(input, `pair for ${output.id} should exist`);
    assert.equal(output.direction, "output");
    assert.equal(input.direction, "input");
    assert.equal(output.displaySide, "right");
    assert.equal(input.displaySide, "left");
    assert.equal(output.pairedConnectorId, input.id);
    assert.equal(input.pairedConnectorId, output.id);
    assert.equal(output.networkGroupId, input.networkGroupId);
    assert.equal(output.generatedByEthernetSwitch, true);
    assert.equal(input.generatedByEthernetSwitch, true);
    assert.equal(output.includeInMatrix, false);
    assert.equal(input.includeInMatrix, false);
    assert.equal(lanes[`connector:${output.id}`], lanes[`connector:${input.id}`], "network pair should share one lane");
    assert.ok(lanes[`connector:${output.id}`] >= 3, "both-side card span should be respected");
  });
  assert.deepEqual(selectedNodeConnectorIds(context), ["fixed-left"]);
  assert.equal(counters.normalizationCalls, normalizationBefore, "batch should not call normalizeConnectorRows per port");
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });

  const firstBatchIds = generatedSwitchConnectors(template, "1g-rj45").map(connector => connector.id);
  before = editorCounterSnapshot(counters);
  api.addEthernetSwitchPortBatch();
  pairs = switchGeneratedPairs(template, "1g-rj45");
  assert.equal(pairs.length, 6);
  assert.deepEqual(pairs.map(pair => pair.output.switchPortIndex), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(generatedSwitchConnectors(template, "1g-rj45").slice(0, firstBatchIds.length).map(connector => connector.id), firstBatchIds);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });

  context.editorSwitchPortCount.value = "2";
  context.editorSwitchPortType.value = "sfp";
  before = editorCounterSnapshot(counters);
  api.addEthernetSwitchPortBatch();
  assert.deepEqual(switchGeneratedPairs(template, "sfp").map(pair => pair.output.switchPortIndex), [1, 2]);
  assert.deepEqual(switchGeneratedPairs(template, "1g-rj45").map(pair => pair.output.switchPortIndex), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 1,
    editorRenders: 0,
    animationSeeds: 1,
    animationRetargets: 1
  });

  const finalMap = itemLaneMap(api.resolveEditorModularLayout(template));
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), finalMap, "generated switch layout is a fixed point");
});

test("Device Editor Ethernet batch insertion preserves exact multi-selection and primary ID", () => {
  const { api, template, context } = structuralEditorHarness({
    isEthernetSwitch: true,
    switchPortCount: 2,
    switchPortType: "1g-rj45",
    connectors: [
      testConnector("selected-left", "left", 0),
      testConnector("selected-right", "right", 0, { direction: "output" }),
      testConnector("unselected-left", "left", 1)
    ]
  });
  context.editorEthernetSwitch.checked = true;
  context.editorSwitchPortCount.value = "2";
  context.editorSwitchPortType.value = "1g-rj45";
  context.editorSelectedNodeIds = new Set(["selected-left", "selected-right"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "selected-right");

  api.addEthernetSwitchPortBatch();

  assert.deepEqual(selectedNodeConnectorIds(context), ["selected-left", "selected-right"]);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "selected-right");
  assert.equal(context.editorSelectedNodeIndex, template.connectors.findIndex(connector => connector.id === "selected-right"));
  assert.equal(generatedSwitchConnectors(template, "1g-rj45").length, 4);
});

test("Device Editor Ethernet Switch batch rollback and later pair movement stay structural", () => {
  const { api, template, counters, context, placementModule } = structuralEditorHarness({
    isEthernetSwitch: true,
    switchPortCount: 2,
    switchPortType: "10g-rj45",
    connectors: [
      testConnector("rollback-left", "left", 0),
      testConnector("rollback-right", "right", 0, { direction: "output" })
    ]
  });
  context.editorEthernetSwitch.checked = true;
  context.editorSwitchPortCount.value = "2";
  context.editorSwitchPortType.value = "10g-rj45";
  context.editorSelectedNodeIds = new Set(["rollback-left", "rollback-right"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "rollback-right");
  const beforeTemplate = structuredClone(template);
  const beforeSelection = selectedNodeConnectorIds(context);
  const beforePrimary = selectedNodePrimaryConnectorId(template, context);
  const beforePrimaryIndex = context.editorSelectedNodeIndex;
  const beforeCounts = editorCounterSnapshot(counters);
  const beforeSettingsRenders = counters.selectedSettingsRenders;
  const beforeRelationshipRenders = counters.relationshipRenders;
  placementModule.forceInvalid = true;
  assert.throws(() => api.addEthernetSwitchPortBatch(), /invalid layout/);
  placementModule.forceInvalid = false;
  assert.deepEqual(template, beforeTemplate);
  assert.deepEqual(template.connectors.map(connector => connector.id), ["rollback-left", "rollback-right"]);
  assert.deepEqual(selectedNodeConnectorIds(context), beforeSelection);
  assert.equal(selectedNodePrimaryConnectorId(template, context), beforePrimary);
  assert.equal(context.editorSelectedNodeIndex, beforePrimaryIndex);
  assert.equal(counters.selectedSettingsRenders, beforeSettingsRenders);
  assert.equal(counters.relationshipRenders, beforeRelationshipRenders);
  assert.deepEqual(editorCounterDelta(counters, beforeCounts), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 0,
    editorRenders: 0,
    animationSeeds: 0,
    animationRetargets: 0
  });

  api.addEthernetSwitchPortBatch();
  const [{ output, input }] = switchGeneratedPairs(template, "10g-rj45");
  assert.ok(output && input);
  api.commitEditorStructuralEdit(template, {
    primaryItemId: `connector:${output.id}`,
    mutate(draft, transactionContext) {
      const outputDraft = draft.connectors.find(connector => connector.id === output.id);
      const inputDraft = draft.connectors.find(connector => connector.id === input.id);
      const y = transactionContext.targetYForLane(0);
      outputDraft.y = y;
      inputDraft.y = y;
      return {
        upsertIds: [`connector:${output.id}`, `connector:${input.id}`],
        hardTargets: {
          [`connector:${output.id}`]: 0,
          [`connector:${input.id}`]: 0
        }
      };
    }
  });
  const movedLanes = itemLaneMap(api.resolveEditorModularLayout(template));
  assert.equal(movedLanes[`connector:${output.id}`], 0);
  assert.equal(movedLanes[`connector:${input.id}`], 0);
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
  assert.match(PRODUCTION_BRIDGE_SOURCE, /ENGINE_BRIDGE_VERSION = "iteration54-12-0-atomic-faceplate-origin-mutations"/);

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
