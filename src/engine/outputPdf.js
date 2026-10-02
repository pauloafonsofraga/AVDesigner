import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { pdfPageLayout, jumpNavigationContext, fitRCoordinates, viewerNavigationZoom } from "./outputPdfLayout.js";
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
    `Matrix Routing - ${[matrix.brand, matrix.name].filter(Boolean).join(" - ") || "Matrix"} (${matrix.size || ""})`,
    ["Output", "Input Source"], matrix.routeRows || [], row => [row.output, row.input], matrix
  ])
].filter(([, , rows, , matrix]) => rows.length || (matrix?.inputs?.length && matrix?.outputs?.length));

function reportPages(doc, report, layout) {
  const margin = Math.max(layout.margin, 18);
  const width = Math.min(layout.paperWidth - 2 * margin, 260 * 72 / 25.4);
  let y = 0;
  const newPage = () => {
    doc.flushPages();
    doc.addPage({ size: [layout.paperWidth, layout.paperHeight], margin: 0 });
    y = margin;
    doc.font("Helvetica-Bold").fontSize(15).fillColor(text)
      .text(String(report.projectName || "WireNexus Project"), margin, y, { width });
    y += 28;
  };
  const rowHeight = 18, headerHeight = 20;
  const drawHeader = (headers, columnWidths) => {
    doc.rect(margin, y, width, headerHeight).fill(dark);
    let x = margin;
    headers.forEach((header, i) => {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
        .text(header.toUpperCase(), x + 5, y + 5, { width: columnWidths[i] - 10, height: 12, ellipsis: true });
      x += columnWidths[i];
    });
    y += headerHeight;
  };
  const drawTitle = title => {
    y += 10;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(text).text(title, margin, y, { width });
    y += 18;
  };
  const drawMatrixGrid = (matrix, title) => {
    const inputs = matrix.inputs || [], outputs = matrix.outputs || [];
    if (!inputs.length || !outputs.length) return;
    if (inputs.length * outputs.length > 400) {
      if (y + rowHeight > layout.paperHeight - margin) { newPage(); drawTitle(title); }
      doc.font("Helvetica").fontSize(8).fillColor(text)
        .text(`Crosspoint grid is ${matrix.size} and is summarized in the route table below.`, margin, y, { width });
      y += rowHeight + 5;
      return;
    }
    const first = Math.min(85, width * 0.3), remaining = (width - first) / inputs.length;
    const columns = [first, ...inputs.map(() => remaining)];
    const gridHeader = () => drawHeader(["OUT \\ IN", ...inputs.map(input => String(input.name || ""))], columns);
    if (y + headerHeight + rowHeight > layout.paperHeight - margin) { newPage(); drawTitle(title); }
    gridHeader();
    for (const output of outputs) {
      if (y + rowHeight > layout.paperHeight - margin) { newPage(); drawTitle(title); gridHeader(); }
      doc.rect(margin, y, width, rowHeight).fill("#ffffff");
      doc.moveTo(margin, y + rowHeight).lineTo(margin + width, y + rowHeight)
        .strokeColor(rule).lineWidth(0.5).stroke();
      doc.font("Helvetica-Bold").fontSize(8).fillColor(text)
        .text(String(output.name || ""), margin + 5, y + 4, { width: first - 10, height: 12, ellipsis: true });
      let x = margin + first;
      for (const input of inputs) {
        if (matrix.routes?.[output.id] === input.id) {
          doc.rect(x, y, remaining, rowHeight).fill("#32b6ff");
          doc.font("Helvetica-Bold").fontSize(9).fillColor(text)
            .text("\u2022", x, y + 3, { width: remaining, align: "center", height: 12 });
        }
        x += remaining;
      }
      y += rowHeight;
    }
    y += 7;
  };
  for (const [title, headers, rows, values, matrix] of sections(report)) {
    if (!y || y + 62 > layout.paperHeight - margin) newPage();
    drawTitle(title);
    if (matrix) drawMatrixGrid(matrix, title);
    if (!rows.length) continue;
    const columnWidths = headers.map(() => width / headers.length);
    drawHeader(headers, columnWidths);
    for (const row of rows) {
      if (y + rowHeight > layout.paperHeight - margin) {
        newPage();
        drawTitle(title);
        drawHeader(headers, columnWidths);
      }
      doc.rect(margin, y, width, rowHeight).fill("#ffffff");
      doc.moveTo(margin, y + rowHeight).lineTo(margin + width, y + rowHeight).strokeColor(rule).lineWidth(0.5).stroke();
      let x = margin;
      values(row).forEach((value, i) => {
        doc.font("Helvetica").fontSize(8).fillColor(text).text(String(value ?? ""), x + 5, y + 3,
          { width: columnWidths[i] - 10, height: rowHeight - 7, ellipsis: true });
        x += columnWidths[i];
      });
      y += rowHeight;
    }
  }
}

/** App-owned vector PDF with internal Jump navigation. */
export async function generatePdf({ svg, diagnostics, engineScene, drawingPages,
  reportData, options = {} }) {
  const drawings = drawingPages || [{ svg, diagnostics, engineScene }];
  if (!drawings.length || drawings.some(page => !page.svg || !page.diagnostics?.viewBox || !page.engineScene)) {
    throw new Error("Every PDF drawing page needs an Engine SVG, viewBox and scene");
  }
  const layouts = drawings.map(page => pdfPageLayout({ ...options, ...page.options,
    svgViewBox: page.diagnostics.viewBox }));
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
  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: true, compress: true, info: {
    Title: `${reportData?.projectName || "WireNexus"} - WireNexus Report`, Producer: "WireNexus PDF exporter"
  } });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(chunks));
    doc.on("error", reject);
  });
  const warnings = [];
  const destinations = new Map();
  for (const [pageIndex, drawing] of drawings.entries()) {
    const pageLayout = layouts[pageIndex];
    doc.addPage({ size: [pageLayout.paperWidth, pageLayout.paperHeight], margin: 0 });
    doc.rect(pageLayout.pageArea.x, pageLayout.pageArea.y,
      pageLayout.pageArea.width, pageLayout.pageArea.height)
      .fillAndStroke("#f7f9fb", rule);
    doc.save();
    doc.translate(pageLayout.drawingRect.x, pageLayout.drawingRect.y).scale(pageLayout.scale);
    let printableSvg = expandInlineSvgImages(drawing.svg);
    SVGtoPDF(doc, printableSvg, 0, 0, {
      width: drawing.diagnostics.viewBox.width, height: drawing.diagnostics.viewBox.height,
      assumePt: true, warningCallback: message => warnings.push(String(message).slice(0, 240))
    });
    printableSvg = null;
    doc.restore();
    for (const node of navigation.filter(item => item.pageIndex === pageIndex)) {
      const hit = pageLayout.rect(node.bounds);
      const context = jumpNavigationContext(pageLayout, hit);
      const fitR = fitRCoordinates(pageLayout.paperHeight, context);
      destinations.set(node.destinationId, { hit, fitR, pageIndex });
      doc.addNamedDestination(node.destinationId, "FitR", ...fitR);
      // PDFium ignores FitR link actions, so clickable links use an internal XYZ context view.
      doc.addNamedDestination(`${node.destinationId}-viewer`, "XYZ", context.x, context.y,
        viewerNavigationZoom(pageLayout));
    }
  }
  for (const node of navigation) {
    const source = destinations.get(node.destinationId);
    doc.switchToPage(source.pageIndex);
    doc.goTo(source.hit.x, source.hit.y, source.hit.width, source.hit.height,
      `${node.targetDestinationId}-viewer`);
  }
  doc.flushPages();
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
