const QUALITY_PRESETS = {
  low: { label: "Low", scale: 1.75, maxSide: 1536 },
  medium: { label: "Medium", scale: 3.5, maxSide: 4096 },
  high: { label: "High", scale: 4.5, maxSide: 6144 }
};

const DEFAULT_QUALITY = "medium";
const LEGACY_DEVICE_BODY = "#171d24";
const LEGACY_DEVICE_FACE = "#26313d";
const LEGACY_DEVICE_BORDER = "#ffffff";
const LEGACY_ADAPTER_FILL = "rgba(50, 182, 255, .08)";
const LEGACY_ADAPTER_STROKE = "rgba(50, 182, 255, .72)";
const FACE_MARGIN = 12;
const FACE_TOP_Y = 38;
const FACE_HEIGHT = 78;
const FACE_IMAGE_PADDING = 8;
const SLOT_HEIGHT = 54;

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
  const connectorShape = (device.connectors || [])
    .map(connector => [
      Math.round(connector.x || 0),
      Math.round(connector.y || 0),
      connector.side || "",
      connector.direction || "",
      connector.type || connector.plug || "",
      connector.label || "",
      connector.nameText || "",
      connector.resolutionFrameRate || "",
      connector.customText || "",
      connector.nameTextCaption || "",
      connector.resolutionFrameRateCaption || "",
      connector.customTextCaption || "",
      options.connectorColors ? connector.color || "" : ""
    ].join(":"))
    .join("|");
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
        connector.nameText || "",
        connector.resolutionFrameRate || "",
        connector.customText || "",
        connector.nameTextCaption || "",
        connector.resolutionFrameRateCaption || "",
        connector.customTextCaption || "",
        connector.customColor || "",
        connector.fiberMode || "",
        connector.installedModuleType || ""
      ].join(",")).join("/")
    ].join(":"))
    .join("|");
  return [
    "device-card-v6",
    visualKind,
    width,
    height,
    color,
    quality.mode,
    quality.highDpi ? "hidpi" : "1x",
    options.simplifiedCards ? "simplified" : "standard",
    options.detailedDeviceTextures === false ? "basic" : "detailed",
    title,
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
    visual.isMatrixRouter ? "matrix" : "",
    device.portCount || 0,
    connectorShape,
    cardShape
  ].join(";");
}

export function buildDeviceVisual(device, options = {}) {
  const start = performance.now();
  const width = Math.max(1, Math.round(device.width || 1));
  const height = Math.max(1, Math.round(device.height || 1));
  const quality = textureQuality(options);
  const maxTextureSide = effectiveTextureMaxSide(device, quality, options);
  const ratio = Math.max(0.1, Math.min(
    quality.scale,
    maxTextureSide / Math.max(width, height, 1)
  ));
  const canvas = createCanvas(Math.max(1, Math.ceil(width * ratio)), Math.max(1, Math.ceil(height * ratio)));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create device visual canvas context.");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawDeviceVisual(ctx, device, width, height, options);
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    cssWidth: width,
    cssHeight: height,
    pixelRatio: ratio,
    qualityMode: quality.mode,
    maxTextureSide,
    buildMs: performance.now() - start,
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
    scale: highDpi ? preset.scale : 1
  };
}

function drawDeviceVisual(ctx, device, width, height, options) {
  const kind = visualDeviceKind(device);
  if (kind === "jump") {
    drawJumpVisual(ctx, device, width, height);
    return;
  }
  if (kind === "surface") {
    drawSurfaceVisual(ctx, device, width, height);
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
  const face = drawFaceplate(ctx, device, visual, width, height, pad, detailed);

  if (detailed && visual.visualCards?.length && !options.simplifiedCards) {
    drawCardAreas(ctx, visual.visualCards, width, height, pad);
  } else if (detailed && visual.hasSwappableCards && device.connectors?.length) {
    drawConnectorBands(ctx, device, width, height, face.bottom + 12);
  }

  if (visual.isLedProcessor) drawDeviceTag(ctx, "LED PROCESSOR", width - pad, 24, "#ff99cc", "right");
  if (visual.isPowerDistro) drawDeviceTag(ctx, "POWER DISTRO", width - pad, 40, "#e53935", "right");
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
      ctx.drawImage(image, placement.x, placement.y, placement.width, placement.height);
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
    drawCardConnectorFields(ctx, card, width);
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
  const connectors = Array.isArray(card.connectors) ? card.connectors : [];
  if (!connectors.length) return;
  connectors.forEach(connector => {
    const fields = connectorInfoFields(connector);
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
  const groups = groupConnectors(device.connectors || []);
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
    gradient.addColorStop(0, inputColor);
    gradient.addColorStop(0.25, inputColor);
    gradient.addColorStop(0.75, outputColor);
    gradient.addColorStop(1, outputColor);
    ctx.strokeStyle = gradient;
    ctx.beginPath();
    adapterInternalWirePath(ctx, pair.input, pair.output);
    ctx.stroke();
  });
  ctx.restore();
}

function adapterInternalWirePairs(connectors) {
  const usable = connectors
    .filter(connector => connector && !connector.empty && (connector.type || connector.label || connector.nameText))
    .slice();
  const inputs = usable
    .filter(connector => connector.direction === "input" || connector.side === "left" || Number(connector.x || 0) <= 1)
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
  const outputs = usable
    .filter(connector => connector.direction === "output" || connector.side === "right")
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
  if (!inputs.length || !outputs.length) return [];
  const pairs = [];
  if (inputs.length === 1) {
    outputs.forEach(output => pairs.push({ input: inputs[0], output }));
    return pairs;
  }
  if (outputs.length === 1) {
    inputs.forEach(input => pairs.push({ input, output: outputs[0] }));
    return pairs;
  }
  const max = Math.max(inputs.length, outputs.length);
  for (let index = 0; index < max; index += 1) {
    const inputIndex = Math.round((index / Math.max(1, max - 1)) * (inputs.length - 1));
    const outputIndex = Math.round((index / Math.max(1, max - 1)) * (outputs.length - 1));
    pairs.push({ input: inputs[inputIndex], output: outputs[outputIndex] });
  }
  return pairs;
}

function adapterInternalWirePath(ctx, input, output) {
  const start = { x: Number(input.x || 0), y: Number(input.y || 0) };
  const end = { x: Number(output.x || 0), y: Number(output.y || 0) };
  const dir = end.x >= start.x ? 1 : -1;
  const dx = Math.max(36, Math.abs(end.x - start.x) * 0.42);
  ctx.moveTo(start.x, start.y);
  ctx.bezierCurveTo(start.x + dx * dir, start.y, end.x - dx * dir, end.y, end.x, end.y);
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
  ctx.fillStyle = "#0a0c0d";
  ctx.fillRect(0, 0, width, height);
  const tile = Math.max(8, Math.min(26, Math.min(width, height) / 18));
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      ctx.fillStyle = ((Math.floor(x / tile) + Math.floor(y / tile)) % 2) ? "#747474" : "#9b9b9b";
      ctx.fillRect(x, y, tile, tile);
    }
  }
  ctx.strokeStyle = "rgb(255, 121, 4)";
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.01);
  ctx.strokeRect(0, 0, width, height);
  drawFittedText(ctx, textureTitle(device), 12, height * 0.44, width - 24, Math.max(18, Math.min(52, height * 0.18)), {
    weight: 800,
    fill: "#89c43e",
    stroke: "rgba(0,0,0,.45)",
    strokeWidth: 2.2,
    align: "center"
  });
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
  return device.kind || "device";
}

function effectiveTextureMaxSide(device, quality, options = {}) {
  const gpuMax = Number(options.gpuMaxTextureSide) || Infinity;
  const modularTarget = device?.visual?.hasSwappableCards
    ? Math.max(quality.maxSide, 8192)
    : quality.maxSide;
  return Math.max(1, Math.min(modularTarget, gpuMax));
}

function textureTitle(device) {
  const visual = device.visual || {};
  if (device.kind === "jump" || device.kind === "surface" || device.kind === "adapter") {
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
  return [visual.faceImage, visual.thumbnailImage]
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
  const scaleY = clamp(Number(visual.faceImageScaleY) || Number(visual.faceImageScale) || 1, 0.2, 6);
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
  const legacyScale = clamp(Number(visual.faceImageScale) || 1, 0.2, 6);
  const imageScaleX = clamp(Number(visual.faceImageScaleX) || legacyScale, 0.2, 6);
  const imageScaleY = clamp(Number(visual.faceImageScaleY) || legacyScale, 0.2, 6);
  const imageWidth = Math.min(inner.width, naturalWidth * fitScale * imageScaleX);
  const imageHeight = Math.min(inner.height, naturalHeight * fitScale * imageScaleY);
  const requestedX = inner.x + (inner.width - imageWidth) / 2 + (Number(visual.faceImageOffsetX) || 0);
  const requestedY = inner.y + (inner.height - imageHeight) / 2 + (Number(visual.faceImageOffsetY) || 0);
  return {
    x: clamp(requestedX, inner.x, inner.x + inner.width - imageWidth),
    y: clamp(requestedY, inner.y, inner.y + inner.height - imageHeight),
    width: imageWidth,
    height: imageHeight
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
