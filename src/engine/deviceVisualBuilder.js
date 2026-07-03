const DEFAULT_PIXEL_RATIO = 1.25;
const MAX_TEXTURE_SIDE = 768;

export function deviceVisualCacheKey(device, options = {}) {
  const visualKind = visualDeviceKind(device);
  const width = Math.max(1, Math.round(device.width || 1));
  const height = Math.max(1, Math.round(device.height || 1));
  const color = String(device.color || "").trim();
  const portCount = Number(device.portCount || 0);
  const connectorShape = (device.connectors || [])
    .map(connector => [
      Math.round(connector.x || 0),
      Math.round(connector.y || 0),
      connector.side || "",
      connector.type || connector.plug || "",
      options.connectorColors ? connector.color || "" : ""
    ].join(":"))
    .join("|");
  return [
    "device-card-v1",
    visualKind,
    width,
    height,
    color,
    portCount,
    connectorShape,
    options.simplifiedCards ? "simplified" : "standard"
  ].join(";");
}

export function buildDeviceVisual(device, options = {}) {
  const start = performance.now();
  const width = Math.max(1, Math.round(device.width || 1));
  const height = Math.max(1, Math.round(device.height || 1));
  const baseRatio = Number(options.pixelRatio || DEFAULT_PIXEL_RATIO);
  const ratio = Math.max(0.5, Math.min(baseRatio, MAX_TEXTURE_SIDE / Math.max(width, height, 1)));
  const canvas = createCanvas(Math.max(1, Math.ceil(width * ratio)), Math.max(1, Math.ceil(height * ratio)));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create device visual canvas context.");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  drawDeviceVisual(ctx, device, width, height, options);
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    cssWidth: width,
    cssHeight: height,
    pixelRatio: ratio,
    buildMs: performance.now() - start,
    fallback: false
  };
}

function drawDeviceVisual(ctx, device, width, height, options) {
  const kind = visualDeviceKind(device);
  if (kind === "jump") {
    drawJumpVisual(ctx, width, height);
    return;
  }
  if (kind === "surface") {
    drawSurfaceVisual(ctx, width, height);
    return;
  }
  if (kind === "adapter") {
    drawAdapterVisual(ctx, width, height);
    return;
  }
  drawRackDeviceVisual(ctx, device, width, height, options);
}

function drawRackDeviceVisual(ctx, device, width, height, options) {
  const radius = Math.min(12, Math.max(5, Math.min(width, height) * 0.055));
  roundRect(ctx, 0, 0, width, height, radius);
  ctx.fillStyle = device.color || "#182531";
  ctx.fill();
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.012);
  ctx.strokeStyle = "#dbe7f3";
  ctx.stroke();

  const faceplateHeight = Math.min(height * 0.36, Math.max(24, height * 0.22));
  const pad = Math.max(8, Math.min(width, height) * 0.045);
  roundRect(ctx, pad, pad, Math.max(1, width - pad * 2), Math.max(1, faceplateHeight), Math.min(7, radius));
  ctx.fillStyle = "#243443";
  ctx.fill();

  const displayWidth = Math.min(width * 0.22, 94);
  roundRect(ctx, pad * 1.6, pad * 1.75, displayWidth, Math.max(9, faceplateHeight * 0.32), 3);
  ctx.fillStyle = "#7bcac1";
  ctx.fill();

  const ledCount = Math.min(8, Math.max(3, Math.floor((width - pad * 4 - displayWidth) / 26)));
  const ledStart = pad * 2.3 + displayWidth;
  const ledY = pad + faceplateHeight * 0.42;
  for (let index = 0; index < ledCount; index += 1) {
    ctx.beginPath();
    ctx.arc(ledStart + index * 18, ledY, Math.max(2.5, Math.min(4.5, width * 0.008)), 0, Math.PI * 2);
    ctx.fillStyle = index % 2 ? "rgb(255, 121, 4)" : "rgb(50, 182, 255)";
    ctx.fill();
  }

  if (!options.simplifiedCards && device.connectors?.length) {
    drawSoftConnectorGuide(ctx, device, width, height);
  }
  if (options.connectorMarkers !== false) drawConnectorMarkers(ctx, device, width, height, options);
}

function drawSoftConnectorGuide(ctx, device, width, height) {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#32b6ff";
  ctx.setLineDash([8, 7]);
  ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.006);
  const groups = new Map();
  device.connectors.forEach(connector => {
    const bucket = `${connector.side || ""}:${Math.round((connector.y || 0) / 80)}`;
    const existing = groups.get(bucket) || [];
    existing.push(connector);
    groups.set(bucket, existing);
  });
  groups.forEach(connectors => {
    if (connectors.length < 2) return;
    const ys = connectors.map(connector => connector.y || 0);
    const y = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    ctx.beginPath();
    ctx.moveTo(width * 0.12, y);
    ctx.lineTo(width * 0.88, y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawAdapterVisual(ctx, width, height) {
  roundRect(ctx, 0, 0, width, height, Math.min(18, Math.max(8, Math.min(width, height) * 0.09)));
  ctx.fillStyle = "rgba(21, 43, 56, .78)";
  ctx.fill();
  ctx.strokeStyle = "rgb(50, 182, 255)";
  ctx.lineWidth = Math.max(3, Math.min(width, height) * 0.02);
  ctx.setLineDash([18, 13]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawJumpVisual(ctx, width, height) {
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
}

function drawSurfaceVisual(ctx, width, height) {
  ctx.fillStyle = "#0a0c0d";
  ctx.fillRect(0, 0, width, height);
  const tile = Math.max(8, Math.min(26, Math.min(width, height) / 18));
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      ctx.fillStyle = ((x / tile + y / tile) % 2) ? "#747474" : "#9b9b9b";
      ctx.fillRect(x, y, tile, tile);
    }
  }
  ctx.strokeStyle = "rgb(255, 121, 4)";
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.01);
  ctx.strokeRect(0, 0, width, height);
}

function drawConnectorMarkers(ctx, device, width, height, options) {
  const connectors = device.connectors?.length
    ? device.connectors
    : fallbackConnectors(device, width, height);
  connectors.forEach(connector => {
    const px = connector.x ?? (connector.side === "right" ? width : 0);
    const py = connector.y ?? height / 2;
    const radius = device.kind === "jump" ? 10 : Math.max(4, Math.min(8, Math.min(width, height) * 0.035));
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = options.connectorColors === false ? "rgb(50, 182, 255)" : connector.color || "rgb(50, 182, 255)";
    ctx.fill();
    ctx.lineWidth = Math.max(2, radius * 0.35);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
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

function visualDeviceKind(device) {
  return device.kind || "device";
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
