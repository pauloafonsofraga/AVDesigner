import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { multiCoreJumpProject } from "../fixtures/multi-core-jump.mjs";
import { largeMultiCoreProject } from "../fixtures/multi-core.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-multi-core-reports";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors = [], timings = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, acceptDownloads: true });
  page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept());
  await page.addInitScript(() => window.showSaveFilePicker = undefined);
  await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773");
  await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  const load = async p => { await page.locator("#fileInput").setInputFiles({ name: "reports.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(name => state.projectName === name && activeEngineBridge()?.ready, p.projectName); };
  const fixture = multiCoreJumpProject(); fixture.projectName = "Multi-Core Report Acceptance";
  fixture.looms = [{ id: "loom-report", name: "LM-001", sideA: { x: 50, y: 200 }, sideB: { x: 300, y: 300 }, routePoints: [], trunkLength: "2 m" }];
  fixture.connections[0].loomId = "loom-report";
  await load(fixture);
  const before = await page.evaluate(() => JSON.stringify([state.connections, state.multiCores, activeEngineBridge().commandHistory.length]));
  await page.locator("#cableScheduleButton").click(); await page.locator("#cableScheduleBody tr").first().waitFor();
  assert.equal(await page.locator("#cableScheduleBody tr").count(), 2);
  const assembly = page.locator("#multiCoreReports details").filter({ has: page.locator('summary', { hasText: 'Multi-Core Assembly Register' }) });
  const manifest = page.locator("#multiCoreReports details").filter({ has: page.locator('summary', { hasText: 'Channel Allocation Manifest' }) });
  await assembly.locator("summary").click(); assert.equal(await assembly.locator("tbody tr").count(), 1);
  await manifest.locator("summary").click(); assert.equal(await manifest.locator("tbody tr").count(), 14);
  assert.match(await manifest.innerText(), /Connected at both ends/); assert.match(await manifest.innerText(), /V-001/);
  await manifest.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${dir}/manifest.png` });
  const expected = await page.evaluate(() => currentMultiCoreReports);
  for (const [selector, file] of [["#downloadCableScheduleCsv", "cable-schedule.csv"], ["#downloadCableScheduleXlsx", "reports.xlsx"]]) {
    const event = page.waitForEvent("download"); await page.locator(selector).click(); await (await event).saveAs(`${dir}/${file}`);
  }
  for (const [section, name] of [[assembly, "assemblies.csv"], [manifest, "channels.csv"]]) {
    const event = page.waitForEvent("download"); await section.getByRole("button", { name: "Download CSV" }).click(); await (await event).saveAs(`${dir}/${name}`);
  }
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(`${dir}/reports.xlsx`);
  assert.equal(workbook.getWorksheet("Cable Schedule").rowCount, 3); assert.equal(workbook.getWorksheet("Channel Allocation").rowCount, 15);
  assert.equal(before, await page.evaluate(() => JSON.stringify([state.connections, state.multiCores, activeEngineBridge().commandHistory.length])));
  await page.locator("#closeCableSchedule").click();
  for (const [wire, direction] of [["patch-3m", "A-to-B"], ["patch-2m", "B-to-A"]]) {
    await page.evaluate(id => openSignalChainForWire(id), wire);
    assert.match(await page.locator("#signalChainBody").innerText(), new RegExp(direction));
    assert.equal(await page.locator("#signalChainBody [data-path-kind]").count(), 3);
    await page.screenshot({ path: `${dir}/signal-${direction}.png` }); await page.locator("#closeSignalChain").click();
  }
  const save = page.waitForEvent("download"); await page.locator("#saveProject").click(); await (await save).saveAs(`${dir}/reports.avd`);
  const saved = JSON.parse(await readFile(`${dir}/reports.avd`, "utf8")); saved.projectName = "Reports reloaded"; await load(saved);
  const output = await page.evaluate(async () => { await ensureEngineOutputSceneModule();
    const plain = await prepareEngineViewerOutput(), hosted = await prepareEngineViewerOutput({ mode: "hosted-viewer" });
    return { html: plain.html, hosted: hosted.html }; });
  await writeFile(`${dir}/reports.html`, output.html);
  for (const hosted of [false, true]) {
    const viewer = await browser.newPage({ viewport: { width: 1800, height: 1200 } }); viewer.on("pageerror", e => errors.push(e.message));
    await viewer.route("**/*", route => hosted && route.request().isNavigationRequest()
      ? route.fulfill({ contentType: "text/html", body: output.hosted }) : route.abort());
    if (hosted) await viewer.goto("https://report-acceptance.test/viewer"); else await viewer.setContent(output.html);
    await viewer.waitForFunction(() => window.outputViewer); await viewer.evaluate(() => engineOutputReady);
    const actual = await viewer.evaluate(() => JSON.parse(document.getElementById("engineOutputPayload").textContent).engineScene.modelData.reports);
    assert.deepEqual(actual.channels, expected.channels); assert.deepEqual(actual.assemblies, expected.assemblies);
    assert.deepEqual(actual.cableRows.map(r => r.cableNumber), ["V-001", "V-002"]);
    await viewer.locator('[data-action="report"]').click();
    assert.equal(await viewer.locator(".multi-core-report-section tbody tr").count(), 1 + 14 + actual.diagnostics.length);
    const channel = viewer.locator(".multi-core-report-section").filter({ hasText: "Channel Allocation Manifest" }); await channel.locator("summary").click();
    await channel.scrollIntoViewIfNeeded(); await viewer.screenshot({ path: `${dir}/${hosted ? "hosted" : "offline"}.png` });
    assert.equal(await viewer.locator('button[data-mc-edit],input[data-mc],.mc-editor-backdrop').count(), 0);
    await viewer.locator('.output-report button').filter({ hasText: /^V-002$/ }).click();
    assert.match(await viewer.locator(".output-signal-chain-body").innerText(), /B-to-A/);
    if (hosted) {
      await viewer.setViewportSize({ width: 390, height: 844 });
      await viewer.screenshot({ path: `${dir}/mobile-signal-chain.png` });
      assert(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await viewer.close();
  }
  await page.locator("#exportPdf").click(); const pdf = page.waitForEvent("download"); await page.locator("#confirmPdfExport").click(); await (await pdf).saveAs(`${dir}/reports.pdf`);
  const partial = structuredClone(saved); partial.projectName = "Partial Reports"; partial.connections.pop(); await load(partial);
  await page.evaluate(() => openSignalChainForWire("patch-3m")); assert.match(await page.locator("#signalChainBody").innerText(), /Open termination.*End B/);
  await page.screenshot({ path: `${dir}/partial.png` }); await page.locator("#closeSignalChain").click();
  for (const count of [64, 256]) {
    const p = largeMultiCoreProject(count); p.projectName = `Report ${count}`; await load(p);
    const start = performance.now(); await page.locator("#cableScheduleButton").click();
    const section = page.locator("#multiCoreReports details").filter({ has: page.locator('summary', { hasText: 'Channel Allocation Manifest' }) });
    await section.locator("summary").click(); assert.equal(await section.locator("tbody tr").count(), count);
    timings.push({ channels: count, openMs: performance.now() - start });
    await section.locator("tbody tr").last().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${dir}/channels-${count}.png` });
    const xlsx = page.waitForEvent("download"); await page.locator("#downloadCableScheduleXlsx").click(); await (await xlsx).saveAs(`${dir}/channels-${count}.xlsx`);
    const large = new ExcelJS.Workbook(); await large.xlsx.readFile(`${dir}/channels-${count}.xlsx`); assert.equal(large.getWorksheet("Channel Allocation").rowCount, count + 1);
    await page.locator("#closeCableSchedule").click();
    await page.locator("#exportPdf").click(); const event = page.waitForEvent("download"); await page.locator("#confirmPdfExport").click(); await (await event).saveAs(`${dir}/channels-${count}.pdf`);
  }
  assert.deepEqual(errors, []); await writeFile(`${dir}/acceptance.json`, JSON.stringify({ timings, errors }, null, 2));
  console.log(JSON.stringify({ directory: dir, timings, errors }));
} catch (error) { await page?.screenshot({ path: `${dir}/failure.png` }); throw error; }
finally { await browser.close(); }
