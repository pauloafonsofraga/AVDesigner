import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
const sources = process.argv.slice(2);
if (!sources.length) throw new Error("Pass representative .avd paths. Originals are read-only; outputs go to the audit directory.");
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-phase8/historical";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const results = [], hash = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  for (const [index, source] of sources.entries()) {
    const beforeHash = hash(await readFile(source)), copy = `${dir}/${index}-input.avd`; await copyFile(source, copy);
    const context = await browser.newContext({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
    await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
    const page = await context.newPage(), errors = [], dialogs = [];
    page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => { dialogs.push(d.message()); d.accept(); });
    await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773");
    await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
    const t = performance.now();
    await page.locator("#fileInput").setInputFiles(copy);
    await page.waitForFunction(() => state.devices.length > 0 && activeEngineBridge()?.ready, null, { timeout: 120000 });
    const loadMs = performance.now() - t; await page.locator("#zoomFit").click();
    const inventory = () => page.evaluate(() => ({ devices: state.devices.map(d => d.instanceId), cables: state.connections.map(c => {
      const record = structuredClone(c), wire = activeEngineBridge().scene.wires.find(w => (w.sourceId || w.id) === c.id);
      // Old LED files have no saved landing index. Save intentionally persists
      // the already displayed ordering; compare that effective endpoint too.
      for (const end of ["from", "to"]) if (record[end]?.surfaceId && wire) record[end].portIndex ??= wire[`${end}PortIndex`];
      return { id: record.id, from: record.from, to: record.to, cableType: record.cableType };
    }),
      multiCores: state.multiCores || [], ledSurfaces: state.ledSurfaces.map(s => s.id), jumpLinks: state.jumpLinks, looms: state.looms.map(l => l.id) }));
    const original = await inventory(); assert.equal(original.multiCores.length, 0);
    await page.screenshot({ path: `${dir}/${index}-canvas.png` });
    const stamp = await page.evaluate(() => JSON.stringify([state.connections, activeEngineBridge().engineHistoryState()]));
    await page.locator("#cableScheduleButton").click(); await page.locator("#cableScheduleBody tr").first().waitFor({ timeout: 60000 });
    const rows = await page.locator("#cableScheduleBody tr").count(); assert(rows > 0); assert.equal(await page.locator("#multiCoreReports details").count(), 0);
    assert.equal(await page.evaluate(() => JSON.stringify([state.connections, activeEngineBridge().engineHistoryState()])), stamp);
    await page.screenshot({ path: `${dir}/${index}-schedule.png` }); await page.locator("#closeCableSchedule").click();
    const download = page.waitForEvent("download", { timeout: 120000 }); await page.locator("#saveProject").click();
    const saved = `${dir}/${index}-reopened.avd`; await (await download).saveAs(saved);
    const previousLoad = await page.evaluate(() => window.__AVD_PROJECT_LOAD_METRICS__?.started);
    await page.locator("#fileInput").setInputFiles(saved);
    await page.waitForFunction(previous => activeEngineBridge()?.ready && window.__AVD_PROJECT_LOAD_METRICS__?.started !== previous && window.__AVD_PROJECT_LOAD_METRICS__?.totalMs >= 0, previousLoad, { timeout: 120000 });
    assert.deepEqual(await inventory(), original);
    await page.locator("#exportPdf").click(); const pdf = page.waitForEvent("download", { timeout: 120000 });
    await page.locator("#confirmPdfExport").click(); await (await pdf).saveAs(`${dir}/${index}-historical.pdf`);
    assert.deepEqual(await inventory(), original); assert.deepEqual(errors, []);
    assert.equal(hash(await readFile(source)), beforeHash, "original private project untouched");
    results.push({ source: basename(source), sourceSha256: beforeHash, loadMs, devices: original.devices.length, cables: original.cables.length, rows, ledSurfaces: original.ledSurfaces.length, jumpLinks: original.jumpLinks.length, looms: original.looms.length, errors, dialogs });
    await writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
} finally { await browser.close(); }
