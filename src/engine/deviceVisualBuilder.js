const QUALITY_PRESETS = {
  low: { label: "Low", scale: 1, maxSide: 512 },
  medium: { label: "Medium", scale: 1.65, maxSide: 1024 },
  high: { label: "High", scale: 2.35, maxSide: 1536 }
};

const DEFAULT_QUALITY = "medium";

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
  const faceKey = visual.hasFaceImage ? visualSourceKey(visual.faceImage || "face") : "";
  const connectorShape = (device.connectors || [])
    .map(connector => [
      Math.round(connector.x || 0),
      Math.round(connector.y || 0),
      connector.side || "",
      connector.direction || "",
      connector.type || connector.plug || "",
      connector.label || "",
      options.connectorColors ? connector.color || "" : ""
    ].join(":"))
    .join("|");
  const cardShape = (visual.visualCards || [])
    .map(card => [
      Math.round(card.x || 0),
      Math.round(card.y || 0),
      Math.round(card.width || 0),
      Math.round(card.height || 0),
      card.name || "",
      card.direction || "",
      card.connectorCount || 0
    ].join(":"))
    .join("|");
  return [
    "device-card-v2",
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
  const ratio = Math.max(0.1, Math.min(
    quality.scale,
    quality.maxSide / Math.max(width, height, 1)
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
    maxTextureSide: quality.maxSide,
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
  const naturalRatio = visual.faceImageNaturalWidth && visual.faceImageNaturalHeight
    ? visual.faceImageNaturalHeight / visual.faceImageNaturalWidth
    : 0.22;
  const scaledRatio = naturalRatio * (Number(visual.faceImageScaleY) || 1);
  const faceHeight = visual.hasFaceImage
    ? Math.min(height * 0.42, Math.max(24, (width - pad * 2) * scaledRatio))
    : Math.min(height * 0.34, Math.max(24, height * 0.22));
  const x = pad;
  const y = headerHeight + Math.max(5, pad * 0.65);
  const w = Math.max(1, width - pad * 2);
  const h = Math.max(1, faceHeight);

  roundRect(ctx, x, y, w, h, Math.min(8, pad));
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, visual.hasFaceImage ? "#2f3f4d" : "#243443");
  gradient.addColorStop(0.55, visual.hasFaceImage ? "#18222c" : "#263746");
  gradient.addColorStop(1, visual.hasFaceImage ? "#4a5660" : "#1d2a36");
  ctx.fillStyle = gradient;
  ctx.fill();

  if (visual.hasFaceImage) {
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
    drawFittedText(ctx, card.name || "Card", x + 8, y + 7, w - 16, Math.min(16, Math.max(8, h * 0.13)), {
      weight: 900,
      fill: "#ffffff",
      stroke: "rgba(0,0,0,.75)",
      strokeWidth: 2.2,
      align: "center",
      baseline: "top"
    });
    if (card.connectorCount) drawDeviceTag(ctx, `${card.connectorCount} ports`, x + w - 7, y + h - 7, "#32b6ff", "right");
  });
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
