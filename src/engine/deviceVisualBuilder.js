const QUALITY_PRESETS = {
  low: { label: "Low", scale: 1, maxSide: 512 },
  medium: { label: "Medium", scale: 1.65, maxSide: 1024 },
  high: { label: "High", scale: 2.35, maxSide: 1536 }
};

const DEFAULT_QUALITY = "medium";
const FACE_MARGIN = 12;
const FACE_TOP_Y = 38;
const FACE_HEIGHT = 78;
const FACE_IMAGE_PADDING = 8;

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
  // This key describes only stable visual appearance. It intentionally avoids
  // instance labels/positions so thousands of identical placed devices can
  // share one GPU texture and keep pan/zoom/drag work cheap.
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
    "device-card-v3",
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
  ctx.imageSmoothingQuality = quality.mode === "high" ? "high" : "medium";
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
  const radius = Math.min(12, Math.max(5, Math.min(width, height) * 0.055));
  const pad = Math.max(8, Math.min(width, height) * 0.045);
  const headerHeight = Math.max(22, Math.min(42, height * 0.12));

  roundRect(ctx, 0, 0, width, height, radius);
  ctx.fillStyle = device.color || "#182531";
  ctx.fill();
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.01);
  ctx.strokeStyle = "#dbe7f3";
  ctx.stroke();

  drawDeviceHeader(ctx, device, width, headerHeight, pad, detailed);
  const face = drawFaceplate(ctx, device, visual, width, height, headerHeight, pad, detailed);

  if (detailed && visual.visualCards?.length && !options.simplifiedCards) {
    drawCardAreas(ctx, visual.visualCards, width, height, pad);
  } else if (detailed && visual.hasSwappableCards && device.connectors?.length) {
    drawConnectorBands(ctx, device, width, height, face.bottom + 12);
  }

  if (visual.isLedProcessor) drawDeviceTag(ctx, "LED PROCESSOR", width - pad, headerHeight + 6, "#ff99cc", "right");
  if (visual.isPowerDistro) drawDeviceTag(ctx, "POWER DISTRO", width - pad, headerHeight + 22, "#e53935", "right");
  if (visual.isMatrixRouter) drawDeviceTag(ctx, "MATRIX", width - pad, headerHeight + 38, "#32b6ff", "right");

  if (options.connectorMarkers !== false) drawConnectorMarkers(ctx, device, width, height, options);
}

function drawDeviceHeader(ctx, device, width, headerHeight, pad, detailed) {
  const title = textureTitle(device);
  ctx.save();
  ctx.fillStyle = "rgba(8, 12, 18, .28)";
  ctx.fillRect(1, 1, width - 2, headerHeight);
  drawFittedText(ctx, title, pad, Math.max(5, headerHeight * 0.2), width - pad * 2, Math.max(11, headerHeight * 0.58), {
    weight: 800,
    fill: "#ffffff",
    stroke: "rgba(0,0,0,.7)",
    strokeWidth: 2.4,
    baseline: "top"
  });

  if (detailed) {
    const parts = [device.brand || device.visual?.brand, device.model || device.visual?.model, device.category || device.visual?.category]
      .map(value => String(value || "").trim())
      .filter(Boolean);
    if (parts.length) {
      drawFittedText(ctx, parts.join(" / "), pad, headerHeight - 10, width - pad * 2, 7.5, {
        weight: 700,
        fill: "#b8c7d7",
        baseline: "top"
      });
    }
  }
  ctx.restore();
}

function drawFaceplate(ctx, device, visual, width, height, headerHeight, pad, detailed) {
  if (visual.faceplateDeleted) return { x: pad, y: headerHeight + pad, width: width - pad * 2, height: 0, bottom: headerHeight + pad };
  const faceBounds = legacyFaceBounds(visual, width);
  const x = visual.hasFaceImage ? faceBounds.x : pad;
  const y = visual.hasFaceImage ? faceBounds.y : headerHeight + Math.max(5, pad * 0.65);
  const w = visual.hasFaceImage ? faceBounds.width : Math.max(1, width - pad * 2);
  const h = visual.hasFaceImage
    ? faceBounds.height
    : Math.min(height * 0.34, Math.max(24, height * 0.22));

  roundRect(ctx, x, y, w, h, Math.min(8, pad));
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, visual.hasFaceImage ? "#2f3f4d" : "#243443");
  gradient.addColorStop(0.55, visual.hasFaceImage ? "#18222c" : "#263746");
  gradient.addColorStop(1, visual.hasFaceImage ? "#4a5660" : "#1d2a36");
  ctx.fillStyle = gradient;
  ctx.fill();

  if (visual.hasFaceImage) {
    const image = cachedImage(visual.faceImage);
    if (image?.complete && image.naturalWidth > 0) {
      const placement = legacyFaceImagePlacement(visual, width, image);
      ctx.save();
      roundRect(ctx, x, y, w, h, Math.min(8, pad));
      ctx.clip();
      ctx.drawImage(image, placement.x, placement.y, placement.width, placement.height);
      ctx.restore();
    } else {
      drawFaceplateLoadingPlaceholder(ctx, visual, x, y, w, h);
    }
  } else {
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

  if (detailed && visual.hasThumbnailImage) {
    drawDeviceTag(ctx, "THUMB", x + w - 8, y + h - 8, "#7bcac1", "right");
  }
  return { x, y, width: w, height: h, bottom: y + h };
}

function drawCardAreas(ctx, cards, width, height, pad) {
  cards.forEach((card, index) => {
    const x = clamp(card.x, pad, Math.max(pad, width - pad - 24));
    const y = clamp(card.y, pad, Math.max(pad, height - pad - 24));
    const w = Math.min(Math.max(24, card.width), Math.max(24, width - x - pad));
    const h = Math.min(Math.max(18, card.height), Math.max(18, height - y - pad));
    roundRect(ctx, x, y, w, h, 6);
    ctx.fillStyle = index % 2 ? "rgba(36, 70, 88, .64)" : "rgba(25, 58, 76, .66)";
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(50, 182, 255, .58)";
    ctx.lineWidth = 1.4;
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
  const maxWidth = Math.max(44, Number(card.width) - 12);
  let fontSize = Math.min(16, 54 * 0.62);
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
    strokeWidth: 4.4,
    align: "center",
    baseline: "middle"
  });
  ctx.restore();
}

function drawCardConnectorFields(ctx, card, deviceWidth) {
  const connectors = Array.isArray(card.connectors) ? card.connectors : [];
  if (!connectors.length) return;
  const boxHeight = 13;
  const gap = Math.max(2, Math.min(4, Number(card.width) * 0.025));
  const boxWidth = Math.max(24, Math.min(43, (Number(card.width) - 28) / 3));
  const topInset = Number(card.y) + 22;
  const bottomLimit = Number(card.y) + Number(card.height) - 8;
  connectors.forEach(connector => {
    const fields = connectorInfoFields(connector);
    if (!fields.length) return;
    const rowY = clamp(Number(connector.y) || Number(card.slotY) || 0, topInset, bottomLimit);
    const valueY = rowY - boxHeight * 0.34;
    const titleY = valueY - boxHeight * 0.52;
    const isInput = connector.direction === "input";
    const startX = isInput
      ? Number(card.x) + 18
      : Number(card.x) + Number(card.width) - 18;
    fields.forEach((field, index) => {
      const x = isInput
        ? startX + index * (boxWidth + gap)
        : startX - (index + 1) * boxWidth - index * gap;
      roundRect(ctx, x, valueY - boxHeight / 2, boxWidth, boxHeight, 3);
      ctx.fillStyle = "rgba(17, 28, 39, .78)";
      ctx.fill();
      ctx.strokeStyle = "rgba(205, 221, 235, .78)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
      drawFittedText(ctx, field.title, x, titleY, boxWidth, 5.5, {
        weight: 800,
        fill: "#32b6ff",
        stroke: "rgba(0,0,0,.78)",
        strokeWidth: 1,
        align: "center",
        baseline: "middle"
      });
      drawFittedText(ctx, field.value || "", x + 2, valueY + 1.2, boxWidth - 4, 5.6, {
        weight: 800,
        fill: "#ffffff",
        align: "center",
        baseline: "middle"
      });
    });
  });
}

function connectorInfoFields(connector) {
  const fields = [
    {
      title: connectorFieldTitle(connector, "nameText", "Name"),
      value: connector.nameText || connector.label || ""
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
  const radius = Math.min(18, Math.max(8, Math.min(width, height) * 0.09));
  roundRect(ctx, 0, 0, width, height, radius);
  ctx.fillStyle = "rgba(21, 43, 56, .78)";
  ctx.fill();
  ctx.strokeStyle = "rgb(50, 182, 255)";
  ctx.lineWidth = Math.max(3, Math.min(width, height) * 0.02);
  ctx.setLineDash([18, 13]);
  ctx.stroke();
  ctx.setLineDash([]);
  const title = textureTitle(device);
  drawFittedText(ctx, title, 8, Math.max(4, height * 0.08), width - 16, Math.max(11, height * 0.17), {
    weight: 900,
    fill: "#ffffff",
    stroke: "rgba(0,0,0,.74)",
    strokeWidth: 2.5,
    align: "center",
    baseline: "top"
  });
  if (options.connectorMarkers !== false) drawConnectorMarkers(ctx, device, width, height, options);
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
  connectors.forEach(connector => {
    const px = connector.x ?? (connector.side === "right" ? width : 0);
    const py = connector.y ?? height / 2;
    const radius = device.kind === "jump" ? 10 : Math.max(4, Math.min(8, Math.min(width, height) * 0.032));
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = options.connectorColors === false ? "rgb(50, 182, 255)" : connector.color || "rgb(50, 182, 255)";
    ctx.fill();
    ctx.lineWidth = Math.max(2, radius * 0.32);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    if (canLabel && connector.label) {
      const text = String(connector.label || connector.type || "").slice(0, 18);
      const alignLeft = px < width / 2;
      const tx = alignLeft ? px + radius + 3 : px - radius - 3;
      drawFittedText(ctx, text, alignLeft ? tx : tx - 56, py + radius * 0.75, 56, Math.max(6, radius * 0.82), {
        weight: 800,
        fill: "#f8fbff",
        stroke: "rgba(0,0,0,.82)",
        strokeWidth: 1.8,
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
    ? Math.max(quality.maxSide, 4096)
    : quality.maxSide;
  return Math.max(1, Math.min(modularTarget, gpuMax));
}

function textureTitle(device) {
  const visual = device.visual || {};
  if (device.kind === "jump" || device.kind === "surface" || device.kind === "adapter") {
    return String(device.label || visual.displayName || visual.templateName || device.kind || "Object").trim();
  }
  return String(
    visual.templateName
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
