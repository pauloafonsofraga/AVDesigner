import { engineConnectorInfoFields } from "./connectorCompatibility.js";
import {
  adapterColorStops,
  adapterInternalWirePairs,
  traceAdapterInternalWirePath
} from "./adapterMapping.js";
import {
  powerDistroDiagnostics,
  powerDistroVisualForDevice,
  powerPlugAssetsForDevice
} from "./powerDistroModel.js";
import {
  canonicalEngineObjectKind,
  isCanvasObjectKind,
  isLedSurfaceKind
} from "./canvasObjectKinds.js";

const QUALITY_PRESETS = {
  low: { label: "Low", scale: 2, maxSide: 2048, maxPixels: 12_000_000 },
  medium: { label: "Medium", scale: 4, maxSide: 8192, maxPixels: 48_000_000 },
  high: { label: "High", scale: 5, maxSide: 12288, maxPixels: 72_000_000 }
};

const DEFAULT_QUALITY = "medium";
const LEGACY_DEVICE_BODY = "#171d24";
const LEGACY_DEVICE_FACE = "#26313d";
const LEGACY_DEVICE_BORDER = "#ffffff";
const LEGACY_ADAPTER_FILL = "#18222b";
const LEGACY_ADAPTER_STROKE = "rgba(50, 182, 255, .72)";
const FACE_MARGIN = 12;
const FACE_TOP_Y = 38;
const FACE_HEIGHT = 78;
const FACE_IMAGE_PADDING = 8;
const SLOT_HEIGHT = 54;
const TITLE_BLOCK_BASE_WIDTH = 760;
const TITLE_BLOCK_BASE_HEIGHT = 112;

const IMAGE_CACHE = new Map();
let assetReadyCallback = null;

export function setDeviceVisualAssetReadyCallback(callback) {
  assetReadyCallback = typeof callback === "function" ? callback : null;
}

export function deviceVisualCacheKey(device, options = {}) {
  const visualKind = visualDeviceKind(device);
  const width = Math.max(1, Math.round(device.width || 1));
  const height = Math.max(1, Math.round(device.height || 1));
  const color = String(device.color || "").trim();
  const quality = textureQuality(options);
  const visual = device.visual || {};
  // This key describes stable visual appearance. It intentionally avoids
  // positions so pan/zoom/drag work stays cheap, but it includes the displayed
  // device title because Legacy renders that title inside the device body.
  const title = textureTitle(device);
  // Faceplate data URLs can be huge; hash them so the key stays small while
  // still invalidating when the actual visual source changes.
  const faceKey = visual.hasFaceImage
    ? `${visualSourceKey(visual.faceImage || "face")}:${deviceVisualAssetRevision(visual.faceImage)}`
    : "";
  const templateRevision = String(
    visual.projectCustomRevision
    || visual.visualRevision
    || device.projectCustomRevision
    || device.visualRevision
    || ""
  ).trim();
  const connectorShape = (device.connectors || [])
    .map(connector => [
      Math.round(connector.x || 0),
      Math.round(connector.y || 0),
      connector.side || "",
      connector.direction || "",
      connector.type || connector.plug || "",
      connector.label || "",
      connector.displayLabel || "",
      connector.effectiveType || "",
      connector.hiddenOnCanvas ? "hidden" : "visible",
      connector.rackExposedPortKey || "",
      connector.labelSource || "",
      connector.installedModuleEffectiveType || "",
      connector.installedModuleFiberMode || "",
      connector.installedModuleFiberFamily || "",
      connector.installedModuleLabel || "",
      connector.fiberFamily || "",
      connector.powerPlugAsset || "",
      connector.powerDistroRole || "",
      connector.powerPlugSize ? `${Math.round(connector.powerPlugSize.width || 0)}x${Math.round(connector.powerPlugSize.height || 0)}` : "",
      Array.isArray(connector.colorSegments) ? connector.colorSegments.join(",") : "",
      options.connectorColors ? connector.color || "" : ""
    ].join(":"))
    .join("|");
  const powerDistroShape = visual.powerDistro
    ? [
      visual.powerDistro.source || "",
      visual.powerDistro.subtype || "",
      visual.powerDistro.faceRect
        ? [
          Math.round(visual.powerDistro.faceRect.x || 0),
          Math.round(visual.powerDistro.faceRect.y || 0),
          Math.round(visual.powerDistro.faceRect.width || 0),
          Math.round(visual.powerDistro.faceRect.height || 0)
        ].join(",")
        : "",
      (visual.powerDistro.plugEntries || []).map(entry => [
        entry.connectorId || "",
        entry.connectorType || "",
        entry.direction || "",
        entry.href || "",
        Math.round(entry.x || 0),
        Math.round(entry.y || 0),
        Math.round(entry.width || 0),
        Math.round(entry.height || 0),
        entry.powerlock ? "powerlock" : "",
        entry.manual ? "manual" : "",
        deviceVisualAssetRevision(entry.href)
      ].join(",")).join("/")
    ].join("|")
    : "";
  const cardShape = (visual.visualCards || [])
    .map(card => [
      card.id || "",
      card.installedCardTypeId || "",
      card.cardTypeId || "",
      Math.round(card.x || 0),
      Math.round(card.y || 0),
      Math.round(card.width || 0),
      Math.round(card.height || 0),
      Math.round(card.captionX || card.textX || 0),
      Math.round(card.captionY || card.slotY || 0),
      card.name || "",
      card.kind || "",
      card.direction || "",
      card.captionTextColor || "",
      card.captionBackgroundColor || "",
      card.rowCount || 0,
      card.laneCount || 0,
      card.connectorCount || 0,
      (card.connectors || []).map(connector => [
        connector.id || "",
        connector.type || "",
        connector.direction || "",
        Math.round(connector.y || 0),
        connector.label || "",
        connector.displayLabel || "",
        connector.effectiveType || "",
        connector.hiddenOnCanvas ? "hidden" : "visible",
        connector.rackExposedPortKey || "",
        connector.labelSource || "",
        connector.customColor || "",
        connector.fiberMode || "",
        connector.fiberFamily || "",
        connector.installedModuleType || "",
        connector.installedModuleEffectiveType || "",
        connector.installedModuleFiberMode || "",
        connector.installedModuleFiberFamily || "",
        connector.installedModuleLabel || "",
        Array.isArray(connector.colorSegments) ? connector.colorSegments.join(",") : ""
      ].join(",")).join("/")
    ].join(":"))
    .join("|");
  const canvasObjectShape = isCanvasObjectKind(device)
    ? [
      canonicalEngineObjectKind(device),
      visual.image || "",
      deviceVisualAssetRevision(visual.image),
      visual.naturalWidth || 0,
      visual.naturalHeight || 0,
      visual.pixelWidth || 0,
      visual.pixelHeight || 0,
      visual.physicalWidth || 0,
      visual.physicalHeight || 0,
      visual.opacity ?? "",
      visual.backgroundColor || "",
      visual.textColor || "",
      visual.leaderColor || "",
      visual.title || "",
      visual.text || "",
      visual.textSize || "",
      visual.box ? `${Math.round(visual.box.x || 0)},${Math.round(visual.box.y || 0)},${Math.round(visual.box.width || 0)},${Math.round(visual.box.height || 0)}` : "",
      visual.anchor ? `${Math.round(visual.anchor.x || 0)},${Math.round(visual.anchor.y || 0)}` : "",
      visual.leaderEnd ? `${Math.round(visual.leaderEnd.x || 0)},${Math.round(visual.leaderEnd.y || 0)}` : "",
      JSON.stringify(visual.fields || {}),
      visual.logo || "",
      deviceVisualAssetRevision(visual.logo)
    ].join("|")
    : "";
  return [
    "device-card-v8-live-fields",
    visualKind,
    width,
    height,
    color,
    quality.mode,
    quality.scale,
    quality.maxSide,
    quality.maxPixels,
    options.gpuMaxTextureSide || "",
    quality.highDpi ? "hidpi" : "1x",
    options.simplifiedCards ? "simplified" : "standard",
    options.detailedDeviceTextures === false ? "basic" : "detailed",
    title,
    templateRevision,
    device.brand || visual.brand || "",
    device.model || visual.model || "",
    device.category || visual.category || "",
    faceKey,
    visual.faceplateDeleted ? "face-deleted" : "",
    visual.faceImageNaturalWidth || 0,
    visual.faceImageNaturalHeight || 0,
    visual.faceImageScale || 1,
    visual.faceImageScaleX || 1,
    visual.faceImageScaleY || 1,
    visual.faceImageOffsetX || 0,
    visual.faceImageOffsetY || 0,
    visual.hasSwappableCards ? "cards" : "",
    visual.isLedProcessor ? "led-processor" : "",
    visual.isPowerDistro ? "pd" : "",
    powerDistroShape,
    visual.isMatrixRouter ? "matrix" : "",
    device.portCount || 0,
    connectorShape,
    cardShape,
    canvasObjectShape
  ].join(";");
}

export function buildDeviceVisual(device, options = {}) {
  const start = performance.now();
  const width = Math.max(1, Math.round(device.width || 1));
  const height = Math.max(1, Math.round(device.height || 1));
  const quality = textureQuality(options);
  const limits = effectiveTextureLimits(device, quality, options);
  const scalePlan = textureScaleForSize(width, height, quality, limits);
  const ratio = scalePlan.ratio;
  const canvas = createCanvas(Math.max(1, Math.ceil(width * ratio)), Math.max(1, Math.ceil(height * ratio)));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create device visual canvas context.");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawDeviceVisual(ctx, device, width, height, options);
  const buildMs = performance.now() - start;
  const diagnostics = deviceVisualDiagnostics(device, {
    logicalWidth: width,
    logicalHeight: height,
    textureWidth: canvas.width,
    textureHeight: canvas.height,
    pixelRatio: ratio,
    quality,
    limits,
    scalePlan,
    buildMs,
    smoothingEnabled: ctx.imageSmoothingEnabled,
    smoothingQuality: ctx.imageSmoothingQuality
  });
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    cssWidth: width,
    cssHeight: height,
    pixelRatio: ratio,
    qualityMode: quality.mode,
    maxTextureSide: limits.maxSide,
    maxTexturePixels: limits.maxPixels,
    buildMs,
    diagnostics,
    fallback: false
  };
}

export function textureQuality(options = {}) {
  const requested = String(options.textureQuality || DEFAULT_QUALITY).toLowerCase();
  const mode = QUALITY_PRESETS[requested] ? requested : DEFAULT_QUALITY;
  const preset = QUALITY_PRESETS[mode];
  const highDpi = options.highDpiTextures !== false;
  return {
    ...preset,
    mode,
    highDpi,
    scale: highDpi ? preset.scale : 1,
    maxPixels: preset.maxPixels || preset.maxSide * preset.maxSide
  };
}

function drawDeviceVisual(ctx, device, width, height, options) {
  const kind = visualDeviceKind(device);
  if (kind === "jump") {
    drawJumpVisual(ctx, device, width, height);
    return;
  }
  if (isLedSurfaceKind(device)) {
    drawSurfaceVisual(ctx, device, width, height);
    return;
  }
  if (kind === "image-object") {
    drawImageObjectVisual(ctx, device, width, height);
    return;
  }
  if (kind === "area") {
    drawAreaVisual(ctx, device, width, height);
    return;
  }
  if (kind === "comment") {
    drawCommentVisual(ctx, device, width, height);
    return;
  }
  if (kind === "title-block") {
    drawTitleBlockVisual(ctx, device, width, height);
    return;
  }
  if (kind === "adapter") {
    drawAdapterVisual(ctx, device, width, height, options);
    return;
  }
  drawRackDeviceVisual(ctx, device, width, height, options);
}

function drawRackDeviceVisual(ctx, device, width, height, options) {
  const visual = device.visual || {};
  const detailed = options.detailedDeviceTextures !== false;
  const radius = 8;
  const pad = FACE_MARGIN;

  roundRect(ctx, 0, 0, width, height, radius);
  ctx.fillStyle = LEGACY_DEVICE_BODY;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = LEGACY_DEVICE_BORDER;
  ctx.stroke();

  drawDeviceHeader(ctx, device, width, pad, detailed);
  const face = drawPowerDistroFaceplate(ctx, device, visual, width, height, detailed)
    || drawFaceplate(ctx, device, visual, width, height, pad, detailed);

  if (detailed && visual.visualCards?.length && !options.simplifiedCards) {
    drawCardAreas(ctx, visual.visualCards, width, height, pad);
  } else if (detailed && visual.hasSwappableCards && device.connectors?.length) {
    drawConnectorBands(ctx, device, width, height, face.bottom + 12);
  }

  if (visual.isLedProcessor) drawDeviceTag(ctx, "LED PROCESSOR", width - pad, 24, "#ff99cc", "right");
  if (visual.isMatrixRouter) drawDeviceTag(ctx, "MATRIX", width - pad, 56, "#32b6ff", "right");

  // Connector nodes are intentionally not baked into cached device textures.
  // Legacy draws them after the device body so the full circle can extend past
  // the shell; baking them here clips the outer half at the texture bounds.
  if (options.connectorMarkers === "baked") drawConnectorMarkers(ctx, device, width, height, options);
}

function drawDeviceHeader(ctx, device, width, pad, detailed) {
  const title = textureTitle(device);
  ctx.save();
  drawFittedText(ctx, title, 20, 22, width - 40, 15.4, {
    weight: 900,
    fill: "#ffffff",
    baseline: "alphabetic"
  });
  ctx.restore();
}

function drawPowerDistroFaceplate(ctx, device, visual, width, height, detailed) {
  const model = powerDistroVisualForDevice(device);
  if (!visual?.isPowerDistro || visual.hasFaceImage || visual.faceplateDeleted || !model?.faceRect) return null;
  const rect = model.faceRect;
  const x = clamp(rect.x, FACE_MARGIN, Math.max(FACE_MARGIN, width - FACE_MARGIN - 1));
  const y = clamp(rect.y, FACE_TOP_Y, Math.max(FACE_TOP_Y, height - FACE_MARGIN - 1));
  const w = Math.min(Math.max(1, rect.width), Math.max(1, width - x - FACE_MARGIN));
  const h = Math.min(Math.max(1, rect.height), Math.max(1, height - y - FACE_MARGIN));

  ctx.save();
  roundRect(ctx, x, y, w, h, 5);
  ctx.fillStyle = LEGACY_DEVICE_FACE;
  ctx.fill();
  ctx.strokeStyle = "rgba(50, 182, 255, .18)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const entries = Array.isArray(model.plugEntries) ? model.plugEntries : [];
  entries.forEach(entry => drawPowerPlugCanvasImage(ctx, entry, { detailed }));
  ctx.restore();

  return { x, y, width: w, height: h, bottom: y + h };
}

function drawPowerPlugCanvasImage(ctx, entry, options = {}) {
  const href = String(entry?.href || "").trim();
  if (!href) return;
  const width = Math.max(1, Number(entry.width) || 1);
  const height = Math.max(1, Number(entry.height) || 1);
  const x = Number(entry.x) || 0;
  const y = Number(entry.y) || 0;
  const image = cachedImage(href);
  if (image?.complete && image.naturalWidth > 0) {
    const drawRect = preserveAspectRatioMeetRect({ x, y, width, height }, image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    return;
  }
  if (options.detailed === false) return;
  ctx.save();
  ctx.globalAlpha = 0.34;
  roundRect(ctx, x, y, width, height, Math.min(6, Math.min(width, height) / 4));
  ctx.strokeStyle = "#d7e6f5";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawFaceplate(ctx, device, visual, width, height, pad, detailed) {
  if (visual.faceplateDeleted) return { x: pad, y: FACE_TOP_Y, width: width - pad * 2, height: 0, bottom: FACE_TOP_Y };
  const faceBounds = legacyFaceBounds(visual, width);
  const x = visual.hasFaceImage ? faceBounds.x : pad;
  const y = visual.hasFaceImage ? faceBounds.y : FACE_TOP_Y;
  const w = visual.hasFaceImage ? faceBounds.width : Math.max(1, width - pad * 2);
  const h = visual.hasFaceImage
    ? faceBounds.height
    : FACE_HEIGHT;

  if (visual.hasFaceImage) {
    const image = cachedImage(visual.faceImage);
    if (image?.complete && image.naturalWidth > 0) {
      const placement = legacyFaceImagePlacement(visual, width, image);
      // Legacy renders faceplates as SVG images with
      // preserveAspectRatio="xMidYMid meet". Canvas drawImage would otherwise
      // stretch the bitmap into the placement box and distort ports/logos.
      const imageRect = preserveAspectRatioMeetRect(placement, image.naturalWidth, image.naturalHeight);
      ctx.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    } else {
      drawFaceplateLoadingPlaceholder(ctx, visual, x, y, w, h);
    }
  } else {
    roundRect(ctx, x, y, w, h, 5);
    ctx.fillStyle = LEGACY_DEVICE_FACE;
    ctx.fill();
    const displayWidth = Math.min(w * 0.22, 94);
    roundRect(ctx, x + pad * 0.75, y + h * 0.22, displayWidth, Math.max(9, h * 0.26), 3);
    ctx.fillStyle = "#7bcac1";
    ctx.fill();
    const ledCount = Math.min(8, Math.max(3, Math.floor((w - pad * 4 - displayWidth) / 26)));
    const ledStart = x + pad * 1.7 + displayWidth;
    const ledY = y + h * 0.44;
    for (let index = 0; index < ledCount; index += 1) {
      ctx.beginPath();
      ctx.arc(ledStart + index * 18, ledY, Math.max(2.5, Math.min(4.5, width * 0.008)), 0, Math.PI * 2);
      ctx.fillStyle = index % 2 ? "rgb(255, 121, 4)" : "rgb(50, 182, 255)";
      ctx.fill();
    }
  }

  return { x, y, width: w, height: h, bottom: y + h };
}

function drawCardAreas(ctx, cards, width, height, pad) {
  cards.forEach(card => {
    const x = clamp(card.x, pad, Math.max(pad, width - pad - 24));
    const y = clamp(card.y, pad, Math.max(pad, height - pad - 24));
    const w = Math.min(Math.max(24, card.width), Math.max(24, width - x - pad));
    const h = Math.min(Math.max(18, card.height), Math.max(18, height - y - pad));
    roundRect(ctx, x, y, w, h, 6);
    ctx.fillStyle = "rgba(50,182,255,.06)";
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(50,182,255,.38)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    drawCardCaption(ctx, card);
    // Connector info boxes are drawn live by renderer.js so they can inverse
    // scale with zoom and magnify on hover without rebuilding device textures.
  });
}

function drawFaceplateLoadingPlaceholder(ctx, visual, x, y, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "rgba(255,255,255,.16)";
  ctx.lineWidth = Math.max(1, h * 0.018);
  for (let yy = y + h * 0.22; yy < y + h; yy += Math.max(8, h * 0.18)) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.05, yy);
    ctx.lineTo(x + w * 0.95, yy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawFittedText(ctx, basename(visual.faceImage), x + w * 0.06, y + h * 0.62, w * 0.88, Math.max(7, h * 0.18), {
    weight: 800,
    fill: "#d7e6f5",
    align: "center"
  });
  ctx.restore();
}

function drawCardCaption(ctx, card) {
  const text = String(card.name || "Empty").trim() || "Empty";
  const maxWidth = Math.max(64, Number(card.width) - 12);
  let fontSize = Math.min(16, SLOT_HEIGHT * 0.62);
  const estimatedWidth = estimateTextWidth(text, fontSize, 800) + 18;
  if (estimatedWidth > maxWidth) {
    fontSize = Math.max(8, fontSize * ((maxWidth - 14) / Math.max(1, estimatedWidth)));
  }
  const barHeight = Math.max(18, fontSize + 8);
  const barWidth = maxWidth;
  const x = (Number(card.captionX) || Number(card.textX) || (Number(card.x) + Number(card.width) / 2)) - barWidth / 2;
  const y = (Number(card.captionY) || Number(card.slotY) || Number(card.y) + 18) - fontSize + 1;
  ctx.save();
  roundRect(ctx, x, y, barWidth, barHeight, 4);
  ctx.fillStyle = normalizeColor(card.captionBackgroundColor, "#17212b");
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;
  drawFittedText(ctx, text, x + 5, y + barHeight / 2 + fontSize * 0.35, barWidth - 10, fontSize, {
    weight: 800,
    fill: normalizeColor(card.captionTextColor, "#32b6ff"),
    stroke: "rgba(0,0,0,.92)",
    strokeWidth: 5,
    align: "center",
    baseline: "middle"
  });
  ctx.restore();
}

function drawCardConnectorFields(ctx, card, deviceWidth) {
  const connectors = Array.isArray(card.connectors)
    ? card.connectors.filter(connector => connector?.hiddenOnCanvas !== true)
    : [];
  if (!connectors.length) return;
  connectors.forEach(connector => {
    const fields = connector.infoFields?.length
      ? connector.infoFields
      : engineConnectorInfoFields(connector);
    if (!fields.length) return;
    const rowY = Number(connector.y) || Number(card.slotY) || 0;
    fields.forEach((field, index) => {
      drawInfoBox(ctx, connector, field.title, field.value, index, rowY);
    });
  });
}

function drawInfoBox(ctx, connector, title, value, index, rowY) {
  if (!value) return;
  const scale = 1;
  const boxWidth = 44 * scale;
  const boxHeight = 15.5 * scale;
  const slotStep = 48 * scale;
  const sideOffset = 18 * scale;
  const x = connector.direction === "input"
    ? connector.x + sideOffset + index * slotStep
    : connector.x - sideOffset - boxWidth - index * slotStep;
  const y = rowY - boxHeight / 2;
  roundRect(ctx, x, y, boxWidth, boxHeight, 4 * scale);
  ctx.fillStyle = "rgba(0,0,0,.08)";
  ctx.fill();
  ctx.strokeStyle = "#9aa2aa";
  ctx.lineWidth = 1.1 * scale;
  ctx.stroke();
  drawInfoBoxText(ctx, x, y, boxWidth, boxHeight, scale, title, value);
}

function drawInfoBoxText(ctx, x, y, width, height, scale, title, text) {
  const labelFontSize = 5.1 * scale;
  const valueFontSize = 4.65 * scale;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.font = `800 ${labelFontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.strokeStyle = "#18202a";
  ctx.lineWidth = 3.5 * scale;
  ctx.fillStyle = "#28bdfd";
  ctx.strokeText(title, x + width / 2, y);
  ctx.fillText(title, x + width / 2, y);

  const lines = wrapInfoBoxLines(text, Math.max(8, width - 7 * scale), valueFontSize, 2);
  const lineHeight = valueFontSize * 1.12;
  const startY = y + height / 2 + 3.3 * scale - (lines.length - 1) * lineHeight / 2;
  ctx.font = `700 ${valueFontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.strokeStyle = "transparent";
  ctx.lineWidth = 0;
  ctx.fillStyle = "#edf2f7";
  lines.forEach((line, index) => {
    ctx.fillText(line || " ", x + width / 2, startY + index * lineHeight);
  });
  ctx.restore();
}

function connectorInfoFields(connector) {
  if (connector?.faceplateSide) return [];
  if (connector?.type === "led-signal") {
    return [{
      title: connectorFieldTitle(connector, "customText", "Panel Coordinates"),
      value: connector.customText || ""
    }];
  }
  const fields = [
    {
      title: connectorFieldTitle(connector, "nameText", "Name"),
      value: connector.nameText || ""
    }
  ];
  if (connector.resolutionFrameRate || isVideoLikeConnector(connector)) {
    fields.push({
      title: connectorFieldTitle(connector, "resolutionFrameRate", "Resolution"),
      value: connector.resolutionFrameRate || ""
    });
  }
  fields.push({
    title: connectorFieldTitle(connector, "customText", "Custom"),
    value: connector.customText || ""
  });
  return fields.slice(0, 3);
}

function connectorFieldTitle(connector, field, fallback) {
  if (field === "nameText" && connector.nameTextCaption) return connector.nameTextCaption;
  if (field === "resolutionFrameRate" && connector.resolutionFrameRateCaption) return connector.resolutionFrameRateCaption;
  if (field === "customText" && connector.customTextCaption) return connector.customTextCaption;
  return fallback;
}

function isVideoLikeConnector(connector) {
  return /hdmi|sdi|display|dvi|dp|video|cxp/i.test(String(connector.type || connector.label || ""));
}

function drawConnectorBands(ctx, device, width, height, startY) {
  const groups = groupConnectors((device.connectors || []).filter(connector => connector?.hiddenOnCanvas !== true));
  ctx.save();
  ctx.globalAlpha = 0.36;
  ctx.setLineDash([9, 8]);
  ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.006);
  groups.forEach((connectors, key) => {
    if (connectors.length < 2) return;
    const ys = connectors.map(connector => connector.y || 0);
    const y1 = Math.max(startY, Math.min(...ys) - 14);
    const y2 = Math.min(height - 10, Math.max(...ys) + 14);
    if (y2 <= y1) return;
    const side = key.startsWith("left") ? "left" : "right";
    const x = side === "left" ? width * 0.08 : width * 0.54;
    const w = width * 0.38;
    roundRect(ctx, x, y1, w, y2 - y1, 5);
    ctx.strokeStyle = "#32b6ff";
    ctx.stroke();
  });
  ctx.restore();
}

function drawAdapterVisual(ctx, device, width, height, options) {
  const radius = 6;
  ctx.save();
  roundRect(ctx, 0, 0, width, height, radius);
  ctx.fillStyle = LEGACY_ADAPTER_FILL;
  ctx.fill();
  ctx.strokeStyle = LEGACY_ADAPTER_STROKE;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawAdapterInternalWires(ctx, device);
  // Breakout connector nodes are also live overlay geometry; only the dashed
  // boundary and internal fan-out lines belong in the cached texture.
  if (options.connectorMarkers === "baked") drawConnectorMarkers(ctx, device, width, height, options);
}

function drawAdapterInternalWires(ctx, device) {
  const pairs = adapterInternalWirePairs(device.connectors || []);
  if (!pairs.length) return;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.95;
  pairs.forEach(pair => {
    const gradient = ctx.createLinearGradient(pair.input.x, pair.input.y, pair.output.x, pair.output.y);
    const inputColor = connectorColor(pair.input);
    const outputColor = connectorColor(pair.output);
    adapterColorStops(inputColor, outputColor).forEach(stop => {
      gradient.addColorStop(stop.offset, stop.color);
    });
    ctx.strokeStyle = gradient;
    ctx.beginPath();
    traceAdapterInternalWirePath(ctx, pair.input, pair.output);
    ctx.stroke();
  });
  ctx.restore();
}

function connectorColor(connector) {
  return String(connector?.color || "rgb(50, 182, 255)").trim();
}

function drawJumpVisual(ctx, device, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.42;
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius);
  gradient.addColorStop(0, "rgb(50, 182, 255)");
  gradient.addColorStop(0.62, "rgb(9, 81, 245)");
  gradient.addColorStop(1, "rgb(255, 121, 4)");
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = Math.max(2, radius * 0.12);
  ctx.strokeStyle = "#092f73";
  ctx.stroke();
  drawFittedText(ctx, textureTitle(device), 0, cy - radius * 0.22, width, radius * 0.32, {
    weight: 900,
    fill: "#ffffff",
    stroke: "rgba(0,0,0,.72)",
    strokeWidth: 2.2,
    align: "center",
    baseline: "middle"
  });
}

function drawSurfaceVisual(ctx, device, width, height) {
  const visual = device.visual || {};
  const image = cachedImage(visual.image);
  if (image?.complete && image.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(Number(visual.opacity), 0, 1) || 1;
    const rect = preserveAspectRatioMeetRect({ x: 0, y: 0, width, height }, image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  } else {
    drawLedSurfacePlaceholder(ctx, device, width, height);
  }
  ctx.strokeStyle = "rgba(255, 121, 4, .92)";
  ctx.lineWidth = Math.max(1.5, Math.min(width, height) * 0.006);
  ctx.strokeRect(0, 0, width, height);
}

function drawLedSurfacePlaceholder(ctx, device, width, height) {
  ctx.fillStyle = "#0a0c0d";
  ctx.fillRect(0, 0, width, height);
  const tile = Math.max(8, Math.min(26, Math.min(width, height) / 18));
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      ctx.fillStyle = ((Math.floor(x / tile) + Math.floor(y / tile)) % 2) ? "#747474" : "#9b9b9b";
      ctx.fillRect(x, y, tile, tile);
    }
  }
  const text = surfaceText(device);
  drawFittedText(ctx, text, 12, height * 0.52, width - 24, Math.max(18, Math.min(52, height * 0.18)), {
    weight: 800,
    fill: "#89c43e",
    stroke: "rgba(0,0,0,.45)",
    strokeWidth: 2.2,
    align: "center"
  });
}

function surfaceText(device) {
  const visual = device.visual || {};
  const px = visual.pixelWidth && visual.pixelHeight ? `${visual.pixelWidth} x ${visual.pixelHeight}` : "";
  const physical = visual.physicalWidth && visual.physicalHeight ? `${visual.physicalWidth}m x ${visual.physicalHeight}m` : "";
  return [textureTitle(device), physical, px].filter(Boolean).join(" - ") || "LED Screen";
}

function drawImageObjectVisual(ctx, device, width, height) {
  const visual = device.visual || {};
  const image = cachedImage(visual.image);
  if (image?.complete && image.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(Number(visual.opacity), 0, 1) || 1;
    const rect = preserveAspectRatioMeetRect({ x: 0, y: 0, width, height }, image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
    return;
  }
  roundRect(ctx, 0, 0, width, height, 5);
  ctx.fillStyle = "rgba(18, 28, 38, .72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(50, 182, 255, .42)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawFittedText(ctx, textureTitle(device), 10, height / 2, width - 20, Math.max(12, Math.min(28, height * 0.2)), {
    weight: 800,
    fill: "#d7e6f5",
    align: "center",
    baseline: "middle"
  });
}

function drawAreaVisual(ctx, device, width, height) {
  const visual = device.visual || {};
  ctx.save();
  roundRect(ctx, 0, 0, width, height, 8);
  ctx.globalAlpha = clamp(Number(visual.opacity), 0.05, 1) || 0.32;
  ctx.fillStyle = normalizeColor(visual.backgroundColor || device.color, "#223544");
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(50, 182, 255, .36)";
  ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.006);
  ctx.stroke();
  drawFittedText(ctx, textureTitle(device), 18, Math.max(34, height * 0.12), width - 36, Math.max(14, Math.min(48, Number(visual.textSize) || 33)), {
    weight: 900,
    fill: "#32b6ff",
    stroke: "rgba(0,0,0,.72)",
    strokeWidth: 3.5,
    align: "left"
  });
  ctx.restore();
}

function drawCommentVisual(ctx, device, width, height) {
  const visual = device.visual || {};
  const box = visual.box || { x: 0, y: 0, width, height };
  const anchor = visual.anchor || { x: width, y: 0 };
  const leaderEnd = visual.leaderEnd || { x: box.x + box.width, y: box.y + box.height / 2 };
  ctx.save();
  ctx.strokeStyle = visual.leaderColor || "#28bdfd";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(leaderEnd.x, leaderEnd.y);
  ctx.stroke();

  roundRect(ctx, box.x, box.y, box.width, box.height, 4);
  ctx.fillStyle = visual.backgroundColor || "rgba(8,13,20,.96)";
  ctx.fill();
  ctx.strokeStyle = "#9aa2aa";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const titleSize = Math.max(10, Math.min(18, (Number(visual.textSize) || 12) * 1.05));
  drawFittedText(ctx, visual.title || textureTitle(device), box.x, box.y - 4, box.width, titleSize, {
    weight: 900,
    fill: "#32b6ff",
    stroke: "#18202a",
    strokeWidth: 3.2,
    align: "center"
  });
  drawWrappedText(ctx, visual.text || "Double-click to edit", box.x + 10, box.y + 18, box.width - 20, box.height - 24, {
    size: Number(visual.textSize) || 12,
    fill: visual.textColor || "#edf2f7",
    weight: 700
  });
  ctx.restore();
}

function drawTitleBlockVisual(ctx, device, width, height) {
  const scale = Math.max(0.05, Math.min(width / TITLE_BLOCK_BASE_WIDTH, height / TITLE_BLOCK_BASE_HEIGHT));
  const xOffset = (width - TITLE_BLOCK_BASE_WIDTH * scale) / 2;
  const yOffset = (height - TITLE_BLOCK_BASE_HEIGHT * scale) / 2;
  const fields = device.visual?.fields || {};
  ctx.save();
  ctx.translate(xOffset, yOffset);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(15, 24, 32, .74)";
  ctx.fillRect(0, 0, TITLE_BLOCK_BASE_WIDTH, TITLE_BLOCK_BASE_HEIGHT);
  ctx.strokeStyle = "#9aa2aa";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0, 0, TITLE_BLOCK_BASE_WIDTH, TITLE_BLOCK_BASE_HEIGHT);
  const columns = [0, 150, 300, 450, 610, TITLE_BLOCK_BASE_WIDTH];
  const rows = [0, 56, TITLE_BLOCK_BASE_HEIGHT];
  columns.slice(1, -1).forEach(x => {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TITLE_BLOCK_BASE_HEIGHT);
    ctx.stroke();
  });
  rows.slice(1, -1).forEach(y => {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TITLE_BLOCK_BASE_WIDTH, y);
    ctx.stroke();
  });
  drawTitleBlockCell(ctx, 8, 22, "Client:", fields.client);
  drawTitleBlockCell(ctx, 8, 78, "Revision:", fields.revision);
  drawTitleBlockCell(ctx, 158, 22, "Project:", fields.project);
  drawTitleBlockCell(ctx, 158, 78, "Location:", fields.location);
  drawTitleBlockCell(ctx, 308, 22, "Title:", fields.title || "Video Wirechart");
  drawTitleBlockCell(ctx, 308, 78, "Job ID:", fields.jobId);
  drawTitleBlockCell(ctx, 458, 16, "Event Date:", fields.eventDate);
  drawTitleBlockCell(ctx, 458, 40, "Drawing Date:", fields.drawingDate);
  drawTitleBlockCell(ctx, 458, 68, "Acc Manager:", fields.accountManager);
  drawTitleBlockCell(ctx, 458, 92, "Approved By:", fields.approvedBy);
  drawFittedText(ctx, fields.logoText || "Company Logo", 622, 58, 126, 13, {
    weight: 700,
    fill: "#d7e6f5",
    align: "center",
    baseline: "middle"
  });
  ctx.restore();
}

function drawTitleBlockCell(ctx, x, y, label, value) {
  ctx.font = "700 6px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillStyle = "#d7e6f5";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
  ctx.font = "800 7px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(String(value || ""), x + 46, y);
}

function drawWrappedText(ctx, text, x, y, maxWidth, maxHeight, options = {}) {
  const size = Math.max(7, Number(options.size) || 12);
  const lineHeight = size * 1.25;
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  ctx.save();
  ctx.font = `${options.weight || 700} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  words.forEach(word => {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  ctx.fillStyle = options.fill || "#edf2f7";
  ctx.textBaseline = "top";
  lines.slice(0, Math.max(1, Math.floor(maxHeight / lineHeight))).forEach((textLine, index) => {
    ctx.fillText(textLine, x, y + index * lineHeight);
  });
  ctx.restore();
}

function drawConnectorMarkers(ctx, device, width, height, options) {
  const connectors = device.connectors?.length
    ? device.connectors
    : fallbackConnectors(device, width, height);
  const canLabel = options.detailedDeviceTextures !== false && (connectors.length <= 48 || height / Math.max(1, connectors.length) > 14);
  const cardsById = new Map((device.visual?.visualCards || []).map(card => [card.id, card]));
  connectors.forEach(connector => {
    const px = connector.x ?? (connector.side === "right" ? width : 0);
    const py = connector.y ?? height / 2;
    const radius = device.kind === "jump" ? 10 : 7;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = options.connectorColors === false ? "rgb(50, 182, 255)" : connector.color || "rgb(50, 182, 255)";
    ctx.fill();
    ctx.lineWidth = Math.max(2, radius * 0.32);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    if (canLabel && connector.label) {
      const card = connector.cardSlotId ? cardsById.get(connector.cardSlotId) : null;
      const text = String(connector.nameText || connector.label || connector.type || "").slice(0, 22);
      const alignLeft = connector.direction === "input" || px < width / 2;
      const labelX = card
        ? alignLeft ? Number(card.x) + 8 : Number(card.x) + Number(card.width) - 8
        : alignLeft ? px + 16 : px - 16;
      drawFittedText(ctx, text, alignLeft ? labelX : labelX - 84, py + 18, 84, 9, {
        weight: 800,
        fill: "#f8fbff",
        stroke: "rgba(0,0,0,.82)",
        strokeWidth: 3,
        align: alignLeft ? "left" : "right",
        baseline: "top"
      });
    }
  });
}

function fallbackConnectors(device, width, height) {
  const count = Math.max(0, Number(device.portCount || 0));
  const connectors = [];
  for (let index = 0; index < count; index += 1) {
    const y = height * ((index + 1) / (count + 1));
    connectors.push({ side: "left", x: 0, y });
    connectors.push({ side: "right", x: width, y });
  }
  return connectors;
}

function groupConnectors(connectors) {
  const groups = new Map();
  connectors.forEach(connector => {
    const side = connector.side || (connector.x < 1 ? "left" : "right");
    const key = `${side}:${connector.cardSlotId || Math.round((connector.y || 0) / 140)}`;
    const list = groups.get(key) || [];
    list.push(connector);
    groups.set(key, list);
  });
  return groups;
}

function drawDeviceTag(ctx, text, x, y, color, align = "left") {
  ctx.save();
  ctx.font = "800 7px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "bottom";
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawFittedText(ctx, text, x, y, maxWidth, maxSize, options = {}) {
  const value = String(text || "").trim();
  if (!value || maxWidth <= 0 || maxSize <= 0) return;
  const minSize = options.minSize || 5;
  let size = maxSize;
  ctx.save();
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "alphabetic";
  ctx.lineJoin = "round";
  do {
    ctx.font = `${options.weight || 700} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    if (ctx.measureText(value).width <= maxWidth || size <= minSize) break;
    size -= 0.75;
  } while (size > minSize);
  let drawX = x;
  if (ctx.textAlign === "center") drawX = x + maxWidth / 2;
  if (ctx.textAlign === "right") drawX = x + maxWidth;
  if (options.stroke) {
    ctx.strokeStyle = options.stroke;
    ctx.lineWidth = options.strokeWidth || Math.max(1.5, size * 0.18);
    ctx.strokeText(value, drawX, y);
  }
  ctx.fillStyle = options.fill || "#ffffff";
  ctx.fillText(value, drawX, y);
  ctx.restore();
}

function visualDeviceKind(device) {
  return canonicalEngineObjectKind(device);
}

function effectiveTextureLimits(device, quality, options = {}) {
  const gpuMax = Number(options.gpuMaxTextureSide) || Infinity;
  // Modular chassis such as E2 are very tall. Iteration 40.4 keeps their
  // logical geometry unchanged but lets the cached texture use more physical
  // pixels when the GPU allows it, so zooming does not magnify a small bitmap.
  const modularTarget = device?.visual?.hasSwappableCards
    ? Math.max(quality.maxSide, 16384)
    : quality.maxSide;
  const optionMaxPixels = Number(options.maxTexturePixels);
  const maxPixels = Number.isFinite(optionMaxPixels) && optionMaxPixels > 0
    ? optionMaxPixels
    : quality.maxPixels || quality.maxSide * quality.maxSide;
  return {
    maxSide: Math.max(1, Math.min(modularTarget, gpuMax)),
    maxPixels: Math.max(1, maxPixels),
    gpuMaxSide: Number.isFinite(gpuMax) ? gpuMax : 0,
    requestedMaxSide: quality.maxSide,
    modularMaxSide: modularTarget
  };
}

function textureScaleForSize(width, height, quality, limits) {
  const maxDimension = Math.max(width, height, 1);
  const logicalPixels = Math.max(1, width * height);
  const requestedScale = Math.max(0.1, Number(quality.scale) || 1);
  const sideScale = limits.maxSide / maxDimension;
  const pixelScale = Math.sqrt(limits.maxPixels / logicalPixels);
  const ratio = Math.max(0.1, Math.min(requestedScale, sideScale, pixelScale));
  const limiters = [];
  if (ratio < requestedScale - 0.001) {
    if (sideScale <= pixelScale + 0.001 && sideScale <= requestedScale + 0.001) limiters.push("max-side");
    if (pixelScale <= sideScale + 0.001 && pixelScale <= requestedScale + 0.001) limiters.push("max-pixels");
  }
  if (!limiters.length) limiters.push("quality");
  return {
    ratio,
    requestedScale,
    sideScale,
    pixelScale,
    limitedBy: limiters.join("+")
  };
}

function deviceVisualDiagnostics(device, render) {
  const face = faceplateDiagnostics(device, render.logicalWidth);
  const adapter = adapterDiagnostics(device);
  const powerDistro = powerDistroDiagnostics(device);
  const texturePixels = render.textureWidth * render.textureHeight;
  return {
    deviceId: device?.id || "",
    templateId: device?.templateId || device?.visual?.templateId || "",
    name: textureTitle(device),
    kind: visualDeviceKind(device),
    logicalWidth: render.logicalWidth,
    logicalHeight: render.logicalHeight,
    textureWidth: render.textureWidth,
    textureHeight: render.textureHeight,
    texturePixels,
    estimatedBytes: texturePixels * 4,
    pixelRatio: render.pixelRatio,
    requestedScale: render.scalePlan.requestedScale,
    sideScale: render.scalePlan.sideScale,
    pixelScale: render.scalePlan.pixelScale,
    limitedBy: render.scalePlan.limitedBy,
    qualityMode: render.quality.mode,
    maxTextureSide: render.limits.maxSide,
    maxTexturePixels: render.limits.maxPixels,
    gpuMaxTextureSide: render.limits.gpuMaxSide,
    requestedMaxTextureSide: render.limits.requestedMaxSide,
    modularMaxTextureSide: render.limits.modularMaxSide,
    smoothingEnabled: Boolean(render.smoothingEnabled),
    smoothingQuality: render.smoothingQuality || "",
    minFilter: "LINEAR",
    magFilter: "LINEAR",
    buildMs: render.buildMs,
    face,
    adapter,
    powerDistro
  };
}

function faceplateDiagnostics(device, logicalWidth) {
  const visual = device?.visual || {};
  const source = String(visual.faceImage || "").trim();
  const hasFaceImage = Boolean(visual.hasFaceImage && source);
  const faceBounds = legacyFaceBounds(visual, logicalWidth);
  const diagnostics = {
    hasFaceImage,
    source,
    state: hasFaceImage ? "loading" : "none",
    declaredNaturalWidth: Number(visual.faceImageNaturalWidth) || 0,
    declaredNaturalHeight: Number(visual.faceImageNaturalHeight) || 0,
    imageNaturalWidth: 0,
    imageNaturalHeight: 0,
    boundsX: faceBounds.x,
    boundsY: faceBounds.y,
    boundsWidth: faceBounds.width,
    boundsHeight: faceBounds.height,
    availableFaceplateX: faceBounds.x,
    availableFaceplateY: faceBounds.y,
    availableFaceplateWidth: faceBounds.width,
    availableFaceplateHeight: faceBounds.height,
    legacyX: 0,
    legacyY: 0,
    legacyWidth: 0,
    legacyHeight: 0,
    engineX: 0,
    engineY: 0,
    engineWidth: 0,
    engineHeight: 0,
    faceImageScale: Number(visual.faceImageScale) || 1,
    faceImageScaleX: Number(visual.faceImageScaleX) || Number(visual.faceImageScale) || 1,
    faceImageScaleY: Number(visual.faceImageScaleY) || Number(visual.faceImageScale) || 1,
    faceImageOffsetX: Number(visual.faceImageOffsetX) || 0,
    faceImageOffsetY: Number(visual.faceImageOffsetY) || 0,
    xScale: 0,
    yScale: 0,
    aspectBefore: 0,
    aspectAfter: 0,
    aspectPreserved: false,
    placementMode: "none",
    placementX: 0,
    placementY: 0,
    placementWidth: 0,
    placementHeight: 0,
    sourcePixelsPerDisplayedLogicalPixel: 0
  };
  if (!hasFaceImage) return diagnostics;
  const image = cachedImage(source);
  if (image?.complete && image.naturalWidth > 0) {
    const placement = legacyFaceImagePlacement(visual, logicalWidth, image);
    const naturalWidth = image.naturalWidth || diagnostics.declaredNaturalWidth || 0;
    const naturalHeight = image.naturalHeight || diagnostics.declaredNaturalHeight || 0;
    const aspectBefore = naturalHeight ? naturalWidth / naturalHeight : 0;
    const engineRect = preserveAspectRatioMeetRect(placement, naturalWidth, naturalHeight);
    const aspectAfter = engineRect.height ? engineRect.width / engineRect.height : 0;
    diagnostics.state = "loaded";
    diagnostics.imageNaturalWidth = naturalWidth;
    diagnostics.imageNaturalHeight = naturalHeight;
    diagnostics.legacyX = placement.x;
    diagnostics.legacyY = placement.y;
    diagnostics.legacyWidth = placement.width;
    diagnostics.legacyHeight = placement.height;
    diagnostics.engineX = engineRect.x;
    diagnostics.engineY = engineRect.y;
    diagnostics.engineWidth = engineRect.width;
    diagnostics.engineHeight = engineRect.height;
    diagnostics.placementX = placement.x;
    diagnostics.placementY = placement.y;
    diagnostics.placementWidth = placement.width;
    diagnostics.placementHeight = placement.height;
    diagnostics.xScale = naturalWidth ? engineRect.width / naturalWidth : 0;
    diagnostics.yScale = naturalHeight ? engineRect.height / naturalHeight : 0;
    diagnostics.aspectBefore = aspectBefore;
    diagnostics.aspectAfter = aspectAfter;
    diagnostics.aspectPreserved = aspectBefore > 0 && aspectAfter > 0 && Math.abs(aspectBefore - aspectAfter) <= 0.02;
    diagnostics.placementMode = diagnostics.faceImageScaleX !== diagnostics.faceImageScaleY
      ? "legacy-box-explicit-xy-preserve-aspect"
      : diagnostics.faceImageScaleX !== 1 || diagnostics.faceImageOffsetX || diagnostics.faceImageOffsetY
        ? "legacy-scaled-or-offset-preserve-aspect"
        : "legacy-contained-preserve-aspect";
    diagnostics.sourcePixelsPerDisplayedLogicalPixel = engineRect.width
      ? (image.naturalWidth || diagnostics.declaredNaturalWidth || 0) / engineRect.width
      : 0;
  } else if (image) {
    diagnostics.state = "loading";
  }
  return diagnostics;
}

function adapterDiagnostics(device) {
  const classification = device?.visual?.adapterClassification || null;
  const connectors = Array.isArray(device?.connectors) ? device.connectors : [];
  const mapping = device?.visual?.adapterMapping || null;
  const pairs = device?.kind === "adapter" && !mapping ? adapterInternalWirePairs(connectors) : [];
  return {
    isAdapter: device?.kind === "adapter",
    engineKind: device?.kind || "",
    templateId: device?.templateId || "",
    templateName: device?.visual?.templateName || "",
    instanceName: device?.label || device?.visual?.displayName || "",
    legacyClassification: classification,
    visualKind: visualDeviceKind(device || {}),
    connectorCount: connectors.length,
    inputConnectorCount: connectors.filter(connector => connector.direction === "input").length,
    outputConnectorCount: connectors.filter(connector => connector.direction !== "input").length,
    internalMappingCount: mapping?.branchCount ?? pairs.length,
    fanDirection: mapping?.fanDirection || "",
    sourceConnectorIds: mapping?.sourceConnectorIds || [],
    destinationConnectorIds: mapping?.destinationConnectorIds || [],
    rendererHelper: device?.kind === "adapter" ? "drawAdapterVisual" : "drawRackDeviceVisual"
  };
}

function textureTitle(device) {
  const visual = device.visual || {};
  if (device.kind === "jump" || isCanvasObjectKind(device) || device.kind === "adapter") {
    return String(device.label || visual.displayName || visual.templateName || device.kind || "Object").trim();
  }
  return String(
    device.label
    || visual.displayName
    || visual.templateName
    || visual.model
    || device.model
    || visual.category
    || device.category
    || "Device"
  ).trim();
}

function basename(path) {
  const value = String(path || "").split(/[\\/]/).pop() || "Faceplate";
  return value.length > 34 ? `${value.slice(0, 31)}...` : value;
}

export function deviceVisualSources(device) {
  const visual = device?.visual || {};
  return [visual.faceImage, visual.thumbnailImage, visual.image, visual.logo, ...powerPlugAssetsForDevice(device)]
    .map(value => String(value || "").trim())
    .filter(Boolean);
}

export function deviceVisualAssetRevision(source) {
  const entry = IMAGE_CACHE.get(String(source || ""));
  return entry?.revision || 0;
}

function cachedImage(source) {
  const src = String(source || "").trim();
  if (!src || typeof Image === "undefined") return null;
  const existing = IMAGE_CACHE.get(src);
  if (existing) return existing.image;
  const image = new Image();
  const entry = {
    image,
    state: "loading",
    revision: 0
  };
  IMAGE_CACHE.set(src, entry);
  image.onload = () => {
    entry.state = "loaded";
    entry.revision += 1;
    assetReadyCallback?.(src);
  };
  image.onerror = () => {
    entry.state = "error";
    entry.revision += 1;
    assetReadyCallback?.(src);
  };
  image.src = src;
  return image;
}

function legacyFaceBounds(visual, width) {
  const faceHeight = legacyFaceHeight(visual, width);
  return {
    x: FACE_MARGIN,
    y: FACE_TOP_Y,
    width: Math.max(1, width - FACE_MARGIN * 2),
    height: faceHeight
  };
}

function legacyFaceHeight(visual, width) {
  if (visual?.faceplateDeleted && !visual?.faceImage) return 0;
  if (!visual?.hasFaceImage && !visual?.faceImage) return FACE_HEIGHT;
  const naturalWidth = Number(visual.faceImageNaturalWidth);
  const naturalHeight = Number(visual.faceImageNaturalHeight);
  const availableWidth = Math.max(1, width - FACE_MARGIN * 2);
  const aspectHeight = naturalWidth && naturalHeight
    ? Math.max(24, Math.round(availableWidth * naturalHeight / naturalWidth))
    : FACE_HEIGHT;
  const scaleY = clamp(Number(visual.faceImageScaleY) || Number(visual.faceplateScaleY) || Number(visual.faceImageScale) || Number(visual.faceplateScale) || 1, 0.2, 6);
  return Math.max(24, Math.round(aspectHeight * scaleY));
}

function legacyFaceImagePlacement(visual, width, image) {
  const faceHeight = legacyFaceHeight(visual, width);
  const pad = Math.min(FACE_IMAGE_PADDING, Math.max(0, faceHeight / 2 - 1));
  const inner = {
    x: FACE_MARGIN + pad,
    y: FACE_TOP_Y + pad,
    width: Math.max(1, width - FACE_MARGIN * 2 - pad * 2),
    height: Math.max(1, faceHeight - pad * 2)
  };
  const naturalWidth = Number(visual.faceImageNaturalWidth) || image?.naturalWidth || 0;
  const naturalHeight = Number(visual.faceImageNaturalHeight) || image?.naturalHeight || 0;
  if (!naturalWidth || !naturalHeight) return inner;
  const fitScale = inner.width / naturalWidth;
  const legacyScale = clamp(Number(visual.faceImageScale) || Number(visual.faceplateScale) || 1, 0.2, 6);
  const imageScaleX = clamp(Number(visual.faceImageScaleX) || Number(visual.faceplateScaleX) || legacyScale, 0.2, 6);
  const imageScaleY = clamp(Number(visual.faceImageScaleY) || Number(visual.faceplateScaleY) || legacyScale, 0.2, 6);
  const imageWidth = Math.min(inner.width, naturalWidth * fitScale * imageScaleX);
  const imageHeight = Math.min(inner.height, naturalHeight * fitScale * imageScaleY);
  const requestedX = inner.x + (inner.width - imageWidth) / 2 + (Number(visual.faceImageOffsetX ?? visual.faceplateOffsetX) || 0);
  const requestedY = inner.y + (inner.height - imageHeight) / 2 + (Number(visual.faceImageOffsetY ?? visual.faceplateOffsetY) || 0);
  return {
    x: clamp(requestedX, inner.x, inner.x + inner.width - imageWidth),
    y: clamp(requestedY, inner.y, inner.y + inner.height - imageHeight),
    width: imageWidth,
    height: imageHeight
  };
}

function preserveAspectRatioMeetRect(box, naturalWidth, naturalHeight) {
  const x = Number(box?.x) || 0;
  const y = Number(box?.y) || 0;
  const width = Math.max(1, Number(box?.width) || 1);
  const height = Math.max(1, Number(box?.height) || 1);
  const sourceWidth = Math.max(1, Number(naturalWidth) || width);
  const sourceHeight = Math.max(1, Number(naturalHeight) || height);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = Math.max(1, sourceWidth * scale);
  const drawHeight = Math.max(1, sourceHeight * scale);
  return {
    x: x + (width - drawWidth) / 2,
    y: y + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight
  };
}

function wrapInfoBoxLines(text, maxWidth, fontSize, maxLines = 2) {
  const value = String(text || "");
  if (!value.trim()) return [""];
  const measure = candidate => estimateTextWidth(candidate, fontSize, 700);
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach(word => {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);
  if (!lines.length) lines.push(value);
  return lines.slice(0, maxLines);
}

function visualSourceKey(value) {
  const text = String(value || "");
  if (text.length < 120) return text;
  return `hash:${text.length}:${hashString(text)}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeColor(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function estimateTextWidth(text, fontSize, weight = 700) {
  return String(text || "").length * fontSize * (weight >= 800 ? 0.62 : 0.56);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
