import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { pdfPageLayout } from "./outputPdfLayout.js";
import { buildOutputJumpNavigation } from "./outputNavigation.js";
import { expandInlineSvgImages } from "./pdfInlineSvgImages.js";

const dark = "#20262d", text = "#17202a", rule = "#cbd3dc";
const sections = report => [
  ["Devices", ["Qty", "Brand", "Device", "Power"], report.deviceRows || [],
    row => [row.quantity, row.brand, row.type, row.power]],
  ["Adapters / Breakouts", ["Qty", "Brand", "Adapter / Breakout", "Category"], report.adapterRows || [],
    row => [row.quantity, row.brand, row.type, row.category]],
  ["Racks", ["Rack", "Devices", "Power"], report.rackRows || [],
    row => [row.name, row.devices, row.power]],
  ["LED Screens", ["Screen", "Physical Size", "Pixels"], report.screenRows || [],
    row => [row.name, row.size, row.pixels]],
  ["Cable Schedule", ["Qty", "Cable Type", "Length"], report.cableRows || [],
    row => [row.quantity, row.type, row.length]],
  ...(report.matrixSections || []).map(matrix => [
    `Matrix Routing - ${matrix.name || "Matrix"} (${matrix.size || ""})`,
    ["Output", "Input Source"], matrix.routeRows || [], row => [row.output, row.input]
  ])
].filter(([, , rows]) => rows.length);

function reportPages(doc, report, layout) {
  const margin = Math.max(layout.margin, 18), width = layout.paperWidth - 2 * margin;
  let y = 0;
  const newPage = () => {
    doc.addPage({ size: [layout.paperWidth, layout.paperHeight], margin: 0 });
    y = margin;
    doc.font("Helvetica-Bold").fontSize(15).fillColor(text)
      .text(String(report.projectName || "WireNexus Project"), margin, y, { width });
    y += 28;
  };
  const rowHeight = 25, headerHeight = 23;
  const drawHeader = (headers, columnWidths) => {
    doc.rect(margin, y, width, headerHeight).fill(dark);
    let x = margin;
    headers.forEach((header, i) => {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
        .text(header, x + 5, y + 7, { width: columnWidths[i] - 10, height: 12, ellipsis: true });
      x += columnWidths[i];
    });
    y += headerHeight;
  };
  for (const [title, headers, rows, values] of sections(report)) {
    if (!y || y + 62 > layout.paperHeight - margin) newPage();
    y += 12;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(text).text(title, margin, y, { width });
    y += 22;
    const columnWidths = headers.map(() => width / headers.length);
    drawHeader(headers, columnWidths);
    for (const row of rows) {
      if (y + rowHeight > layout.paperHeight - margin) {
        newPage();
        doc.font("Helvetica-Bold").fontSize(12).fillColor(text).text(title, margin, y, { width });
        y += 22;
        drawHeader(headers, columnWidths);
      }
      doc.rect(margin, y, width, rowHeight).fill("#ffffff");
      doc.moveTo(margin, y + rowHeight).lineTo(margin + width, y + rowHeight).strokeColor(rule).lineWidth(0.5).stroke();
      let x = margin;
      values(row).forEach((value, i) => {
        doc.font("Helvetica").fontSize(8).fillColor(text).text(String(value ?? ""), x + 5, y + 5,
          { width: columnWidths[i] - 10, height: rowHeight - 7, ellipsis: true });
        x += columnWidths[i];
      });
      y += rowHeight;
    }
  }
}

/** Experimental app-owned PDF bytes. Does not affect the production Chromium export. */
export async function generateExperimentalPdf({ svg, diagnostics, engineScene, drawingPages,
  reportData, options = {} }) {
  const drawings = drawingPages || [{ svg, diagnostics, engineScene }];
  if (!drawings.length || drawings.some(page => !page.svg || !page.diagnostics?.viewBox || !page.engineScene)) {
    throw new Error("Every PDF drawing page needs an Engine SVG, viewBox and scene");
  }
  const layouts = drawings.map(page => pdfPageLayout({ ...options, svgViewBox: page.diagnostics.viewBox }));
  const layout = layouts[0];
  const navigation = drawings.flatMap((page, pageIndex) => {
    const allowed = page.sourceIds ? new Set(page.sourceIds.map(String)) : null;
    return buildOutputJumpNavigation(page.engineScene).jumpNodes
      .filter(node => !allowed || allowed.has(node.sourceId))
      .map(node => ({ ...node, pageIndex }));
  });
  const destinationIds = new Set(navigation.map(node => node.destinationId));
  if (destinationIds.size !== navigation.length || navigation.some(node => !destinationIds.has(node.targetDestinationId))) {
    throw new Error("PDF drawing pages must contain each paired Jump destination exactly once");
  }
  const doc = new PDFDocument({ autoFirstPage: false, compress: true, info: {
    Title: `${reportData?.projectName || "WireNexus"} - WireNexus Report`, Producer: "WireNexus experimental PDFKit backend"
  } });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(chunks));
    doc.on("error", reject);
  });
  const warnings = [];
  for (const [pageIndex, drawing] of drawings.entries()) {
    const pageLayout = layouts[pageIndex];
    doc.addPage({ size: [pageLayout.paperWidth, pageLayout.paperHeight], margin: 0 });
    doc.save();
    doc.translate(pageLayout.drawingRect.x, pageLayout.drawingRect.y).scale(pageLayout.scale);
    SVGtoPDF(doc, expandInlineSvgImages(drawing.svg), 0, 0, {
      width: drawing.diagnostics.viewBox.width, height: drawing.diagnostics.viewBox.height,
      assumePt: true, warningCallback: message => warnings.push(String(message).slice(0, 240))
    });
    doc.restore();
    for (const node of navigation.filter(item => item.pageIndex === pageIndex)) {
      const hit = pageLayout.rect(node.bounds);
      doc.addNamedDestination(node.destinationId, "XYZ", hit.x, hit.y, null);
      doc.goTo(hit.x, hit.y, hit.width, hit.height, node.targetDestinationId);
    }
  }
  if (reportData) reportPages(doc, reportData, layout);
  doc.end();
  const parts = await complete;
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { bytes, layout: { paperWidth: layout.paperWidth, paperHeight: layout.paperHeight,
    drawingRect: layout.drawingRect, scale: layout.scale }, warnings,
    jumpAnnotations: navigation.length };
}
