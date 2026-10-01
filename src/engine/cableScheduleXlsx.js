import ExcelJS from "exceljs/dist/exceljs.min.js";
import { CABLE_SCHEDULE_COLUMNS } from "./cableSchedule.js";

function cleanColor(value, fallback = "#32b6ff") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function toArgb(color) {
  return `FF${cleanColor(color).slice(1).toUpperCase()}`;
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

async function nodeGraphic(node, colorValue, loadArtwork) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 40;
  const context = canvas.getContext("2d");
  const color = cleanColor(colorValue || node?.color);
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

function cableGraphic(color) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 40;
  const context = canvas.getContext("2d");
  context.strokeStyle = cleanColor(color); context.lineWidth = 7; context.lineCap = "round";
  context.beginPath(); context.moveTo(7, 20); context.lineTo(57, 20); context.stroke();
  context.fillStyle = "#f8fafc";
  for (const x of [7, 57]) { context.beginPath(); context.arc(x, 20, 3, 0, Math.PI * 2); context.fill(); }
  return canvas.toDataURL("image/png");
}

export async function createCableScheduleXlsx(rows, { nodeDefinitions = [], loadArtwork = async value => value,
  graphics = null } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WireNexus";
  const sheet = workbook.addWorksheet("Cable Schedule", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = CABLE_SCHEDULE_COLUMNS.map(([key, header], index) => ({
    key, header, width: [14, 25, 38, 25, 38, 13, 25, 38, 13, 20, 26, 38][index]
  }));
  sheet.autoFilter = { from: "A1", to: `L${Math.max(2, rows.length + 1)}` };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263641" } };
    cell.alignment = { vertical: "middle" };
  });
  const nodeById = new Map(Array.isArray(nodeDefinitions)
    ? nodeDefinitions.map(node => [node.id, node]) : Object.entries(nodeDefinitions).map(([id, node]) => [id, node]));
  const imageIds = new Map();
  const addGraphic = async (row, column, key, makeImage) => {
    if (!key) return;
    let imageId = imageIds.get(key);
    if (imageId === undefined) {
      const dataUrl = await makeImage();
      if (!dataUrl) return;
      imageId = workbook.addImage({ base64: dataUrl, extension: "png" });
      imageIds.set(key, imageId);
    }
    sheet.addImage(imageId, { tl: { nativeCol: column - 1, nativeColOff: 185 * 9525,
      nativeRow: row - 1, nativeRowOff: 3 * 9525 },
      ext: { width: 38, height: 24 }, editAs: "oneCell" });
    sheet.getCell(row, column).alignment = { vertical: "middle", wrapText: true };
  };
  for (let index = 0; index < rows.length; index++) {
    const record = rows[index], rowNumber = index + 2;
    const row = sheet.addRow(Object.fromEntries(CABLE_SCHEDULE_COLUMNS.map(([key]) => [key, String(record[key] ?? "")])));
    row.height = Math.max(32, String(record.notes || "").split("\n").length * 16);
    row.eachCell(cell => { cell.alignment = { vertical: "middle", wrapText: true }; });
    if (index % 2) row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F7" } }; });
    const sourceId = record.sourceNodeTypeId, destinationId = record.destinationNodeTypeId;
    await addGraphic(rowNumber, 3, `node:${sourceId}:${record.sourceNodeColor}`, async () => graphics?.nodes?.[sourceId]
      || nodeGraphic(nodeById.get(sourceId), record.sourceNodeColor, loadArtwork));
    await addGraphic(rowNumber, 5, `node:${destinationId}:${record.destinationNodeColor}`, async () => graphics?.nodes?.[destinationId]
      || nodeGraphic(nodeById.get(destinationId), record.destinationNodeColor, loadArtwork));
    const color = cleanColor(record.cableColor);
    await addGraphic(rowNumber, 8, `cable:${color}`, async () => graphics?.cables?.[color]
      || cableGraphic(color));
    sheet.getCell(rowNumber, 1).font = { bold: true, color: { argb: toArgb(color) } };
  }
  return workbook.xlsx.writeBuffer();
}
