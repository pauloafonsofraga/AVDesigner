const DEVICE_WIDTH = 380;
const FACE_MARGIN = 12;
const FACE_TOP_Y = 38;
const FACE_HEIGHT = 78;
const POWER_PLUG_EDGE_GAP_Y = 10;

export const POWER_PLUG_ASSET_BASE = "Nodes/PowerPlugs/";

export const POWER_PLUG_TYPES = {
  "nema": { output: "NEMA.svg", order: 10, size: 24 },
  "uk-13a": { output: "13A-UK.svg", order: 20, size: 55 },
  "schuko": { output: "Schuko.svg", order: 30, size: 45 },
  "powercon": { input: "powerCON_Blue.svg", output: "powerCON_White.svg", order: 40, size: 31 },
  "powercon-true1": { input: "powerCON_True1_Male.svg", output: "powerCON_True1_Female.svg", order: 50, size: 31 },
  "16a-1ph-110v": { input: "16-1ph110v-Male.svg", output: "16-1ph110v.svg", order: 60, size: 66 },
  "16a-1ph": { input: "16-1ph-Male.svg", output: "16-1ph.svg", order: 70, size: 66 },
  "16a-cee": { input: "16-1ph-Male.svg", output: "16-1ph.svg", order: 70, size: 66 },
  "32a-1ph-110v": { input: "32-1ph110vMale.svg", output: "32-1ph110v.svg", order: 80, size: 72 },
  "32a-1ph": { input: "32-1ph-Male.svg", output: "32-1ph.svg", order: 90, size: 72 },
  "32a-cee": { input: "32-1ph-Male.svg", output: "32-1ph.svg", order: 90, size: 72 },
  "16a-3ph": { input: "16-3ph-Male.svg", output: "16-3ph.svg", order: 100, size: 66 },
  "32a-3ph": { input: "32-3ph-Male.svg", output: "32-3ph.svg", order: 110, size: 72 },
  "63a-3ph": { input: "63-3ph-Male.svg", output: "63-3ph.svg", order: 120, size: 100 },
  "63a-cee": { input: "63-3ph-Male.svg", output: "63-3ph.svg", order: 120, size: 100 },
  "125a-3ph": { input: "125-3ph-Male.svg", output: "125-3ph.svg", order: 130, size: 120 },
  "125a-cee": { input: "125-3ph-Male.svg", output: "125-3ph.svg", order: 130, size: 120 },
  "socapex": { input: "SocapexMale.svg", output: "SocapexFemale.svg", order: 140, size: 56 },
  "harting": { input: "HartingMale.svg", output: "HartingFemale.svg", order: 150, width: 111, height: 27 },
  "powerlock": { input: "Powelock drain.svg", output: "Powelock source.svg", order: 500, width: 300, height: 44, powerlock: true }
};

export function isPowerDistroTemplateForEngine(template = {}, instance = {}) {
  return Boolean(template?.isPowerDistro || instance?.isPowerDistro);
}

export function powerPlugMeta(type) {
  return POWER_PLUG_TYPES[String(type || "")] || null;
}

export function powerPlugImageForConnector(connector) {
  const meta = powerPlugMeta(connector?.type);
  if (!meta) return "";
  const side = connector?.direction === "input" ? "input" : "output";
  const file = meta[side];
  return file ? `${POWER_PLUG_ASSET_BASE}${file}` : "";
}

export function powerPlugCanExistOnSide(type, direction) {
  const meta = powerPlugMeta(type);
  if (!meta) return true;
  return Boolean(meta[direction === "input" ? "input" : "output"]);
}

export function isPowerPlugConnector(connector) {
  return Boolean(powerPlugImageForConnector(connector));
}

export function powerPlugDisplaySize(connector) {
  const meta = powerPlugMeta(connector?.type) || {};
  const width = Number(meta.width);
  const height = Number(meta.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  const size = Number(meta.size) || 58;
  return { width: size, height: size };
}

export function normalizePowerPlugPlacement(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  return {
    manual: value.manual === true,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0
  };
}

export function normalizePowerDistroForEngine({ template = {}, instance = {}, width = DEVICE_WIDTH, connectors = [] } = {}) {
  if (!isPowerDistroTemplateForEngine(template, instance) || template.faceImage || instance.faceImage || template.faceplateDeleted || instance.faceplateDeleted) {
    return null;
  }
  const templateLike = {
    ...template,
    ...instance,
    isPowerDistro: true,
    width,
    connectors
  };
  const faceRect = powerDistroFaceRect(templateLike);
  const plugEntries = powerPlugLayout(templateLike).map(entry => normalizePowerPlugEntry(entry));
  const normalInputs = sortedPowerPlugConnectors(templateLike, "input", false);
  const normalOutputs = sortedPowerPlugConnectors(templateLike, "output", false);
  const powerlockEntries = [
    ...sortedPowerPlugConnectors(templateLike, "input", true),
    ...sortedPowerPlugConnectors(templateLike, "output", true)
  ];
  return {
    isPowerDistro: true,
    subtype: String(template.powerDistroType || instance.powerDistroType || ""),
    faceY: faceRect.y,
    faceHeight: faceRect.height,
    faceRect,
    plugEntries,
    plugCount: plugEntries.length,
    inputCount: normalInputs.length,
    outputCount: normalOutputs.length,
    powerlockCount: powerlockEntries.length,
    connectorCount: connectors.length,
    assetBase: POWER_PLUG_ASSET_BASE,
    source: "legacy-power-plug-layout"
  };
}

export function powerDistroRequiredHeight(model, connectors = [], fallbackHeight = FACE_TOP_Y + FACE_HEIGHT + 22) {
  if (!model) return fallbackHeight;
  const faceBottom = Number(model.faceRect?.y || 0) + Number(model.faceRect?.height || 0) + 22;
  const connectorBottom = (connectors || []).reduce((max, connector) => (
    Math.max(max, (Number(connector.y) || 0) + 22)
  ), 0);
  return Math.max(fallbackHeight, faceBottom, connectorBottom);
}

export function powerPlugAssetsForDevice(device) {
  const entries = device?.visual?.powerDistro?.plugEntries;
  if (!Array.isArray(entries)) return [];
  return [...new Set(entries.map(entry => String(entry.href || "").trim()).filter(Boolean))];
}

export function powerDistroVisualForDevice(device) {
  const model = device?.visual?.powerDistro;
  return model && typeof model === "object" ? model : null;
}

export function powerDistroDiagnostics(device = {}) {
  const model = powerDistroVisualForDevice(device);
  const connectors = Array.isArray(device.connectors) ? device.connectors : [];
  return {
    isPowerDistro: Boolean(device.kind === "power-distro" || device.visual?.isPowerDistro),
    engineKind: device.kind || "",
    templateId: device.templateId || "",
    templateName: device.visual?.templateName || "",
    instanceName: device.label || device.visual?.displayName || "",
    rendererHelper: "drawPowerDistroFaceplate",
    modelSource: model?.source || "",
    faceX: model?.faceRect?.x ?? 0,
    faceY: model?.faceRect?.y ?? 0,
    faceWidth: model?.faceRect?.width ?? 0,
    faceHeight: model?.faceRect?.height ?? 0,
    inputCount: model?.inputCount ?? 0,
    outputCount: model?.outputCount ?? 0,
    powerlockCount: model?.powerlockCount ?? 0,
    plugCount: model?.plugCount ?? 0,
    connectorCount: connectors.length,
    plugAssets: powerPlugAssetsForDevice(device)
  };
}

function powerPlugStackHeight(connectors) {
  return connectors.reduce((total, connector, index) => {
    const size = powerPlugDisplaySize(connector);
    return total + size.height + (index ? POWER_PLUG_EDGE_GAP_Y : 0);
  }, 0);
}

function powerDistroManualPlugHeight(template, faceYOverride = null) {
  if (!template?.isPowerDistro || template.faceImage || template.faceplateDeleted) return FACE_HEIGHT;
  const faceY = Number.isFinite(Number(faceYOverride)) ? Number(faceYOverride) : powerDistroFaceY(template);
  const powerlockEntries = [
    ...sortedPowerPlugConnectors(template, "input", true),
    ...sortedPowerPlugConnectors(template, "output", true)
  ];
  return [
    ...sortedPowerPlugConnectors(template, "input", false),
    ...sortedPowerPlugConnectors(template, "output", false),
    ...powerlockEntries
  ].reduce((maxBottom, connector) => {
    if (connector.powerPlug?.manual !== true) return maxBottom;
    const size = powerPlugDisplaySize(connector);
    const centerY = Number(connector.powerPlug.y);
    if (!Number.isFinite(centerY)) return maxBottom;
    return Math.max(maxBottom, centerY + size.height / 2 - faceY + POWER_PLUG_EDGE_GAP_Y);
  }, 0);
}

function powerDistroAutoFaceHeight(template, faceYOverride = null) {
  if (!template?.isPowerDistro || template.faceImage || template.faceplateDeleted) return FACE_HEIGHT;
  const normalInputs = sortedPowerPlugConnectors(template, "input", false)
    .filter(connector => connector.powerPlug?.manual !== true);
  const normalOutputs = sortedPowerPlugConnectors(template, "output", false)
    .filter(connector => connector.powerPlug?.manual !== true);
  const powerlockEntries = [
    ...sortedPowerPlugConnectors(template, "input", true),
    ...sortedPowerPlugConnectors(template, "output", true)
  ].filter(connector => connector.powerPlug?.manual !== true);
  const normalStack = Math.max(powerPlugStackHeight(normalInputs), powerPlugStackHeight(normalOutputs));
  const powerlockStack = powerPlugStackHeight(powerlockEntries);
  const stacks = normalStack + (normalStack && powerlockStack ? 18 : 0) + powerlockStack;
  return Math.max(FACE_HEIGHT, 36 + stacks, powerDistroManualPlugHeight(template, faceYOverride));
}

function powerDistroFaceHeight(template) {
  const autoHeight = powerDistroAutoFaceHeight(template);
  const manualHeight = Number(template?.powerDistroFaceHeight) || 0;
  return Math.max(autoHeight, manualHeight);
}

function powerDistroFaceY(template) {
  const value = Number(template?.powerDistroFaceY);
  return Number.isFinite(value) ? Math.max(FACE_TOP_Y, value) : FACE_TOP_Y;
}

function powerDistroFaceRect(template) {
  const width = Number(template?.width) || DEVICE_WIDTH;
  return {
    x: FACE_MARGIN,
    y: powerDistroFaceY(template),
    width: Math.max(1, width - FACE_MARGIN * 2),
    height: powerDistroFaceHeight(template)
  };
}

function powerPlugSortValue(connector) {
  return powerPlugMeta(connector?.type)?.order || 999;
}

function sortedPowerPlugConnectors(template, direction, powerlock = false) {
  return (template.connectors || [])
    .filter(connector => !connector.empty && connector.direction === direction && isPowerPlugConnector(connector))
    .filter(connector => Boolean(powerPlugMeta(connector.type)?.powerlock) === powerlock)
    .sort((a, b) => {
      const rank = powerPlugSortValue(a) - powerPlugSortValue(b);
      if (rank) return rank;
      return (Number(a.y) || 0) - (Number(b.y) || 0);
    });
}

// Iteration 46: this is a runtime copy of Legacy powerPlugLayout(), not a new
// responsive grid. It should keep matching 8301fbf/index.html unless Legacy
// intentionally changes the Power Distro editor model.
function powerPlugLayout(template) {
  if (!template?.isPowerDistro || template.faceImage || template.faceplateDeleted) return [];
  const rect = powerDistroFaceRect(template);
  const entries = [];
  const normalInputs = sortedPowerPlugConnectors(template, "input", false);
  const normalOutputs = sortedPowerPlugConnectors(template, "output", false);
  const leftX = rect.x + rect.width * 0.25;
  const rightX = rect.x + rect.width * 0.75;
  const top = rect.y + 18;
  const placeStack = (items, side) => {
    let cursor = top;
    items.forEach(connector => {
      const size = powerPlugDisplaySize(connector);
      const autoX = side === "input" ? leftX : rightX;
      const autoY = cursor + size.height / 2;
      const manual = connector.powerPlug?.manual === true;
      const center = manual
        ? clampPowerPlugCenter(template, connector.powerPlug.x, connector.powerPlug.y, size.width, size.height)
        : { x: autoX, y: autoY };
      entries.push({
        connector,
        href: powerPlugImageForConnector(connector),
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
        cx: center.x,
        cy: center.y,
        width: size.width,
        height: size.height,
        powerlock: false
      });
      cursor += size.height + POWER_PLUG_EDGE_GAP_Y;
    });
  };
  placeStack(normalInputs, "input");
  placeStack(normalOutputs, "output");

  const normalBottom = top + Math.max(powerPlugStackHeight(normalInputs), powerPlugStackHeight(normalOutputs));
  let powerlockCursor = normalBottom + (normalInputs.length || normalOutputs.length ? 18 : 0);
  [
    ...sortedPowerPlugConnectors(template, "input", true),
    ...sortedPowerPlugConnectors(template, "output", true)
  ].forEach(connector => {
    const size = powerPlugDisplaySize(connector);
    const autoY = powerlockCursor + size.height / 2;
    const manual = connector.powerPlug?.manual === true;
    const center = manual
      ? clampPowerPlugCenter(template, connector.powerPlug.x, connector.powerPlug.y, size.width, size.height)
      : { x: rect.x + rect.width / 2, y: autoY };
    entries.push({
      connector,
      href: powerPlugImageForConnector(connector),
      x: center.x - size.width / 2,
      y: center.y - size.height / 2,
      cx: center.x,
      cy: center.y,
      width: size.width,
      height: size.height,
      powerlock: true
    });
    powerlockCursor += size.height + POWER_PLUG_EDGE_GAP_Y;
  });
  return entries;
}

function clampPowerPlugCenter(template, x, y, width = 32, height = 32) {
  const rect = powerDistroFaceRect(template);
  const halfW = width / 2;
  const halfH = height / 2;
  return {
    x: clamp(Number(x) || rect.x + rect.width / 2, rect.x + halfW, rect.x + rect.width - halfW),
    y: clamp(Number(y) || rect.y + rect.height / 2, rect.y + halfH, rect.y + rect.height - halfH)
  };
}

function normalizePowerPlugEntry(entry) {
  return {
    connectorId: String(entry.connector?.id || ""),
    connectorType: String(entry.connector?.type || ""),
    connectorLabel: String(entry.connector?.label || entry.connector?.nameText || entry.connector?.type || ""),
    direction: entry.connector?.direction === "input" ? "input" : "output",
    href: String(entry.href || ""),
    x: Number(entry.x) || 0,
    y: Number(entry.y) || 0,
    cx: Number(entry.cx) || 0,
    cy: Number(entry.cy) || 0,
    width: Math.max(1, Number(entry.width) || 1),
    height: Math.max(1, Number(entry.height) || 1),
    powerlock: Boolean(entry.powerlock),
    manual: entry.connector?.powerPlug?.manual === true,
    order: powerPlugSortValue(entry.connector),
    crop: powerPlugMeta(entry.connector?.type)?.crop || null
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
