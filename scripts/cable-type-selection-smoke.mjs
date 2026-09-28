import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = mkdtempSync(join(tmpdir(), "avd-cable-selection-"));
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const checks = [], errors = [], hdmi = ["cable-0", "cable-1", "cable-2"];
const watch = page => {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
};
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, acceptDownloads: true });
  watch(page);
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const assertSelection = async ids => {
    await page.waitForFunction(ids => JSON.stringify([...activeEngineBridge().scene.selectedWireIds]) === JSON.stringify(ids), ids);
    assert.deepEqual(await page.evaluate(() => selectedWireIds()), ids);
    assert.equal(await page.evaluate(() => activeEngineBridge().scene.selectedIds.size), 0);
  };
  for (const route of ["bezier", "orthogonal"]) {
    await page.evaluate(project => { restoreSnapshot(project); zoomToFit(); }, { ...cableTypeSelectionFixture(), wireMode: route });
    const before = await page.evaluate(() => ({ connections: structuredClone(state.connections), history: activeEngineBridge().commandHistory.length }));
    const popupPromise = page.waitForEvent("popup");
    await page.locator("#projectReportButton").click();
    const report = await popupPromise; watch(report);
    await report.locator('[data-report-cable-type="hdmi"]').first().waitFor();
    assert.equal(await report.locator('[data-report-cable-type="hdmi"]').count(), 3, "length groups remain separate report rows");
    for (const row of await report.locator('[data-report-cable-type="hdmi"]').all()) {
      await report.locator('[data-report-cable-type="sdi"]').click(); await assertSelection(["cable-3"]);
      await row.click(); await assertSelection(hdmi);
    }
    checks.push(`${route}: each report length row selects all three HDMI cables, excluding SDI`);
    await report.close(); await page.bringToFront();
    await page.screenshot({ path: join(directory, `${route}-report-selection.png`) });
    for (const [id, expected] of [["cable-3", ["cable-3"]], ["cable-1", hdmi]]) {
      const point = await page.evaluate(id => {
        const b = activeEngineBridge(), wire = b.scene.getWire(id), points = b.scene.wireRenderPolyline(wire);
        const a = points[Math.floor((points.length - 1) / 2)], z = points[Math.ceil((points.length - 1) / 2)];
        const p = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 }, r = b.canvas.getBoundingClientRect();
        return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom };
      }, id);
      await page.mouse.click(point.x, point.y, { button: "right" });
      const action = page.getByRole("button", { name: "Select all cables from the same type", exact: true });
      await action.waitFor();
      await action.click(); await assertSelection(expected);
    }
    await page.mouse.move(10, 10);
    await page.screenshot({ path: join(directory, `${route}-context-selection.png`) });
    checks.push(`${route}: native right-click action uses the new label and highlights the complete cable type`);
    const after = await page.evaluate(() => ({ connections: structuredClone(state.connections), history: activeEngineBridge().commandHistory.length }));
    assert.deepEqual(after, before, "report/context selection must not edit wires or record undo history");
    checks.push(`${route}: wire data and undo history unchanged`);
  }
  const downloadPromise = page.waitForEvent("download");
  await page.evaluate(() => exportHtml());
  const download = await downloadPromise, file = join(directory, "cable-types.html"); await download.saveAs(file);
  const offline = await browser.newContext({ offline: true, viewport: { width: 1600, height: 1000 } });
  const viewer = await offline.newPage(); watch(viewer);
  await viewer.goto(pathToFileURL(file).href); await viewer.evaluate(() => engineOutputReady);
  const initial = await viewer.evaluate(() => ({ signature: outputViewer.model.contract.signature, rebuilds: outputViewer.diagnostics().fullRebuilds }));
  for (let i = 0; i < 3; i++) {
    await viewer.getByRole("button", { name: "Report", exact: true }).click();
    await viewer.locator(".output-report-table button").filter({ hasText: /^HDMI$/ }).nth(i).click();
    assert.deepEqual(await viewer.evaluate(() => [...outputViewer.scene.selectedWireIds]), hdmi);
    assert.equal(await viewer.getByRole("dialog", { name: "Project Report" }).isVisible(), false);
  }
  await viewer.screenshot({ path: join(directory, "offline-report-selection.png") });
  const final = await viewer.evaluate(() => ({ signature: outputViewer.model.contract.signature, rebuilds: outputViewer.diagnostics().fullRebuilds }));
  assert.deepEqual(final, initial);
  checks.push("offline bundled viewer: every length row selects the whole type without rebuilding or mutating its scene");
  await offline.close();
  assert.deepEqual(errors, []);
  checks.push("no browser console or page errors");
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, directory }, null, 2));
} finally { await browser.close(); }
