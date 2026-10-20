import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { deviceBrandHeadersFixture } from "../fixtures/device-brand-headers.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-brand-2026-10-20/chrome";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1700, height: 1050 }, acceptDownloads: true, serviceWorkers: "block" });
function captureHeaders() {
  if (window.headerDraws) return;
  window.headerDraws = {};
  for (const Ctor of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D].filter(Boolean)) {
    const fillText = Ctor.prototype.fillText;
    Ctor.prototype.fillText = function(text, x, y, ...args) {
      if (x === 20 && y === 22 && this.font.startsWith("900 ")) {
        window.headerDraws[text] = { font: this.font, width: this.measureText(text).width, x, y, color: this.fillStyle };
      }
      return fillText.call(this, text, x, y, ...args);
    };
  }
}
await context.addInitScript(captureHeaders);
await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
await context.route("**/*", route => {
  const request = route.request(), url = new URL(request.url());
  return url.origin === new URL(base).origin && ["GET", "HEAD"].includes(request.method())
    ? route.continue() : route.abort();
});
const page = await context.newPage(), errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => dialog.accept());
const check = text => { checks.push(text); console.log("PASS " + text); };
const download = async (filename, action) => {
  const pending = page.waitForEvent("download", { timeout: 120000 });
  await action(); const item = await pending, path = join(dir, filename); await item.saveAs(path); return path;
};
const upload = async project => {
  await page.locator("#fileInput").setInputFiles({ name: "brand-headers.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  const long = project.devices.find(d => d.instanceId === "long");
  await page.waitForFunction(name => state.projectName === "Device Brand Headers"
    && activeEngineBridge()?.scene.getDevice("long")?.label === name, long.name || long.templateOverride.name);
  await page.locator("#zoomFit").click();
};
const expected = ["Barco E2 Gen 2", "Unbranded Monitor", "Roland V-160HD", "bArCo E2 Gen 2",
  "Analog Way Main Screen Processor", "Analog Way Aquilon C+",
  "Blackmagic Design ATEM Constellation 8K Advanced Production Switcher with Extended Control", "Analog Way Multi Format Switcher"];
const originalFields = project => project.devices.map(d => ({
  id: d.instanceId, name: d.name, templateId: d.templateId,
  ...Object.fromEntries(["name", "brand", "manufacturer", "vendor", "make"].map(key => ["template." + key, d.templateOverride?.[key]]))
}));
const point = id => page.evaluate(id => {
  const bridge = activeEngineBridge(), device = bridge.scene.getDevice(id), rect = bridge.canvas.getBoundingClientRect();
  const p = bridge.worldToScreenPoint({ x: device.x + device.width / 2, y: device.y + 25 });
  return { x: rect.x + p.x, y: rect.y + p.y };
}, id);
try {
  await page.goto(base);
  await page.waitForFunction(() => window.wireNexusReady, null, { timeout: 60000 });
  await page.evaluate(() => wireNexusReady);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded, null, { timeout: 60000 });
  const fixture = deviceBrandHeadersFixture();
  await upload(fixture);
  await page.waitForFunction(names => names.every(name => window.headerDraws?.[name])
    && Object.keys(headerDraws).some(name => name.startsWith("Blackmagic Design ")), expected.filter(name => !name.startsWith("Blackmagic")));
  const headers = await page.evaluate(() => headerDraws);
  const rendered = expected.map(name => name.startsWith("Blackmagic")
    ? Object.keys(headers).find(label => label.startsWith("Blackmagic Design ")) : name);
  assert.equal(headers["Barco E2 Gen 2"].font.replaceAll('"', ""), "900 15.4px system-ui, -apple-system, Segoe UI, sans-serif");
  for (const name of rendered) assert.ok(headers[name].width <= 300, name + " fits existing header");
  await page.screenshot({ path: join(dir, "canvas.png") });
  check("Actual Engine texture draws: brand, missing brand, duplicate, custom, modular and long names fit");
  const before = await page.evaluate(() => projectSnapshotData());
  for (const id of ["barco", "modular", "custom", "manufacturer"]) {
    const p = await point(id); await page.mouse.click(p.x, p.y, { button: "right" });
    await page.locator('[data-device-menu="edit"]').click();
    await page.locator('[data-editor-tab="device"]').click();
    const instance = fixture.devices.find(d => d.instanceId === id), template = instance.templateOverride;
    assert.equal(await page.locator("#editorDeviceName").inputValue(), instance.name || template.name);
    assert.equal(await page.locator("#editorDeviceBrand").inputValue(), template.brand || "");
    if (id === "barco") await page.screenshot({ path: join(dir, "editor-separate-fields.png") });
    await page.locator("#closeDeviceEditor").click();
    await page.locator("#deviceEditorModal.hidden").waitFor({ state: "attached" });
  }
  const after = await page.evaluate(() => projectSnapshotData());
  assert.deepEqual(originalFields(after), originalFields(before));
  assert.deepEqual(after.connections, before.connections);
  check("Device Editor open/close preserves separate authored fields, instance name and endpoints");
  const savedPath = await download("brand-headers.avd", () => page.locator("#saveProject").click());
  const saved = JSON.parse(await readFile(savedPath, "utf8"));
  assert.deepEqual(originalFields(saved), originalFields(before));
  assert.deepEqual(saved.connections, before.connections);
  await upload(saved);
  assert.deepEqual(originalFields(await page.evaluate(() => projectSnapshotData())), originalFields(before));
  check("Production Save and file-input reload retain original names/brands and cable endpoints");

  const extreme = structuredClone(saved);
  extreme.devices.find(d => d.instanceId === "long").name = "LongModel".repeat(200);
  await upload(extreme);
  await page.waitForFunction(() => Object.keys(headerDraws).some(name => name.endsWith("\u2026")));
  const clipped = await page.evaluate(() => Object.entries(headerDraws).filter(([name]) => name.endsWith("\u2026")));
  assert.ok(clipped.every(([,draw]) => draw.width <= 300));
  await page.screenshot({ path: join(dir, "extreme-header-fitted.png") });
  await upload(saved);
  check("Extreme names truncate within existing bounds without resizing devices");

  const htmlPath = await download("brand-headers.html", () => page.locator("#exportHtml").click());
  const html = await readFile(htmlPath, "utf8");
  const inspectViewer = async (content, name) => {
    const viewer = await context.newPage();
    viewer.on("pageerror", error => errors.push(error.message));
    await viewer.route("**/*", route => route.abort());
    await viewer.evaluate(captureHeaders);
    await viewer.setContent(content, { waitUntil: "load" });
    await viewer.waitForFunction(() => window.outputViewer, null, { timeout: 60000 });
    await viewer.evaluate(() => engineOutputReady);
    await viewer.waitForFunction(names => names.every(name => window.headerDraws?.[name]), rendered);
    const p = await viewer.evaluate(() => {
      const v = outputViewer, d = v.scene.getDevice("barco"), r = v.canvas.getBoundingClientRect();
      return { x: r.x + (d.x + d.width / 2 - v.camera.x) * v.camera.zoom,
        y: r.y + (d.y + 25 - v.camera.y) * v.camera.zoom };
    });
    await viewer.mouse.move(p.x, p.y);
    await viewer.locator(".output-device-hint:not([hidden])").waitFor();
    assert.equal(await viewer.locator(".output-device-hint").textContent(), "Barco E2 Gen 2");
    await viewer.mouse.click(p.x, p.y);
    assert.equal(await viewer.locator(".output-inspector h2").textContent(), "Barco E2 Gen 2");
    await viewer.screenshot({ path: join(dir, name + ".png") });
    const result = await viewer.evaluate(() => ({ devices: outputViewer.scene.devices, headers: headerDraws }));
    for (const label of rendered) assert.deepEqual(result.headers[label], headers[label], "Viewer/canvas header fitting");
    await viewer.close(); return result;
  };
  const offline = await inspectViewer(html, "offline-viewer");
  check("Offline HTML actual headers, Inspector and hover match canvas with network blocked");
  let published;
  await page.route("**/api/publish", route => {
    published = route.request().postDataJSON();
    return route.fulfill({ json: { url: base + "/viewer.html?id=local-brand-test" } });
  });
  await page.evaluate(async () => {
    window.testPublishedFiles = {};
    loadBlobClient = async () => ({ upload: async (pathname, blob, options) => {
      if (options.access !== "private") throw new Error("Publish must remain private");
      testPublishedFiles[pathname] = await blob.text(); return { pathname };
    } });
    openPublishProjectModal();
    publishProjectPassword.value = "local-brand-test";
    await publishHostedProject();
  });
  assert.ok(published?.htmlPath, "Actual Publish preparation completed with mocked storage/network");
  const hostedHtml = await page.evaluate(path => testPublishedFiles[path], published.htmlPath);
  await writeFile(join(dir, "simulated-publish.html"), hostedHtml);
  const hosted = await inspectViewer(hostedHtml, "simulated-publish");
  assert.deepEqual(hosted.devices, offline.devices);
  await page.evaluate(() => closePublishProjectModal());
  check("Actual Publish preparation with simulated I/O preserves exact viewer scene and headers");
  await page.locator("#exportPdf").click();
  const pdf = await download("brand-headers.pdf", () => page.locator("#confirmPdfExport").click());
  execFileSync("pdftoppm", ["-scale-to", "1800", "-png", pdf, join(dir, "pdf-page")], { timeout: 120000 });
  const pdfText = execFileSync(process.env.AVDESIGNER_PDF_PYTHON || "python3", ["-c",
    "import sys; from pypdf import PdfReader; print('\\n'.join(p.extract_text() or '' for p in PdfReader(sys.argv[1]).pages))", pdf], { encoding: "utf8" });
  await writeFile(join(dir, "pdf-text.txt"), pdfText);
  const flat = pdfText.replace(/\s+/g, " ");
  for (const label of rendered) assert.ok(flat.includes(label), "PDF contains " + label);
  check("Production vector PDF contains identical headers; pages rasterized for visual inspection");
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: join(dir, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(dir, "results.json"), JSON.stringify({ checks, errors, chrome: browser.version(), screenshots: dir }, null, 2));
  await browser.close();
}
