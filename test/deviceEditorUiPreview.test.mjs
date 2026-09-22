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
import { SceneGraph } from "../src/engine/sceneGraph.js";
import {
  authoringInsertionBoundaryForLane,
  authoringInsertionBoundaryScreenPositions,
  authoringInsertionBoundaryWithHysteresis,
  connectorPlacementSideMask,
  createModularAuthoringInsertionSession,
  createModularCompositeInsertionDragSession,
  createModularInsertionDragSession,
  createModularStructuralEditSession,
  isValidModularCompositeInsertionResult,
  isValidModularInsertionResult,
  isValidModularStructuralEditResult,
  resolveModularCompositeInsertionDrag,
  resolveModularAuthoringInsertion,
  resolveModularInsertionDrag,
  resolveModularStructuralEdit,
  targetLaneWithHysteresis,
  resolveModularPlacementItems
} from "../src/engine/modularDeviceLayout.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import {
  POWER_PLUG_TYPES,
  normalizePowerDistroForEngine,
  powerDistroRequiredHeight,
  powerPlugCanExistOnSide,
  powerPlugImageForConnector,
  isPowerPlugConnector
} from "../src/engine/powerDistroModel.js";

const INDEX_HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ENGINE_PREVIEW_SOURCE = readFileSync(new URL("../src/engine/enginePreview.js", import.meta.url), "utf8");
const DEVICE_VISUAL_BUILDER_SOURCE = readFileSync(new URL("../src/engine/deviceVisualBuilder.js", import.meta.url), "utf8");
const RENDERER_SOURCE = readFileSync(new URL("../src/engine/renderer.js", import.meta.url), "utf8");
const PRODUCTION_BRIDGE_SOURCE = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
const PROJECT_MUTATIONS_SOURCE = readFileSync(new URL("../src/engine/projectMutations.js", import.meta.url), "utf8");
const RELEASE_HARDENING_FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/modular-placement-release-hardening.avd", import.meta.url), "utf8"));

function editorPanel(name) {
  const match = INDEX_HTML.match(new RegExp(`<section class="editor-panel[^"]*" data-editor-panel="${name}">([\\s\\S]*?)</section>`));
  return match?.[1] || "";
}

function deviceFeaturePane() {
  const match = INDEX_HTML.match(/<aside class="device-feature-pane[^"]*" id="deviceFeaturePane"[\s\S]*?<\/aside>/);
  return match?.[0] || "";
}

function functionSourceFrom(source, functionName) {
  const namePattern = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`function\\s+${namePattern}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  assert.ok(match, `Missing function ${functionName}`);
  const start = match.index;
  const bodyStart = start + match[0].lastIndexOf("{");
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Unterminated function ${functionName}`);
}

function functionSource(functionName) {
  return functionSourceFrom(INDEX_HTML, functionName);
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

function testSvgNode(tagName, attributes = {}) {
  return {
    tagName,
    attributes: { ...attributes },
    childNodes: [],
    textContent: "",
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
  };
}

function testSvgDescendants(root) {
  const result = [];
  const visit = node => {
    (node?.childNodes || []).forEach(child => {
      result.push(child);
      visit(child);
    });
  };
  visit(root);
  return result;
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
    Set,
    String,
    structuredClone,
    SLOT_HEIGHT: 54,
    DEVICE_BOTTOM_PAD: 48,
    editorNodeDrag: null,
    editorCardSlotDrag: null,
    editorConnectorSnapGuide: null,
    editorSlotIndex: null,
    editorSelectedNodeIds: new Set(),
    editorSelectedCardNodeIds: new Set(),
    editorSelectedPowerPlugIds: new Set(),
    editorSelectedFaceplate: false,
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
      authoringInsertionBoundaryWithHysteresis,
      createModularAuthoringInsertionSession,
      createModularCompositeInsertionDragSession,
      createModularInsertionDragSession,
      createModularStructuralEditSession,
      isValidModularCompositeInsertionResult,
      resolveModularAuthoringInsertion,
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
    "editorProjectedLanePixels",
    "createEditorCompactPlacementDragSession",
    "createEditorStablePlacementDragSession",
    "createEditorCompositeConnectorDragSession",
    "resolveEditorCompactPlacementDragMove",
    "resolveEditorStablePlacementDragMove",
    "applyEditorStableResolvedLayout",
    "commitEditorStablePlacementDrag",
    "captureEditorCardDragSelection",
    "restoreEditorCardDragSelection",
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
  const animationFrames = new Map();
  let nextAnimationFrameId = 1;
  const resizeSurface = {
    capturedPointers: new Set(),
    setPointerCapture(pointerId) { this.capturedPointers.add(pointerId); },
    hasPointerCapture(pointerId) { return this.capturedPointers.has(pointerId); },
    releasePointerCapture(pointerId) { this.capturedPointers.delete(pointerId); }
  };
  const placementModule = {
    authoringInsertionBoundaryForLane,
    authoringInsertionBoundaryWithHysteresis,
    connectorPlacementSideMask,
    createModularAuthoringInsertionSession,
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
    resolveModularAuthoringInsertion,
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
    FACE_HEIGHT: 44,
    FACE_MARGIN: 12,
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
    editorActiveTab: "connectors",
    editorFaceplateUploadRevision: 0,
    editorSlotIndex: null,
    editorCardIndex: 0,
    editorSelectedNodeIndex: null,
    editorSelectedNodeIds: new Set(),
    editorSelectedFaceplate: false,
    editorSelectedPowerPlugIds: new Set(),
    editorNodeDrag: null,
    editorCardSlotDrag: null,
    editorConnectorSnapGuide: null,
    editorDragPointerReleaseInProgress: false,
    editorResizeSession: null,
    editorResizePreviewTemplate: null,
    editorPlacementMotionPreviewLock: null,
    editorResizePointerReleaseInProgress: false,
    editorInteractionSvg: null,
    resizeSurface,
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
    requestAnimationFrame: callback => {
      const id = nextAnimationFrameId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: id => animationFrames.delete(id),
    flushAnimationFrames: () => {
      const pending = [...animationFrames.entries()];
      animationFrames.clear();
      pending.forEach(([, callback]) => callback());
      return pending.length;
    },
    editorSvgForEvent: () => resizeSurface,
    getEditorPreviewPoint: event => ({
      x: Number(event?.point?.x ?? event?.clientX) || 0,
      y: Number(event?.point?.y ?? event?.clientY) || 0
    }),
    setEditorPointerCapture: event => {
      context.editorInteractionSvg = resizeSurface;
      resizeSurface.setPointerCapture(event.pointerId);
    },
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
        const scaleY = Number(device.faceImageScaleY) || Number(device.faceImageScale) || 1;
        return width > 0 && height > 0 ? baseStartY + Math.round(height / width * 100 * scaleY) : baseStartY;
      }
      if (device?.faceplateDeleted) return Number(device.deletedFaceStartY) || baseStartY;
      if (!device?.isPowerDistro) return baseStartY;
      const explicitStartY = Number(device.powerDistroStartY);
      if (Number.isFinite(explicitStartY)) return explicitStartY;
      if (device.resizeGeometryMode === true && Number.isFinite(Number(device.powerDistroFaceHeight))) {
        return Math.round((Number(device.powerDistroFaceY) || 20) + Number(device.powerDistroFaceHeight) + 36);
      }
      const powerPlugCount = (device.connectors || []).filter(connector => String(connector?.type || "").startsWith("power-")).length;
      return baseStartY + Math.max(0, powerPlugCount - 1) * 54;
    },
    laneIndexForY: (y, startY = 100) => Math.max(0, Math.round(((Number(y) || startY) - startY) / 54)),
    laneY: (lane, startY = 100) => startY + Math.max(0, Math.round(Number(lane) || 0)) * 54,
    deviceTemplateWidth: device => Number(device?.width) || 420,
    connectorSideKey: connector => connector?.direction === "output" ? "output" : "input",
    currentEditorTemplate: () => context.editorDraft[context.editorIndex],
    editorPreviewDeviceName: device => String(device?.name || "Device"),
    validateDraftDefaults: device => device,
    normalizedPowerWatts: value => Math.max(0, Number(value) || 0),
    powerUnitFor: device => device?.powerUnit === "A" ? "A" : "W",
    normalizePowerUnit: value => value === "A" ? "A" : "W",
    editorActiveStableDragLayout: () => null,
    applyEditorPlacementVisualsToPreviewTemplate: device => device,
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
    deviceContentHeightForSlotCounts: device => {
      const manualHeight = Number(device?.manualHeight) || 0;
      device.manualHeight = 0;
      const height = context.deviceHeightForSlotCounts(device);
      device.manualHeight = manualHeight;
      return height;
    },
    faceImageBounds: (device, width = 420) => {
      const naturalWidth = Number(device?.faceImageNaturalWidth) || 1;
      const naturalHeight = Number(device?.faceImageNaturalHeight) || 1;
      const scaleY = Number(device?.faceImageScaleY) || Number(device?.faceImageScale) || 1;
      const faceHeight = Math.max(24, Math.round((width - 24) * naturalHeight / naturalWidth * scaleY));
      return { x: 20, y: 28, width: width - 40, height: Math.max(16, faceHeight - 16) };
    },
    faceImagePlacement: (device, width = 420) => {
      const bounds = context.faceImageBounds(device, width);
      const scaleX = Number(device?.faceImageScaleX) || Number(device?.faceImageScale) || 1;
      const scaleY = Number(device?.faceImageScaleY) || Number(device?.faceImageScale) || 1;
      const imageWidth = Math.min(bounds.width, bounds.width * scaleX);
      const imageHeight = Math.min(bounds.height, bounds.height * scaleY);
      return {
        x: Math.min(bounds.x + bounds.width - imageWidth, Math.max(bounds.x, bounds.x + (bounds.width - imageWidth) / 2 + (Number(device?.faceImageOffsetX) || 0))),
        y: Math.min(bounds.y + bounds.height - imageHeight, Math.max(bounds.y, bounds.y + (bounds.height - imageHeight) / 2 + (Number(device?.faceImageOffsetY) || 0))),
        width: imageWidth,
        height: imageHeight
      };
    },
    powerDistroFaceY: device => Number(device?.powerDistroFaceY) || 20,
    powerDistroAutoFaceHeight: device => Number(device?.autoFaceHeight) || 80,
    powerDistroFaceHeight: device => Math.max(Number(device?.autoFaceHeight) || 80, Number(device?.powerDistroFaceHeight) || 0),
    powerDistroFaceRect: device => ({
      x: 12,
      y: Number(device?.powerDistroFaceY) || 20,
      width: (Number(device?.width) || 420) - 24,
      height: Math.max(Number(device?.autoFaceHeight) || 80, Number(device?.powerDistroFaceHeight) || 0)
    }),
    powerDistroManualPlugTopLimit: device => Number.isFinite(Number(device?.manualPlugTopLimit)) ? Number(device.manualPlugTopLimit) : Infinity,
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
    "editorStableDragItemId",
    "editorStableDragLaneMap",
    "editorPlacementItemByStableId",
    "editorPlacementTemplateForConnectorDrag",
    "editorProjectedLanePixels",
    "createEditorCompactPlacementDragSession",
    "createEditorStablePlacementDragSession",
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
    "shiftTemplateRowsForStartChange",
    "setEditorDeviceHeight",
    "setEditorPowerDistroFaceGeometry",
    "editorPlacementPreviewLockFor",
    "editorResizePreviewTemplateFor",
    "readonlyDeviceEditorPreviewTemplate",
    "editorEnginePreviewTemplateClone",
    "freezeEditorResizeSnapshotValue",
    "editorResizeScalarLayoutSnapshot",
    "editorResizeGeometry",
    "editorResizeGeometryEqual",
    "editorResizeSessionIdentityCurrent",
    "editorResizeLegacyNavigationSnapshot",
    "applyEditorResizeLegacyNavigation",
    "captureEditorResizeBaseline",
    "restoreEditorResizeSelection",
    "beginEditorResizeSession",
    "applyEditorCustomFaceImageResizeCandidate",
    "deriveEditorResizePreviewCandidate",
    "editorResizeCandidateIsValid",
    "cancelEditorResizePreviewFrame",
    "flushEditorResizePreviewCandidate",
    "scheduleEditorResizePreview",
    "updateEditorResizeSessionFromEvent",
    "releaseEditorResizePointerCapture",
    "commitEditorResizeCandidate",
    "finishEditorResizeSession",
    "cancelEditorResizeSession",
    "editorNodeSelectionSnapshot",
    "restoreEditorNodeSelectionByStableIds",
    "pairedNetworkGroupId",
    "ensurePairedNetworkPair",
    "nextEditorPlacementY",
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
    "fillEditorSlotById",
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
    "createCardSlot",
    "uniqueCardSlotId",
    "installCardInSlot",
    "addEditorCardSlot",
    "removeCardSlot",
    "editorDataTransferHasType",
    "editorCardDropTypeId",
    "editorPreviewCanCreateCardSlotFromDrop",
    "createCardSlotFromPreviewDrop",
    "captureTemplateConfiguration",
    "saveTemplateAsDefault",
    "resetTemplateToDefault"
  ];
  const script = `${helpers.map(functionSource).join("\n")}
    ({
      resolveEditorModularLayout,
      editorPlacementTemplateForConnectorDrag,
      createEditorStablePlacementDragSession,
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
      editorResizePreviewTemplateFor,
      readonlyDeviceEditorPreviewTemplate,
      editorEnginePreviewTemplateClone,
      captureEditorResizeBaseline,
      beginEditorResizeSession,
      deriveEditorResizePreviewCandidate,
      editorResizeCandidateIsValid,
      flushEditorResizePreviewCandidate,
      updateEditorResizeSessionFromEvent,
      finishEditorResizeSession,
      cancelEditorResizeSession,
      editorNodeSelectionSnapshot,
      restoreEditorNodeSelectionByStableIds,
      applyLedProcessorSettings,
      applyPowerDistroSettings,
      applyEthernetSwitchSettings,
      addEthernetSwitchPortBatch,
      addEditorNode,
      fillEditorSlotById,
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
      removeCardSlot,
      createCardSlotFromPreviewDrop,
      captureTemplateConfiguration,
      saveTemplateAsDefault,
      resetTemplateToDefault,
      applyEditorStableResolvedLayout
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

function cardDragInteractionHarness(inputTemplate = {}, options = {}) {
  const template = structuredClone({
    id: "card-drag-device",
    name: "Card Drag Device",
    width: 420,
    height: 240,
    manualHeight: 0,
    startY: 100,
    connectors: [],
    cardSlots: [],
    ...inputTemplate
  });
  const counters = {
    captures: 0,
    releases: 0,
    previewRenders: 0,
    editorRenders: 0,
    motionSeeds: 0,
    motionRetargets: [],
    draggedVisualUpdates: [],
    motionSettles: 0,
    motionClears: 0,
    motionRollbacks: 0,
    commits: 0
  };
  const context = {
    console,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Set,
    String,
    structuredClone,
    SLOT_HEIGHT: 54,
    DEVICE_BOTTOM_PAD: 48,
    editorActiveTab: "connectors",
    editorIndex: 0,
    editorSlotIndex: null,
    editorSelectedNodeIndex: null,
    editorNodeDrag: null,
    editorCardSlotDrag: null,
    editorSelectedInstalledCardConnectorId: "",
    editorConnectorSnapGuide: null,
    editorSelectedNodeIds: new Set(["node-selection-sentinel"]),
    editorSelectedCardNodeIds: new Set(["card-selection-sentinel"]),
    editorSelectedFaceplate: true,
    editorDragPointerReleaseInProgress: false,
    editorResizeSession: null,
    editorPowerPlugMarquee: null,
    editorNodeMarquee: null,
    editorPowerPlugDrag: null,
    rackPreviewDeviceDrag: null,
    editorSelectedPowerPlugIds: new Set(["selection-sentinel"]),
    previewScale: Number(options.previewScale) || 1,
    currentEditorTemplate: () => template,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    connectorStartYForTemplate: device => Number(device?.startY) || 100,
    laneY: (lane, startY = 100) => startY + Math.max(0, lane) * 54,
    captureTemplateConfiguration: device => structuredClone(device),
    deviceTemplateWidth: device => Number(device?.width) || 420,
    connectorSideKey: connector => connector?.direction === "output" ? "output" : "input",
    editorNodeTargetIndexFromEvent: event => Number(event?.nodeIndex),
    editorSelectedConnectorIds: device => {
      const valid = new Set((device?.connectors || []).map(connector => connector.id));
      return [...context.editorSelectedNodeIds].filter(id => valid.has(id));
    },
    setEditorNodeSelection: (device, index, selectionOptions = {}) => {
      const connector = device?.connectors?.[index];
      if (!connector) return;
      if (selectionOptions.toggle) {
        if (context.editorSelectedNodeIds.has(connector.id)) context.editorSelectedNodeIds.delete(connector.id);
        else context.editorSelectedNodeIds.add(connector.id);
      } else if (!(selectionOptions.keepGroup && context.editorSelectedNodeIds.size > 1 && context.editorSelectedNodeIds.has(connector.id))) {
        context.editorSelectedNodeIds = new Set([connector.id]);
      }
      context.editorSelectedNodeIndex = index;
    },
    syncEditorNodeSelection: device => {
      const valid = new Set((device?.connectors || []).map(connector => connector.id));
      context.editorSelectedNodeIds = new Set([...context.editorSelectedNodeIds].filter(id => valid.has(id)));
      const firstId = context.editorSelectedNodeIds.values().next().value;
      context.editorSelectedNodeIndex = firstId
        ? device.connectors.findIndex(connector => connector.id === firstId)
        : null;
    },
    editorPreviewPositions: device => new Map((device?.connectors || []).map(connector => [connector.id, connector.y])),
    renderSelectedConnectorSettings: () => {},
    startRackPreviewDeviceDrag: () => false,
    startEditorFaceImageResize: () => false,
    startEditorResizeDrag: () => false,
    startEditorPowerPlugDrag: () => false,
    editorInstalledCardConnectorFromEvent: () => null,
    startEditorFaceplateMarquee: () => false,
    startEditorNodeMarquee: () => false,
    isAdapterCenterDropTarget: () => false,
    isFaceplateSideDropTarget: () => false,
    reorderConnectorInDirection: () => null,
    isEditorV2ConnectorCandidate: connector => Array.isArray(connector?.anchors),
    editorConnectorAnchors: connector => structuredClone(connector?.anchors || []),
    getEditorPreviewPoint: event => ({
      x: Number(event?.clientX) / context.previewScale,
      y: Number(event?.clientY) / context.previewScale
    }),
    captureEditorDragCoordinateFrame: (event, localPoint) => Object.freeze({
      clientX: Number(event.clientX) || 0,
      clientY: Number(event.clientY) || 0,
      localX: Number(localPoint?.x) || 0,
      localY: Number(localPoint?.y) || 0,
      xBasisX: 1 / context.previewScale,
      xBasisY: 0,
      yBasisX: 0,
      yBasisY: 1 / context.previewScale
    }),
    setEditorPointerCapture: () => { counters.captures += 1; },
    releaseEditorPointerCapture: () => { counters.releases += 1; },
    beginEditorPlacementMotion: () => { counters.motionSeeds += 1; },
    retargetEditorPlacementMotionForDrag: (_drag, motionOptions) => {
      counters.motionRetargets.push(structuredClone(motionOptions));
    },
    setEditorDraggedPlacementVisualY: (_drag, visualY) => {
      counters.draggedVisualUpdates.push(visualY);
    },
    settleEditorPlacementMotionToLayout: layout => {
      counters.motionSettles += 1;
      counters.settledLayout = structuredClone(layout);
    },
    clearEditorPlacementMotion: () => { counters.motionClears += 1; },
    rollbackEditorPlacementMotionForDrag: () => {
      counters.motionRollbacks += 1;
      return false;
    },
    renderDeviceEditorPreview: () => { counters.previewRenders += 1; },
    renderDeviceEditor: () => { counters.editorRenders += 1; },
    applyEditorFaceImageResize: () => false,
    updateEditorResizeSessionFromEvent: () => false,
    requireDeviceEditorPlacementModule: () => ({
      authoringInsertionBoundaryForLane,
      authoringInsertionBoundaryScreenPositions,
      authoringInsertionBoundaryWithHysteresis,
      createModularAuthoringInsertionSession,
      createModularInsertionDragSession,
      isValidModularInsertionResult,
      resolveModularAuthoringInsertion,
      resolveModularInsertionDrag,
      targetLaneWithHysteresis,
      resolveModularPlacementItems
    })
  };
  context.syncEditorConnectorAnchorsToPosition = (device, connector) => {
    if (!Array.isArray(connector.anchors)) return;
    const width = Number(device?.width) || 420;
    connector.anchors = connector.anchors.map(anchor => ({
      ...anchor,
      x: anchor.side === "right" ? width : 0,
      y: connector.y
    }));
  };
  context.resolveEditorModularLayout = device => {
    const startY = Number(device?.startY) || 100;
    const connectors = (device.connectors || []).map((connector, index) => ({
      id: `connector:${connector.id}`,
      kind: "connector",
      itemType: "chassis-connector",
      sideMask: connector.sideMask || (connector.displaySide === "both" ? "both" : connector.direction === "output" ? "right" : "left"),
      requestedLane: Math.max(0, Math.round(((Number(connector.y) || startY) - startY) / 54)),
      span: 1,
      order: index
    }));
    const cards = (device.cardSlots || []).map((slot, index) => ({
      id: `card:${slot.id}`,
      kind: "card",
      itemType: "card-slot",
      sideMask: slot.sideMask || "both",
      requestedLane: Math.max(0, Math.round(((Number(slot.y) || startY) - startY) / 54)),
      span: Math.max(1, Number(slot.span) || 1),
      order: connectors.length + index
    }));
    return resolveModularPlacementItems([...connectors, ...cards], { startY, slotHeight: 54 });
  };
  context.deviceHeightForSlotCounts = device => {
    const layout = context.resolveEditorModularLayout(device);
    const bottom = Math.max(0, ...layout.items.map(item => item.y + item.span * 54));
    return Math.max(Number(device?.manualHeight) || 0, 240, Math.ceil(bottom + 75));
  };
  context.editorLaneMapsEqual = (left = new Map(), right = new Map()) => {
    if (left.size !== right.size) return false;
    for (const [id, lane] of left) {
      if (right.get(id) !== lane) return false;
    }
    return true;
  };

  const helpers = [
    "editorStableDragLayout",
    "editorStableDragItemId",
    "editorStableLayoutItemKind",
    "editorStableDragSourceId",
    "editorStableDragLaneMap",
    "editorPlacementItemByStableId",
    "editorPlacementTemplateForConnectorDrag",
    "editorProjectedLanePixels",
    "createEditorCompactPlacementDragSession",
    "createEditorCompactCardDragSession",
    "resolveEditorCompactPlacementDragMove",
    "resolveEditorCompactCardDragMove",
    "createEditorStablePlacementDragSession",
    "createEditorCompositeConnectorDragSession",
    "resolveEditorStablePlacementDragMove",
    "applyEditorStableResolvedLayout",
    "commitEditorStablePlacementDrag",
    "captureEditorCardDragSelection",
    "restoreEditorCardDragSelection",
    "cancelEditorStableDrags",
    "getEditorDragPreviewPoint",
    "editorDragConnectorIds",
    "commitEditorNodeDrag",
    "startEditorCardSlotDrag",
    "startEditorNodeDrag",
    "moveEditorNode",
    "stopEditorNodeDrag"
  ];
  const script = `${helpers.map(functionSource).join("\n")}
    ({
      startEditorCardSlotDrag,
      startEditorNodeDrag,
      moveEditorNode,
      stopEditorNodeDrag,
      cancelEditorStableDrags,
      getDrag: () => editorCardSlotDrag,
      getNodeDrag: () => editorNodeDrag,
      getLayout: () => resolveEditorModularLayout(currentEditorTemplate())
    })`;
  const api = vm.runInNewContext(script, context);
  const cardEvent = (type, pointerId, clientY, slotIndex = 0) => ({
    type,
    pointerId,
    button: 0,
    clientX: 20,
    clientY,
    target: {
      closest(selector) {
        return selector === "[data-editor-card-slot]"
          ? { dataset: { editorCardSlot: String(slotIndex) } }
          : null;
      }
    },
    preventDefault() {},
    stopPropagation() {}
  });
  const nodeEvent = (type, pointerId, clientY, nodeIndex = 0) => ({
    type,
    pointerId,
    button: 0,
    clientX: 20,
    clientY,
    nodeIndex,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    target: { closest: () => null },
    preventDefault() {},
    stopPropagation() {}
  });
  const startCardDrag = (slotIndex, pointerId = 1) => {
    const slot = template.cardSlots[slotIndex];
    const clientY = Number(slot.y) * context.previewScale;
    const event = cardEvent("pointerdown", pointerId, clientY, slotIndex);
    assert.equal(api.startEditorCardSlotDrag(event), true);
    return { pointerId, clientY, startY: Number(slot.y), frame: api.getDrag().coordinateFrame };
  };
  const moveCardToClientY = (started, clientY) => {
    api.moveEditorNode(cardEvent("pointermove", started.pointerId, clientY));
    return api.getDrag();
  };
  const moveCardToLane = (started, lane, { rawLane = lane } = {}) => {
    const drag = api.getDrag();
    const targetBoundaryIndex = authoringInsertionBoundaryForLane(drag.session, lane, {
      previousBoundaryIndex: drag.currentBoundaryIndex
    });
    const positions = authoringInsertionBoundaryScreenPositions(drag.session, {
      projectedLanePx: drag.projectedLanePx,
      minimumStepPx: 12
    });
    const boundaryDelta = positions[targetBoundaryIndex] - positions[drag.originalBoundaryIndex];
    const boundaryLanes = drag.session.boundaries.map(boundary => boundary.targetLane);
    const minLane = Math.min(...boundaryLanes);
    const maxLane = Math.max(...boundaryLanes);
    const overshoot = rawLane > maxLane
      ? rawLane - maxLane
      : rawLane < minLane
        ? rawLane - minLane
        : 0;
    const edgeStepPx = Math.max(12, drag.projectedLanePx);
    const clientY = started.frame.clientY + boundaryDelta + overshoot * edgeStepPx;
    return moveCardToClientY(started, clientY);
  };
  const stopCardDrag = (started, type = "pointerup") => {
    if (type === "pointerup") counters.commits += api.getDrag()?.movementThresholdCrossed ? 1 : 0;
    api.stopEditorNodeDrag(cardEvent(type, started.pointerId, started.clientY));
  };
  const loseCardPointerCapture = started => api.cancelEditorStableDrags(
    cardEvent("lostpointercapture", started.pointerId, started.clientY)
  );
  const startNodeDrag = (nodeIndex, pointerId = 1, selectedIds = null) => {
    const connector = template.connectors[nodeIndex];
    if (Array.isArray(selectedIds)) context.editorSelectedNodeIds = new Set(selectedIds);
    const clientY = Number(connector.y) * context.previewScale;
    api.startEditorNodeDrag(nodeEvent("pointerdown", pointerId, clientY, nodeIndex));
    const drag = api.getNodeDrag();
    assert.ok(drag, `node ${nodeIndex} drag should start`);
    return { pointerId, clientY, startY: Number(connector.y), frame: drag.coordinateFrame, nodeIndex };
  };
  const moveNodeToClientY = (started, clientY) => {
    api.moveEditorNode(nodeEvent("pointermove", started.pointerId, clientY, started.nodeIndex));
    return api.getNodeDrag();
  };
  const stopNodeDrag = (started, type = "pointerup") => {
    if (type === "pointerup") counters.commits += api.getNodeDrag()?.movementThresholdCrossed ? 1 : 0;
    api.stopEditorNodeDrag(nodeEvent(type, started.pointerId, started.clientY, started.nodeIndex));
  };
  return {
    api,
    context,
    counters,
    template,
    startCardDrag,
    moveCardToClientY,
    moveCardToLane,
    stopCardDrag,
    loseCardPointerCapture,
    startNodeDrag,
    moveNodeToClientY,
    stopNodeDrag
  };
}

function deviceHeightCalculationHarness() {
  const context = {
    Math,
    Map,
    Number,
    DEVICE_WIDTH: 420,
    SLOT_HEIGHT: 54,
    DEVICE_BOTTOM_PAD: 48,
    ADAPTER_NODE_RADIUS: 16,
    ADAPTER_NODE_EDGE_PADDING: 24,
    connectorStartYForTemplate: template => Number(template?.startY) || 100,
    deviceMinimumHeight: () => 240,
    effectiveTemplateConnectors: template => template.connectors || [],
    isAdapterTemplate: () => false,
    isLayoutConnector: () => true,
    cardSlotLaneCount: (_template, slot) => Math.max(1, Number(slot?.span) || 1),
    cardTypeById: () => ({ kind: "io" }),
    deviceHeightForSlotCount: (_count, _startY, minHeight) => minHeight,
    editorPlacementMotionVisualY: () => {
      throw new Error("model-only height must not read placement motion");
    }
  };
  const helpers = [
    "editorPlacementItemByStableId",
    "editorPlacementYForHeight",
    "editorConnectorYForHeight",
    "cardBandGeometryAtY",
    "deviceContentHeightForSlotCounts",
    "deviceHeightForSlotCounts"
  ];
  const api = vm.runInNewContext(`${helpers.map(functionSource).join("\n")}
    ({ deviceContentHeightForSlotCounts, deviceHeightForSlotCounts })`, context);
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

function assertNoAuthoringOverlap(layout) {
  const occupied = { left: new Map(), right: new Map() };
  (layout?.items || []).forEach(item => {
    const sides = item.sideMask === "both" ? ["left", "right"] : [item.sideMask === "right" ? "right" : "left"];
    sides.forEach(side => {
      for (let lane = item.lane; lane < item.lane + item.span; lane += 1) {
        assert.equal(occupied[side].has(lane), false, `${item.id} overlaps ${side} lane ${lane}`);
        occupied[side].set(lane, item.id);
      }
    });
  });
}

function assertEditorPlacementInvariants(api, template, label = "editor layout", context = null) {
  const layout = api.resolveEditorModularLayout(template);
  const occupied = { left: new Map(), right: new Map() };
  const ids = new Set();
  (layout.items || []).forEach(item => {
    assert.ok(!ids.has(item.id), `${label}: ${item.id} should be unique`);
    ids.add(item.id);
    assert.ok(Number.isInteger(item.lane) && item.lane >= 0, `${label}: ${item.id} should have a non-negative integer lane`);
    assert.ok(Number.isInteger(item.span) && item.span >= 1, `${label}: ${item.id} should have an integer span`);
    const sides = item.sideMask === "both" ? ["left", "right"] : [item.sideMask === "right" ? "right" : "left"];
    sides.forEach(side => {
      for (let lane = item.lane; lane < item.lane + item.span; lane += 1) {
        assert.equal(occupied[side].has(lane), false, `${label}: ${item.id} overlaps ${occupied[side].get(lane)} on ${side} lane ${lane}`);
        occupied[side].set(lane, item.id);
      }
    });
  });
  const connectorIds = new Set((template.connectors || []).map(connector => connector.id));
  assert.equal(connectorIds.size, (template.connectors || []).length, `${label}: chassis connector IDs should be unique`);
  (template.connectorRelationships || []).forEach(relationship => {
    (relationship.members || []).forEach(connectorId => {
      assert.ok(connectorIds.has(connectorId), `${label}: relationship ${relationship.id} references surviving connector ${connectorId}`);
    });
    if (relationship.sourceConnectorId) assert.ok(connectorIds.has(relationship.sourceConnectorId), `${label}: relationship source should survive`);
    if (relationship.targetConnectorId) assert.ok(connectorIds.has(relationship.targetConnectorId), `${label}: relationship target should survive`);
  });
  (template.connectors || []).filter(connector => connector.pairedConnectorId).forEach(connector => {
    const pair = (template.connectors || []).find(candidate => candidate.id === connector.pairedConnectorId);
    assert.ok(pair, `${label}: paired connector ${connector.id} should resolve`);
    assert.equal(pair.pairedConnectorId, connector.id, `${label}: paired connector ${connector.id} should be reciprocal`);
  });
  (template.connectors || []).filter(connector => Array.isArray(connector.anchors) && connector.anchors.length).forEach(connector => {
    const primary = connector.anchors.find(anchor => anchor.id === connector.primaryAnchorId)
      || connector.anchors.find(anchor => anchor.primary)
      || connector.anchors[0];
    assert.equal(connector.x, primary.x, `${label}: ${connector.id} primary x parity`);
    assert.equal(connector.y, primary.y, `${label}: ${connector.id} primary y parity`);
  });
  if (typeof api.generatedCardConnectors === "function") {
    const generated = api.generatedCardConnectors(template);
    const generatedIds = new Set();
    generated.forEach(connector => {
      assert.equal(connector.id, `${connector.cardSlotId}__${connector.sourceConnectorId}`, `${label}: generated connector ID contract`);
      assert.equal(generatedIds.has(connector.id), false, `${label}: generated connector IDs should be unique`);
      generatedIds.add(connector.id);
      const slot = (template.cardSlots || []).find(candidate => candidate.id === connector.cardSlotId);
      const card = (template.cardTypes || []).find(candidate => candidate.id === slot?.installedCardTypeId);
      assert.ok(slot && card?.connectors?.some(source => source.id === connector.sourceConnectorId), `${label}: generated connector source should resolve`);
      const primary = (connector.anchors || []).find(anchor => anchor.id === connector.primaryAnchorId)
        || (connector.anchors || []).find(anchor => anchor.primary)
        || connector.anchors?.[0];
      assert.ok(primary, `${label}: generated connector ${connector.id} should have an installed anchor`);
      assert.equal(connector.x, primary.x, `${label}: generated connector ${connector.id} primary x parity`);
      assert.equal(connector.y, primary.y, `${label}: generated connector ${connector.id} primary y parity`);
    });
  }
  if (context) {
    const selectedIds = [...(context.editorSelectedNodeIds || [])];
    selectedIds.forEach(id => assert.ok(connectorIds.has(id), `${label}: selected connector ${id} should survive`));
    if (Number.isInteger(context.editorSelectedNodeIndex)) {
      const indexed = template.connectors?.[context.editorSelectedNodeIndex];
      assert.ok(indexed && selectedIds.includes(indexed.id), `${label}: primary connector index should identify a selected stable ID`);
    }
    const selectedCardIndexes = [...(context.editorSelectedCardNodeIds || [])];
    const selectedCard = template.cardTypes?.[context.editorCardIndex];
    selectedCardIndexes.forEach(index => {
      assert.ok(Number.isInteger(Number(index)) && selectedCard?.connectors?.[Number(index)], `${label}: selected card connector index should survive`);
    });
    (template.connectors || []).filter(connector => connector.faceplateSide).forEach(connector => {
      assert.equal(layout.byId.has(`connector:${connector.id}`), false, `${label}: faceplate-side connector should remain outside modular lanes`);
    });
  }
  const repeated = api.resolveEditorModularLayout(template);
  assert.deepEqual(itemLaneMap(repeated), itemLaneMap(layout), `${label}: static layout should be a fixed point`);
  const requiredBottom = Math.max(0, ...(layout.items || []).map(item => Number(item.y) + Number(item.span) * 54 + 48));
  assert.ok(Number(template.height) >= requiredBottom || Number(template.manualHeight) >= requiredBottom, `${label}: device height should contain resolved content`);
  return layout;
}

function seededGenerator(seed) {
  let state = seed >>> 0;
  return {
    next() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    pick(values) {
      return values[Math.floor(this.next() * values.length) % values.length];
    },
    integer(maxExclusive) {
      return Math.floor(this.next() * Math.max(1, maxExclusive));
    }
  };
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

function resizeConnector(id, sideMask, lane, origin, options = {}) {
  const connector = testConnector(id, sideMask, lane, { v2: true, ...options });
  connector.y = origin + lane * 54;
  if (Array.isArray(connector.anchors)) {
    connector.anchors = connector.anchors.map(anchor => ({ ...anchor, y: connector.y }));
  }
  return connector;
}

function resizePointer(pointerId, x, y, type = "pointermove") {
  return { pointerId, button: 0, clientX: x, clientY: y, point: { x, y }, type };
}

function editorResizeGeometrySnapshot(template) {
  return {
    height: template?.height,
    manualHeight: template?.manualHeight,
    powerDistroFaceY: template?.powerDistroFaceY,
    powerDistroFaceHeight: template?.powerDistroFaceHeight,
    faceImageScale: template?.faceImageScale,
    faceImageScaleX: template?.faceImageScaleX,
    faceImageScaleY: template?.faceImageScaleY,
    faceImageOffsetX: template?.faceImageOffsetX,
    faceImageOffsetY: template?.faceImageOffsetY,
    connectors: (template?.connectors || []).map(connector => ({
      id: connector.id,
      x: connector.x,
      y: connector.y,
      anchors: structuredClone(connector.anchors || [])
    })),
    cardSlots: (template?.cardSlots || []).map(slot => ({ id: slot.id, y: slot.y }))
  };
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
  const addNode = functionSource("addEditorNode");
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
  assert.match(addNode, /context\.targetYForLane\(context\.baselineLayout\.endLane\)/);
  assert.doesNotMatch(addNode, /nextEditorPlacementY|nextAvailableConnectorY|normalizeConnectorRows/);
  assert.doesNotMatch(INDEX_HTML, /function nextEditorSlotY\(/);
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
  assert.match(functionSource("bindEditorInteractionSvg"), /lostpointercapture"[\s\S]*cancelEditorResizeSession\(event\)[\s\S]*cancelEditorStableDrags\(event\)/);
  assert.match(functionSource("cancelEditorInteraction"), /if \(cancelEditorStableDrags\(event\)\) return;/);
  assert.match(functionSource("stopEditorNodeDrag"), /commitEditorStablePlacementDrag\(template, completedDrag/);
  assert.match(functionSource("startEditorNodeDrag"), /createEditorCompositeConnectorDragSession\(template/);
  assert.match(functionSource("moveEditorNode"), /resolveEditorCompactPlacementDragMove\(editorNodeDrag, event\.clientY\)/);
  assert.doesNotMatch(functionSource("moveEditorNode"), /targetLaneWithHysteresis|resolveModularCompositeInsertionDrag/);
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
  const fillSlotById = functionSource("fillEditorSlotById");
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

  [addNode, fillSlotById, removeNode, applyLed, applyPowerDistro, addEthernet, installCard, addCardSlot, removeCardSlot].forEach(source => {
    assert.match(source, /commitEditorStructuralEdit\(template/);
  });
  assert.match(fillSlot, /fillEditorSlotById\(connectorId, type\)/);
  assert.doesNotMatch(applyEthernet, /commitEditorStructuralEdit\(template/);
  assert.doesNotMatch(ensureNetworkPair, /normalizeMixedDeviceRows|normalizeConnectorRows/);
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
  assert.match(addCardSlot, /createModularAuthoringInsertionSession\(context\.baselineLayout\.items/);
  assert.match(addCardSlot, /resolveModularAuthoringInsertion\(insertionSession, boundaryIndex/);
  assert.match(addCardSlot, /hardTargets: Object\.fromEntries\(resolvedInsertion\.items/);
  assert.match(removeNode, /removeIds: \[\.{3}idsToRemove\]\.map\(id => `connector:\$\{id\}`\)/);
  assert.match(removeCardSlot, /removeIds: \[`card:\$\{slotId\}`\]/);
  assert.match(fillSlotById, /applyEditorConnectorTypeToDraft\(draft, connectorId, type/);
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

function assertDefaultNodeAppend(harness, direction, options = {}) {
  const { api, template, context, counters } = harness;
  const baseline = api.resolveEditorModularLayout(template);
  const before = structuredClone(template);
  const existingIds = new Set(before.connectors.map(connector => connector.id));
  api.addEditorNode(direction, options);
  const created = template.connectors.filter(connector => !existingIds.has(connector.id));
  assert.ok(created.length > 0);
  const expected = { ...itemLaneMap(baseline) };
  for (const connector of created) {
    expected[`connector:${connector.id}`] = baseline.endLane;
    assert.equal(connector.y, context.connectorStartYForTemplate(template) + baseline.endLane * 54);
    if (connector.anchors) assert.equal(connector.anchors.find(anchor => anchor.id === connector.primaryAnchorId).y, connector.y);
  }
  const resolved = api.resolveEditorModularLayout(template);
  assert.deepEqual(itemLaneMap(resolved), expected);
  assert.equal(resolved.endLane, baseline.endLane + 1);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), expected, "static-layout fixed point");
  for (const original of before.connectors) {
    const current = template.connectors.find(connector => connector.id === original.id);
    assert.equal(current.x, original.x);
    assert.equal(current.y, original.y);
    assert.deepEqual(current.anchors.map(({ id, x, y }) => ({ id, x, y })), original.anchors.map(({ id, x, y }) => ({ id, x, y })));
    for (const key of ["nameText", "pairedConnectorId", "networkGroupId", "infoFields"]) {
      assert.deepEqual(current[key], original[key]);
    }
  }
  assert.deepEqual(template.cardSlots, before.cardSlots);
  assert.deepEqual(template.cardTypes, before.cardTypes);
  assert.deepEqual(template.connectorRelationships, before.connectorRelationships);
  assert.deepEqual([...context.editorSelectedNodeIds], [created[0].id]);
  const edit = counters.edits.at(-1);
  assert.ok(edit.upserts.every(item => item.hard && item.span === 1 && item.targetLane === baseline.endLane));
  assert.equal(counters.normalizationCalls, 0, "no legacy row normalizer");
  return created;
}

test("Device Editor default append starts an empty device at lane zero", () => {
  const h = structuralEditorHarness();
  const [created] = assertDefaultNodeAppend(h, "input");
  assert.equal(created.empty, true);
  assert.equal(created.y, h.context.connectorStartYForTemplate(h.template));
  assert.deepEqual(itemLaneMap(h.api.resolveEditorModularLayout(h.template)), { "connector:input-slot-1": 0 });
});

for (const [direction, occupiedSide, prefix] of [["input", "right", "out"], ["output", "left", "in"]]) {
  test(`Device Editor default append ${direction} uses the opposite side global end`, () => {
    const h = structuralEditorHarness({ connectors: ["a", "b", "c"].map((id, lane) => testConnector(`${prefix}-${id}`, occupiedSide, lane, { v2: true })) });
    assert.deepEqual(itemLaneMap(h.api.resolveEditorModularLayout(h.template)), {
      [`connector:${prefix}-a`]: 0, [`connector:${prefix}-b`]: 1, [`connector:${prefix}-c`]: 2
    });
    assertDefaultNodeAppend(h, direction);
    assert.deepEqual(itemLaneMap(h.api.resolveEditorModularLayout(h.template)), {
      [`connector:${prefix}-a`]: 0, [`connector:${prefix}-b`]: 1, [`connector:${prefix}-c`]: 2,
      [`connector:${direction}-slot-1`]: 3
    });
  });
}

test("Device Editor default append leaves earlier gaps and network rows in place", () => {
  const h = structuralEditorHarness({ connectors: [
    testConnector("network", "both", 0, { v2: true, type: "ethernet" }),
    testConnector("later", "left", 4, { v2: true })
  ] });
  assertDefaultNodeAppend(h, "input");
  assert.deepEqual(itemLaneMap(h.api.resolveEditorModularLayout(h.template)), {
    "connector:network": 0, "connector:later": 4, "connector:input-slot-3": 5
  });
});

for (const direction of ["input", "output"]) {
  test(`Device Editor default append ${direction} follows mixed connectors and full installed card span`, () => {
    const h = structuralEditorHarness({
      connectors: [testConnector("left", "left", 0, { v2: true }), testConnector("right", "right", 0, { v2: true }), testConnector("both", "both", 2, { v2: true })],
      cardTypes: [{ id: "io-card", name: "I/O", kind: "io", connectors: [
        testConnector("card-a", "left", 0, { v2: true }), testConnector("card-b", "left", 1, { v2: true }), testConnector("card-c", "right", 0, { v2: true })
      ] }],
      cardSlots: [{ id: "slot", installedCardTypeId: "io-card", y: 262, connectorOverrides: { "card-a": { nameText: "Custom input" } } }]
    });
    const baseline = h.api.resolveEditorModularLayout(h.template);
    assert.deepEqual(itemLaneMap(baseline), { "connector:left": 0, "connector:right": 0, "connector:both": 2, "card:slot": 3 });
    assert.equal(baseline.endLane, 7);
    assertDefaultNodeAppend(h, direction);
  });
}

test("Device Editor default append preserves shared-bus members, anchors and relationship data", () => {
  const h = structuralEditorHarness({
    connectors: [0, 1, 2, 3].map(lane => testConnector(`bus-${lane}`, "right", lane, { v2: true, nameText: `SDI ${lane + 1}` })),
    connectorRelationships: [{ id: "bus", type: "shared-bus", members: ["bus-0", "bus-1", "bus-2", "bus-3"], outputMode: "and" }]
  });
  assertDefaultNodeAppend(h, "input");
  assert.equal(h.template.connectors.at(-1).y, 316);
});

test("Device Editor default append repeated additions never move earlier rows", () => {
  const h = structuralEditorHarness();
  for (let lane = 0; lane < 8; lane += 1) {
    const [created] = assertDefaultNodeAppend(h, lane % 2 ? "output" : "input");
    assert.equal(created.y, 100 + lane * 54);
  }
  assert.equal(h.counters.structuralSessions, 8);
  assert.equal(h.counters.solverCalls, 8);
});

for (const y of [null, NaN, Infinity, -Infinity]) {
  test(`Device Editor default append treats ${String(y)} as no finite explicit Y`, () => {
    assertDefaultNodeAppend(structuralEditorHarness({ connectors: [testConnector("last", "right", 2, { v2: true })] }), "input", { y });
  });
}

test("Device Editor default append uses dynamic faceplate and Power Distro origins", () => {
  for (const fields of [{ faceImage: "custom.png", faceImageStartY: 320 }, { isPowerDistro: true, powerDistroStartY: 550 }]) {
    const h = structuralEditorHarness(fields);
    assertDefaultNodeAppend(h, "input");
    assertDefaultNodeAppend(h, "output");
  }
});

test("Device Editor default append typed and paired network additions begin at the global end", () => {
  for (const [version, type, count] of [[2, "hdmi", 1], [2, "ethernet", 1], [1, "ethernet", 2]]) {
    const h = structuralEditorHarness({ deviceDefinitionVersion: version, schemaVersion: version,
      connectors: [testConnector("last-output", "right", 2, { v2: true })] });
    const created = assertDefaultNodeAppend(h, "input", { type });
    assert.equal(created.length, count);
    assert.equal(created[0].type, type);
    assert.equal(created[0].empty, false);
    if (count === 2) {
      assert.equal(created[0].pairedConnectorId, created[1].id);
      assert.equal(created[1].pairedConnectorId, created[0].id);
      assert.equal(created[0].networkGroupId, created[1].networkGroupId);
    }
  }
});

test("Device Editor default append grows height only when the appended row needs it", () => {
  const h = structuralEditorHarness({ height: 600 });
  assertDefaultNodeAppend(h, "input");
  assert.equal(h.template.height, 600);
  while (h.api.resolveEditorModularLayout(h.template).endLane < 9) assertDefaultNodeAppend(h, "output");
  assert.equal(h.template.height, h.context.deviceHeightForSlotCounts(h.template));
  assert.ok(h.template.height > 600);
});

test("Device Editor default append validation and post-apply failures restore template, height and selection", () => {
  for (const failure of ["validation", "height"]) {
    const h = structuralEditorHarness({ height: 800, connectors: [testConnector("selected", "left", 2, { v2: true })] });
    h.context.editorSelectedNodeIds = new Set(["selected"]);
    h.context.editorSelectedNodeIndex = 0;
    const before = structuredClone(h.template);
    h.placementModule.forceInvalid = failure === "validation";
    h.context.failDeviceHeightForSlotCounts = failure === "height";
    assert.throws(() => h.api.addEditorNode("input"), failure === "validation" ? /invalid layout/ : /forced device height failure/);
    assert.deepEqual(h.template, before);
    assert.deepEqual([...h.context.editorSelectedNodeIds], ["selected"]);
    assert.equal(h.context.editorSelectedNodeIndex, 0);
    assert.equal(h.counters.previewRenders, 0);
    assert.equal(h.counters.selectedSettingsRenders, 0);
    assert.equal(h.counters.animationSeeds, 0);
  }
});

test("Device Editor append change preserves explicit insertion and faceplate/adapter palette targets", () => {
  const h = structuralEditorHarness({ connectors: [0, 1, 2].map(lane => testConnector(`in-${lane}`, "left", lane, { v2: true })) });
  h.api.addEditorNode("input", { y: 154 });
  assert.deepEqual(itemLaneMap(h.api.resolveEditorModularLayout(h.template)), {
    "connector:in-0": 0, "connector:input-slot-4": 1, "connector:in-1": 2, "connector:in-2": 3
  });
  const face = structuralEditorHarness({ allowFaceplateSide: true, connectors: [testConnector("row", "left", 2, { v2: true })] });
  face.api.addEditorNode("input", { y: 42, type: "hdmi" });
  assert.equal(face.template.connectors.at(-1).faceplateSide, true);
  assert.equal(face.template.connectors.at(-1).y, face.context.faceplateSideConnectorY(face.template));
  assert.deepEqual(itemLaneMap(face.api.resolveEditorModularLayout(face.template)), { "connector:row": 2 });
  const adapter = structuralEditorHarness({ objectType: "adapter", connectors: [testConnector("last", "right", 4, { v2: true })] });
  Object.assign(adapter.context, {
    editorPaletteDragSession: { active: true, connectorType: "hdmi" },
    addEditorNode: adapter.api.addEditorNode
  });
  const drop = runnableIndexFunction("editorDropPointCreatesAdapterNode", adapter.context);
  assert.equal(drop({ point: { x: 0, y: 154 } }), true);
  assert.deepEqual(itemLaneMap(adapter.api.resolveEditorModularLayout(adapter.template)), { "connector:input-slot-1": 1, "connector:last": 4 });
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

test("Device Editor can detach a faceplate-side connector into a normal drag session", () => {
  const front = testConnector("front-io", "left", 0, {
    v2: true,
    faceplateSide: true
  });
  front.y = 42;
  front.anchors = front.anchors.map(anchor => ({ ...anchor, y: 42 }));
  const { api, template } = structuralEditorHarness({
    allowFaceplateSide: true,
    connectors: [
      front,
      testConnector("row-a", "left", 0, { v2: true }),
      testConnector("row-b", "left", 1, { v2: true })
    ],
    cardSlots: []
  });
  const baseline = structuredClone(template);
  const sourceConnector = template.connectors.find(connector => connector.id === "front-io");
  const dragTemplate = api.editorPlacementTemplateForConnectorDrag(template, sourceConnector);

  assert.notEqual(dragTemplate, template);
  assert.equal(sourceConnector.faceplateSide, true);
  assert.equal(dragTemplate.connectors.find(connector => connector.id === "front-io").faceplateSide, false);
  assert.ok(api.resolveEditorModularLayout(dragTemplate).byId.has("connector:front-io"));

  const session = api.createEditorStablePlacementDragSession(dragTemplate, {
    id: "front-io",
    pointerId: 9,
    pointerY: 42,
    pointerClientY: 42
  });
  assert.ok(session, "faceplate-side connector should get a reusable lane insertion session");
  assert.ok(session.lastValidResolvedLayout.byId.has("connector:front-io"));
  assert.deepEqual(template, baseline, "preparing the drag must not mutate the saved faceplate placement");
  assert.match(functionSource("startEditorNodeDrag"), /editorPlacementTemplateForConnectorDrag\(template, connector\)/);
  assert.match(functionSource("startEditorNodeDrag"), /specialTarget: \{ type: "faceplate-side" \}/);
});

test("Device Editor commits a faceplate-side connector into the first normal lane", () => {
  const front = testConnector("front-io", "left", 0, {
    v2: true,
    faceplateSide: true
  });
  front.y = 42;
  front.anchors = front.anchors.map(anchor => ({ ...anchor, y: 42 }));
  const harness = cardDragInteractionHarness({
    allowFaceplateSide: true,
    connectors: [
      front,
      testConnector("row-a", "left", 0, { v2: true }),
      testConnector("row-b", "left", 1, { v2: true })
    ],
    cardSlots: []
  }, { previewScale: .2 });

  const started = harness.startNodeDrag(0, 19);
  const drag = harness.moveNodeToClientY(started, 47 * harness.context.previewScale);
  assert.equal(drag.currentBoundaryIndex, drag.originalBoundaryIndex, "the first lane is the session's original insertion boundary");
  assert.equal(drag.moved, true, "leaving the faceplate must count as a committed move even at the same boundary");

  harness.stopNodeDrag(started);
  const connector = harness.template.connectors.find(item => item.id === "front-io");
  assert.equal(connector.faceplateSide, false);
  assert.equal(connector.y, 100);
  assert.equal(connector.anchors[0].y, 100);
});

test("Device Editor palette drops resolve a nearby empty slot through preview overlays", () => {
  const template = {
    width: 420,
    connectors: [
      { id: "input-slot", direction: "input", empty: true, x: 0, y: 154 },
      { id: "filled-output", direction: "output", empty: false, x: 420, y: 154 },
      { id: "output-slot", direction: "output", empty: true, x: 420, y: 208 }
    ]
  };
  const context = {
    Math,
    Number,
    SLOT_HEIGHT: 54,
    editorActiveTab: "connectors",
    currentEditorTemplate: () => template,
    editorEngineConnectorIdFromEvent: () => "",
    getEditorPreviewPointAtClient: (x, y) => ({ x, y }),
    deviceEditorPreview: {},
    deviceTemplateWidth: device => device.width,
    editorPreviewPositions: () => new Map(),
    editorDisplayAnchorsForConnector: (connector, width, y) => [{
      x: connector.direction === "output" ? width : 0,
      y
    }]
  };
  context.editorPaletteNearestSlotIdAtClient = runnableIndexFunction("editorPaletteNearestSlotIdAtClient", context);
  const api = vm.runInNewContext(`(${functionSource("editorPaletteDropTargetIdFromEvent")})`, context);

  const event = (x, y) => ({ clientX: x, clientY: y, target: { closest: () => null } });
  assert.equal(api(event(20, 176)), "input-slot", "input label/overlay proximity should resolve the empty input slot");
  assert.equal(api(event(400, 230)), "output-slot", "output label/overlay proximity should resolve the empty output slot");
  assert.equal(api(event(420, 154)), "", "geometry fallback must ignore a filled connector");
  assert.equal(api(event(210, 154)), "", "unrelated preview space must not become a slot target");
});

const CEE_DROP_TYPES = [
  "16a-1ph-110v", "16a-1ph", "32a-1ph-110v", "32a-1ph",
  "16a-3ph", "32a-3ph", "63a-3ph", "125a-3ph"
];

function paletteDropHarness({ mode = "engine", scale = 1 } = {}) {
  const { api, context, template, counters } = structuralEditorHarness({
    isPowerDistro: true,
    connectors: [
      { id: "slot-in", direction: "input", displaySide: "left", empty: true, x: 0, y: 154, type: "" },
      { id: "slot-out", direction: "output", displaySide: "right", empty: true, x: 420, y: 154, type: "" }
    ]
  });
  const listeners = () => {
    const callbacks = new Map();
    return {
      callbacks,
      addEventListener(name, callback) { callbacks.set(name, callback); },
      querySelectorAll() { return []; }
    };
  };
  const nodePalette = listeners();
  const cardPalette = listeners();
  const deviceEditorPreview = listeners();
  const deviceEditorPreviewHost = listeners();
  deviceEditorPreviewHost.contains = node => node === deviceEditorPreview || node?.insideHost === true;
  deviceEditorPreviewHost.getBoundingClientRect = () => ({ left: -30 * scale, top: -30 * scale, right: 450 * scale, bottom: 500 * scale });
  const overlayNodes = template.connectors.map(connector => {
    const classes = new Set();
    return {
      dataset: { editorNodeId: connector.id }, classes,
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } }
    };
  });
  deviceEditorPreview.querySelectorAll = selector => selector === "[data-editor-node-id]" ? overlayNodes : [];
  deviceEditorPreview.createSVGPoint = () => ({
    x: 0, y: 0,
    matrixTransform() { return { x: this.x / scale, y: this.y / scale }; }
  });
  deviceEditorPreview.getScreenCTM = () => ({ inverse: () => ({}) });
  deviceEditorPreview.contains = () => false;
  context.nodePalette = nodePalette;
  context.cardPalette = cardPalette;
  context.deviceEditorPreview = deviceEditorPreview;
  context.deviceEditorPreviewHost = deviceEditorPreviewHost;
  context.document = { addEventListener() {} };
  context.editorNodePaletteActive = () => true;
  context.editorEngineConnectorIndexFromEvent = () => -1;
  context.editorEngineConnectorIdFromEvent = () => "";
  context.deviceEditorActivePreviewUsesEngine = () => mode === "engine";
  context.editorEnginePreviewSurface = mode === "engine" ? {
    screenToDeviceLocal: (_id, point) => ({ x: point.x / scale, y: point.y / scale })
  } : null;
  context.deviceEditorEnginePreviewScreenPoint = event => ({ x: event.clientX, y: event.clientY });
  context.editorEnginePreviewLastDeviceId = "test-device";
  context.DEVICE_EDITOR_ENGINE_PREVIEW_DEVICE_ID = "test-device";
  context.plainPoint = point => ({ x: point.x, y: point.y });
  context.editorPreviewPositions = () => new Map();
  context.editorDisplayAnchorsForConnector = (connector, width, y) => [{ x: connector.direction === "output" ? width : 0, y }];
  context.getEditorPreviewPoint = event => ({ x: event.clientX / scale, y: event.clientY / scale });
  context.getEditorPreviewPointAtClient = runnableIndexFunction("getEditorPreviewPointAtClient", context);
  context.editorCardDropTypeId = () => "";
  context.editorDataTransferHasType = (event, type) => event.dataTransfer.types.includes(type);
  context.editorPreviewCanCreateCardSlotFromDrop = () => false;
  context.editorDropPointCreatesAdapterNode = () => false;
  context.fillEditorSlot = api.fillEditorSlot;
  context.fillEditorSlotById = api.fillEditorSlotById;
  context.editorPaletteDragSession = null;
  context.traceEditorDeviceDrop = () => {};
  context.powerPlugCanExistOnSide = powerPlugCanExistOnSide;
  context.powerPlugImageForConnector = powerPlugImageForConnector;
  context.isPowerPlugConnector = isPowerPlugConnector;
  context.deviceHeightForSlotCounts = device => {
    const model = normalizePowerDistroForEngine({ template: device, width: device.width, connectors: device.connectors });
    return powerDistroRequiredHeight(model, device.connectors, 240);
  };
  CEE_DROP_TYPES.forEach(type => { context.cableTypes[type] = { label: type, color: "#d33" }; });
  context.editorPaletteDropTargetIdFromEvent = runnableIndexFunction("editorPaletteDropTargetIdFromEvent", context);
  context.editorPaletteNearestSlotIdAtClient = runnableIndexFunction("editorPaletteNearestSlotIdAtClient", context);
  context.resolveEditorPaletteDrop = runnableIndexFunction("resolveEditorPaletteDrop", context);
  context.setEditorPaletteDropCandidate = runnableIndexFunction("setEditorPaletteDropCandidate", context);
  context.clearEditorPaletteDragSession = runnableIndexFunction("clearEditorPaletteDragSession", context);
  vm.runInNewContext(sourceSlice(INDEX_HTML, '    nodePalette.addEventListener("dragstart"', '    function bindEditorInteractionSvg'), context);
  const chip = type => ({
    dataset: { nodeType: type }, offsetWidth: 80, offsetHeight: 20,
    classList: { add() {}, remove() {} }
  });
  function transfer() {
    const values = new Map();
    return {
      types: [], effectAllowed: "", dropEffect: "",
      setData(type, value) { values.set(type, value); this.types = [...values.keys()]; },
      getData(type) { return values.get(type) || ""; },
      setDragImage() {}
    };
  }
  function event(dataTransfer, target, x, y) {
    return {
      dataTransfer, target, clientX: x * scale, clientY: y * scale,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }
    };
  }
  function target(connectorId, kind = "circle") {
    const index = template.connectors.findIndex(connector => connector.id === connectorId);
    return {
      kind,
      closest(selector) {
        if (selector === "[data-editor-node]") return kind === "nearby" ? null : { dataset: { editorNode: String(index) } };
        if (selector === "[data-editor-node-id]") return kind === "nearby" ? null : { dataset: { editorNodeId: connectorId } };
        return null;
      }
    };
  }
  function drag(type, connectorId, kind = "circle", { x, y, beforeDrop, protectedOver = true } = {}) {
    const dataTransfer = transfer();
    nodePalette.callbacks.get("dragstart")(event(dataTransfer, { closest: () => chip(type) }, 0, 0));
    const destination = connectorId ? target(connectorId, kind) : { closest: () => null };
    const direction = template.connectors.find(connector => connector.id === connectorId)?.direction || "input";
    const localX = x ?? (direction === "output" ? 420 : 0);
    const localY = y ?? 154;
    const over = event(dataTransfer, destination, localX, localY);
    if (protectedOver) over.dataTransfer = { ...dataTransfer, getData: () => "" };
    deviceEditorPreviewHost.callbacks.get("dragover")(over);
    const overCandidateId = context.editorPaletteDragSession?.candidate?.connectorId || "";
    const overHighlighted = overlayNodes.find(node => node.dataset.editorNodeId === connectorId)?.classes.has("editor-palette-drop-target") === true;
    beforeDrop?.(dataTransfer);
    const drop = event(dataTransfer, destination, localX, localY);
    deviceEditorPreviewHost.callbacks.get("drop")(drop);
    nodePalette.callbacks.get("dragend")(drop);
    const highlightCleared = overlayNodes.every(node => !node.classes.has("editor-palette-drop-target"));
    return { over, drop, overCandidateId, overHighlighted, highlightCleared };
  }
  function cancel(type, connectorId) {
    const dataTransfer = transfer();
    nodePalette.callbacks.get("dragstart")(event(dataTransfer, { closest: () => chip(type) }, 0, 0));
    const over = event({ ...dataTransfer, getData: () => "" }, target(connectorId), 0, 154);
    deviceEditorPreviewHost.callbacks.get("dragover")(over);
    const highlighted = context.editorPaletteDragSession?.candidate?.connectorId === connectorId;
    nodePalette.callbacks.get("dragend")(over);
    return { highlighted, cleared: context.editorPaletteDragSession === null };
  }
  function nativeDrag(type, connectorId, { dropOnRoot = false, nullRelatedTarget = false, protectedDrop = false, beforeDrop, destinationId = connectorId, direction = "input", overKind = "circle", dropX } = {}) {
    const dataTransfer = transfer();
    const thumbnail = { closest: () => chip(type), tagName: "IMG" };
    nodePalette.callbacks.get("dragstart")(event(dataTransfer, thumbnail, 0, 0));
    const x = direction === "output" ? 420 : 0;
    const to = id => overKind === "root" ? { closest: () => null, tagName: "DIV" } : target(id, overKind === "overlay" ? "nearby" : overKind);
    const root = { closest: () => null, tagName: "DIV" };
    deviceEditorPreviewHost.callbacks.get("dragenter")(event(dataTransfer, root, x, 154));
    const over = event({ ...dataTransfer, getData: () => "" }, to(connectorId), x, 154);
    deviceEditorPreviewHost.callbacks.get("dragover")(over);
    deviceEditorPreviewHost.callbacks.get("dragleave")({ ...event(dataTransfer, to(connectorId), x, 154), relatedTarget: nullRelatedTarget ? null : { insideHost: true } });
    const candidateAfterInternalLeave = context.editorPaletteDragSession?.candidate?.connectorId || "";
    deviceEditorPreviewHost.callbacks.get("dragenter")(event(dataTransfer, to(destinationId), x, 154));
    deviceEditorPreviewHost.callbacks.get("dragover")(event({ ...dataTransfer, getData: () => "" }, to(destinationId), x, 154));
    beforeDrop?.(dataTransfer);
    const drop = event(protectedDrop ? { ...dataTransfer, getData: () => "", types: [] } : dataTransfer, dropOnRoot ? root : to(destinationId), dropX ?? x, 154);
    deviceEditorPreviewHost.callbacks.get("drop")(drop);
    nodePalette.callbacks.get("dragend")(drop);
    return { drop, over, candidateAfterInternalLeave };
  }
  return { api, context, template, counters, drag, cancel, nativeDrag, target, deviceEditorPreview, deviceEditorPreviewHost, nodePalette };
}

test("CEE palette drag/drop commits all input and output assets in Engine and Legacy previews", () => {
  let cases = 0;
  for (const mode of ["engine", "legacy"]) {
    for (const scale of [1, 0.25]) {
      for (const type of CEE_DROP_TYPES) {
        for (const direction of ["input", "output"]) {
          const id = direction === "input" ? "slot-in" : "slot-out";
          for (const kind of ["circle", "label", "nearby"]) {
            const h = paletteDropHarness({ mode, scale });
            const result = h.drag(type, id, kind, {
              x: kind === "nearby" ? (direction === "input" ? 18 : 402) : undefined,
              y: kind === "nearby" ? 174 : undefined
            });
            const connector = h.template.connectors.find(item => item.id === id);
            assert.equal(result.overCandidateId, id, `${mode}/${scale}/${type}/${direction}/${kind}: dragover targets the same stable ID`);
            assert.equal(result.overHighlighted, true);
            assert.equal(result.drop.defaultPrevented, true, `${mode}/${scale}/${type}/${direction}: drop accepted`);
            assert.equal(connector.type, type);
            assert.equal(connector.empty, false);
            assert.equal(h.template.connectors.length, 2);
            assert.equal(connector.direction, direction);
            assert.equal(connector.displaySide, direction === "input" ? "left" : "right");
            assert.equal(connector.y, 154);
            assert.equal(connector.anchors.find(anchor => anchor.id === connector.primaryAnchorId)?.y, 154);
            const model = normalizePowerDistroForEngine({ template: h.template, width: 420, connectors: h.template.connectors });
            assert.equal(model.plugEntries.length, 1);
            assert.equal(model.plugEntries[0].connectorId, id);
            assert.equal(model.plugEntries[0].href, `Nodes/PowerPlugs/${POWER_PLUG_TYPES[type][direction]}`);
            assert.ok(h.template.height >= model.faceRect.y + model.faceRect.height + 22);
            assert.equal(h.counters.previewRenders, 1);
            assert.equal(h.counters.normalizationCalls, 0);
            assert.equal(h.counters.solverCalls, 0, "type-only fill must not invoke the placement solver");
            assert.deepEqual([...h.context.editorSelectedNodeIds], [id]);
            assert.equal(h.context.editorPaletteDragSession, null);
            assert.equal(result.highlightCleared, true);
            cases++;
          }
        }
      }
    }
  }
  assert.equal(cases, 192);
});

test("palette drop preserves stable IDs through reordering and rejects filled slots", () => {
  const h = paletteDropHarness();
  const before = structuredClone(h.template.connectors);
  h.drag("32a-3ph", "slot-in", "circle", {
    beforeDrop() { h.template.connectors.reverse(); }
  });
  assert.equal(h.template.connectors.find(item => item.id === "slot-in").type, "32a-3ph");
  assert.equal(h.template.connectors.find(item => item.id === "slot-out").empty, true);
  const renderCount = h.counters.previewRenders;
  h.drag("16a-1ph", "slot-in");
  assert.equal(h.counters.previewRenders, renderCount, "filled target must not mutate");
  assert.notDeepEqual(h.template.connectors, before);
});

test("palette drop validates current slot and transfer before any mutation", () => {
  const cases = [
    { name: "removed target", action(h) { return h.drag("32a-1ph", "slot-in", "circle", { beforeDrop() { h.template.connectors = h.template.connectors.filter(item => item.id !== "slot-in"); } }); } },
    { name: "filled target", action(h) { return h.drag("32a-1ph", "slot-in", "circle", { beforeDrop() { h.template.connectors[0].empty = false; } }); } },
    { name: "wrong tab", action(h) { h.context.editorActiveTab = "device"; return h.drag("32a-1ph", "slot-in"); } },
    { name: "bad type", action(h) { return h.drag("not-a-connector", "slot-in"); } },
    { name: "unrelated space", action(h) { return h.drag("32a-1ph", null, "nearby", { x: 210, y: 300 }); } }
  ];
  for (const scenario of cases) {
    const h = paletteDropHarness();
    const result = scenario.action(h);
    assert.equal(result.drop.defaultPrevented, false, scenario.name);
    assert.equal(h.counters.previewRenders, 0, scenario.name);
    assert.equal(h.counters.structuralSessions, 0, scenario.name);
    assert.equal(h.context.editorPaletteDragSession, null, scenario.name);
  }
});

test("palette drag cancellation clears the slot highlight without editing", () => {
  const h = paletteDropHarness();
  const result = h.cancel("16a-1ph-110v", "slot-in");
  assert.equal(result.highlighted, true);
  assert.equal(result.cleared, true);
  assert.equal(h.context.editorPaletteDragSession, null);
  assert.equal(h.counters.structuralSessions, 0);
  assert.equal(h.counters.previewRenders, 0);
});

test("native palette lifecycle is owned by the preview host and keeps an accepted candidate", () => {
  const h = paletteDropHarness();
  assert.ok(h.deviceEditorPreviewHost?.callbacks.has("dragenter"), "stable preview host should own native dragenter");
  assert.ok(h.deviceEditorPreviewHost.callbacks.has("dragover"), "stable preview host should own native dragover");
  assert.ok(h.deviceEditorPreviewHost.callbacks.has("dragleave"), "stable preview host should own native dragleave");
  assert.ok(h.deviceEditorPreviewHost.callbacks.has("drop"), "stable preview host should own native drop");
  const result = h.nativeDrag("32a-3ph", "slot-in", { dropOnRoot: true, nullRelatedTarget: true, protectedDrop: true });
  assert.equal(result.candidateAfterInternalLeave, "slot-in");
  assert.equal(result.drop.defaultPrevented, true);
  assert.equal(h.template.connectors.find(item => item.id === "slot-in").type, "32a-3ph");
  assert.equal(h.counters.previewRenders, 1);
  assert.equal(h.counters.structuralSessions, 1);
  assert.equal(h.context.editorPaletteDragSession, null);
});

test("PD palette type-fill authorizes the faceplate-driven modular-origin rebase", () => {
  const h = paletteDropHarness();
  h.context.connectorStartYForTemplate = device => device.connectors.some(connector => connector.type === "32a-3ph") ? 130 : 100;
  const result = h.nativeDrag("32a-3ph", "slot-in", { dropOnRoot: true, nullRelatedTarget: true, protectedDrop: true });
  assert.equal(result.drop.defaultPrevented, true);
  assert.equal(h.template.connectors.find(item => item.id === "slot-in").type, "32a-3ph");
  assert.equal(h.template.connectors.find(item => item.id === "slot-in").y, 184);
  assert.equal(h.template.connectors.find(item => item.id === "slot-in").anchors[0].y, 184);
  assert.equal(h.counters.structuralSessions, 1);
  assert.equal(h.counters.previewRenders, 1);
});

test("removing a real catalog plug rebases ordinary nodes once and preserves their anchors", () => {
  const h = structuralEditorHarness({ isPowerDistro: true, connectors: [
    testConnector("plug", "left", 0, { v2: true, type: "125a-3ph" }),
    testConnector("ordinary", "right", 1, { v2: true, type: "sdi", customText: "keep" })
  ] });
  h.context.connectorStartYForTemplate = device => {
    const model = normalizePowerDistroForEngine({ template: device, width: device.width, connectors: device.connectors });
    return model.faceRect.y + model.faceRect.height + 36;
  };
  const origin = h.context.connectorStartYForTemplate(h.template);
  h.template.connectors.forEach((connector, index) => {
    connector.y = origin + index * 54;
    connector.anchors.forEach(anchor => { anchor.y = connector.y; });
  });
  h.api.removeEditorNode(0);
  assert.equal(h.template.connectors.length, 1);
  const remaining = h.template.connectors[0];
  assert.equal(remaining.id, "ordinary");
  assert.equal(remaining.customText, "keep");
  assert.equal(remaining.y, 38 + 78 + 36 + 54);
  assert.equal(remaining.anchors[0].y, remaining.y);
  assert.equal(h.counters.structuralSessions, 1);
});

test("Power Distro motion completion refreshes the committed plug artwork once", () => {
  for (const isPowerDistro of [true, false]) {
    const renders = [];
    const context = {
      editorPlacementMotionScheduler: { cancel() {} }, editorPlacementMotionSampleCache: null,
      editorPlacementMotionClearWhenSettled: true, editorEngineDynamicCardArtworkActive: false,
      editorPlacementMotionState: { entries: new Map([["connector:powerlock", {}]]) },
      editorPlacementMotionPreviewLock: null,
      currentEditorTemplate: () => ({ isPowerDistro }),
      deviceEditorPlacementMotionModule: { clearPlacementMotion() {} },
      setEditorEngineDynamicCardArtworkActive() {},
      deviceEditorModal: { classList: { contains: () => false } },
      renderDeviceEditorPreview: options => renders.push(options)
    };
    const clear = runnableIndexFunction("clearEditorPlacementMotion", context);
    clear({ renderFinal: true });
    clear({ renderFinal: true });
    assert.equal(renders.length, isPowerDistro ? 1 : 0);
    if (isPowerDistro) assert.equal(renders[0].refreshTexture, true);
  }
});

test("catalog type changes grow and shrink the faceplate without losing ordinary lanes or selection", () => {
  const h = structuralEditorHarness({ isPowerDistro: true, connectors: [
    testConnector("plug", "left", 0, { v2: true, type: "iec", powerPlug: { manual: false, x: 0, y: 0 } }),
    testConnector("ordinary", "right", 1, { v2: true, type: "sdi", customText: "per-device override" })
  ] });
  h.context.isPowerPlugConnector = connector => Boolean(powerPlugImageForConnector(connector));
  h.context.connectorStartYForTemplate = device => {
    const model = normalizePowerDistroForEngine({ template: device, width: device.width, connectors: device.connectors });
    return model.faceRect.y + model.faceRect.height + 36;
  };
  const origin = h.context.connectorStartYForTemplate(h.template);
  h.template.connectors.forEach((c, i) => { c.y = origin + i * 54; c.anchors.forEach(a => { a.y = c.y; }); });
  for (const type of [...Object.keys(POWER_PLUG_TYPES), ...Object.keys(POWER_PLUG_TYPES).reverse()]) {
    h.context.cableTypes[type] = { label: type, color: "#ff0000" };
    assert.equal(h.api.fillEditorSlotById("plug", type), true);
    const start = h.context.connectorStartYForTemplate(h.template);
    const [plug, ordinary] = h.template.connectors;
    assert.equal(plug.id, "plug");
    assert.equal(plug.type, type);
    assert.equal(plug.y, start);
    assert.equal(ordinary.y, start + 54);
    assert.equal(ordinary.customText, "per-device override");
    assert.equal(ordinary.anchors[0].y, ordinary.y);
    assert.ok(h.context.editorSelectedNodeIds.has("plug"));
    assert.deepEqual(JSON.parse(JSON.stringify(plug.powerPlug)), { manual: false, x: 0, y: 0 });
  }
});

test("protected native drops keep accepted input and output IDs across preview modes and Fit scales", () => {
  let cases = 0;
  for (const mode of ["engine", "legacy"]) for (const scale of [1, 0.25]) {
    for (const type of ["16a-1ph-110v", "32a-1ph", "32a-3ph", "125a-3ph"]) {
      for (const direction of ["input", "output"]) {
        const h = paletteDropHarness({ mode, scale });
        const id = direction === "input" ? "slot-in" : "slot-out";
        const result = h.nativeDrag(type, id, { dropOnRoot: true, nullRelatedTarget: true, protectedDrop: true, direction });
        assert.equal(result.candidateAfterInternalLeave, id);
        assert.equal(result.drop.defaultPrevented, true);
        assert.equal(h.template.connectors.find(item => item.id === id).type, type);
        assert.equal(h.counters.structuralSessions, 1);
        assert.equal(h.counters.previewRenders, 1);
        assert.equal(h.context.editorPaletteDragSession, null);
        cases++;
      }
    }
  }
  assert.equal(cases, 32);
});

test("last dragover wins, but drop root cannot independently change the accepted slot", () => {
  const h = paletteDropHarness();
  const result = h.nativeDrag("32a-3ph", "slot-in", { destinationId: "slot-out", dropOnRoot: true, protectedDrop: true, dropX: 0 });
  assert.equal(result.drop.defaultPrevented, true);
  assert.equal(h.template.connectors.find(item => item.id === "slot-out").type, "32a-3ph", "accepted dragover ID wins over drop coordinates");
  assert.equal(h.template.connectors.find(item => item.id === "slot-in").empty, true);
  assert.equal(h.counters.structuralSessions, 1);
});

test("native drop revalidates candidate after reorder, removal, or filling", () => {
  for (const mutation of ["reorder", "remove", "fill"]) {
    const h = paletteDropHarness();
    const result = h.nativeDrag("32a-3ph", "slot-in", {
      dropOnRoot: true, protectedDrop: true,
      beforeDrop() {
        if (mutation === "reorder") h.template.connectors.reverse();
        if (mutation === "remove") h.template.connectors = h.template.connectors.filter(item => item.id !== "slot-in");
        if (mutation === "fill") h.template.connectors.find(item => item.id === "slot-in").empty = false;
      }
    });
    assert.equal(result.drop.defaultPrevented, mutation === "reorder", mutation);
    assert.equal(h.counters.structuralSessions, mutation === "reorder" ? 1 : 0, mutation);
    assert.equal(h.context.editorPaletteDragSession, null);
  }
});

test("genuine preview exit and dragend cancel without mutation", () => {
  const h = paletteDropHarness();
  const transfer = { types: [], setData() {}, setDragImage() {}, getData() { return ""; } };
  const chip = { dataset: { nodeType: "32a-3ph" }, offsetWidth: 80, offsetHeight: 20, classList: { add() {}, remove() {} } };
  const event = (target, x, y) => ({ target, clientX: x, clientY: y, dataTransfer: transfer, preventDefault() {} });
  h.nodePalette.callbacks.get("dragstart")(event({ closest: () => chip }, 0, 0));
  h.deviceEditorPreviewHost.callbacks.get("dragover")(event(h.target("slot-in"), 0, 154));
  assert.equal(h.context.editorPaletteDragSession?.candidate?.connectorId, "slot-in");
  h.deviceEditorPreviewHost.callbacks.get("dragleave")({ ...event(h.target("slot-in"), 600, 600), relatedTarget: null });
  assert.equal(h.context.editorPaletteDragSession, null);
  h.nodePalette.callbacks.get("dragend")(event(h.target("slot-in"), 600, 600));
  assert.equal(h.counters.structuralSessions, 0);
});

test("preview host owns bubbling sources and thumbnails are not independent drag sources", () => {
  assert.match(INDEX_HTML, /class="editor-preview" id="deviceEditorPreviewHost"[\s\S]*?<svg id="deviceEditorPreview"/);
  assert.match(INDEX_HTML, /class="node-thumbnail" draggable="false"/);
  assert.match(INDEX_HTML, /class="node-chip" draggable="false"/);
  for (const kind of ["circle", "label", "overlay", "root"]) {
    const h = paletteDropHarness();
    // Controlled bubbling: host handlers receive each descendant target unchanged.
    const result = h.nativeDrag("32a-3ph", "slot-in", { overKind: kind, dropOnRoot: kind === "root", nullRelatedTarget: true, protectedDrop: true });
    assert.equal(result.drop.defaultPrevented, true, kind);
    assert.equal(h.template.connectors.find(item => item.id === "slot-in").type, "32a-3ph", kind);
  }
});

test("stable host preserves card and adapter drops and palette reordering", () => {
  const h = paletteDropHarness();
  let installed = 0;
  let adapted = 0;
  let reordered = 0;
  h.context.editorCardDropTypeId = () => "card-id";
  h.context.installCardInSlot = (index, type) => { assert.equal(index, 2); assert.equal(type, "card-id"); installed++; };
  h.context.editorPreviewCanCreateCardSlotFromDrop = () => true;
  const cardTarget = {
    closest(selector) { return selector === "[data-editor-card-slot]" ? { dataset: { editorCardSlot: "2" } } : null; }
  };
  const event = (target, types, x = 210, y = 154) => ({
    target, clientX: x, clientY: y, dataTransfer: { types, dropEffect: "", getData: () => "card-id" },
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }
  });
  const cardOver = event(cardTarget, ["application/x-av-card-type"]);
  h.deviceEditorPreviewHost.callbacks.get("dragover")(cardOver);
  const cardDrop = event(cardTarget, ["application/x-av-card-type"]);
  h.deviceEditorPreviewHost.callbacks.get("drop")(cardDrop);
  assert.equal(cardOver.defaultPrevented, true);
  assert.equal(cardDrop.defaultPrevented, true);
  assert.equal(installed, 1);

  h.context.editorCardDropTypeId = () => "";
  h.context.editorDropPointCreatesAdapterNode = () => { adapted++; return true; };
  const source = { dataset: { nodeType: "32a-3ph" }, offsetWidth: 80, offsetHeight: 20, classList: { add() {}, remove() {} } };
  const transfer = { types: [], setData(type) { this.types.push(type); }, setDragImage() {}, getData: () => "" };
  h.nodePalette.callbacks.get("dragstart")({ ...event({ closest: () => source }, [], 0, 0), dataTransfer: transfer });
  const bodyOver = { ...event({ closest: () => null }, transfer.types), dataTransfer: transfer };
  h.deviceEditorPreviewHost.callbacks.get("dragover")(bodyOver);
  h.deviceEditorPreviewHost.callbacks.get("drop")(bodyOver);
  assert.equal(adapted, 1);
  assert.equal(h.context.editorPaletteDragSession, null);

  h.context.moveNodeType = (moving, destination) => { assert.equal(moving, "32a-3ph"); assert.equal(destination, "16a-1ph"); reordered++; };
  const reorderEvent = {
    ...event({ closest: () => ({ dataset: { nodeType: "16a-1ph" }, classList: { remove() {} } }) }, ["application/x-av-node-reorder"]),
    dataTransfer: { getData: () => "32a-3ph" }
  };
  h.nodePalette.callbacks.get("drop")(reorderEvent);
  assert.equal(reordered, 1);
});

test("opt-in Device Editor drop trace exposes bounded native event diagnostics", () => {
  const context = {
    editorDeviceDropDebugEnabled: true,
    editorDeviceDropEvents: [],
    editorPaletteDragSession: { connectorType: "32a-3ph", candidate: { connectorId: "slot-in" } },
    APP_BUILD_ID: "iteration54-20-4-native-device-editor-palette-drops",
    window: {}
  };
  const trace = runnableIndexFunction("traceEditorDeviceDrop", context);
  const event = { target: { tagName: "circle", id: "node", getAttribute: () => "editor-node" }, dataTransfer: { types: ["application/x-av-node-type"] } };
  trace("dragover", event, "candidate-accepted", true, false);
  const entry = context.window.__avDesignerDeviceDropDebug.events[0];
  assert.equal(entry.candidateId, "slot-in");
  assert.equal(entry.connectorType, "32a-3ph");
  assert.equal(entry.prevented, true);
  assert.equal(entry.target, "circle#node.editor-node");
  for (let index = 0; index < 90; index++) trace("dragover", event, "candidate-accepted", true, false);
  assert.equal(context.window.__avDesignerDeviceDropDebug.events.length, 80);
  context.editorDeviceDropDebugEnabled = false;
  trace("drop", event, "slot-filled", true, true);
  assert.equal(context.window.__avDesignerDeviceDropDebug.events.length, 80);
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

test("Device Editor resize handlers delegate to detached transactional sessions", () => {
  const move = functionSource("moveEditorNode");
  const stop = functionSource("stopEditorNodeDrag");
  const cancel = functionSource("cancelEditorInteraction");
  const bind = functionSource("bindEditorInteractionSvg");
  const faceMove = functionSource("applyEditorFaceImageResize");
  const previewClone = functionSource("readonlyDeviceEditorPreviewTemplate");
  const faceTransaction = functionSource("commitEditorFaceplateOriginMutation");
  const closeEditor = functionSource("closeDeviceEditor");
  const selectDevice = functionSource("selectEditorDeviceIndex");
  const escapeHandler = INDEX_HTML;

  assert.match(move, /updateEditorResizeSessionFromEvent\(event\)/);
  assert.doesNotMatch(move, /setEditorDeviceHeight\(template|setEditorPowerDistroFaceGeometry\(template/);
  assert.match(faceMove, /updateEditorResizeSessionFromEvent\(event\)/);
  assert.doesNotMatch(faceMove, /faceImageScale|shiftRowsAfterFaceChange|renderDeviceEditorPreview/);
  assert.match(stop, /finishEditorResizeSession\(event\)/);
  assert.match(cancel, /cancelEditorResizeSession\(event\)/);
  assert.match(bind, /pointercancel", cancelEditorInteraction/);
  assert.match(bind, /lostpointercapture"[\s\S]*cancelEditorResizeSession\(event\)/);
  assert.match(previewClone, /editorResizePreviewTemplateFor\(template\)/);
  assert.match(faceTransaction, /animate: options\.animate/);
  assert.match(closeEditor, /cancelEditorResizeSession\(null, \{ render: false \}\)/);
  assert.match(selectDevice, /cancelEditorResizeSession\(null, \{ render: false \}\)/);
  assert.match(INDEX_HTML, /resetDeviceEditor"\)\.addEventListener\("click", \(\) => \{\s*cancelEditorResizeSession\(null, \{ render: false \}\)/);
  assert.match(INDEX_HTML, /if \(previousTab !== nextTab\) cancelEditorResizeSession\(null, \{ render: false \}\);[\s\S]*editorActiveTab = nextTab/);
  assert.match(escapeHandler, /deviceEditorOpen && editorResizeSession[\s\S]*cancelEditorResizeSession\(\)/);
});

test("Legacy resize navigation keeps the absolute camera center across changing preview bounds", () => {
  const context = {
    console,
    Number,
    Object,
    String,
    currentEditorTemplate: () => null,
    deviceEditorActivePreviewUsesEngine: () => false,
    deviceEditorPreview: {
      getAttribute: name => name === "viewBox" ? "10 20 400 200" : ""
    },
    editorPreviewZoom: 1.75,
    editorPreviewPan: { x: 14, y: -9 },
    editorActivePreviewBounds: template => template.bounds
  };
  const script = `${functionSource("freezeEditorResizeSnapshotValue")}
    ${functionSource("editorResizeLegacyNavigationSnapshot")}
    ${functionSource("applyEditorResizeLegacyNavigation")}
    ({ editorResizeLegacyNavigationSnapshot, applyEditorResizeLegacyNavigation })`;
  const api = vm.runInNewContext(script, context);
  const baselineTemplate = { bounds: { x: 12, y: 38, width: 356, height: 78 } };
  const candidateTemplate = { bounds: { x: 12, y: 38, width: 356, height: 144 } };
  const navigation = api.editorResizeLegacyNavigationSnapshot(baselineTemplate);
  const session = { baseline: { previewNavigation: navigation } };

  api.applyEditorResizeLegacyNavigation(session, candidateTemplate);
  assert.equal(context.editorPreviewZoom, 1.75);
  assert.equal(candidateTemplate.bounds.x + candidateTemplate.bounds.width / 2 + context.editorPreviewPan.x, 210);
  assert.equal(candidateTemplate.bounds.y + candidateTemplate.bounds.height / 2 + context.editorPreviewPan.y, 120);

  api.applyEditorResizeLegacyNavigation(session, baselineTemplate);
  assert.equal(baselineTemplate.bounds.x + baselineTemplate.bounds.width / 2 + context.editorPreviewPan.x, 210);
  assert.equal(baselineTemplate.bounds.y + baselineTemplate.bounds.height / 2 + context.editorPreviewPan.y, 120);
  assert.equal(Object.isFrozen(navigation), true);
  assert.equal(Object.isFrozen(navigation.pan), true);
});

test("generated Power Distro resize previews are isolated, coalesced, and commit one atomic rebase", () => {
  const origin = 156;
  const faceConnector = resizeConnector("front", "left", 0, origin, {
    faceplateSide: true,
    nameText: "Front I/O"
  });
  faceConnector.y = 70;
  faceConnector.anchors = faceConnector.anchors.map(anchor => ({ ...anchor, y: 70 }));
  const { api, template, counters, context } = structuralEditorHarness({
    resizeGeometryMode: true,
    isPowerDistro: true,
    powerDistroFaceY: 20,
    powerDistroFaceHeight: 100,
    autoFaceHeight: 80,
    manualPlugTopLimit: 70,
    connectors: [
      resizeConnector("left", "left", 0, origin, { powerPlug: { manual: true, x: 90, y: 64 } }),
      resizeConnector("right", "right", 0, origin, { direction: "output" }),
      resizeConnector("both", "both", 1, origin),
      resizeConnector("network-in", "left", 2, origin, { type: "ethernet", networkGroupId: "net-a" }),
      resizeConnector("network-out", "right", 2, origin, { type: "ethernet", direction: "output", networkGroupId: "net-a" }),
      resizeConnector("led-output", "right", 6, origin, { type: "led-signal", direction: "output", generatedByLedProcessor: true }),
      faceConnector
    ],
    cardTypes: [{
      id: "io-card",
      name: "I/O Card",
      kind: "io",
      connectors: [
        { id: "in", direction: "input", type: "hdmi", empty: false },
        { id: "out", direction: "output", type: "hdmi", empty: false }
      ]
    }],
    cardSlots: [{ id: "slot-a", installedCardTypeId: "io-card", y: origin + 3 * 54, span: 3 }],
    connectorRelationships: [{ id: "network-a", type: "paired-network", members: ["network-in", "network-out"] }]
  });
  template.height = context.deviceHeightForSlotCounts(template);
  const baselineTemplate = structuredClone(template);
  const baselineLanes = itemLaneMap(api.resolveEditorModularLayout(template));
  const baselineGeneratedIds = api.generatedCardConnectors(structuredClone(template)).map(connector => connector.id);
  context.editorSelectedNodeIds = new Set(["left", "both", "led-output"]);
  context.editorSelectedNodeIndex = template.connectors.findIndex(connector => connector.id === "both");
  context.editorSelectedFaceplate = true;
  context.editorSelectedPowerPlugIds = new Set(["left"]);
  const before = editorCounterSnapshot(counters);

  assert.equal(api.beginEditorResizeSession(resizePointer(41, 200, 120, "pointerdown"), {
    kind: "generated-faceplate",
    edge: "bottom",
    startPoint: { x: 200, y: 120 }
  }), true);
  for (let index = 0; index < 30; index += 1) {
    assert.equal(api.updateEditorResizeSessionFromEvent(resizePointer(41, 200, 121 + index)), true);
  }
  assert.deepEqual(template, baselineTemplate, "pointer movement must not mutate the live template");
  assert.equal(counters.structuralSessions, 0);
  assert.equal(counters.solverCalls, 0);
  assert.equal(counters.animationSeeds, 0);
  assert.equal(context.flushAnimationFrames(), 1, "bursty movement should coalesce to one frame");
  const preview = context.editorResizePreviewTemplate;
  assert.ok(preview && preview !== template);
  assert.equal(preview.powerDistroFaceHeight, 130);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(preview)), baselineLanes);
  assert.deepEqual(api.generatedCardConnectors(preview).map(connector => connector.id), baselineGeneratedIds);
  assert.deepEqual(template, baselineTemplate);

  api.finishEditorResizeSession(resizePointer(41, 200, 174, "pointerup"));
  assert.equal(template.powerDistroFaceHeight, 154);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(template)), baselineLanes);
  assert.deepEqual(api.generatedCardConnectors(template).map(connector => connector.id), baselineGeneratedIds);
  assert.deepEqual(template.connectors.find(connector => connector.id === "left").powerPlug, { manual: true, x: 90, y: 64 });
  template.connectors.filter(connector => connector.id !== "front").forEach(connector => {
    assert.ok(connector.anchors.every(anchor => anchor.y === connector.y), `${connector.id} anchors should match the committed row`);
  });
  assert.equal(template.connectors.find(connector => connector.id === "front").y, context.faceplateSideConnectorY(template));
  assert.deepEqual(editorCounterDelta(counters, before), {
    structuralSessions: 1,
    solverCalls: 1,
    previewRenders: 2,
    editorRenders: 1,
    animationSeeds: 0,
    animationRetargets: 0
  });

  const roundTripBaseline = editorResizeGeometrySnapshot(template);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const growPointerId = 70 + cycle * 2;
    api.beginEditorResizeSession(resizePointer(growPointerId, 200, 0, "pointerdown"), {
      kind: "generated-faceplate",
      edge: "bottom",
      startPoint: { x: 200, y: 0 }
    });
    api.finishEditorResizeSession(resizePointer(growPointerId, 200, 30, "pointerup"));
    const shrinkPointerId = growPointerId + 1;
    api.beginEditorResizeSession(resizePointer(shrinkPointerId, 200, 0, "pointerdown"), {
      kind: "generated-faceplate",
      edge: "bottom",
      startPoint: { x: 200, y: 0 }
    });
    api.finishEditorResizeSession(resizePointer(shrinkPointerId, 200, -30, "pointerup"));
    assert.deepEqual(editorResizeGeometrySnapshot(template), roundTripBaseline, `resize cycle ${cycle + 1} must not accumulate coordinate or height drift`);
  }
});

test("generated faceplate top resize keeps origin fixed and cancellation restores exact selection", () => {
  const origin = 156;
  const { api, template, counters, context } = structuralEditorHarness({
    resizeGeometryMode: true,
    isPowerDistro: true,
    powerDistroFaceY: 20,
    powerDistroFaceHeight: 100,
    autoFaceHeight: 60,
    manualPlugTopLimit: 55,
    connectors: [resizeConnector("left", "left", 0, origin), resizeConnector("right", "right", 0, origin, { direction: "output" })]
  });
  template.height = context.deviceHeightForSlotCounts(template);
  const baseline = structuredClone(template);
  context.editorSelectedNodeIds = new Set(["left", "right"]);
  context.editorSelectedNodeIndex = 1;
  context.editorSelectedFaceplate = false;
  context.editorSelectedPowerPlugIds = new Set(["left"]);
  const before = editorCounterSnapshot(counters);

  api.beginEditorResizeSession(resizePointer(42, 200, 20, "pointerdown"), {
    kind: "generated-faceplate",
    edge: "top",
    startPoint: { x: 200, y: 20 }
  });
  api.updateEditorResizeSessionFromEvent(resizePointer(42, 200, 90));
  context.flushAnimationFrames();
  assert.equal(context.editorResizePreviewTemplate.powerDistroFaceY, 55, "manual plug top must clamp the faceplate edge");
  assert.equal(context.connectorStartYForTemplate(context.editorResizePreviewTemplate), origin, "top resize keeps the face bottom and origin fixed");
  assert.deepEqual(template, baseline);
  api.cancelEditorResizeSession(resizePointer(42, 200, 90, "pointercancel"));
  assert.deepEqual(template, baseline);
  assert.deepEqual(selectedNodeConnectorIds(context), ["left", "right"]);
  assert.equal(selectedNodePrimaryConnectorId(template, context), "right");
  assert.equal(context.editorSelectedFaceplate, false);
  assert.deepEqual([...context.editorSelectedPowerPlugIds], ["left"]);
  assert.equal(counters.structuralSessions, 0);
  assert.equal(counters.solverCalls, 0);

  api.beginEditorResizeSession(resizePointer(43, 200, 20, "pointerdown"), {
    kind: "generated-faceplate",
    edge: "top",
    startPoint: { x: 200, y: 20 }
  });
  api.updateEditorResizeSessionFromEvent(resizePointer(43, 200, 45));
  context.flushAnimationFrames();
  api.finishEditorResizeSession(resizePointer(43, 200, 45, "pointerup"));
  assert.equal(context.connectorStartYForTemplate(template), origin);
  assert.equal(counters.structuralSessions, 1);
  assert.equal(counters.solverCalls, 0);
  assert.equal(counters.animationSeeds, 0);
  assert.equal(counters.editorRenders - before.editorRenders, 1);
});

test("custom image resize derives from its baseline and separates horizontal and vertical commits", () => {
  const horizontalOrigin = 150;
  const horizontal = structuralEditorHarness({
    faceImage: "data:image/png;base64,custom",
    faceImageNaturalWidth: 800,
    faceImageNaturalHeight: 400,
    faceImageScale: 1,
    faceImageScaleX: 1,
    faceImageScaleY: 1,
    connectors: [
      resizeConnector("left", "left", 0, horizontalOrigin),
      resizeConnector("both", "both", 1, horizontalOrigin)
    ]
  });
  horizontal.template.height = horizontal.context.deviceHeightForSlotCounts(horizontal.template);
  const startFace = horizontal.context.faceImagePlacement(horizontal.template, 420);
  const liveBefore = structuredClone(horizontal.template);
  horizontal.api.beginEditorResizeSession(resizePointer(51, startFace.x + startFace.width, startFace.y + startFace.height / 2, "pointerdown"), {
    kind: "custom-face-image",
    handle: "e",
    startPoint: { x: startFace.x + startFace.width, y: startFace.y + startFace.height / 2 }
  });
  horizontal.api.updateEditorResizeSessionFromEvent(resizePointer(51, startFace.x + startFace.width - 90, startFace.y + startFace.height / 2));
  horizontal.context.flushAnimationFrames();
  assert.deepEqual(horizontal.template, liveBefore);
  assert.ok(horizontal.context.editorResizePreviewTemplate.faceImageScaleX < 1);
  assert.equal(horizontal.context.editorResizePreviewTemplate.faceImageScaleY, 1);
  assert.equal(horizontal.context.connectorStartYForTemplate(horizontal.context.editorResizePreviewTemplate), horizontalOrigin);
  horizontal.api.finishEditorResizeSession(resizePointer(51, startFace.x + startFace.width - 90, startFace.y + startFace.height / 2, "pointerup"));
  assert.equal(horizontal.counters.structuralSessions, 1);
  assert.equal(horizontal.counters.solverCalls, 0);
  assert.equal(horizontal.counters.animationSeeds, 0);

  const vertical = structuralEditorHarness({
    faceImage: "data:image/png;base64,custom",
    faceImageNaturalWidth: 800,
    faceImageNaturalHeight: 400,
    faceImageScale: 1,
    faceImageScaleX: 1,
    faceImageScaleY: 1,
    connectors: [resizeConnector("left", "left", 0, horizontalOrigin), resizeConnector("right", "right", 1, horizontalOrigin, { direction: "output" })]
  });
  vertical.template.height = vertical.context.deviceHeightForSlotCounts(vertical.template);
  const verticalLanes = itemLaneMap(vertical.api.resolveEditorModularLayout(vertical.template));
  const verticalFace = vertical.context.faceImagePlacement(vertical.template, 420);
  const start = { x: verticalFace.x + verticalFace.width / 2, y: verticalFace.y + verticalFace.height };
  vertical.api.beginEditorResizeSession(resizePointer(52, start.x, start.y, "pointerdown"), {
    kind: "custom-face-image",
    handle: "s",
    startPoint: start
  });
  vertical.api.updateEditorResizeSessionFromEvent(resizePointer(52, start.x, start.y + 80));
  vertical.context.flushAnimationFrames();
  const outward = structuredClone(vertical.context.editorResizePreviewTemplate);
  vertical.api.updateEditorResizeSessionFromEvent(resizePointer(52, start.x, start.y - 20));
  vertical.context.flushAnimationFrames();
  const reversed = vertical.context.editorResizePreviewTemplate;
  const direct = vertical.api.deriveEditorResizePreviewCandidate(vertical.context.editorResizeSession, { x: start.x, y: start.y - 20 });
  assert.notEqual(outward.faceImageScaleY, reversed.faceImageScaleY);
  assert.equal(reversed.faceImageScaleY, direct.faceImageScaleY, "reversal must derive from the pointer-down snapshot");
  assert.ok(reversed.faceImageScaleY >= .2 && reversed.faceImageScaleY <= 6);
  vertical.api.updateEditorResizeSessionFromEvent(resizePointer(52, start.x, start.y + 80));
  vertical.context.flushAnimationFrames();
  const finalPreview = structuredClone(vertical.context.editorResizePreviewTemplate);
  vertical.api.finishEditorResizeSession(resizePointer(52, start.x, start.y + 80, "pointerup"));
  assert.equal(vertical.template.faceImageScaleY, finalPreview.faceImageScaleY);
  assert.equal(vertical.template.faceImageOffsetX, finalPreview.faceImageOffsetX);
  assert.deepEqual(itemLaneMap(vertical.api.resolveEditorModularLayout(vertical.template)), verticalLanes);
  assert.equal(vertical.counters.structuralSessions, 1);
  assert.equal(vertical.counters.solverCalls, 1);
  assert.equal(vertical.counters.animationSeeds, 0);
});

test("custom image corner resize honors minimums, scale clamps, offsets, and shared preview ownership", () => {
  const minimum = structuralEditorHarness({
    faceImage: "data:image/png;base64,custom",
    faceImageNaturalWidth: 800,
    faceImageNaturalHeight: 400,
    faceImageScale: 1,
    faceImageScaleX: 1,
    faceImageScaleY: 1,
    faceImageOffsetX: 12,
    faceImageOffsetY: -6,
    connectors: [resizeConnector("both", "both", 0, 150)]
  });
  minimum.template.height = minimum.context.deviceHeightForSlotCounts(minimum.template);
  const baseline = structuredClone(minimum.template);
  const face = minimum.context.faceImagePlacement(minimum.template, 420);
  const start = { x: face.x, y: face.y };
  const target = { x: face.x + face.width - 1, y: face.y + face.height - 1 };
  minimum.api.beginEditorResizeSession(resizePointer(53, start.x, start.y, "pointerdown"), {
    kind: "custom-face-image",
    handle: "nw",
    startPoint: start
  });
  minimum.api.updateEditorResizeSessionFromEvent(resizePointer(53, target.x, target.y));
  minimum.context.flushAnimationFrames();
  const preview = structuredClone(minimum.context.editorResizePreviewTemplate);
  assert.deepEqual(minimum.template, baseline);
  assert.equal(preview.faceImageScaleX, .2);
  assert.equal(preview.faceImageScaleY, .2);
  assert.notEqual(preview.faceImageOffsetX, baseline.faceImageOffsetX);
  assert.notEqual(preview.faceImageOffsetY, baseline.faceImageOffsetY);
  const engineCandidate = minimum.api.editorEnginePreviewTemplateClone(minimum.template);
  const legacyCandidate = minimum.api.readonlyDeviceEditorPreviewTemplate(minimum.template);
  assert.deepEqual(engineCandidate, legacyCandidate, "Engine and Legacy preview ownership must resolve the same detached candidate");
  assert.deepEqual(editorResizeGeometrySnapshot(engineCandidate), editorResizeGeometrySnapshot(preview));
  minimum.api.finishEditorResizeSession(resizePointer(53, target.x, target.y, "pointerup"));
  assert.deepEqual(editorResizeGeometrySnapshot(minimum.template), editorResizeGeometrySnapshot(preview));
  assert.equal(minimum.counters.structuralSessions, 1);
  assert.equal(minimum.counters.animationSeeds, 0);

  const maximum = structuralEditorHarness({
    faceImage: "data:image/png;base64,custom",
    faceImageNaturalWidth: 800,
    faceImageNaturalHeight: 400,
    faceImageScale: 1,
    faceImageScaleX: 1,
    faceImageScaleY: 1,
    connectors: [resizeConnector("left", "left", 0, 150)]
  });
  maximum.template.height = maximum.context.deviceHeightForSlotCounts(maximum.template);
  const maximumBaseline = structuredClone(maximum.template);
  const maximumFace = maximum.context.faceImagePlacement(maximum.template, 420);
  const maximumStart = { x: maximumFace.x + maximumFace.width, y: maximumFace.y + maximumFace.height };
  maximum.api.beginEditorResizeSession(resizePointer(54, maximumStart.x, maximumStart.y, "pointerdown"), {
    kind: "custom-face-image",
    handle: "se",
    startPoint: maximumStart
  });
  maximum.api.updateEditorResizeSessionFromEvent(resizePointer(54, maximumStart.x + 10000, maximumStart.y + 10000));
  maximum.context.flushAnimationFrames();
  assert.equal(maximum.context.editorResizePreviewTemplate.faceImageScaleY, 6);
  assert.deepEqual(maximum.template, maximumBaseline);
  maximum.api.cancelEditorResizeSession(resizePointer(54, maximumStart.x + 10000, maximumStart.y + 10000, "pointercancel"));
  assert.deepEqual(maximum.template, maximumBaseline);
  assert.equal(maximum.counters.structuralSessions, 0);
});

test("device height resize commits once while cancel, stale identity, and failure leave live state intact", () => {
  const fixture = () => structuralEditorHarness({
    connectors: [testConnector("left", "left", 0, { v2: true }), testConnector("right", "right", 1, { v2: true, direction: "output" })]
  });
  const committed = fixture();
  committed.template.height = committed.context.deviceHeightForSlotCounts(committed.template);
  const lanes = itemLaneMap(committed.api.resolveEditorModularLayout(committed.template));
  const startHeight = committed.template.height;
  committed.api.beginEditorResizeSession(resizePointer(61, 200, startHeight, "pointerdown"), {
    kind: "device-height",
    edge: "bottom",
    startPoint: { x: 200, y: startHeight }
  });
  committed.api.updateEditorResizeSessionFromEvent(resizePointer(61, 200, startHeight + 120));
  committed.context.flushAnimationFrames();
  assert.equal(committed.template.height, startHeight);
  assert.equal(committed.context.editorResizePreviewTemplate.height, startHeight + 120);
  committed.api.finishEditorResizeSession(resizePointer(61, 200, startHeight + 120, "pointerup"));
  assert.equal(committed.template.manualHeight, startHeight + 120);
  assert.equal(committed.counters.structuralSessions, 1);
  assert.equal(committed.counters.solverCalls, 0);
  assert.equal(committed.counters.animationSeeds, 0);
  assert.deepEqual(itemLaneMap(committed.api.resolveEditorModularLayout(committed.template)), lanes);

  const cancelled = fixture();
  cancelled.template.height = cancelled.context.deviceHeightForSlotCounts(cancelled.template);
  cancelled.context.editorSelectedNodeIds = new Set(["left", "right"]);
  cancelled.context.editorSelectedNodeIndex = 1;
  const cancelledBefore = structuredClone(cancelled.template);
  cancelled.api.beginEditorResizeSession(resizePointer(62, 200, 0, "pointerdown"), {
    kind: "device-height",
    edge: "top",
    startPoint: { x: 200, y: 0 }
  });
  cancelled.api.updateEditorResizeSessionFromEvent(resizePointer(62, 200, -80));
  cancelled.context.flushAnimationFrames();
  cancelled.api.cancelEditorResizeSession(resizePointer(62, 200, -80, "lostpointercapture"));
  assert.deepEqual(cancelled.template, cancelledBefore);
  assert.deepEqual(selectedNodeConnectorIds(cancelled.context), ["left", "right"]);
  assert.equal(cancelled.counters.structuralSessions, 0);
  assert.equal(cancelled.api.cancelEditorResizeSession(resizePointer(62, 200, -80, "lostpointercapture")), false);

  const stale = fixture();
  stale.template.height = stale.context.deviceHeightForSlotCounts(stale.template);
  const staleBefore = structuredClone(stale.template);
  stale.api.beginEditorResizeSession(resizePointer(63, 200, 0, "pointerdown"), {
    kind: "device-height",
    edge: "bottom",
    startPoint: { x: 200, y: 0 }
  });
  stale.context.editorDraft = [{ ...structuredClone(stale.template), id: "replacement" }];
  stale.api.updateEditorResizeSessionFromEvent(resizePointer(63, 200, 90));
  assert.deepEqual(stale.template, staleBefore);
  assert.equal(stale.counters.structuralSessions, 0);

  const failed = structuralEditorHarness({
    resizeGeometryMode: true,
    isPowerDistro: true,
    powerDistroFaceY: 20,
    powerDistroFaceHeight: 100,
    autoFaceHeight: 80,
    connectors: [resizeConnector("row", "left", 0, 156)]
  });
  failed.template.height = failed.context.deviceHeightForSlotCounts(failed.template);
  failed.context.editorSelectedNodeIds = new Set(["row"]);
  failed.context.editorSelectedNodeIndex = 0;
  failed.context.editorSelectedFaceplate = false;
  failed.context.editorSelectedPowerPlugIds = new Set(["row"]);
  const failedBefore = structuredClone(failed.template);
  failed.placementModule.forceInvalid = true;
  failed.api.beginEditorResizeSession(resizePointer(64, 200, 120, "pointerdown"), {
    kind: "generated-faceplate",
    edge: "bottom",
    startPoint: { x: 200, y: 120 }
  });
  failed.api.updateEditorResizeSessionFromEvent(resizePointer(64, 200, 180));
  failed.context.flushAnimationFrames();
  failed.api.finishEditorResizeSession(resizePointer(64, 200, 180, "pointerup"));
  assert.deepEqual(failed.template, failedBefore);
  assert.equal(failed.context.editorResizeSession, null);
  assert.equal(failed.context.editorResizePreviewTemplate, null);
  assert.deepEqual(selectedNodeConnectorIds(failed.context), ["row"]);
  assert.equal(selectedNodePrimaryConnectorId(failed.template, failed.context), "row");
  assert.equal(failed.context.editorSelectedFaceplate, false);
  assert.deepEqual([...failed.context.editorSelectedPowerPlugIds], ["row"]);
  assert.equal(failed.counters.animationSeeds, 0);
  assert.equal(failed.counters.editorRenders, 0);

  const noMotion = fixture();
  noMotion.template.height = noMotion.context.deviceHeightForSlotCounts(noMotion.template);
  noMotion.api.beginEditorResizeSession(resizePointer(65, 200, 0, "pointerdown"), {
    kind: "device-height",
    edge: "bottom",
    startPoint: { x: 200, y: 0 }
  });
  noMotion.api.finishEditorResizeSession(resizePointer(65, 200, 0, "pointerup"));
  assert.equal(noMotion.counters.structuralSessions, 0);
  assert.equal(noMotion.counters.solverCalls, 0);

  const clamped = fixture();
  clamped.template.height = clamped.context.deviceHeightForSlotCounts(clamped.template);
  const clampedHeight = clamped.template.height;
  clamped.api.beginEditorResizeSession(resizePointer(66, 200, clampedHeight, "pointerdown"), {
    kind: "device-height",
    edge: "bottom",
    startPoint: { x: 200, y: clampedHeight }
  });
  clamped.api.updateEditorResizeSessionFromEvent(resizePointer(66, 200, clampedHeight - 10000));
  clamped.context.flushAnimationFrames();
  assert.equal(clamped.context.editorResizePreviewTemplate.height, clampedHeight);
  clamped.api.finishEditorResizeSession(resizePointer(66, 200, clampedHeight - 10000, "pointerup"));
  assert.equal(clamped.template.height, clampedHeight);
  assert.equal(clamped.counters.structuralSessions, 0, "geometry clamped to its baseline must skip the transaction");
  assert.equal(clamped.counters.solverCalls, 0);
});

test("resize interruption routes cancel pending work and normal release cannot finalize twice", () => {
  const interruptionTypes = ["pointercancel", "lostpointercapture", "keydown", "tabchange", "close", "reset"];
  interruptionTypes.forEach((type, index) => {
    const fixture = structuralEditorHarness({
      connectors: [testConnector("left", "left", 0, { v2: true }), testConnector("right", "right", 1, { v2: true, direction: "output" })]
    });
    fixture.template.height = fixture.context.deviceHeightForSlotCounts(fixture.template);
    fixture.context.editorSelectedNodeIds = new Set(["left", "right"]);
    fixture.context.editorSelectedNodeIndex = 1;
    fixture.context.editorSelectedFaceplate = true;
    fixture.context.editorSelectedPowerPlugIds = new Set(["left"]);
    const baseline = structuredClone(fixture.template);
    const pointerId = 80 + index;
    fixture.api.beginEditorResizeSession(resizePointer(pointerId, 200, fixture.template.height, "pointerdown"), {
      kind: "device-height",
      edge: "bottom",
      startPoint: { x: 200, y: fixture.template.height }
    });
    fixture.api.updateEditorResizeSessionFromEvent(resizePointer(pointerId, 200, fixture.template.height + 90));
    const event = type === "keydown" || type === "tabchange" || type === "close" || type === "reset"
      ? { type }
      : resizePointer(pointerId, 200, fixture.template.height + 90, type);
    fixture.api.cancelEditorResizeSession(event, { render: !["tabchange", "close", "reset"].includes(type) });
    assert.deepEqual(fixture.template, baseline, `${type} must leave the live template unchanged`);
    assert.equal(fixture.context.editorResizeSession, null);
    assert.equal(fixture.context.editorResizePreviewTemplate, null);
    assert.equal(fixture.context.flushAnimationFrames(), 0, `${type} must cancel its pending animation frame`);
    assert.equal(fixture.context.resizeSurface.capturedPointers.size, 0);
    assert.deepEqual(selectedNodeConnectorIds(fixture.context), ["left", "right"]);
    assert.equal(selectedNodePrimaryConnectorId(fixture.template, fixture.context), "right");
    assert.equal(fixture.context.editorSelectedFaceplate, true);
    assert.deepEqual([...fixture.context.editorSelectedPowerPlugIds], ["left"]);
    assert.equal(fixture.counters.structuralSessions, 0);
    assert.equal(fixture.counters.solverCalls, 0);
  });

  const released = structuralEditorHarness({
    connectors: [testConnector("left", "left", 0, { v2: true })]
  });
  released.template.height = released.context.deviceHeightForSlotCounts(released.template);
  const pointerId = 99;
  released.api.beginEditorResizeSession(resizePointer(pointerId, 200, released.template.height, "pointerdown"), {
    kind: "device-height",
    edge: "bottom",
    startPoint: { x: 200, y: released.template.height }
  });
  released.api.updateEditorResizeSessionFromEvent(resizePointer(pointerId, 200, released.template.height + 60));
  released.context.flushAnimationFrames();
  released.api.finishEditorResizeSession(resizePointer(pointerId, 200, released.template.height + 60, "pointerup"));
  const committedHeight = released.template.height;
  const committedCounters = editorCounterSnapshot(released.counters);
  assert.equal(released.api.cancelEditorResizeSession(resizePointer(pointerId, 200, committedHeight, "lostpointercapture")), false);
  assert.equal(released.template.height, committedHeight);
  assert.deepEqual(editorCounterSnapshot(released.counters), committedCounters);
  assert.equal(released.context.resizeSurface.capturedPointers.size, 0);
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
  assert.match(previewClone, /applyEditorPlacementVisualsToPreviewTemplate\(draft, sourceTemplate\)/);
  assert.match(legacyRender, /applyEditorPlacementVisualsToPreviewTemplate\(previewTemplate, editorResizePreviewTemplateFor\(template\)\)/);
  assert.doesNotMatch(legacyRender, /animateTransform/);
  assert.match(engineRender, /motionOnly: options\.motionFrame === true \|\| editorPlacementMotionHasEntries\(\)/);
  assert.match(syncEngine, /options\.motionOnly === true/);
  assert.match(nodeMove, /retargetEditorPlacementMotionForDrag\(editorNodeDrag/);
  assert.match(nodeMove, /draggedIds\.length > 1/);
  assert.match(nodeMove, /retargetEditorPlacementMotionForDrag\(editorCardSlotDrag/);
  assert.match(nodeMove, /draggedY:\s*visualY/);
  assert.match(nodeMove, /setEditorDraggedPlacementVisualY\(editorCardSlotDrag, visualY\)/);
  assert.match(functionSource("retargetEditorPlacementMotionForDrag"), /pinEditorCompositeDraggedMotionEntries\(drag, draggedY/);
  assert.match(stopDrag, /settleEditorPlacementMotionToLayout\(completedDrag\.lastValidResolvedLayout/);
  assert.match(cancelDrags, /rollbackEditorPlacementMotionForDrag/);
  assert.match(displayAnchors, /deltaY = y - baseY/);
  assert.match(setPreviewY, /deltaY = nextY - currentY/);
});

test("Device Editor card-slot drag defers dynamic ownership until pointer movement", () => {
  const cardDrag = functionSource("startEditorCardSlotDrag");
  const faceResize = functionSource("startEditorFaceImageResize");

  assert.doesNotMatch(faceResize, /beginEditorPlacementMotion\(/, "face image resize should not seed modular card motion");
  assert.doesNotMatch(cardDrag, /beginEditorPlacementMotion\(/, "a click must not hand card artwork to the drag compositor");
  assert.match(functionSource("moveEditorNode"), /if \(motionJustStarted\) \{[\s\S]*beginEditorPlacementMotion\(editorCardSlotDrag\)/);
  assert.match(functionSource("moveEditorNode"), /renderDeviceEditorPreview\(\{ refreshTexture: true, motionFrame: true \}\)/);
  assert.match(cardDrag, /createEditorCompactCardDragSession\(template/);
  assert.match(cardDrag, /pointerY:\s*point\.y/);
});

test("Device Editor installed card children select before their parent card drag target", () => {
  const startNodeDrag = functionSource("startEditorNodeDrag");
  const renderInspector = functionSource("renderSelectedConnectorSettings");
  const installedTarget = functionSource("editorInstalledCardConnectorFromEvent");

  assertOrder(startNodeDrag, [
    "editorInstalledCardConnectorFromEvent(event)",
    "setEditorInstalledCardConnectorSelection(template, installedCardConnector.id)",
    "startEditorCardSlotDrag(event)"
  ], "installed child connectors must own pointer selection before the card band starts dragging");
  assert.match(installedTarget, /data-editor-card-connector-id/);
  assert.match(installedTarget, /editorEngineConnectorIdFromEvent\(event\)/, "Engine-rendered child nodes must use the same selection path");
  assert.match(renderInspector, /installedSelection = editorSelectedInstalledCardConnector\(template\)/);
  assert.match(renderInspector, /setCardSlotConnectorOverride/);
  assert.match(renderInspector, /Installed Card Connector/);
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

test("Device Editor card drag handlers keep accepted lanes, continuous visuals, and frozen Fit coordinates in sync", () => {
  const fixture = {
    id: "e2-gen1-card-drag-fixture",
    name: "E2 Gen1 Card Drag Fixture",
    height: 520,
    connectors: [
      { id: "left-top", direction: "input", sideMask: "left", x: 0, y: 100 },
      { id: "right-top", direction: "output", sideMask: "right", x: 420, y: 100 }
    ],
    cardSlots: [
      { id: "slot-a", installedCardTypeId: "card-span", sideMask: "both", span: 2, y: 154, overrides: { "in-1": { nameText: "A IN" } } },
      { id: "slot-b", installedCardTypeId: "card-input", sideMask: "left", span: 1, y: 262 },
      { id: "slot-c", installedCardTypeId: "card-output", sideMask: "right", span: 1, y: 262 },
      { id: "slot-d", installedCardTypeId: "card-io", sideMask: "both", span: 2, y: 316 }
    ],
    connectorRelationships: [{ id: "relationship-a", members: ["left-top", "right-top"] }]
  };
  const expectedDown = {
    "connector:left-top": 0,
    "connector:right-top": 0,
    "card:slot-a": 4,
    "card:slot-b": 1,
    "card:slot-c": 1,
    "card:slot-d": 2
  };
  const expectedUp = {
    "connector:left-top": 0,
    "connector:right-top": 0,
    "card:slot-a": 1,
    "card:slot-b": 3,
    "card:slot-c": 3,
    "card:slot-d": 4
  };

  for (const previewMode of ["engine", "legacy"]) {
    const harness = cardDragInteractionHarness(fixture, { previewScale: 0.16, previewMode });
    const { api, context, counters, template, startCardDrag, moveCardToLane, stopCardDrag } = harness;
    const originalIds = template.cardSlots.map(slot => slot.id);
    const originalOverrides = structuredClone(template.cardSlots[0].overrides);
    const originalRelationships = structuredClone(template.connectorRelationships);
    const originalHeight = template.height;
    const started = startCardDrag(0, previewMode === "engine" ? 41 : 42);
    const frozenBasis = started.frame.yBasisY;

    context.previewScale = 0.035;
    const drag = moveCardToLane(started, 4);
    assert.equal(drag.currentTargetLane, 4, `${previewMode}: solver target should survive preview scale changes`);
    assert.equal(drag.acceptedY, 316, `${previewMode}: semantic reservation should use the accepted lane Y`);
    assert.equal(drag.currentY, 316, `${previewMode}: compatibility semantic Y should remain accepted`);
    assert.equal(drag.visualY, 337, `${previewMode}: dragged visual should follow the frozen pointer frame`);
    assert.equal(counters.motionRetargets.at(-1).draggedY, 337, `${previewMode}: motion should target visual pointer Y`);
    assert.equal(started.frame.yBasisY, frozenBasis, `${previewMode}: coordinate frame should remain immutable`);
    assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), expectedDown, `${previewMode}: exact downward lane map`);
    assert.equal(template.height, originalHeight, `${previewMode}: move preview must not mutate persisted height`);
    assert.equal(template.cardSlots[0].y, 154, `${previewMode}: move preview must not mutate persisted slot Y`);

    stopCardDrag(started);
    assert.deepEqual(itemLaneMap(api.getLayout()), expectedDown, `${previewMode}: release should commit the displayed map`);
    assert.equal(template.cardSlots.find(slot => slot.id === "slot-a").y, 316);
    assert.equal(counters.motionSettles, 1);
    assert.equal(counters.commits, 1, `${previewMode}: release should commit exactly once`);
    assert.deepEqual(template.cardSlots.map(slot => slot.id), originalIds, `${previewMode}: stable slot IDs should survive`);
    assert.deepEqual(template.cardSlots[0].overrides, originalOverrides, `${previewMode}: per-slot overrides should survive`);
    assert.deepEqual(template.connectorRelationships, originalRelationships, `${previewMode}: relationships should survive`);

    const upward = startCardDrag(0, previewMode === "engine" ? 43 : 44);
    const upwardDrag = moveCardToLane(upward, 1);
    assert.deepEqual(itemLaneMap(upwardDrag.lastValidResolvedLayout), expectedUp, `${previewMode}: exact upward lane map`);
    stopCardDrag(upward);
    assert.deepEqual(itemLaneMap(api.getLayout()), expectedUp, `${previewMode}: upward release should commit the displayed map`);
    assert.equal(template.cardSlots.find(slot => slot.id === "slot-a").y, 154);
  }
});

test("Device Editor card visual follows pointer continuously without retargeting stationary layout", () => {
  for (const previewMode of ["engine", "legacy"]) {
    const fixture = {
      id: `continuous-card-${previewMode}`,
      name: "Continuous Card Drag",
      height: 520,
      cardSlots: [
        { id: "slot-a", installedCardTypeId: "card-a", sideMask: "both", span: 1, y: 100 },
        { id: "slot-b", installedCardTypeId: "card-b", sideMask: "both", span: 7, y: 154 },
        { id: "slot-c", installedCardTypeId: "card-c", sideMask: "both", span: 1, y: 532 }
      ]
    };
    const harness = cardDragInteractionHarness(fixture, { previewScale: 0.08, previewMode });
    const baseline = structuredClone(harness.template);
    const baselineMap = itemLaneMap(harness.api.getLayout());
    const baselineHeight = harness.template.height;
    const started = harness.startCardDrag(1, previewMode === "engine" ? 71 : 72);
    const drag = harness.moveCardToClientY(started, started.clientY + 5);

    assert.equal(drag.currentBoundaryIndex, drag.originalBoundaryIndex, `${previewMode}: sub-midpoint move keeps reservation`);
    assert.equal(drag.acceptedY, 154, `${previewMode}: semantic Y remains at the reserved lane`);
    assert.equal(drag.visualY, 216.5, `${previewMode}: visual Y follows five CSS pixels through the frozen frame`);
    assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), baselineMap, `${previewMode}: stationary semantic lanes remain unchanged`);
    assert.equal(harness.template.height, baselineHeight, `${previewMode}: visual motion cannot affect height`);
    assert.equal(harness.counters.motionRetargets.length, 0, `${previewMode}: unchanged boundary must not retarget stationary animation`);
    assert.equal(harness.counters.draggedVisualUpdates.at(-1), 216.5, `${previewMode}: only the active visual is updated`);

    const geometry = placementMotionModule.cardMotionDerivedGeometry(drag.visualY, {
      slotHeight: 54,
      span: 7,
      connectorRowIndex: 3
    });
    assert.equal(geometry.bandY, drag.visualY - 27, `${previewMode}: card body remains rigid with visual Y`);
    assert.equal(geometry.captionY, drag.visualY + 3, `${previewMode}: caption remains rigid with visual Y`);
    assert.equal(geometry.connectorY, drag.visualY + 216, `${previewMode}: generated connector offset remains rigid`);

    harness.stopCardDrag(started);
    assert.deepEqual(harness.template, baseline, `${previewMode}: no-boundary release is a model no-op`);
    assert.equal(harness.counters.commits, 0, `${previewMode}: no-boundary release must not commit`);
    assert.equal(harness.counters.motionSettles, 1, `${previewMode}: visual returns to the baseline reservation`);
  }
});

test("Device Editor generated card connectors remain rigid with dragged card artwork", () => {
  const harness = structuralEditorHarness({
    id: "rigid-dragged-card-connectors",
    name: "Rigid Dragged Card Connectors",
    hasSwappableCards: true,
    height: 520,
    cardTypes: [{
      id: "large-io-card",
      name: "Large I/O Card",
      kind: "io",
      connectors: [
        { id: "in-1", type: "hdmi", direction: "input", nameText: "IN 1" },
        { id: "in-2", type: "hdmi", direction: "input", nameText: "IN 2" },
        { id: "out-1", type: "hdmi", direction: "output", nameText: "OUT 1" }
      ]
    }],
    cardSlots: [{
      id: "slot-a",
      installedCardTypeId: "large-io-card",
      y: 154,
      connectorOverrides: {}
    }]
  });
  const visualY = 243.25;
  harness.context.cardSlotDisplayY = (_template, slot) => slot.id === "slot-a" ? visualY : Number(slot.y);
  const generated = harness.api.generatedCardConnectors(harness.template);
  const bySourceId = Object.fromEntries(generated.map(connector => [connector.sourceConnectorId, connector]));
  const geometry = placementMotionModule.cardMotionDerivedGeometry(visualY, { slotHeight: 54, span: 3 });

  assert.equal(geometry.slotY, visualY);
  assert.equal(bySourceId["in-1"].y, visualY + 54);
  assert.equal(bySourceId["in-2"].y, visualY + 108);
  assert.equal(bySourceId["out-1"].y, visualY + 54);
  generated.forEach(connector => {
    const primary = connector.anchors.find(anchor => anchor.id === connector.primaryAnchorId) || connector.anchors[0];
    assert.equal(primary.y, connector.y);
    assert.equal(connector.cardSlotId, "slot-a");
  });
});

test("Device Editor card click and lost capture restore exact baseline state", () => {
  const fixture = {
    id: "card-click-lost-capture",
    name: "Card Click Lost Capture",
    height: 360,
    connectorRelationships: [{ id: "keep", members: ["a", "b"] }],
    cardSlots: [
      { id: "slot-a", installedCardTypeId: "card-a", sideMask: "both", span: 1, y: 100, overrides: { port: { nameText: "Keep A" } } },
      { id: "slot-b", installedCardTypeId: "card-b", sideMask: "both", span: 1, y: 154, overrides: { port: { nameText: "Keep B" } } }
    ]
  };
  const clickHarness = cardDragInteractionHarness(fixture, { previewScale: 0.08 });
  const clickBaseline = structuredClone(clickHarness.template);
  const click = clickHarness.startCardDrag(0, 81);
  assert.equal(clickHarness.counters.motionSeeds, 0, "pointer down alone must leave the static card owner active");
  clickHarness.stopCardDrag(click);
  assert.deepEqual(clickHarness.template, clickBaseline);
  assert.equal(clickHarness.counters.commits, 0);
  assert.equal(clickHarness.counters.motionClears, 1);
  assert.equal(clickHarness.counters.motionSettles, 0);

  const lostHarness = cardDragInteractionHarness(fixture, { previewScale: 0.08 });
  const lostBaseline = structuredClone(lostHarness.template);
  const lost = lostHarness.startCardDrag(0, 82);
  lostHarness.moveCardToLane(lost, 1);
  assert.equal(lostHarness.loseCardPointerCapture(lost), true);
  assert.deepEqual(lostHarness.template, lostBaseline);
  assert.equal(lostHarness.counters.motionRollbacks, 1);
  assert.equal(lostHarness.counters.commits, 0);
  assert.equal(lostHarness.context.editorSelectedPowerPlugIds.has("selection-sentinel"), true);
  assert.equal(lostHarness.context.editorSelectedNodeIds.has("node-selection-sentinel"), true);
  assert.equal(lostHarness.context.editorSelectedCardNodeIds.has("card-selection-sentinel"), true);
  assert.equal(lostHarness.context.editorSelectedFaceplate, true);
  assert.equal(lostHarness.context.editorSlotIndex, null);
});

test("Device Editor commits complementary two-card compaction through a single insertion boundary", () => {
  const harness = cardDragInteractionHarness({
    id: "two-complementary-cards",
    name: "Two Complementary Cards",
    height: 420,
    cardSlots: [
      { id: "input-card", installedCardTypeId: "input-type", sideMask: "left", span: 3, y: 100 },
      { id: "output-card", installedCardTypeId: "output-type", sideMask: "right", span: 3, y: 262 }
    ]
  });
  const started = harness.startCardDrag(1, 83);
  const drag = harness.moveCardToClientY(started, started.clientY + 5);
  assert.equal(drag.session.boundaries.length, 1, "complementary cards have one canonical insertion boundary");
  assert.equal(drag.movementThresholdCrossed, true, "canonical compaction must count as a committed movement");
  assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), {
    "card:input-card": 0,
    "card:output-card": 0
  });
  harness.stopCardDrag(started);
  assert.deepEqual(harness.template.cardSlots.map(slot => slot.y), [100, 100]);
});

test("Device Editor real card handlers keep a 12-slot E2 layout compact at tiny Fit scales", () => {
  const cardSlots = [
    { id: "slot-a", sideMask: "both", span: 7, lane: 1 },
    { id: "slot-b", sideMask: "left", span: 1, lane: 8 },
    { id: "slot-c", sideMask: "right", span: 1, lane: 8 },
    { id: "slot-d", sideMask: "both", span: 3, lane: 9 },
    { id: "slot-e", sideMask: "left", span: 1, lane: 12 },
    { id: "slot-f", sideMask: "right", span: 1, lane: 12 },
    { id: "slot-g", sideMask: "both", span: 2, lane: 13 },
    { id: "slot-h", sideMask: "left", span: 1, lane: 15 },
    { id: "slot-i", sideMask: "right", span: 1, lane: 15 },
    { id: "slot-j", sideMask: "both", span: 2, lane: 16 },
    { id: "slot-k", sideMask: "left", span: 1, lane: 18 },
    { id: "slot-l", sideMask: "right", span: 1, lane: 18 }
  ].map(slot => ({
    ...slot,
    installedCardTypeId: `card-${slot.id}`,
    y: 100 + slot.lane * 54,
    overrides: { port: { nameText: slot.id.toUpperCase() } }
  }));
  const fixture = {
    id: "e2-compact-authoring-fixture",
    name: "E2 Compact Authoring Fixture",
    height: 930,
    connectors: [
      { id: "fixed-left", direction: "input", sideMask: "left", x: 0, y: 100 },
      { id: "fixed-right", direction: "output", sideMask: "right", x: 420, y: 100 }
    ],
    cardSlots
  };

  for (const previewScale of [0.035, 0.08]) {
    const harness = cardDragInteractionHarness(fixture, { previewScale });
    const before = harness.api.getLayout();
    const beforeExtent = before.endLane;
    const originalIds = harness.template.cardSlots.map(slot => slot.id);
    const originalOverrides = structuredClone(harness.template.cardSlots.map(slot => slot.overrides));
    const started = harness.startCardDrag(0, Math.round(previewScale * 10000));
    const drag = harness.moveCardToLane(started, 999, { rawLane: 999 });

    assert.equal(drag.currentBoundaryIndex, drag.session.boundaries.length - 1, `${previewScale}: far below clamps to append`);
    assert.equal(drag.lastValidResolvedLayout.endLane, beforeExtent, `${previewScale}: reorder does not grow extent`);
    assertNoAuthoringOverlap(drag.lastValidResolvedLayout);
    for (let lane = 0; lane < drag.lastValidResolvedLayout.endLane; lane += 1) {
      assert.ok(
        drag.lastValidResolvedLayout.items.some(item => lane >= item.lane && lane < item.lane + item.span),
        `${previewScale}: compact layout should not contain an empty global lane ${lane}`
      );
    }
    harness.stopCardDrag(started);
    assert.equal(harness.api.getLayout().endLane, beforeExtent, `${previewScale}: committed extent matches preview`);
    assert.deepEqual(harness.template.cardSlots.map(slot => slot.id), originalIds, `${previewScale}: IDs remain stable`);
    assert.deepEqual(harness.template.cardSlots.map(slot => slot.overrides), originalOverrides, `${previewScale}: overrides remain stable`);
  }
});

test("Device Editor card drag handlers support cancellation and clamp far pointers to compact boundaries", () => {
  const fixture = {
    id: "new-three-slot-device",
    name: "New Three Slot Device",
    height: 360,
    cardSlots: [
      { id: "slot-1", installedCardTypeId: "card-a", sideMask: "both", span: 1, y: 100 },
      { id: "slot-2", installedCardTypeId: "card-a", sideMask: "both", span: 1, y: 154 },
      { id: "slot-3", installedCardTypeId: "card-a", sideMask: "both", span: 1, y: 208 }
    ]
  };
  const harness = cardDragInteractionHarness(fixture, { previewScale: 0.2 });
  const { api, counters, template, startCardDrag, moveCardToLane, stopCardDrag } = harness;
  const baseline = structuredClone(template);
  const started = startCardDrag(2, 51);
  const drag = moveCardToLane(started, 0);
  assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), {
    "card:slot-1": 1,
    "card:slot-2": 2,
    "card:slot-3": 0
  });
  stopCardDrag(started, "pointercancel");
  assert.deepEqual(template, baseline, "pointer cancellation should restore the exact model and height");
  assert.equal(counters.motionRollbacks, 1);
  assert.equal(counters.commits, 0);

  const far = startCardDrag(0, 52);
  const farDrag = moveCardToLane(far, 8, { rawLane: 8.45 });
  assert.equal(farDrag.currentBoundaryIndex, farDrag.session.boundaries.length - 1);
  assert.equal(farDrag.currentTargetLane, 2);
  assert.equal(farDrag.acceptedY, 208, "far pointer movement should clamp semantic Y to the last compact boundary");
  assert.equal(farDrag.currentY, 208, "compatibility semantic Y remains accepted");
  assert.equal(farDrag.visualY, 607, "visual Y continues to follow the far pointer");
  assert.equal(farDrag.rawPointerY, farDrag.visualY, "raw pointer-follow Y remains distinct from semantic Y");
  assert.equal(counters.motionRetargets.at(-1).draggedY, farDrag.visualY);
  assert.equal(template.height, baseline.height, "far pointer movement must not mutate persisted height before release");
  stopCardDrag(far);
  assert.equal(template.cardSlots.find(slot => slot.id === "slot-1").y, 208);
  assert.deepEqual(template.cardSlots.map(slot => slot.y).sort((a, b) => a - b), [100, 154, 208]);
  assert.equal(template.height, baseline.height, "same-extent reorder should preserve the captured model height");
  assert.equal(counters.commits, 1);
});

test("Device Editor node handlers use finite compact boundaries at Engine and Legacy zoom scales", () => {
  const fixture = {
    id: "e2-s3d-node-compact-fixture",
    name: "E2 S3D Node Compact Fixture",
    height: 720,
    connectors: [
      { id: "fixed-left", nameText: "Fixed In", direction: "input", sideMask: "left", x: 0, y: 100 },
      { id: "fixed-right", nameText: "Fixed Out", direction: "output", sideMask: "right", x: 420, y: 100 },
      { id: "s3d-in-1", nameText: "S3D In 1", direction: "input", sideMask: "left", x: 0, y: 316 },
      { id: "s3d-out-1", nameText: "S3D Out 1", direction: "output", sideMask: "right", x: 420, y: 316 },
      { id: "tail-left", nameText: "Tail", direction: "input", sideMask: "left", x: 0, y: 532 },
      { id: "both-tail", nameText: "Both", direction: "input", displaySide: "both", sideMask: "both", x: 0, y: 586 }
    ],
    cardSlots: [
      { id: "tricombo-a", installedCardTypeId: "tricombo", sideMask: "both", span: 3, y: 154 },
      { id: "tricombo-b", installedCardTypeId: "tricombo", sideMask: "both", span: 2, y: 370 },
      { id: "tricombo-c", installedCardTypeId: "tricombo", sideMask: "both", span: 1, y: 478 }
    ]
  };
  const assertCompact = (layout, label) => {
    assertNoAuthoringOverlap(layout);
    for (let lane = 0; lane < layout.endLane; lane += 1) {
      assert.ok(
        layout.items.some(item => lane >= item.lane && lane < item.lane + item.span),
        `${label}: lane ${lane} must not be an empty pointer-distance row`
      );
    }
  };

  for (const previewMode of ["engine", "legacy"]) {
    for (const previewScale of [1.47, 0.035, 0.08]) {
      const harness = cardDragInteractionHarness(fixture, { previewMode, previewScale });
      const baseline = structuredClone(harness.template);
      const baselineHeight = harness.template.height;
      const started = harness.startNodeDrag(2, Math.round(previewScale * 100000));
      const dragAtStart = harness.api.getNodeDrag();
      const frozenFrame = structuredClone(dragAtStart.coordinateFrame);
      const frozenPreviewHeight = dragAtStart.baselinePreviewHeight;
      const farBelowClientY = started.clientY + 10000;
      const farAboveClientY = started.clientY - 10000;

      let drag = harness.moveNodeToClientY(started, farBelowClientY);
      assert.equal(drag.currentBoundaryIndex, drag.session.boundaries.length - 1, `${previewMode}/${previewScale}: far below clamps last`);
      assertCompact(drag.lastValidResolvedLayout, `${previewMode}/${previewScale} below`);
      const belowMap = itemLaneMap(drag.lastValidResolvedLayout);
      const belowExtent = drag.lastValidResolvedLayout.endLane;
      drag = harness.moveNodeToClientY(started, farBelowClientY + 1000000);
      assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), belowMap, `${previewMode}/${previewScale}: extra distance cannot change semantic rows`);
      assert.equal(drag.lastValidResolvedLayout.endLane, belowExtent);

      drag = harness.moveNodeToClientY(started, farAboveClientY);
      assert.equal(drag.currentBoundaryIndex, 0, `${previewMode}/${previewScale}: far above clamps first`);
      assertCompact(drag.lastValidResolvedLayout, `${previewMode}/${previewScale} above`);
      drag = harness.moveNodeToClientY(started, farBelowClientY);
      assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), belowMap, `${previewMode}/${previewScale}: reversal returns deterministically`);
      assert.equal(harness.template.height, baselineHeight, `${previewMode}/${previewScale}: gesture cannot stretch body`);
      assert.equal(drag.baselinePreviewHeight, frozenPreviewHeight);
      assert.deepEqual(drag.coordinateFrame, frozenFrame, `${previewMode}/${previewScale}: pointer transform stays frozen`);
      assert.equal(drag.compactAuthoringDrag, true);
      const displayed = itemLaneMap(drag.lastValidResolvedLayout);
      harness.stopNodeDrag(started);
      assert.deepEqual(itemLaneMap(harness.api.getLayout()), displayed, `${previewMode}/${previewScale}: release matches preview`);

      const cancelBaseline = structuredClone(harness.template);
      const cancelled = harness.startNodeDrag(2, Math.round(previewScale * 100000) + 1);
      harness.moveNodeToClientY(cancelled, cancelled.clientY - 10000);
      harness.stopNodeDrag(cancelled, "pointercancel");
      assert.deepEqual(harness.template, cancelBaseline, `${previewMode}/${previewScale}: cancel restores model exactly`);
      assert.ok(harness.counters.motionRollbacks >= 1);
      assert.notDeepEqual(harness.template, baseline, `${previewMode}/${previewScale}: release performed a real reorder before cancel check`);
    }
  }
});

test("Device Editor multi-node handlers move a rigid selected profile through compact boundaries", () => {
  const fixture = {
    id: "multi-node-compact-fixture",
    height: 520,
    connectors: [
      { id: "left-top", direction: "input", sideMask: "left", x: 0, y: 100 },
      { id: "right-top", direction: "output", sideMask: "right", x: 420, y: 100 },
      { id: "s3d-in-1", nameText: "S3D In 1", direction: "input", sideMask: "left", x: 0, y: 316 },
      { id: "s3d-out-1", direction: "output", sideMask: "right", x: 420, y: 316 }
    ],
    cardSlots: [
      { id: "tricombo-a", installedCardTypeId: "tricombo", sideMask: "both", span: 3, y: 154 },
      { id: "tricombo-b", installedCardTypeId: "tricombo", sideMask: "both", span: 2, y: 370 }
    ]
  };

  for (const previewMode of ["engine", "legacy"]) {
    const harness = cardDragInteractionHarness(fixture, { previewMode, previewScale: 1.47 });
    const started = harness.startNodeDrag(2, previewMode === "engine" ? 901 : 902, ["s3d-in-1", "s3d-out-1"]);
    let drag = harness.moveNodeToClientY(started, started.clientY - 10000);
    assert.equal(drag.currentBoundaryIndex, 0);
    assert.equal(drag.compositeDrag, true);
    assert.deepEqual(
      JSON.parse(JSON.stringify(drag.selectedDraggedItemIds)),
      ["connector:s3d-in-1", "connector:s3d-out-1"]
    );
    assert.equal(
      drag.lastValidResolvedLayout.byId.get("connector:s3d-in-1").lane,
      drag.lastValidResolvedLayout.byId.get("connector:s3d-out-1").lane,
      `${previewMode}: cross-side selected members keep their shared row`
    );
    assertNoAuthoringOverlap(drag.lastValidResolvedLayout);
    const firstMap = itemLaneMap(drag.lastValidResolvedLayout);
    drag = harness.moveNodeToClientY(started, started.clientY - 1000000);
    assert.deepEqual(itemLaneMap(drag.lastValidResolvedLayout), firstMap, `${previewMode}: first boundary saturates`);
    drag = harness.moveNodeToClientY(started, started.clientY + 10000);
    assert.equal(drag.currentBoundaryIndex, drag.session.boundaries.length - 1);
    assertNoAuthoringOverlap(drag.lastValidResolvedLayout);
    const displayed = itemLaneMap(drag.lastValidResolvedLayout);
    harness.stopNodeDrag(started);
    assert.deepEqual(itemLaneMap(harness.api.getLayout()), displayed, `${previewMode}: group release matches preview`);
  }
});

test("Device Editor preview card drops insert between and append through compact boundaries", () => {
  const { api, template } = structuralEditorHarness({
    height: 700,
    cardTypes: [{
      id: "io-card",
      name: "I/O Card",
      kind: "io",
      connectors: [
        { id: "in", direction: "input", type: "hdmi" },
        { id: "out", direction: "output", type: "hdmi" }
      ]
    }],
    cardSlots: [
      { id: "slot-a", installedCardTypeId: "io-card", sideMask: "both", y: 100, connectorOverrides: {} },
      { id: "slot-b", installedCardTypeId: "io-card", sideMask: "both", y: 262, connectorOverrides: {} },
      { id: "slot-c", installedCardTypeId: "io-card", sideMask: "both", y: 424, connectorOverrides: {} }
    ]
  });
  const dropEvent = y => ({
    point: { x: 210, y },
    target: { closest: () => null },
    dataTransfer: {
      types: ["application/x-av-card-type"],
      getData: type => type === "application/x-av-card-type" ? "io-card" : ""
    }
  });
  const beforeIds = template.cardSlots.map(slot => slot.id);
  const beforeExtent = api.resolveEditorModularLayout(template).endLane;

  assert.equal(api.createCardSlotFromPreviewDrop(dropEvent(262), "io-card"), true);
  let layout = api.resolveEditorModularLayout(template);
  const insertedBetween = template.cardSlots.find(slot => !beforeIds.includes(slot.id));
  assert.ok(insertedBetween);
  assert.equal(layout.byId.get(`card:${insertedBetween.id}`).lane, 3);
  assert.equal(layout.endLane, beforeExtent + 3, "one inserted card grows by exactly its span");
  assertNoAuthoringOverlap(layout);

  const idsAfterBetween = template.cardSlots.map(slot => slot.id);
  assert.equal(api.createCardSlotFromPreviewDrop(dropEvent(template.height), "io-card"), true);
  layout = api.resolveEditorModularLayout(template);
  const appended = template.cardSlots.find(slot => !idsAfterBetween.includes(slot.id));
  assert.equal(layout.byId.get(`card:${appended.id}`).lane, layout.endLane - 3);
  assert.equal(layout.endLane, beforeExtent + 6, "append grows by one additional card span only");
  assertNoAuthoringOverlap(layout);
});

test("Device Editor repeated card drag cycles do not ratchet coordinates or height", () => {
  const harness = cardDragInteractionHarness({
    id: "repeated-card-drag-device",
    height: 520,
    connectors: [
      { id: "fixed-left", direction: "input", sideMask: "left", x: 0, y: 100 },
      { id: "fixed-right", direction: "output", sideMask: "right", x: 420, y: 100 }
    ],
    cardSlots: [
      { id: "moving", installedCardTypeId: "span", sideMask: "both", span: 2, y: 154, overrides: { port: { nameText: "Moving" } } },
      { id: "left", installedCardTypeId: "left", sideMask: "left", span: 1, y: 262, overrides: { port: { nameText: "Left" } } },
      { id: "right", installedCardTypeId: "right", sideMask: "right", span: 1, y: 262, overrides: { port: { nameText: "Right" } } },
      { id: "lower", installedCardTypeId: "lower", sideMask: "both", span: 2, y: 316, overrides: { port: { nameText: "Lower" } } }
    ],
    connectorRelationships: [{ id: "keep-relationship", members: ["fixed-left", "fixed-right"] }]
  }, { previewScale: 0.12 });
  const baselineMap = itemLaneMap(harness.api.getLayout());
  const baselineSlotYs = harness.template.cardSlots.map(slot => slot.y);
  const baselineIds = harness.template.cardSlots.map(slot => slot.id);
  const baselineOverrides = structuredClone(harness.template.cardSlots.map(slot => slot.overrides));
  const baselineRelationships = structuredClone(harness.template.connectorRelationships);
  const expectedStableHeight = harness.template.height;

  for (let cycle = 0; cycle < 10; cycle += 1) {
    const down = harness.startCardDrag(0, 100 + cycle * 2);
    harness.moveCardToLane(down, 4);
    harness.stopCardDrag(down);
    const up = harness.startCardDrag(0, 101 + cycle * 2);
    harness.moveCardToLane(up, 1);
    harness.stopCardDrag(up);
    assert.deepEqual(itemLaneMap(harness.api.getLayout()), baselineMap, `cycle ${cycle + 1}: lane map should return exactly`);
    assert.deepEqual(harness.template.cardSlots.map(slot => slot.y), baselineSlotYs, `cycle ${cycle + 1}: slot coordinates should not drift`);
    assert.equal(harness.template.height, expectedStableHeight, `cycle ${cycle + 1}: height should not ratchet`);
  }
  assert.equal(harness.counters.commits, 20);
  assert.deepEqual(harness.template.cardSlots.map(slot => slot.id), baselineIds);
  assert.deepEqual(harness.template.cardSlots.map(slot => slot.overrides), baselineOverrides);
  assert.deepEqual(harness.template.connectorRelationships, baselineRelationships);
});

test("Device Editor multi-lane input and output cards reverse, release, and cancel without preview drift", () => {
  const fixture = {
    id: "single-owner-video-fixture",
    name: "Single Owner Video Fixture",
    height: 640,
    connectors: [
      { id: "left-top", direction: "input", sideMask: "left", x: 0, y: 100 },
      { id: "right-top", direction: "output", sideMask: "right", x: 420, y: 100 },
      { id: "left-bottom", direction: "input", sideMask: "left", x: 0, y: 532 },
      { id: "right-bottom", direction: "output", sideMask: "right", x: 420, y: 532 }
    ],
    cardSlots: [
      { id: "input-card", installedCardTypeId: "input-type", sideMask: "left", span: 3, y: 154 },
      { id: "output-card", installedCardTypeId: "output-type", sideMask: "right", span: 2, y: 370 }
    ]
  };
  for (const previewMode of ["engine", "legacy"]) {
    for (const slotIndex of [0, 1]) {
      const releaseHarness = cardDragInteractionHarness(fixture, { previewScale: 0.11, previewMode });
      const baselineHeight = releaseHarness.template.height;
      const baselineEndLane = releaseHarness.api.getLayout().endLane;
      const started = releaseHarness.startCardDrag(slotIndex, 400 + slotIndex);
      let drag = null;
      [0, 3, 8, 3, 0, 8].forEach(targetLane => {
        drag = releaseHarness.moveCardToLane(started, targetLane, { rawLane: targetLane });
        assertNoAuthoringOverlap(drag.lastValidResolvedLayout);
        assert.equal(releaseHarness.template.height, baselineHeight, `${previewMode}: pointer motion must not resize the body`);
        assert.equal(drag.baselinePreviewHeight, releaseHarness.context.deviceHeightForSlotCounts(releaseHarness.template));
      });
      if (drag.currentBoundaryIndex === drag.originalBoundaryIndex) {
        for (const targetLane of [0, 4, 8]) {
          drag = releaseHarness.moveCardToLane(started, targetLane, { rawLane: targetLane });
          if (drag.currentBoundaryIndex !== drag.originalBoundaryIndex) break;
        }
      }
      assert.notEqual(drag.currentBoundaryIndex, drag.originalBoundaryIndex, `${previewMode}: release fixture must end on a changed boundary`);
      const displayed = itemLaneMap(drag.lastValidResolvedLayout);
      releaseHarness.stopCardDrag(started);
      assert.deepEqual(itemLaneMap(releaseHarness.api.getLayout()), displayed, `${previewMode}: release must commit the displayed layout`);
      const expectedCommittedHeight = drag.lastValidResolvedLayout.endLane === baselineEndLane
        ? baselineHeight
        : releaseHarness.context.deviceHeightForSlotCounts(releaseHarness.template);
      assert.equal(releaseHarness.template.height, expectedCommittedHeight, `${previewMode}: release applies at most one semantic height transition`);

      const cancelHarness = cardDragInteractionHarness(fixture, { previewScale: 0.11, previewMode });
      const cancelBaseline = structuredClone(cancelHarness.template);
      const cancelStarted = cancelHarness.startCardDrag(slotIndex, 500 + slotIndex);
      [8, 0, 4, 0].forEach(targetLane => {
        const cancelDrag = cancelHarness.moveCardToLane(cancelStarted, targetLane, { rawLane: targetLane });
        assertNoAuthoringOverlap(cancelDrag.lastValidResolvedLayout);
        assert.equal(cancelHarness.template.height, cancelBaseline.height);
      });
      cancelHarness.stopCardDrag(cancelStarted, "pointercancel");
      assert.deepEqual(cancelHarness.template, cancelBaseline, `${previewMode}: cancellation restores the exact baseline`);
      assert.equal(cancelHarness.counters.motionRollbacks, 1);
      assert.equal(cancelHarness.counters.commits, 0);
    }
  }
});

test("Device Editor model height ignores placement motion and follows only accepted layout", () => {
  const { api, context } = deviceHeightCalculationHarness();
  const template = {
    startY: 100,
    manualHeight: 0,
    hasSwappableCards: true,
    connectors: [{ id: "fixed", direction: "input", x: 0, y: 100 }],
    cardSlots: [{ id: "slot-a", installedCardTypeId: "card-a", span: 2, y: 154 }]
  };
  const acceptedLayout = {
    items: [
      { id: "connector:fixed", kind: "connector", y: 100, lane: 0, span: 1 },
      { id: "card:slot-a", kind: "card", y: 478, lane: 7, span: 2 }
    ]
  };
  const persistedHeight = api.deviceHeightForSlotCounts(template);
  const acceptedHeight = api.deviceHeightForSlotCounts(template, { layout: acceptedLayout });
  context.editorPlacementMotionVisualY = () => 99999;
  assert.equal(api.deviceHeightForSlotCounts(template), persistedHeight, "active motion must not affect persisted height calculation");
  assert.equal(api.deviceHeightForSlotCounts(template, { layout: acceptedLayout }), acceptedHeight, "active motion must not affect accepted-layout height");
  assert.ok(acceptedHeight > persistedHeight, "accepted downward lanes may grow height discretely");
  template.manualHeight = acceptedHeight + 200;
  assert.equal(api.deviceHeightForSlotCounts(template), acceptedHeight + 200, "manual height remains authoritative");

  const cardSlotDisplayY = runnableIndexFunction("cardSlotDisplayY", {
    Number,
    connectorStartYForTemplate: () => 100,
    editorPlacementMotionVisualY: () => null,
    editorCardSlotDrag: null,
    editorActiveStableDragLayout: () => null,
    editorResolvedCardSlotY: () => 154
  });
  assert.equal(cardSlotDisplayY(template, { id: "slot-a", y: 154 }), 154, "inactive motion must not coerce null into top-lane y=0");

  assert.doesNotMatch(functionSource("deviceContentHeightForSlotCounts"), /editorPlacementMotion/);
  assert.doesNotMatch(functionSource("deviceHeightForSlotCounts"), /editorPlacementMotion/);
  assert.doesNotMatch(functionSource("readonlyDeviceEditorPreviewTemplate"), /editorPlacementMotionBottomY/);
  assert.match(functionSource("startEditorCardSlotDrag"), /const coordinateFrame = captureEditorDragCoordinateFrame/);
  assert.match(functionSource("moveEditorNode"), /getEditorDragPreviewPoint\(event, editorCardSlotDrag\)/);
});

test("Device Editor card reorder freezes body height and Fit bounds through ownership settle", () => {
  const template = {
    id: "frozen-card-preview",
    name: "Frozen Card Preview",
    width: 420,
    height: 520,
    manualHeight: 0,
    cardSlots: [{ id: "slot-a", y: 154 }]
  };
  const baselineLayout = { items: [{ id: "card:slot-a", kind: "card", y: 154, lane: 1, span: 2 }] };
  const acceptedLayout = { items: [{ id: "card:slot-a", kind: "card", y: 802, lane: 13, span: 2 }] };
  const finalRenders = [];
  const context = {
    console,
    Math,
    Number,
    Object,
    String,
    structuredClone,
    editorPlacementMotionPreviewLock: null,
    editorPlacementMotionScheduler: null,
    editorPlacementMotionSampleCache: null,
    editorPlacementMotionClearWhenSettled: true,
    editorPlacementMotionState: { entries: new Map([["card:slot-a", {}]]) },
    editorEngineDynamicCardArtworkActive: true,
    editorEngineDynamicCardArtworkTextureRefreshPending: false,
    deviceEditorPlacementMotionModule: { clearPlacementMotion: state => state.entries.clear() },
    deviceEditorModal: { classList: { contains: () => false } },
    currentEditorTemplate: () => template,
    editorResizePreviewTemplateFor: draft => draft,
    deviceTemplateWidth: draft => Number(draft.width) || 420,
    editorPreviewDeviceName: draft => draft.name,
    validateDraftDefaults: draft => draft,
    editorActiveStableDragLayout: () => acceptedLayout,
    deviceHeightForSlotCounts: (_draft, options = {}) => options.layout === acceptedLayout ? 980 : 520,
    renderDeviceEditorPreview: options => finalRenders.push(structuredClone(options))
  };
  const api = vm.runInNewContext(`${[
    "setEditorEngineDynamicCardArtworkActive",
    "editorPlacementPreviewLockFor",
    "captureEditorPlacementPreviewLock",
    "clearEditorPlacementMotion",
    "readonlyDeviceEditorPreviewTemplate",
    "normalizeEditorPreviewBounds",
    "editorFullDevicePreviewBounds"
  ].map(functionSource).join("\n")}
    ({
      captureEditorPlacementPreviewLock,
      clearEditorPlacementMotion,
      readonlyDeviceEditorPreviewTemplate,
      editorFullDevicePreviewBounds,
      getLock: () => editorPlacementMotionPreviewLock,
      getDynamicOwner: () => editorEngineDynamicCardArtworkActive
    })`, context);
  const drag = {
    compactAuthoringDrag: true,
    baselineResolvedLayout: baselineLayout,
    baselinePreviewHeight: 520,
    baselinePreviewBounds: { x: 0, y: 0, width: 420, height: 520 }
  };

  api.captureEditorPlacementPreviewLock(drag, template);
  assert.equal(api.readonlyDeviceEditorPreviewTemplate(template).height, 520, "accepted lanes must not resize the body mid-drag");
  assert.deepEqual(
    { ...api.editorFullDevicePreviewBounds(template) },
    { x: 0, y: 0, width: 420, height: 520 },
    "floating and accepted motion must not alter Fit bounds"
  );
  api.clearEditorPlacementMotion({ renderFinal: true });
  assert.equal(api.getLock(), null, "settle completion releases the frozen preview bounds");
  assert.equal(api.getDynamicOwner(), false, "settle completion restores texture ownership");
  assert.deepEqual(finalRenders, [{ refreshTexture: true, motionFrame: false }]);
});

test("Engine Device Editor card motion has one visible owner per installed card", () => {
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

  const motionPositions = new Map([
    ["card:slot-a", 243.25],
    ["card:slot-b", 351.25]
  ]);
  const renderTemplate = {
    ...structuredClone(template),
    cardSlots: [
      ...structuredClone(template.cardSlots),
      { id: "slot-b", name: "Slot B", installedCardTypeId: "card-a", y: 262 }
    ]
  };
  const context = {
    Number,
    Math,
    DEVICE_WIDTH: 420,
    SLOT_HEIGHT: 54,
    editorActiveTab: "connectors",
    editorEngineDynamicCardArtworkActive: true,
    editorCardSlotDrag: { slotId: "slot-a" },
    editorNodeDrag: null,
    editorSlotIndex: 0,
    editorSelectedInstalledCardConnectorId: "slot-a__in-a",
    editorConnectorSnapGuide: null,
    editorPlacementMotionHasCardEntries: () => true,
    editorPlacementMotionVisualY: (id, fallback) => motionPositions.get(id) ?? fallback,
    editorActiveStableDragLayout: () => null,
    editorResolvedCardSlotY: (_draft, slot) => Number(slot.y),
    connectorStartYForTemplate: () => 100,
    cardTypeById: (draft, id) => draft.cardTypes.find(card => card.id === id),
    cardSlotLaneCount: () => 2,
    generatedCardConnectors: draft => draft.cardSlots.flatMap(slot => {
      const card = draft.cardTypes.find(candidate => candidate.id === slot.installedCardTypeId);
      const slotY = motionPositions.get(`card:${slot.id}`) ?? Number(slot.y);
      const counts = { input: 0, output: 0 };
      return (card?.connectors || []).map(source => {
        const direction = source.direction === "output" ? "output" : "input";
        const row = counts[direction]++;
        const x = direction === "output" ? 420 : 0;
        const y = slotY + 54 + row * 54;
        return {
          ...source,
          id: `${slot.id}__${source.id}`,
          sourceConnectorId: source.id,
          cardSlotId: slot.id,
          generatedFromCard: true,
          x,
          y,
          primaryAnchorId: direction,
          anchors: [{ id: direction, side: direction === "output" ? "right" : "left", x, y, primary: true }]
        };
      });
    }),
    isEditorV2ConnectorCandidate: connector => Array.isArray(connector?.anchors),
    editorConnectorAnchors: connector => connector.anchors || [],
    editorPrimaryAnchor: connector => connector.anchors?.[0] || { id: connector.direction, x: connector.x, y: connector.y },
    drawEditorConnectorNode: (parent, _connector, x, y) => parent.appendChild(testSvgNode("circle", { cx: x, cy: y })),
    connectorTypeLabel: connector => connector.type || "Connector",
    connectorFieldTitle: (_connector, field) => field,
    usesResolutionField: () => true,
    addVisibleInfoBoxes: (parent, connector) => parent.appendChild(testSvgNode("g", {
      "data-editor-card-field-y": connector.y
    })),
    state: { darkMode: true },
    createSvg: testSvgNode,
    normalizeColor: value => String(value || ""),
    estimateTitleTextWidth: (value, fontSize) => String(value || "").length * Number(fontSize || 0) * 0.56,
    isAdapterTemplate: () => false,
    deviceTemplateWidth: draft => Number(draft.width) || 420
  };
  const compositor = vm.runInNewContext(`${[
    "cardCaptionTextColor",
    "cardCaptionBackgroundColor",
    "drawCardCaption",
    "cardBandGeometryAtY",
    "cardBandGeometry",
    "cardSlotDisplayY",
    "editorAnchorConnector",
    "editorCardLocalConnector",
    "drawEditorInstalledCardConnectorVisuals",
    "drawCardSlotBands",
    "drawEditorEngineCardTextureMasks",
    "drawEditorEngineDynamicCardArtwork",
    "drawEditorEngineCardSlotOverlay",
    "drawEditorConnectorSnapGuide"
  ].map(functionSource).join("\n")}
    ({ drawEditorEngineDynamicCardArtwork, drawEditorEngineCardSlotOverlay, drawEditorConnectorSnapGuide })`, context);
  const root = testSvgNode("svg");
  compositor.drawEditorEngineDynamicCardArtwork(root, renderTemplate, { engineTextureSuppressed: true });
  compositor.drawEditorEngineCardSlotOverlay(root, renderTemplate);
  const rendered = testSvgDescendants(root);
  const artwork = rendered.filter(node => node.attributes?.["data-editor-card-slot-artwork"]);
  const bands = rendered.filter(node => node.attributes?.["data-editor-card-band"]);
  const captions = rendered.filter(node => node.attributes?.["data-editor-card-caption"]);
  const textureMasks = rendered.filter(node => node.attributes?.["data-editor-card-texture-mask"]);
  const hits = rendered.filter(node => node.attributes?.class === "editor-engine-card-slot-hit");
  const selections = rendered.filter(node => node.attributes?.["data-editor-card-slot-selection"]);
  const connectorLabels = rendered
    .filter(node => node.tagName === "text" && (node.textContent === "IN" || node.textContent === "OUT"))
    .map(node => node.textContent);

  assert.deepEqual(
    textureMasks.map(node => node.attributes["data-editor-card-texture-mask"]),
    ["slot-a", "slot-b"],
    "each baked baseline card band must be covered during dynamic ownership"
  );
  assert.deepEqual(
    textureMasks.map(node => node.attributes.y),
    [125, 233],
    "texture masks stay at committed slot rows rather than following animated cards"
  );
  assert.equal(root.childNodes[0].attributes?.["data-editor-card-texture-masks"], "true", "stale texture masks draw below live card artwork");
  assert.equal(root.childNodes[1].attributes?.["data-editor-dynamic-card-artwork"], "true", "live card artwork draws after the masks");
  assert.deepEqual(artwork.map(node => node.attributes["data-editor-card-slot-artwork"]), ["slot-a", "slot-b"]);
  assert.deepEqual(connectorLabels, ["IN", "OUT", "IN", "OUT"], "dynamic card connectors preserve installed nameText labels");
  assert.deepEqual(
    artwork.map(node => node.attributes.transform),
    ["translate(0 243.25)", "translate(0 351.25)"],
    "each installed card must have one parent translation at its sampled world Y"
  );
  assert.equal(bands.length, 2, "dynamic compositor should draw one band per installed slot");
  assert.equal(captions.length, 2, "dynamic compositor should draw one caption per installed slot");
  assert.deepEqual(captions.map(node => node.attributes["data-editor-card-caption"]), ["slot-a", "slot-b"]);
  captions.forEach(caption => {
    assert.equal(
      caption.parentNode?.attributes?.["data-editor-card-slot-artwork"],
      caption.attributes["data-editor-card-caption"],
      "caption must be owned by the same transformed artwork group"
    );
    assert.equal(caption.attributes.y, 3, "caption Y must remain card-local");
    assert.equal(caption.attributes["dominant-baseline"], "middle", "caption text stays vertically centered in its color bar");
  });
  bands.forEach(band => {
    assert.equal(band.attributes.y, -27, "title bar and card body must remain card-local");
  });
  const installedConnectors = rendered.filter(node => node.attributes?.["data-editor-card-connector-id"]);
  assert.equal(installedConnectors.length, 4, "all installed connector visuals must be rendered by their card owner");
  installedConnectors.forEach(connector => {
    assert.ok(
      connector.parentNode?.attributes?.["data-editor-card-slot-artwork"],
      "installed connector visuals must be direct children of the rigid card group"
    );
  });
  const selectedInstalled = installedConnectors.find(node => node.attributes?.["data-editor-installed-card-connector-id"] === "slot-a__in-a");
  assert.ok(selectedInstalled, "installed card child connectors expose stable selectable IDs");
  assert.match(selectedInstalled.attributes.class, /editor-node-selected/);
  artwork.forEach(owner => {
    const descendants = testSvgDescendants(owner);
    const hitIndex = descendants.findIndex(node => node.attributes?.class === "editor-engine-card-slot-hit");
    const connectorIndex = descendants.findIndex(node => node.attributes?.["data-editor-card-connector-id"]);
    assert.ok(hitIndex >= 0 && connectorIndex > hitIndex, "child connectors must render above the card drag hit region");
  });
  assert.equal(captions.some(node => node.attributes.y === 157 || node.attributes.y === 265), false, "no caption may remain at a source slot Y");
  assert.equal(hits.length, 2, "each card keeps one hit region");
  hits.forEach(hit => {
    assert.equal(hit.attributes.fill, "transparent");
    assert.equal(hit.attributes.stroke, "transparent");
    assert.equal(hit.childNodes.length, 0, "hit overlays must not reproduce card contents");
  });
  assert.deepEqual(selections.map(node => node.attributes["data-editor-card-slot-selection"]), ["slot-a"]);
  assert.equal(bands.find(node => node.attributes["data-editor-card-band"] === "slot-a").attributes.y, -27);
  assert.equal(bands.find(node => node.attributes["data-editor-card-band"] === "slot-b").attributes.y, -27);

  const localGeometrySignature = (rootNode, slotId) => {
    const owner = testSvgDescendants(rootNode).find(node => node.attributes?.["data-editor-card-slot-artwork"] === slotId);
    assert.ok(owner, `${slotId} should have one rigid owner`);
    return testSvgDescendants(owner).map(node => ({
      tagName: node.tagName,
      role: node.attributes?.["data-editor-card-band"]
        || node.attributes?.["data-editor-card-caption-bar"]
        || node.attributes?.["data-editor-card-caption"]
        || node.attributes?.["data-editor-card-connector-id"]
        || node.attributes?.["data-editor-card-field-y"]
        || node.attributes?.class
        || "",
      x: node.attributes?.x,
      y: node.attributes?.y,
      cx: node.attributes?.cx,
      cy: node.attributes?.cy,
      x1: node.attributes?.x1,
      y1: node.attributes?.y1,
      x2: node.attributes?.x2,
      y2: node.attributes?.y2
    }));
  };
  const baselineLocalGeometry = new Map([
    ["slot-a", localGeometrySignature(root, "slot-a")],
    ["slot-b", localGeometrySignature(root, "slot-b")]
  ]);
  const renderMotionFrame = positions => {
    positions.forEach((value, key) => motionPositions.set(key, value));
    const frame = testSvgNode("svg");
    compositor.drawEditorEngineDynamicCardArtwork(frame, renderTemplate, { engineTextureSuppressed: true });
    compositor.drawEditorEngineCardSlotOverlay(frame, renderTemplate);
    return frame;
  };
  const assertRigidFrame = (frame, expectedTransforms, label) => {
    const descendants = testSvgDescendants(frame);
    const owners = descendants.filter(node => node.attributes?.["data-editor-card-slot-artwork"]);
    const frameCaptions = descendants.filter(node => node.attributes?.["data-editor-card-caption"]);
    assert.equal(owners.length, 2, `${label}: no duplicate card owner may remain`);
    assert.equal(frameCaptions.length, 2, `${label}: exactly one visible title per card`);
    expectedTransforms.forEach((transform, slotId) => {
      const owner = owners.find(node => node.attributes["data-editor-card-slot-artwork"] === slotId);
      assert.equal(owner.attributes.transform, `translate(0 ${transform})`, `${label}: parent owns world movement`);
      assert.deepEqual(localGeometrySignature(frame, slotId), baselineLocalGeometry.get(slotId), `${label}: every child offset remains immutable`);
    });
    const slotACaption = frameCaptions.find(node => node.attributes["data-editor-card-caption"] === "slot-a");
    const slotAWorldY = expectedTransforms.get("slot-a") + Number(slotACaption.attributes.y);
    assert.notEqual(slotAWorldY, 157, `${label}: no caption remains at the baseline source coordinate`);
  };

  assertRigidFrame(renderMotionFrame(new Map([
    ["card:slot-a", 159.25],
    ["card:slot-b", 351.25]
  ])), new Map([
    ["slot-a", 159.25],
    ["slot-b", 351.25]
  ]), "small move");
  assertRigidFrame(renderMotionFrame(new Map([
    ["card:slot-a", 297.25],
    ["card:slot-b", 405.25]
  ])), new Map([
    ["slot-a", 297.25],
    ["slot-b", 405.25]
  ]), "boundary crossing");
  assertRigidFrame(renderMotionFrame(new Map([
    ["card:slot-a", 213.25],
    ["card:slot-b", 351.25]
  ])), new Map([
    ["slot-a", 213.25],
    ["slot-b", 351.25]
  ]), "reversal");
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const slotAY = cycle % 2 ? 243.25 : 297.25;
    const slotBY = cycle % 2 ? 351.25 : 405.25;
    assertRigidFrame(renderMotionFrame(new Map([
      ["card:slot-a", slotAY],
      ["card:slot-b", slotBY]
    ])), new Map([
      ["slot-a", slotAY],
      ["slot-b", slotBY]
    ]), `repeat ${cycle + 1}`);
  }

  const unsuppressed = testSvgNode("svg");
  compositor.drawEditorEngineDynamicCardArtwork(unsuppressed, renderTemplate, { engineTextureSuppressed: false });
  assert.equal(unsuppressed.childNodes.length, 0, "dynamic owner must wait for texture suppression");

  const guideLayer = testSvgNode("svg");
  compositor.drawEditorConnectorSnapGuide(guideLayer, renderTemplate);
  assert.equal(guideLayer.childNodes.length, 0, "card movement must not produce a snap-guide element");
  context.editorCardSlotDrag = null;
  context.editorNodeDrag = { itemId: "connector:a" };
  compositor.drawEditorConnectorSnapGuide(guideLayer, renderTemplate);
  assert.equal(guideLayer.childNodes.length, 0, "node movement must not produce a snap-guide element");

  const textureRefreshes = [];
  const surface = {
    replaceDevice(_device, options) { textureRefreshes.push(options.refreshTexture); },
    render() {}
  };
  const syncContext = {
    editorEnginePreviewModule: {
      createPreviewDeviceFromDraft(payload) {
        return {
          id: "preview-device",
          kind: "device",
          visual: {
            isPowerDistro: false,
            hasSwappableCards: true,
            visualCards: [{}],
            suppressCardAreasInTexture: payload.template.suppressCardAreasInTexture === true
          }
        };
      }
    },
    editorEnginePreviewDraftSynced: true,
    editorEngineDynamicCardArtworkTextureRefreshPending: true,
    editorEnginePreviewLastDeviceId: "",
    editorActiveTab: "connectors",
    ensureDeviceEditorEnginePreviewSurface: () => surface,
    editorEnginePreviewPayload: (_draft, options) => ({
      template: { suppressCardAreasInTexture: options.suppressCardAreasInTexture === true }
    }),
    editorActivePreviewBounds: () => ({ x: 0, y: 0, width: 420, height: 520 }),
    syncDeviceEditorEngineOverlayViewBox() {}
  };
  const syncPreview = runnableIndexFunction("syncDeviceEditorEnginePreview", syncContext);
  syncPreview(renderTemplate, {
    dynamicCardArtwork: true,
    refreshTexture: false,
    motionOnly: true,
    fitBounds: { x: 0, y: 0, width: 420, height: 520 }
  });
  assert.deepEqual(textureRefreshes, [true], "first dynamic frame must refresh to a suppressed texture");
  assert.equal(syncContext.editorEngineDynamicCardArtworkTextureRefreshPending, false);
  syncPreview(renderTemplate, {
    dynamicCardArtwork: true,
    refreshTexture: false,
    motionOnly: true,
    fitBounds: { x: 0, y: 0, width: 420, height: 520 }
  });
  assert.deepEqual(textureRefreshes, [true, false], "settle frames reuse the suppressed texture");
  syncContext.editorEngineDynamicCardArtworkTextureRefreshPending = true;
  syncPreview(renderTemplate, {
    dynamicCardArtwork: false,
    refreshTexture: true,
    motionOnly: false,
    fitBounds: { x: 0, y: 0, width: 420, height: 520 }
  });
  assert.deepEqual(textureRefreshes, [true, false, true], "ownership return refreshes the normal texture once");
  assert.equal(syncContext.editorEngineDynamicCardArtworkTextureRefreshPending, false);
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
    "card:slot-1": 0,
    "connector:A": 3,
    "connector:B": 4,
    "connector:C": 5
  });
  const cardItem = cardApi.editorPlacementItemByStableId(cardDrag.lastValidResolvedLayout, "card:slot-1");
  assert.equal(cardItem.span, 3, "stationary card should move as one interval");
  assert.equal(cardApi.commitEditorStablePlacementDrag(cardTemplate, cardDrag, { includeConnectors: true, includeCards: true }), true);
  assert.equal(cardTemplate.cardSlots[0].y, 100, "committed card slot should match the previewed compact row");
  assert.ok(cardTemplate.height >= 100 + 6 * 54 + 48, "height should contain the compact solved layout");
});

test("Device Editor composite connector far movement saturates at the last compact boundary and cancels exactly", () => {
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
    "connector:C": 0,
    "connector:A": 1,
    "connector:B": 2
  });
  assert.equal(drag.lastValidResolvedLayout.endLane, 3, "raw pointer distance must not grow the compact extent");
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

  assert.match(readonlyClone, /const sourceTemplate = editorResizePreviewTemplateFor\(template\);[\s\S]*const draft = structuredClone\(sourceTemplate\);/);
  assert.match(readonlyClone, /validateDraftDefaults\(draft\);/);
  assert.doesNotMatch(readonlyClone, /validateDraftDefaults\(template\)/);

  assert.match(renderPreview, /const previewTemplate = readonlyDeviceEditorPreviewTemplate\(template\);/);
  assert.doesNotMatch(renderPreview, /validateDraftDefaults\(template\);/);
  assert.match(renderPreview, /deviceTemplateWidth\(previewTemplate\)/);
  assert.match(renderPreview, /editorActivePreviewBounds\(previewTemplate\)/);
  assert.match(renderPreview, /previewTemplate\.connectors\.forEach/);
  assert.match(renderPreview, /drawEditorCardSlotBands\(deviceEditorPreview, previewTemplate\)/);
  assert.doesNotMatch(renderPreview, /deviceEditorPreview\.appendChild\(g\);[\s\S]*data-editor-card-connector-id/);

  assert.match(renderEnginePreview, /const previewTemplate = readonlyDeviceEditorPreviewTemplate\(template\);/);
  assert.doesNotMatch(renderEnginePreview, /validateDraftDefaults\(template\);/);
  assert.match(renderEnginePreview, /syncDeviceEditorEnginePreview\(previewTemplate/);
  assert.match(renderEnginePreview, /drawEditorEngineConnectorOverlay\(deviceEditorPreview, previewTemplate\)/);
  assert.match(engineClone, /readonlyDeviceEditorPreviewTemplate\(template\)/);
  assert.match(engineClone, /connector\.hiddenOnCanvas = true/);
});

test("Engine card-motion handoff suppresses static card pixels without mutating card definitions", () => {
  const source = {
    id: "card-motion-handoff",
    name: "Card Motion Handoff",
    width: 420,
    height: 320,
    hasSwappableCards: true,
    connectors: [],
    cardTypes: [{
      id: "hdmi-card",
      name: "HDMI 2.0",
      connectors: [{ id: "hdmi-1", type: "hdmi", direction: "input", x: 0, y: 54 }]
    }],
    cardSlots: [{ id: "slot-a", installedCardTypeId: "hdmi-card", y: 154 }]
  };
  const clone = runnableIndexFunction("editorEnginePreviewTemplateClone", {
    editorResizePreviewTemplateFor: template => template,
    readonlyDeviceEditorPreviewTemplate: template => structuredClone(template),
    applyEditorPlacementVisualsToPreviewTemplate: draft => draft
  });
  const dynamicDraft = clone(source, { suppressCardAreasInTexture: true });
  assert.equal(dynamicDraft.suppressCardAreasInTexture, true);
  assert.equal(dynamicDraft.cardTypes[0].connectors[0].hiddenOnCanvas, true);
  assert.equal(source.cardTypes[0].connectors[0].hiddenOnCanvas, undefined, "authoring card definitions remain immutable");

  const previewPayload = template => ({
    template,
    projectData: { state: { deviceLibrary: [template], nodeLibrary: [] } },
    instance: {
      instanceId: "card-motion-preview",
      id: "card-motion-preview",
      templateId: template.id,
      templateOverride: template,
      name: template.name,
      x: 0,
      y: 0
    }
  });
  const dynamicDevice = createPreviewDeviceFromDraft(previewPayload(dynamicDraft), 0);
  const dynamicConnector = dynamicDevice.connectors.find(connector => connector.generatedFromCard);
  assert.equal(dynamicConnector?.id, "slot-a__hdmi-1");
  assert.equal(dynamicConnector?.hiddenOnCanvas, true, "project adaptation must preserve the editor handoff flag");

  const scene = new SceneGraph();
  scene.setData({ devices: [dynamicDevice], wires: [], racks: [] });
  assert.equal(
    scene.getConnector(dynamicDevice.id, dynamicConnector.id)?.hiddenOnCanvas,
    true,
    "SceneGraph normalization and visibility must keep the Engine card layer suppressed"
  );

  const staticDraft = clone(source, { suppressCardAreasInTexture: false });
  assert.equal(staticDraft.suppressCardAreasInTexture, undefined);
  assert.equal(staticDraft.cardTypes[0].connectors[0].hiddenOnCanvas, undefined, "static ownership restores normal connector rendering");
  const staticDevice = createPreviewDeviceFromDraft(previewPayload(staticDraft), 0);
  assert.equal(
    staticDevice.connectors.find(connector => connector.generatedFromCard)?.hiddenOnCanvas,
    false,
    "normal preview rendering must continue to expose installed card connectors"
  );
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
  assert.doesNotMatch(hydrateOverrides, /normalizeMixedDeviceRows|normalizeConnectorRows|deviceHeightForSlotCounts/, "instance metadata hydration must preserve placement exactly");
  assert.match(pruneOverrides, /effectiveTemplateConnectors\(editedTemplate\)/);
  assert.match(pruneOverrides, /EDITOR_INSTANCE_CONNECTOR_OVERRIDE_FIELDS/);
  assert.match(pruneOverrides, /EDITOR_INSTANCE_DERIVED_CONNECTOR_OVERRIDE_FIELDS/);
  assert.match(INDEX_HTML, /const EDITOR_INSTANCE_CONNECTOR_OVERRIDE_FIELDS = new Set\(CARD_SLOT_OVERRIDE_FIELDS\);/);
  assert.match(INDEX_HTML, /"displayLabel",[\s\S]*"colorSegments",[\s\S]*"installedModuleEffectiveType"/);
});

test("release-hardening deterministic edit trace preserves placement invariants", t => {
  const source = RELEASE_HARDENING_FIXTURE.state.deviceLibrary.find(item => item.id === "release-modular-chassis");
  const fixture = structuralEditorHarness(source);
  const { api, context, counters } = fixture;
  const trace = [];
  const current = () => context.editorDraft[0];
  const check = name => {
    trace.push(name);
    const template = current();
    assertEditorPlacementInvariants(api, template, name, context);
    const validIds = new Set((template.connectors || []).map(connector => connector.id));
    assert.ok([...context.editorSelectedNodeIds].every(id => validIds.has(id)), `${name}: chassis selection should contain surviving stable IDs only`);
  };
  const moveItem = (itemId, targetLane, reverseLane = null) => {
    const template = current();
    const startY = context.connectorStartYForTemplate(template);
    const layout = api.resolveEditorModularLayout(template);
    const session = createModularInsertionDragSession(layout.items, itemId, { startY, slotHeight: 54 });
    if (reverseLane !== null) resolveModularInsertionDrag(session.snapshot, itemId, reverseLane, { startY, slotHeight: 54 });
    const resolved = resolveModularInsertionDrag(session.snapshot, itemId, targetLane, { startY, slotHeight: 54 });
    assert.ok(isValidModularInsertionResult(session.snapshot, resolved, itemId, targetLane, { startY, slotHeight: 54 }));
    api.applyEditorStableResolvedLayout(template, resolved);
  };

  current().height = context.deviceHeightForSlotCounts(current());
  context.editorSelectedNodeIds = new Set(["release-left", "release-both"]);
  context.editorSelectedNodeIndex = current().connectors.findIndex(connector => connector.id === "release-left");
  check("open fixture");

  api.addEditorNode("input", { type: "hdmi" });
  check("add left connector");
  api.addEditorNode("output", { type: "sdi" });
  check("add right connector");
  api.commitEditorStructuralEdit(current(), {
    primaryItemId: "connector:trace-both",
    mutate(draft, transaction) {
      const y = transaction.targetYForLane(2);
      draft.connectors.push({
        id: "trace-both",
        schemaVersion: 2,
        type: "usb-c",
        direction: "io",
        signalDirection: "bidirectional",
        displaySide: "both",
        primaryAnchorId: "left",
        sideMask: "both",
        x: 0,
        y,
        anchors: [
          { id: "left", side: "left", x: 0, y, primary: true },
          { id: "right", side: "right", x: draft.width, y: y + 7 }
        ]
      });
      return { hardTargets: { "connector:trace-both": 2 } };
    }
  });
  check("add both-side connector");

  const lastConnector = current().connectors.at(-2);
  const lastLayoutItem = api.resolveEditorModularLayout(current()).byId.get(`connector:${lastConnector.id}`);
  moveItem(`connector:${lastConnector.id}`, Math.max(0, lastLayoutItem.lane - 2), lastLayoutItem.lane + 1);
  check("reverse single drag before release");

  const cancelBefore = JSON.stringify(current());
  const cancelLayout = api.resolveEditorModularLayout(current());
  const cancelItem = cancelLayout.items.find(item => item.kind === "connector");
  const cancelSession = createModularInsertionDragSession(cancelLayout.items, cancelItem.id, {
    startY: context.connectorStartYForTemplate(current()),
    slotHeight: 54
  });
  resolveModularInsertionDrag(cancelSession.snapshot, cancelItem.id, cancelItem.lane + 2, {
    startY: context.connectorStartYForTemplate(current()),
    slotHeight: 54
  });
  assert.equal(JSON.stringify(current()), cancelBefore, "cancelled drag must leave the live template byte-for-byte unchanged");
  check("cancel connector drag");

  {
    const template = current();
    const startY = context.connectorStartYForTemplate(template);
    const layout = api.resolveEditorModularLayout(template);
    const selectedIds = ["connector:release-left", "connector:release-network-in"];
    const session = createModularCompositeInsertionDragSession(layout.items, selectedIds, selectedIds[0], { startY, slotHeight: 54 });
    const targetLane = Math.max(0, session.primaryOriginalLane + 1);
    const resolved = resolveModularCompositeInsertionDrag(session, targetLane, { startY, slotHeight: 54 });
    assert.ok(isValidModularCompositeInsertionResult(session, resolved, targetLane, { startY, slotHeight: 54 }));
    api.applyEditorStableResolvedLayout(template, resolved);
  }
  check("composite non-contiguous drag");

  {
    const layout = api.resolveEditorModularLayout(current());
    const card = layout.byId.get("card:release-slot-io");
    moveItem(card.id, Math.max(0, card.lane - 1));
  }
  check("drag variable-span card");

  const inputSlotIndex = current().cardSlots.findIndex(slot => slot.id === "release-slot-input");
  assert.equal(api.installCardInSlot(inputSlotIndex, "release-output-card"), true);
  check("replace installed card");

  context.editorCardIndex = current().cardTypes.findIndex(card => card.id === "release-io-card");
  api.changeEditorCardKind("input");
  check("change reusable card kind");
  const editedCard = current().cardTypes[context.editorCardIndex];
  const survivingCardConnectorId = editedCard.connectors[0].id;
  api.setEditorCardNodeSelection(0);
  api.setEditorCardNodeSelection(1, { add: true });
  const removedCardConnectorId = editedCard.connectors[1].id;
  api.removeCardConnector(1);
  assert.equal(selectedCardConnectorIds(current(), context).includes(removedCardConnectorId), false);
  assert.ok(selectedCardConnectorIds(current(), context).includes(survivingCardConnectorId), "surviving card selection should remain stable");
  check("remove card connector and preserve selection");

  const slotsBeforeToggle = JSON.stringify(current().cardSlots);
  current().hasSwappableCards = false;
  check("disable swappable cards");
  current().hasSwappableCards = true;
  assert.equal(JSON.stringify(current().cardSlots), slotsBeforeToggle, "feature toggle must not discard slot data");
  check("restore swappable cards");

  context.editorLedProcessor.checked = true;
  context.editorLedOutputCount.value = "4";
  api.applyLedProcessorSettings();
  check("generate LED outputs");
  context.editorLedOutputCount.value = "2";
  api.applyLedProcessorSettings();
  check("reduce LED outputs");

  context.editorEthernetSwitch.checked = true;
  context.editorSwitchPortCount.value = "2";
  context.editorSwitchPortType.value = "1g-rj45";
  api.addEthernetSwitchPortBatch();
  check("add Ethernet batch");

  context.editorPowerDistro.checked = true;
  api.applyPowerDistroSettings();
  check("enable Power Distro");
  context.editorPowerDistro.checked = false;
  api.applyPowerDistroSettings();
  check("disable Power Distro");

  const faceBeforeResize = context.faceImagePlacement(current(), current().width);
  const faceResizeStart = {
    x: faceBeforeResize.x + faceBeforeResize.width,
    y: faceBeforeResize.y + faceBeforeResize.height / 2
  };
  api.beginEditorResizeSession(resizePointer(799, faceResizeStart.x, faceResizeStart.y, "pointerdown"), {
    kind: "custom-face-image",
    handle: "e",
    startPoint: faceResizeStart
  });
  api.updateEditorResizeSessionFromEvent(resizePointer(799, faceResizeStart.x - 24, faceResizeStart.y));
  context.flushAnimationFrames();
  api.finishEditorResizeSession(resizePointer(799, faceResizeStart.x - 24, faceResizeStart.y, "pointerup"));
  check("commit faceplate resize");
  const faceCancelBefore = JSON.stringify(current());
  const cancelFace = context.faceImagePlacement(current(), current().width);
  const faceCancelStart = { x: cancelFace.x + cancelFace.width, y: cancelFace.y + cancelFace.height };
  api.beginEditorResizeSession(resizePointer(800, faceCancelStart.x, faceCancelStart.y, "pointerdown"), {
    kind: "custom-face-image",
    handle: "se",
    startPoint: faceCancelStart
  });
  api.updateEditorResizeSessionFromEvent(resizePointer(800, faceCancelStart.x + 50, faceCancelStart.y + 50));
  context.flushAnimationFrames();
  api.cancelEditorResizeSession(resizePointer(800, faceCancelStart.x + 50, faceCancelStart.y + 50, "pointercancel"));
  assert.equal(JSON.stringify(current()), faceCancelBefore);
  check("cancel faceplate resize");

  const startHeight = current().height;
  api.beginEditorResizeSession(resizePointer(801, 200, startHeight, "pointerdown"), {
    kind: "device-height",
    edge: "bottom",
    startPoint: { x: 200, y: startHeight }
  });
  api.updateEditorResizeSessionFromEvent(resizePointer(801, 200, startHeight + 54));
  context.flushAnimationFrames();
  api.finishEditorResizeSession(resizePointer(801, 200, startHeight + 54, "pointerup"));
  check("commit device resize");
  const resizeCancelBefore = JSON.stringify(current());
  api.beginEditorResizeSession(resizePointer(802, 200, current().height, "pointerdown"), {
    kind: "device-height",
    edge: "bottom",
    startPoint: { x: 200, y: current().height }
  });
  api.updateEditorResizeSessionFromEvent(resizePointer(802, 200, current().height + 108));
  context.flushAnimationFrames();
  api.cancelEditorResizeSession(resizePointer(802, 200, current().height + 108, "pointercancel"));
  assert.equal(JSON.stringify(current()), resizeCancelBefore);
  check("cancel device resize");

  const uploadTarget = api.captureEditorFaceplateUploadTarget();
  assert.ok(api.commitPreparedEditorFaceplateUpload(uploadTarget, {
    dataUrl: "data:image/png;base64,release-replacement",
    thumbnailDataUrl: "data:image/png;base64,release-replacement-thumb",
    width: 1200,
    height: 300
  }));
  check("replace face image");
  assert.ok(api.applyEditorFaceImageRemoval());
  check("remove face image");
  assert.ok(api.applyEditorFaceplateDeletion());
  check("delete faceplate");
  assert.ok(api.applyEditorFaceImageRemoval());
  check("restore faceplate");

  api.saveTemplateAsDefault(current());
  const defaultLaneMap = itemLaneMap(api.resolveEditorModularLayout(current()));
  current().brand = "Changed after default";
  current().connectors[0].nameText = "Changed field";
  assert.equal(api.resetTemplateToDefault(current()), true);
  assert.deepEqual(itemLaneMap(api.resolveEditorModularLayout(current())), defaultLaneMap);
  check("save and reset default configuration");

  const serialized = JSON.stringify(current());
  context.editorDraft[0] = JSON.parse(serialized);
  check("serialize reload and reopen");
  api.addEditorNode("input", { type: "dvi" });
  check("continue editing after reopen");
  assert.ok(counters.solverCalls > 0, "trace should exercise the structural solver");
  assert.ok(counters.animationSeeds > 0, "committed structural edits should animate");
  t.diagnostic(`release hardening trace operations: ${trace.length}`);
  t.diagnostic(`structural sessions: ${counters.structuralSessions}, solver calls: ${counters.solverCalls}, animation seeds: ${counters.animationSeeds}`);
});

test("release-hardening seeded mixed-operation soak is deterministic", t => {
  const seeds = [0x541400, 0x5eed5, 0xc0ffee, 0xdecade, 0x13579b, 0x2468ac];
  const operationsPerSeed = 28;

  const runSeed = seed => {
    const random = seededGenerator(seed);
    const source = structuredClone(RELEASE_HARDENING_FIXTURE.state.deviceLibrary.find(item => item.id === "release-modular-chassis"));
    source.id = `stress-${seed.toString(16)}`;
    source.name = `Stress ${seed.toString(16)}`;
    const fixture = structuralEditorHarness(source);
    const { api, context, counters } = fixture;
    const trace = [];
    const stressConnectorIds = new Set();
    const current = () => context.editorDraft[0];
    current().height = context.deviceHeightForSlotCounts(current());

    const check = operation => {
      trace.push(operation);
      assertEditorPlacementInvariants(api, current(), `seed ${seed} after ${operation}`, context);
      assert.equal(context.editorResizeSession, null, `seed ${seed}: resize session should settle after ${operation}`);
      assert.equal(context.editorResizePreviewTemplate, null, `seed ${seed}: resize preview should settle after ${operation}`);
      assert.equal(context.flushAnimationFrames(), 0, `seed ${seed}: no scheduled resize frame should survive ${operation}`);
    };

    const applyDrag = (item, targetLane) => {
      const template = current();
      const startY = context.connectorStartYForTemplate(template);
      const session = createModularInsertionDragSession(api.resolveEditorModularLayout(template).items, item.id, { startY, slotHeight: 54 });
      const resolved = resolveModularInsertionDrag(session.snapshot, item.id, targetLane, { startY, slotHeight: 54 });
      assert.ok(isValidModularInsertionResult(session.snapshot, resolved, item.id, targetLane, { startY, slotHeight: 54 }));
      const stableIds = (template.connectors || []).map(connector => connector.id);
      api.applyEditorStableResolvedLayout(template, resolved);
      assert.deepEqual(template.connectors.map(connector => connector.id), stableIds, "coordinate-only drag should preserve connector IDs");
    };

    for (let step = 0; step < operationsPerSeed; step += 1) {
      const operationKind = step % 14;
      try {
        if (operationKind === 0) {
          const sideMask = random.pick(["left", "right", "both"]);
          const id = `stress-${seed.toString(16)}-${step}`;
          const targetLane = random.integer(Math.max(2, api.resolveEditorModularLayout(current()).endLane + 2));
          api.commitEditorStructuralEdit(current(), {
            primaryItemId: `connector:${id}`,
            mutate(draft, transaction) {
              const y = transaction.targetYForLane(targetLane);
              const direction = sideMask === "right" ? "output" : sideMask === "both" ? "io" : "input";
              const connector = {
                id,
                schemaVersion: 2,
                type: "hdmi",
                physicalType: "hdmi",
                connectorType: "hdmi",
                label: "HDMI",
                direction,
                signalDirection: direction === "io" ? "bidirectional" : direction,
                displaySide: sideMask,
                sideMask,
                x: sideMask === "right" ? draft.width : 0,
                y,
                primaryAnchorId: sideMask === "right" ? "right" : "left",
                anchors: sideMask === "both"
                  ? [
                      { id: "left", side: "left", x: 0, y, primary: true },
                      { id: "right", side: "right", x: draft.width, y: y + 3 }
                    ]
                  : [{ id: sideMask, side: sideMask, x: sideMask === "right" ? draft.width : 0, y, primary: true }],
                empty: false
              };
              draft.connectors.push(connector);
              return { hardTargets: { [`connector:${id}`]: targetLane } };
            }
          });
          stressConnectorIds.add(id);
          check(`insert ${id}`);
        } else if (operationKind === 1) {
          const layout = api.resolveEditorModularLayout(current());
          const item = random.pick(layout.items);
          const targetLane = Math.max(0, item.lane + random.pick([-2, -1, 1, 2]));
          applyDrag(item, targetLane);
          check(`drag ${item.id} to ${targetLane}`);
        } else if (operationKind === 2) {
          const before = JSON.stringify(current());
          const layout = api.resolveEditorModularLayout(current());
          const item = random.pick(layout.items);
          const startY = context.connectorStartYForTemplate(current());
          const session = createModularInsertionDragSession(layout.items, item.id, { startY, slotHeight: 54 });
          resolveModularInsertionDrag(session.snapshot, item.id, Math.max(0, item.lane + random.pick([-2, 2])), { startY, slotHeight: 54 });
          assert.equal(JSON.stringify(current()), before, "cancelled drag should not mutate the committed template");
          check(`cancel drag ${item.id}`);
        } else if (operationKind === 3) {
          const template = current();
          const layout = api.resolveEditorModularLayout(template);
          const connectorItems = layout.items.filter(item => item.kind !== "card");
          const firstIndex = random.integer(connectorItems.length);
          let secondIndex = random.integer(connectorItems.length - 1);
          if (secondIndex >= firstIndex) secondIndex += 1;
          const selected = [connectorItems[firstIndex], connectorItems[secondIndex]].filter(Boolean);
          if (selected.length === 2) {
            const startY = context.connectorStartYForTemplate(template);
            const selectedIds = selected.map(item => item.id);
            const session = createModularCompositeInsertionDragSession(layout.items, selectedIds, selectedIds[0], { startY, slotHeight: 54 });
            const targetLane = Math.max(0, session.primaryOriginalLane + random.pick([-1, 1, 2]));
            const resolved = resolveModularCompositeInsertionDrag(session, targetLane, { startY, slotHeight: 54 });
            assert.ok(isValidModularCompositeInsertionResult(session, resolved, targetLane, { startY, slotHeight: 54 }));
            api.applyEditorStableResolvedLayout(template, resolved);
          }
          check(`composite drag ${selected.map(item => item.id).join(",")}`);
        } else if (operationKind === 4) {
          const layout = api.resolveEditorModularLayout(current());
          const cards = layout.items.filter(item => item.kind === "card");
          const card = random.pick(cards);
          if (card) applyDrag(card, Math.max(0, card.lane + random.pick([-2, -1, 1, 2])));
          check(`card drag ${card?.id || "none"}`);
        } else if (operationKind === 5) {
          const template = current();
          const slotIndex = random.integer(template.cardSlots.length);
          const cardId = random.pick(template.cardTypes).id;
          api.installCardInSlot(slotIndex, cardId);
          check(`replace ${template.cardSlots[slotIndex].id} with ${cardId}`);
        } else if (operationKind === 6) {
          const template = current();
          context.editorCardIndex = random.integer(template.cardTypes.length);
          const nextKind = random.pick(["input", "output", "io"]);
          api.changeEditorCardKind(nextKind);
          const card = current().cardTypes[context.editorCardIndex];
          const direction = card.kind === "output" ? "output" : card.kind === "input" ? "input" : random.pick(["input", "output"]);
          api.addCardConnector(direction);
          const updatedCard = current().cardTypes[context.editorCardIndex];
          api.fillCardConnector(updatedCard.connectors.length - 1, random.pick(["hdmi", "dvi"]));
          check(`change card ${card.id} to ${nextKind} and grow ${direction}`);
        } else if (operationKind === 7) {
          const removable = [...stressConnectorIds].filter(id => current().connectors.some(connector => connector.id === id));
          const removeId = random.pick(removable);
          if (removeId) {
            api.removeEditorNode(current().connectors.findIndex(connector => connector.id === removeId));
            stressConnectorIds.delete(removeId);
          }
          check(`delete ${removeId || "none"}`);
        } else if (operationKind === 8) {
          context.editorLedProcessor.checked = !current().isLedProcessor;
          context.editorLedOutputCount.value = String(2 + random.integer(4));
          api.applyLedProcessorSettings();
          check(`LED ${context.editorLedProcessor.checked ? "on" : "off"} ${context.editorLedOutputCount.value}`);
        } else if (operationKind === 9) {
          const slots = JSON.stringify(current().cardSlots);
          current().hasSwappableCards = false;
          current().hasSwappableCards = true;
          assert.equal(JSON.stringify(current().cardSlots), slots, "swappable-card toggle should preserve slots");
          check("toggle swappable cards off/on");
        } else if (operationKind === 10) {
          context.editorPowerDistro.checked = !current().isPowerDistro;
          api.applyPowerDistroSettings();
          check(`Power Distro ${context.editorPowerDistro.checked ? "on" : "off"}`);
        } else if (operationKind === 11) {
          if (current().faceImage) {
            api.applyEditorFaceImageRemoval();
            check("remove face image");
          } else if (!current().faceplateDeleted) {
            api.applyEditorFaceplateDeletion();
            check("delete faceplate");
          } else {
            const target = api.captureEditorFaceplateUploadTarget();
            api.commitPreparedEditorFaceplateUpload(target, {
              dataUrl: `data:image/png;base64,stress-${seed}`,
              thumbnailDataUrl: `data:image/png;base64,stress-thumb-${seed}`,
              width: 1000,
              height: 250
            });
            check("restore prepared face image");
          }
        } else if (operationKind === 12) {
          const template = current();
          const pointerId = seed + step;
          const startHeight = template.height;
          const start = resizePointer(pointerId, template.width / 2, startHeight, "pointerdown");
          api.beginEditorResizeSession(start, {
            kind: "device-height",
            edge: "bottom",
            startPoint: { x: template.width / 2, y: startHeight }
          });
          const shouldCancel = random.next() < 0.5;
          const moved = resizePointer(pointerId, template.width / 2, startHeight + (shouldCancel ? 108 : 54));
          api.updateEditorResizeSessionFromEvent(moved);
          context.flushAnimationFrames();
          if (shouldCancel) api.cancelEditorResizeSession({ ...moved, type: "pointercancel" });
          else api.finishEditorResizeSession({ ...moved, type: "pointerup" });
          check(`resize ${shouldCancel ? "cancel" : "commit"}`);
        } else {
          const serialized = JSON.stringify(current());
          context.editorDraft[0] = JSON.parse(serialized);
          check("save/reload");
        }
      } catch (error) {
        throw new Error(`seed ${seed} failed at step ${step} after [${trace.join(" -> ")}]`, { cause: error });
      }
    }

    return {
      template: JSON.parse(JSON.stringify(current())),
      lanes: itemLaneMap(api.resolveEditorModularLayout(current())),
      trace,
      counters: {
        structuralSessions: counters.structuralSessions,
        solverCalls: counters.solverCalls,
        animationSeeds: counters.animationSeeds,
        previewRenders: counters.previewRenders,
        editorRenders: counters.editorRenders
      }
    };
  };

  let totalOperations = 0;
  seeds.forEach(seed => {
    const first = runSeed(seed);
    const repeated = runSeed(seed);
    assert.deepEqual(repeated, first, `seed ${seed} should replay identically`);
    totalOperations += first.trace.length;
  });
  t.diagnostic(`seeded release soak: ${seeds.length} seeds, ${totalOperations} committed/cancelled operations (${totalOperations * 2} including deterministic replay)`);
});

test("nonstructural Device Editor edits preserve placement and bypass normalizers", () => {
  const renderEditor = functionSource("renderDeviceEditor");
  const syncFields = functionSource("syncEditorFieldsToDraft");
  const hydrateOverrides = functionSource("hydrateEditorDraftFromInstanceConnectorOverrides");
  const setModule = functionSource("setTemplateConnectorModule");
  const saveDefault = functionSource("saveTemplateAsDefault");
  const hasCardsListener = sourceSlice(INDEX_HTML, 'editorHasCards.addEventListener("change"', 'editorLedProcessor.addEventListener("change"');
  const forbidden = /normalizeMixedDeviceRows|normalizeConnectorRows|normalizeCardSlots/;

  assert.match(renderEditor, /normalizePlacement: false/);
  assert.doesNotMatch(syncFields, forbidden);
  assert.doesNotMatch(hydrateOverrides, forbidden);
  assert.doesNotMatch(setModule, forbidden);
  assert.doesNotMatch(saveDefault, forbidden);
  assert.doesNotMatch(hasCardsListener, forbidden);
  assert.doesNotMatch(INDEX_HTML, /deviceEditorPreview\.addEventListener\("dblclick"/);
  assert.match(functionSource("renderSelectedConnectorSettings"), /data-selected-connector-caption/);
  assert.match(functionSource("renderSelectedConnectorSettings"), /<span>Name<\/span>/);
  assert.match(functionSource("renderSelectedConnectorSettings"), /<span>Text<\/span>/);
  assert.match(functionSource("canvasConnectorFieldSectionMarkup"), /data-canvas-connector-caption/);
  assert.match(functionSource("canvasConnectorFieldSectionMarkup"), /<span>Name<\/span>/);
  assert.match(PRODUCTION_BRIDGE_SOURCE, /<span>Name<\/span>[\s\S]*data-engine-connector-caption/);
  assert.match(PRODUCTION_BRIDGE_SOURCE, /<span>Text<\/span>[\s\S]*data-engine-connector-field/);
  assert.doesNotMatch(functionSource("generatedCardConnectors"), /ensureModularDefaults/);
  assert.doesNotMatch(INDEX_HTML, /function\s+(?:reorderCardSlot|shiftRowsAfterFaceChange|setEditorPowerDistroFaceHeight|normalizeCardSlots|ensureEthernetPair)\b/);

  const fixture = structuralEditorHarness({
    connectors: [
      testConnector("meta-left", "left", 0, { v2: true }),
      testConnector("meta-right", "right", 0, { v2: true, direction: "output" })
    ],
    cardTypes: [],
    cardSlots: []
  });
  fixture.template.height = fixture.context.deviceHeightForSlotCounts(fixture.template);
  const before = {
    lanes: itemLaneMap(fixture.api.resolveEditorModularLayout(fixture.template)),
    anchors: structuredClone(fixture.template.connectors.map(connector => connector.anchors)),
    height: fixture.template.height,
    solverCalls: fixture.counters.solverCalls,
    animations: fixture.counters.animationSeeds
  };
  fixture.template.connectors[0].nameText = "Renamed";
  fixture.template.connectors[0].fiberMode = "single-mode";
  fixture.template.techSpecs = "Metadata only";
  const reloaded = JSON.parse(JSON.stringify(fixture.template));
  assert.deepEqual(itemLaneMap(fixture.api.resolveEditorModularLayout(reloaded)), before.lanes);
  assert.deepEqual(reloaded.connectors.map(connector => connector.anchors), before.anchors);
  assert.equal(reloaded.height, before.height);
  assert.equal(fixture.counters.solverCalls, before.solverCalls);
  assert.equal(fixture.counters.animationSeeds, before.animations);
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
  const editorWheel = functionSource("handleEditorPreviewWheel");
  assert.match(editorWheel, /if \(editorPreviewWheelZoomModifierActive\(event\)\)/);
  assert.match(editorWheel, /event\.preventDefault\(\);/);
  assert.match(editorWheel, /zoomEditorPreviewSvg\(targetSvg, editorPreviewWheelZoomFactor\(event\), event\);/);
  assert.match(editorWheel, /editorPreviewPan\.y \+= worldDeltaY/);
  assert.match(editorWheel, /editorEnginePreviewSurface\.setCamera/);
  assert.match(editorWheel, /shiftEditorDragCoordinateFrame\(editorNodeDrag, worldDeltaX, worldDeltaY\)/);
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

test("Device Editor interaction ownership and relationship authoring stay tab-scoped", () => {
  const startDrag = functionSource("startEditorNodeDrag");
  assertOrder(startDrag, [
    'if (editorActiveTab === "cards")',
    'if (editorActiveTab === "faceplate")',
    'if (editorActiveTab !== "connectors") return;',
    "const installedCardConnector = editorInstalledCardConnectorFromEvent(event);"
  ], "Only Connectors should reach chassis/card placement dragging");
  assert.match(functionSource("startEditorResizeDrag"), /editorActiveTab !== "faceplate"/);
  assert.match(functionSource("startEditorFaceImageResize"), /editorActiveTab !== "faceplate"/);
  assert.match(functionSource("drawEditorResizeHandles"), /editorActiveTab !== "faceplate"/);
  assert.match(functionSource("renderCardConnectorRelationshipsPanel"), /data-card-relationship-toggle="exclusive"/);
  assert.match(functionSource("renderCardConnectorRelationshipsPanel"), /data-card-relationship-toggle="through"/);
  assert.match(functionSource("relationshipOutputCopyControl"), /Plug is a copy/);
});

test("Through relationships render as faint direct node-to-node lines", () => {
  const editorLine = functionSource("drawEditorRelationshipArrow");
  const engineLine = functionSourceFrom(RENDERER_SOURCE, "pushThroughConnectorArrow");
  assert.match(editorLine, /x1: from\.x/);
  assert.match(editorLine, /x2: to\.x/);
  assert.match(editorLine, /"stroke-width": 1\.2/);
  assert.match(editorLine, /opacity: \.3/);
  assert.doesNotMatch(editorLine, /createSvg\("path"|pushSmallArrowHead/);
  assert.match(engineLine, /pushLine\(vertices, from, to, 1\.2, "rgba\(50,182,255,\.3\)"\)/);
  assert.doesNotMatch(engineLine, /pushSmallArrowHead/);
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
