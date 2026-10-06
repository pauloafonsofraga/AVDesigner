import ExcelJS from "exceljs/dist/exceljs.min.js";
import { CABLE_SCHEDULE_COLUMNS } from "./cableSchedule.js";
import { cableGraphic, cableIdGraphic, cleanCableScheduleColor, nodeGraphic } from "./cableScheduleGraphics.js";

function toArgb(color) {
  return `FF${cleanCableScheduleColor(color).slice(1).toUpperCase()}`;
}

export async function createCableScheduleXlsx(rows, { nodeDefinitions = [], loadArtwork = async value => value,
  graphics = null, looms = [] } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WireNexus";
  const sheet = workbook.addWorksheet("Cable Schedule", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = CABLE_SCHEDULE_COLUMNS.map(([key, header], index) => ({
    key, header, width: [19, 25, 38, 25, 38, 13, 25, 38, 13, 20, 26, 38][index]
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
  const addGraphic = async (row, column, key, makeImage, placement = {}) => {
    if (!key) return;
    let imageId = imageIds.get(key);
    if (imageId === undefined) {
      const dataUrl = await makeImage();
      if (!dataUrl) return;
      imageId = workbook.addImage({ base64: dataUrl.dataUrl || dataUrl, extension: "png" });
      imageIds.set(key, imageId);
    }
    const x = placement.x ?? 185, y = placement.y ?? 3;
    const width = placement.width ?? 38, height = placement.height ?? 24;
    // Two-cell anchors keep each graphic with its row when Excel filters hide rows.
    sheet.addImage(imageId, {
      tl: { nativeCol: column - 1, nativeColOff: x * 9525,
        nativeRow: row - 1, nativeRowOff: y * 9525 },
      br: { nativeCol: column - 1, nativeColOff: (x + width) * 9525,
        nativeRow: row - 1, nativeRowOff: (y + height) * 9525 },
      editAs: "twoCell"
    });
    sheet.getCell(row, column).alignment = { vertical: "middle", wrapText: true };
  };
  for (let index = 0; index < rows.length; index++) {
    const record = rows[index], rowNumber = index + 2;
    const row = sheet.addRow(Object.fromEntries(CABLE_SCHEDULE_COLUMNS.map(([key]) => [key, String(record[key] ?? "")])));
    row.height = Math.max(36, String(record.notes || "").split("\n").length * 16);
    row.eachCell(cell => { cell.alignment = { vertical: "middle", wrapText: true }; });
    if (index % 2) row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F7" } }; });
    const sourceId = record.sourceNodeTypeId, destinationId = record.destinationNodeTypeId;
    await addGraphic(rowNumber, 3, `node:${sourceId}:${record.sourceNodeColor}`, async () => graphics?.nodes?.[sourceId]
      || nodeGraphic(nodeById.get(sourceId), record.sourceNodeColor, loadArtwork));
    await addGraphic(rowNumber, 5, `node:${destinationId}:${record.destinationNodeColor}`, async () => graphics?.nodes?.[destinationId]
      || nodeGraphic(nodeById.get(destinationId), record.destinationNodeColor, loadArtwork));
    const color = cleanCableScheduleColor(record.cableColor);
    await addGraphic(rowNumber, 8, `cable:${color}`, async () => graphics?.cables?.[color]
      || cableGraphic(color));
    const idCell = sheet.getCell(rowNumber, 1);
    idCell.font = { bold: true, size: 17, color: { argb: toArgb(color) } };
    // Keep the ID searchable as cell text; the image supplies the separate black text stroke.
    const idGraphic = graphics?.ids?.[record.cableNumber]
      || cableIdGraphic(record.cableNumber, color, index % 2 ? "#f1f5f7" : "#ffffff");
    if (idGraphic) await addGraphic(rowNumber, 1, `id:${record.cableNumber}:${color}`,
      async () => idGraphic, { x: 0, y: 6, width: idGraphic.width || 105, height: idGraphic.height || 34 });
  }
  const loomSheet = workbook.addWorksheet("Loom Schedule", { views: [{ state: "frozen", ySplit: 1 }] });
  const loomColumns = [
    ["name", "Loom", 20], ["origin", "Origin", 24], ["destination", "Destination", 24],
    ["trunkLength", "Length", 18], ["circuits", "Circuits", 12],
    ["composition", "Composition", 48], ["notes", "Notes", 42]
  ];
  loomSheet.columns = loomColumns.map(([key, header, width]) => ({ key, header, width }));
  loomSheet.autoFilter = { from: "A1", to: `G${Math.max(2, looms.length + 1)}` };
  loomSheet.getRow(1).height = 28;
  loomSheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263641" } };
    cell.alignment = { vertical: "middle" };
  });
  for (const [index, loom] of looms.entries()) {
    const members = rows.filter(row => row.loomId === loom.id);
    const families = new Map();
    members.forEach(row => families.set(row.signal, (families.get(row.signal) || 0) + 1));
    const row = loomSheet.addRow({ name: String(loom.name || ""), origin: String(loom.origin || ""),
      destination: String(loom.destination || ""), trunkLength: String(loom.trunkLength || ""),
      circuits: members.length,
      composition: [...families].sort(([a], [b]) => a.localeCompare(b))
        .map(([family, count]) => `${count} ${family}`).join(" / "), notes: String(loom.notes || "") });
    row.height = Math.max(28, String(loom.notes || "").split("\n").length * 16);
    row.eachCell(cell => { cell.alignment = { vertical: "middle", wrapText: true }; });
    if (index % 2) row.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F7" } };
    });
  }
  return workbook.xlsx.writeBuffer();
}
