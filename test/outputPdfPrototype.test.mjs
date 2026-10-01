import test from "node:test";
import assert from "node:assert/strict";
import { pdfPageLayout } from "../src/engine/outputPdfLayout.js";
import { generateExperimentalPdf } from "../src/engine/outputPdfPrototype.js";
import { outputPdfJumpFixture } from "../fixtures/output-pdf-jumps.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { expandInlineSvgImages } from "../src/engine/pdfInlineSvgImages.js";

const view = { x: -200, y: 100, width: 2000, height: 500 };
test("PDF page layout maps viewBox points and bounds through the exact drawing transform", () => {
  for (const [paper, marginMm, scale] of [
    ["A4", 0, "fit"], ["A4", 4, "fit"], ["A3", 0, "fit"],
    ["A3", 4, "fit"], ["A3", 10, "fit"], ["A3", 4, 75],
    ["A3", 4, 100], ["A2", 4, "fit"]
  ]) {
    const layout = pdfPageLayout({ paper, marginMm, scale, svgViewBox: view });
    assert.equal(layout.point(view.x, view.y).x, layout.drawingRect.x);
    assert.equal(layout.point(view.x, view.y).y, layout.drawingRect.y);
    assert.ok(Math.abs(layout.point(view.x + view.width, view.y + view.height).x
      - (layout.drawingRect.x + layout.drawingRect.width)) < 1e-9);
    const bounds = { x: 50, y: 200, width: 44, height: 44 };
    assert.deepEqual(layout.rect(bounds), {
      ...layout.point(bounds.x, bounds.y), width: bounds.width * layout.scale,
      height: bounds.height * layout.scale
    });
    assert.ok(layout.drawingRect.x >= layout.margin - 1e-9);
    assert.ok(layout.drawingRect.y >= layout.margin - 1e-9);
  }
  const tall = pdfPageLayout({ paper: "A3", orientation: "portrait", svgViewBox: { x: 0, y: 0, width: 200, height: 3000 } });
  assert.ok(tall.drawingRect.x > tall.margin, "tall drawing letterboxes horizontally");
  assert.throws(() => pdfPageLayout({ paper: "A9", svgViewBox: view }));
  assert.throws(() => pdfPageLayout({ marginMm: 500, svgViewBox: view }));
});

test("PDFKit prototype generates vector PDF bytes with reciprocal Jump annotations", async () => {
  const scene = buildEngineOutputScene(outputPdfJumpFixture());
  const drawing = renderEngineOutputSvg(scene);
  const result = await generateExperimentalPdf({ svg: drawing.svg, diagnostics: drawing.diagnostics,
    engineScene: scene, reportData: { projectName: "Jump fixture", deviceRows: [
      { quantity: 1, brand: "Test", type: "Source", power: "0W" }
    ] } });
  assert.equal(new TextDecoder().decode(result.bytes.subarray(0, 4)), "%PDF");
  assert.equal(result.jumpAnnotations, 4);
  assert.deepEqual(result.warnings, []);
});

test("inline SVG plug art stays nested vector artwork without touching raster images", () => {
  const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><circle cx="2" cy="2" r="2"/></svg>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image x="5" y="7" width="10" height="10" href="data:image/svg+xml,${encodeURIComponent(art)}"/><image href="data:image/png;base64,AAAA"/></svg>`;
  const expanded = expandInlineSvgImages(svg);
  assert.match(expanded, /<svg[^>]*x="5"[^>]*y="7"[^>]*width="10"[^>]*height="10"/);
  assert.match(expanded, /<circle cx="2" cy="2" r="2"\/>/);
  assert.match(expanded, /data:image\/png;base64,AAAA/);
  assert.doesNotMatch(expanded, /data:image\/svg\+xml/);
});
