import ExcelJS from "exceljs/dist/exceljs.min.js";
import { cableScheduleColumns } from "./cableSchedule.js";
import { multiCoreReportSections } from "./multiCoreReports.js";
import { cableGraphic, cableIdGraphic, cleanCableScheduleColor, nodeGraphic } from "./cableScheduleGraphics.js";

function toArgb(color) {
  return `FF${cleanCableScheduleColor(color).slice(1).toUpperCase()}`;
}

export async function createCableScheduleXlsx(rows, { nodeDefinitions = [], loadArtwork = async value => value,
  graphics = null, looms = [], reports = null } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WireNexus";
  const sheet = workbook.addWorksheet("Cable Schedule", { views: [{ state: "frozen", ySplit: 1 }] });
  const columns = cableScheduleColumns(rows);
  sheet.columns = columns.map(([key, header], index) => ({
    key, header, width: [19, 25, 38, 25, 38, 13, 25, 38, 13, 20, 26, 38][index] || 24
  }));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, rows.length + 1), column: columns.length } };
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
    const row = sheet.addRow(Object.fromEntries(columns.map(([key]) => [key, String(record[key] ?? "")])));
    row.height = Math.max(36, String(record.notes || "").split("\n").length * 16);
    row.eachCell(cell => { cell.alignment = { vertical: "middle", wrapText: true }; });
    if (index % 2) row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F7" } }; });
    const sourceId = record.sourceNodeTypeId, destinationId = record.destinationNodeTypeId;
    await addGraphic(rowNumber, 3, `node:${sourceId}:${record.sourceNodeColor}`, async () => graphics?.nodes?.[sourceId]
      || nodeGraphic(nodeById.get(sourceId), record.sourceNodeColor, loadArtwork));
    await addGraphic(rowNumber, 5, `node:${destinationId}:${record.destinationNodeColor}`, async () => graphics?.nodes?.[destinationId]
      || nodeGraphic(nodeById.get(destinationId), record.destinationNodeColor, loadArtwork));
    const color = cleanCableScheduleColor(record.cableColor);
    await addGraphic(rowNumber, 8, `cable:${color}:${record.cableColors?.join(",") || ""}`, async () => graphics?.cables?.[color]
      || cableGraphic(color, record.cableColors));
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
  for (const [title, columns, records] of multiCoreReportSections(reports)) {
    const name = { "Multi-Core Assembly Register": "Multi-Core Assemblies", "Channel Allocation Manifest": "Channel Allocation" }[title] || title;
    const report = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    report.columns = columns.map(([key, header]) => ({ key, header, width: key === "message" || key === "notes" ? 48 : 24 }));
    report.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, records.length + 1), column: columns.length } };
    report.getRow(1).height = 32;
    report.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263641" } };
      cell.alignment = { wrapText: true, vertical: "middle" };
    });
    for (const record of records) {
      const row = report.addRow(Object.fromEntries(columns.map(([key]) => [key, String(record[key] ?? "")])));
      row.eachCell(cell => { cell.numFmt = "@"; cell.alignment = { wrapText: true, vertical: "top" }; });
      row.height = Math.max(32, ...columns.map(([key]) => Math.ceil(String(record[key] ?? "").length / 24) * 12));
    }
  }
  return workbook.xlsx.writeBuffer();
}
