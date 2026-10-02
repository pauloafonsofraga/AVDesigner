import PDFDocument from "pdfkit";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = process.argv[2] || mkdtempSync(join(tmpdir(), "wirenexus-pdf-destinations-"));
const width = 800, height = 600;
const variants = ["named-fit-r", "direct-dest-fit-r", "direct-action-fit-r", "exact-xyz"];
const targets = [
  { x: 145, y: 395, width: 36, height: 36 },
  { x: 585, y: 310, width: 36, height: 36 }
];
const contextFor = target => ({
  x: Math.max(0, Math.min(target.x + target.width / 2 - 160, width - 320)),
  y: Math.max(0, Math.min(target.y + target.height / 2 - 120, height - 240)),
  width: 320, height: 240
});
const fitR = rect => [rect.x, height - rect.y - rect.height, rect.x + rect.width, height - rect.y];
const sources = variants.map((variant, index) => ({ variant, x: 55, y: 50 + index * 48, width: 200, height: 34 }));
const doc = new PDFDocument({ autoFirstPage: false, bufferPages: true, compress: false,
  info: { Title: "PDF destination mechanism spike", CreationDate: new Date(0) } });
const chunks = [];
const complete = new Promise((resolve, reject) => {
  doc.on("data", chunk => chunks.push(chunk));
  doc.on("end", resolve);
  doc.on("error", reject);
});
const pages = [];
for (const [index, target] of targets.entries()) {
  doc.addPage({ size: [width, height], margin: 0 });
  pages.push(doc.page.dictionary);
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#182534").text(`Page ${index + 1}`, 42, 16);
  doc.rect(target.x, target.y, target.width, target.height).fillAndStroke("#ff8b2c", "#182534");
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#182534")
    .text(`Jump ${index ? "B" : "A"}`, target.x + 42, target.y + 10);
  doc.addNamedDestination(`spike-target-${index}`, "FitR", ...fitR(contextFor(target)));
  for (const source of sources) {
    doc.rect(source.x, source.y, source.width, source.height).fillAndStroke("#e7f2ff", "#235f99");
    doc.font("Helvetica").fontSize(11).fillColor("#182534")
      .text(source.variant, source.x + 10, source.y + 9, { width: source.width - 20 });
  }
}
for (const [pageIndex, page] of pages.entries()) {
  doc.switchToPage(pageIndex);
  const targetIndex = 1 - pageIndex;
  const target = targets[targetIndex];
  const frame = fitR(contextFor(target));
  const destination = [pages[targetIndex], "FitR", ...frame];
  const exactXyz = [pages[targetIndex], "XYZ", target.x, height - target.y, null];
  for (const source of sources) {
    if (source.variant === "named-fit-r") {
      doc.goTo(source.x, source.y, source.width, source.height, `spike-target-${targetIndex}`);
    } else if (source.variant === "direct-dest-fit-r") {
      doc.annotate(source.x, source.y, source.width, source.height,
        { Subtype: "Link", Dest: destination });
    } else {
      const action = doc.ref({ S: "GoTo", D: source.variant === "exact-xyz" ? exactXyz : destination });
      action.end();
      doc.annotate(source.x, source.y, source.width, source.height, { Subtype: "Link", A: action });
    }
  }
}
doc.end();
await complete;
writeFileSync(join(directory, "destination-spike.pdf"), Buffer.concat(chunks));
writeFileSync(join(directory, "expected.json"), JSON.stringify({ width, height, sources,
  targets: targets.map((target, pageIndex) => ({ ...target, pageIndex, context: contextFor(target),
    fitR: fitR(contextFor(target)) })) }, null, 2));
console.log(directory);
