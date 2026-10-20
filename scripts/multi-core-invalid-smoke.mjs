import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { multiCoreInvalidCases } from "../fixtures/multi-core-invalid.mjs";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-phase8/invalid";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const results = [];
try {
  for (const { name, project } of multiCoreInvalidCases) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
    await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
    const page = await context.newPage(), errors = [], dialogs = [];
    page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => { dialogs.push(d.message()); d.accept(); });
    await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773");
    await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
    const input = project();
    const load = async data => {
      const previous = await page.evaluate(() => window.__AVD_PROJECT_LOAD_METRICS__?.started);
      await page.locator("#fileInput").setInputFiles({ name: "negative.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
      await page.waitForFunction(previous => activeEngineBridge()?.ready && window.__AVD_PROJECT_LOAD_METRICS__?.started !== previous && window.__AVD_PROJECT_LOAD_METRICS__?.totalMs >= 0, previous);
    };
    await load(input); await page.locator("#zoomFit").click();
    const read = () => page.evaluate(() => structuredClone({ multiCores: state.multiCores, connections: state.connections, devices: state.devices.map(d => d.instanceId) }));
    const loaded = await read(); assert.deepEqual(loaded.multiCores, input.multiCores);
    assert.deepEqual(loaded.devices, input.devices.map(d => d.instanceId));
    const stamp = await page.evaluate(() => JSON.stringify([projectSnapshotData({ forEngine: true }), activeEngineBridge().engineHistoryState()]));
    await page.locator("#cableScheduleButton").click();
    await page.waitForFunction(() => currentMultiCoreReports?.diagnostics?.length > 0);
    const diagnostics = await page.evaluate(() => currentMultiCoreReports.diagnostics);
    await page.screenshot({ path: `${dir}/${name.replaceAll(' ', '-')}.png` });
    await page.locator("#closeCableSchedule").click();
    assert.equal(await page.evaluate(() => JSON.stringify([projectSnapshotData({ forEngine: true }), activeEngineBridge().engineHistoryState()])), stamp);
    if (input.multiCores.length) {
      await page.locator("#createMultiCore").click(); await page.locator("[data-assembly-edit]").first().click();
      await page.locator(".mc-editor").waitFor(); await page.keyboard.press("Escape");
      assert.equal(await page.locator(".mc-editor").count(), 0); assert.deepEqual(await read(), loaded);
    }
    const pending = page.waitForEvent("download", { timeout: 10000 }); await page.locator("#saveProject").click();
    // A missing required asset must reject a portable save, never silently omit it.
    if (name === "missing artwork") {
      await pending.catch(() => null); assert(dialogs.some(m => /asset|image|artwork|fetch/i.test(m)));
      assert.deepEqual(await read(), loaded);
    } else {
      const saved = JSON.parse(await readFile(await (await pending).path(), "utf8"));
      assert.deepEqual(saved.multiCores, input.multiCores);
      await load(saved); assert.deepEqual((await read()).multiCores, input.multiCores);
      assert.deepEqual((await read()).devices, loaded.devices);
      assert.equal((await read()).connections.length, loaded.connections.length);
    }
    assert.deepEqual(errors, []); results.push({ name, diagnostics: diagnostics.length, saved: name !== "missing artwork", errors, dialogs });
    await writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results.at(-1))); await context.close();
  }
} finally { await browser.close(); }
