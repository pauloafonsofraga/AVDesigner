export function cleanCableScheduleColor(value, fallback = "#32b6ff") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

async function imageForSource(source) {
  if (!source || typeof Image !== "function") return null;
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

export async function nodeGraphic(node, colorValue, loadArtwork) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 40;
  const context = canvas.getContext("2d");
  const color = cleanCableScheduleColor(colorValue || node?.color);
  context.fillStyle = color;
  context.beginPath(); context.arc(13, 20, 8, 0, Math.PI * 2); context.fill();
  context.strokeStyle = "#32404b"; context.lineWidth = 2; context.stroke();
  let artwork = null;
  if (node?.thumbnail) {
    try { artwork = await imageForSource(await loadArtwork(node.thumbnail)); } catch { /* Color marker remains usable. */ }
  }
  if (artwork) {
    const scale = Math.min(32 / artwork.width, 32 / artwork.height);
    const width = artwork.width * scale, height = artwork.height * scale;
    context.drawImage(artwork, 29 + (32 - width) / 2, 4 + (32 - height) / 2, width, height);
  }
  return canvas.toDataURL("image/png");
}

export function cableGraphic(color) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 40;
  const context = canvas.getContext("2d");
  context.strokeStyle = cleanCableScheduleColor(color); context.lineWidth = 7; context.lineCap = "round";
  context.beginPath(); context.moveTo(7, 20); context.lineTo(57, 20); context.stroke();
  context.fillStyle = "#f8fafc";
  for (const x of [7, 57]) { context.beginPath(); context.arc(x, 20, 3, 0, Math.PI * 2); context.fill(); }
  return canvas.toDataURL("image/png");
}

export function cableIdGraphic(id, color, background = "#ffffff") {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const text = String(id || "");
  const scale = 3;
  const fontPx = 17 * 96 / 72;
  context.font = `bold ${fontPx}px Arial, sans-serif`;
  const width = Math.ceil(context.measureText(text).width + 12);
  const height = 34;
  canvas.width = width * scale; canvas.height = height * scale;
  context.scale(scale, scale);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.font = `bold ${fontPx}px Arial, sans-serif`;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 0.5 * 96 / 72;
  context.strokeStyle = "#000000";
  context.strokeText(text, 6, height / 2);
  context.fillStyle = cleanCableScheduleColor(color);
  context.fillText(text, 6, height / 2);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}
