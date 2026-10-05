import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { buildOutputJumpNavigation } from "../src/engine/outputNavigation.js";
import { pdfPageLayout, jumpNavigationContext, fitRCoordinates } from "../src/engine/outputPdfLayout.js";
import { generatePdf } from "../src/engine/outputPdf.js";
import { outputPdfJumpFixture } from "../fixtures/output-pdf-jumps.mjs";
import { pdfJumpPaddedAcceptanceFixture } from "../fixtures/pdf-jump-padded-acceptance.mjs";

const dir = mkdtempSync(join(tmpdir(), "wirenexus-pdf-production-"));
const options = [
  ["a4-0-fit", { paper: "A4", marginMm: 0 }],
  ["a4-4-fit", { paper: "A4", marginMm: 4 }],
  ["a3-0-fit", { paper: "A3", marginMm: 0 }],
  ["a3-4-fit", { paper: "A3", marginMm: 4 }],
  ["a3-10-fit", { paper: "A3", marginMm: 10 }],
  ["a3-4-75", { paper: "A3", marginMm: 4, scale: 75 }],
  ["a3-4-100", { paper: "A3", marginMm: 4, scale: 100 }],
  ["a2-4-fit", { paper: "A2", marginMm: 4 }]
];
const reportData = { projectName: "Jump Navigation", deviceRows: [
  { quantity: 1, brand: "WireNexus", type: "Strict Source", power: "0W" }
], cableRows: [
  { quantity: 1, type: "SDI", length: "10m" }
] };
const expected = {};

async function produce(name, drawingPages, config = {}, report = reportData) {
  const beforeMs = performance.now(), beforeRss = process.memoryUsage().rss;
  const result = await generatePdf({ drawingPages, reportData: report, options: config });
  const generationMs = Math.round((performance.now() - beforeMs) * 10) / 10;
  const rssDeltaMiB = Math.round((process.memoryUsage().rss - beforeRss) / 1048576 * 10) / 10;
  writeFileSync(join(dir, `${name}.pdf`), result.bytes);
  const nodes = drawingPages.flatMap((page, pageIndex) => {
    const layout = pdfPageLayout({ ...config, ...page.options, svgViewBox: page.diagnostics.viewBox });
    const allowed = page.sourceIds ? new Set(page.sourceIds) : null;
    return buildOutputJumpNavigation(page.engineScene).jumpNodes
      .filter(node => !allowed || allowed.has(node.sourceId))
      .map(node => {
        const pdfRect = layout.rect(node.bounds);
        return { ...node, pageIndex, pdfRect, contextRect: jumpNavigationContext(layout, pdfRect),
          fitR: fitRCoordinates(layout.paperHeight, jumpNavigationContext(layout, pdfRect)),
          paperHeight: layout.paperHeight, drawingRect: layout.drawingRect };
      });
  });
  assert.equal(result.jumpAnnotations, nodes.length);
  expected[name] = { nodes, pages: drawingPages.length, report: true,
    warnings: result.warnings, bytes: result.bytes.length, generationMs, rssDeltaMiB };
}

for (const shape of ["wide", "tall"]) {
  const project = outputPdfJumpFixture();
  if (shape === "wide") project.jumpNodes[1].x += 2400;
  else project.jumpNodes[1].y += 2400;
  const scene = buildEngineOutputScene(project), drawing = renderEngineOutputSvg(scene);
  const page = { ...drawing, engineScene: scene };
  for (const [name, config] of options) await produce(`${shape}-${name}`, [page], config);
}

for (const [name, x, y] of [
  ["top-left", -490, -290], ["top-right", 1180, -290],
  ["bottom-left", -490, 750], ["bottom-right", 1180, 750],
  ["center", 370, 250]
]) {
  const edgeProject = outputPdfJumpFixture();
  const target = edgeProject.jumpNodes.find(node => node.id === "strict-b");
  target.x = x; target.y = y;
  const scene = buildEngineOutputScene(edgeProject);
  await produce(`edge-${name}`, [{ ...renderEngineOutputSvg(scene), engineScene: scene }],
    { paper: "A3", marginMm: 4 });
}

const project = outputPdfJumpFixture(), fullScene = buildEngineOutputScene(project);
const halves = [["strict-a", "bidi-a", "unpaired"], ["strict-b", "bidi-b"]];
const drawingPages = halves.map(ids => {
  const subset = { ...project, devices: project.devices.filter(device => project.connections.some(wire =>
    [wire.from, wire.to].some(end => end.deviceId === device.instanceId
      && [wire.from, wire.to].some(other => ids.includes(other.jumpNodeId))))),
  jumpNodes: project.jumpNodes.filter(node => ids.includes(node.id)),
  connections: project.connections.filter(wire => [wire.from, wire.to]
    .some(end => ids.includes(end.jumpNodeId))), jumpLinks: [] };
  const drawing = renderEngineOutputSvg(buildEngineOutputScene(subset));
  return { ...drawing, engineScene: fullScene, sourceIds: ids };
});
drawingPages[1].options = { paper: "A4", orientation: "portrait", marginMm: 10 };
await produce("cross-page", drawingPages, { paper: "A3", marginMm: 4 });

const denseScene = buildEngineOutputScene(pdfJumpPaddedAcceptanceFixture());
assert.equal(denseScene.devices.length, 110);
assert.equal(denseScene.wires.length, 310);
assert.equal(denseScene.jumpLinks.length, 5);
await produce("dense-acceptance", [{ ...renderEngineOutputSvg(denseScene), engineScene: denseScene }],
  { paper: "A3", marginMm: 4 });

if (process.argv[2]) {
  for (const [name, source] of [["full-project", "engine-full"], ["large-report", "multipage"],
    ["managed-loom", "managed-loom"]]) {
    const full = JSON.parse(readFileSync(join(process.argv[2], `${source}.prototype.json`), "utf8"));
    await produce(name, [full], { paper: "A3", marginMm: 4 }, full.reportData);
    expected[name].reportRows = {
      devices: full.reportData.deviceRows.length,
      cables: full.reportData.cableRows.map(row => ({ type: String(row.type), length: String(row.length) }))
    };
  }
}
writeFileSync(join(dir, "expected.json"), JSON.stringify(expected, null, 2));
console.log(JSON.stringify({ dir, cases: Object.keys(expected).length,
  warnings: Object.fromEntries(Object.entries(expected).filter(([, item]) => item.warnings.length)
    .map(([name, item]) => [name, item.warnings])) }, null, 2));
