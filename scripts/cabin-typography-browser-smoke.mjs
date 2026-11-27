import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stageboxNodeOnlyFixture } from "../fixtures/stagebox-node-only.mjs";
import { adapterIntegrationFixture, modularIntegrationFixture } from "../fixtures/modular-integration.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const candidate = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8947";
const baseline = process.env.WIRENEXUS_TYPOGRAPHY_BASELINE_URL;
const checkSize = process.env.WIRENEXUS_CHECK_TEXT_STEP === "1";
for (const url of [candidate, baseline].filter(Boolean)) assert.equal(new URL(url).hostname, "127.0.0.1");
const dir = await mkdtemp(join(tmpdir(), "wnx-cabin-visual-"));
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
const project = stageboxNodeOnlyFixture(16, ["rectangle", "fanout"]);
project.projectName = "Cabin typography acceptance";
const dense = { id: "dense", name: "Dense 4K signal processor", width: 300, height: 726,
  connectors: ["input", "output"].flatMap(direction => Array.from({ length: 10 }, (_, i) => ({
    id: direction + "-" + i, nameText: (direction === "input" ? "IN " : "OUT ") + (i + 1), direction,
    type: ["hdmi", "sdi", "display-port", "qsfp-cage"][i % 4], x: direction === "input" ? 0 : 300,
    y: 188 + 52 * i, resolutionFrameRate: "3840\u00d72160",
    ...(i % 4 === 3 ? { cageCapabilities: { supportedFormFactors: ["qsfp28"] } } : {})
  }))) };
const instance = (id, template, x, y) => ({ instanceId: id, name: template.name, x, y, templateOverride: template });
project.devices.push(instance("dense", dense, 1350, 22), instance("adapter", adapterIntegrationFixture(), 950, 540),
  instance("chassis", modularIntegrationFixture(), 1840, 55));
project.connections.push({ id: "display-run", cableType: "sdi", cableNumber: "VX-1234", length: "2m",
  from: { deviceId: "dense", connectorId: "output-1" }, to: { deviceId: "chassis", connectorId: "left-a" } });

function digitalGeometry() {
  const { scene } = activeEngineBridge();
  return { devices: scene.devices.map(d => [d.id, d.x, d.y, d.width, d.height,
    d.connectors.map(c => [c.id, scene.connectorWorldPoint(d, c)])]),
  wires: scene.wires.map(w => [w.id, scene.wireRenderPolyline(w)]) };
}

async function platformFonts(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    return (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
  } finally { await cdp.detach(); }
}

async function inspect(url, prefix, verify) {
  const context = await browser.newContext({ viewport: { width: 1720, height: 1080 }, acceptDownloads: true });
  await context.route("**/*", route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
  await context.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  const page = await context.newPage(), pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    globalThis.textDraws = new Map();
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(value, ...args) {
      const text = String(value);
      if (/HDMI|SDI|QSFP28|3840|^IN$|^OUT$|^Dense|VX-1234/.test(text)) {
        const key = text + this.canvas.className + this.font;
        globalThis.textDraws.set(key, { text, font: this.font, width: this.measureText(text).width });
      }
      return fill.call(this, value, ...args);
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => window.wireNexusReady);
  await page.evaluate(() => wireNexusReady);
  await page.locator("#fileInput").setInputFiles({ name: "typography.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => activeEngineBridge()?.scene.getDevice("dense"));
  await page.locator("#zoomFit").click();
  const geometry = await page.evaluate(digitalGeometry);
  const screen = (name, full = false) => page.screenshot({ path: join(dir, prefix + "-" + name + ".png"), fullPage: full });
  async function theme(dark) {
    if (await page.evaluate(() => document.body.classList.contains("dark-mode")) !== dark) await page.locator("#darkModeToggle").click();
  }
  await theme(true); await screen("overview");
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    Object.assign(bridge.camera, { zoom: 1.12, x: 1260, y: -42 });
    bridge.scheduleRender();
  });
  await page.waitForFunction(() => [...textDraws.values()].some(sample => sample.text === "3840\u00d72160"));
  const point = await page.evaluate(() => {
    const bridge = activeEngineBridge(), c = bridge.scene.getConnector("dense", "input-3");
    const p = bridge.worldToScreenPoint(bridge.scene.connectorWorldPoint(bridge.scene.getDevice("dense"), c));
    const rect = bridge.canvas.getBoundingClientRect(); return { x: rect.left + p.x, y: rect.top + p.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.locator("[data-transceiver-config]").waitFor();
  await screen("dense-dark");
  await theme(false); await screen("dense-light");
  const samples = await page.evaluate(() => [...textDraws.values()]);
  const inspectorSize = await page.locator("[data-transceiver-config] label").first()
    .evaluate(label => parseFloat(getComputedStyle(label).fontSize));
  const panelFont = await platformFonts(page, '[data-transceiver-config] label');
  if (verify) {
    assert(panelFont.some(font => font.familyName === "Cabin" && font.isCustomFont), JSON.stringify(panelFont));
    for (const sample of samples) assert.match(sample.font, /Cabin/, sample.text);
    assert(samples.some(sample => sample.text === "HDMI") && samples.some(sample => sample.text.includes("QSFP28")));
  }
  await page.locator("#cableScheduleButton").click();
  await page.locator("#cableScheduleDialog tr").filter({ hasText: "VX-1234" }).waitFor();
  const scheduleSize = await page.locator(".cable-schedule-id").first()
    .evaluate(label => parseFloat(getComputedStyle(label).fontSize));
  if (verify) assert((await platformFonts(page, ".cable-schedule-id")).some(font => font.familyName === "Cabin"));
  await screen("schedule");
  await page.locator("#closeCableSchedule").click();
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#projectReportButton").click();
  const report = await popupPromise;
  await report.locator("h1").waitFor();
  await report.evaluate(() => document.fonts.ready.then(() => true));
  if (verify) assert((await platformFonts(report, "h1")).some(font => font.familyName === "Cabin"));
  await report.screenshot({ path: join(dir, prefix + "-report.png") });
  await report.close();
  const save = async (button, file, confirm) => {
    const pending = page.waitForEvent("download");
    await page.locator(button).click();
    if (confirm) await page.locator(confirm).click();
    const path = join(dir, prefix + "-" + file); await (await pending).saveAs(path);
    return path;
  };
  const html = await save("#exportHtml", "viewer.html");
  const pdf = await save("#exportPdf", "vector.pdf", "#confirmPdfExport");
  if (verify) {
    const bytes = await readFile(pdf, "latin1");
    assert.match(bytes, /\/BaseFont \/[A-Z]{6}\+Cabin-Regular/);
    assert.match(bytes, /\/BaseFont \/[A-Z]{6}\+Cabin-Bold/);
  }
  const offline = await browser.newContext({ offline: true, viewport: { width: 1520, height: 1040 } });
  const viewer = await offline.newPage(), requests = [];
  viewer.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  viewer.on("pageerror", error => pageErrors.push(error.message));
  await viewer.goto(pathToFileURL(html).href);
  await viewer.evaluate(() => engineOutputReady);
  if (verify) assert((await platformFonts(viewer, ".output-toolbar strong")).some(font => font.familyName === "Cabin" && font.isCustomFont));
  assert.deepEqual(requests, []);
  await viewer.screenshot({ path: join(dir, prefix + "-viewer-dark.png") });
  await viewer.locator('[data-action="theme"]').click();
  await viewer.screenshot({ path: join(dir, prefix + "-viewer-light.png") });
  await viewer.setViewportSize({ width: 390, height: 844 });
  await viewer.locator('[data-action="fit"]').click();
  await viewer.screenshot({ path: join(dir, prefix + "-viewer-mobile.png") });
  assert.deepEqual(pageErrors, []);
  await offline.close(); await context.close();
  return { geometry, samples, panelFont, inspectorSize, scheduleSize };
}

try {
  const before = baseline && await inspect(baseline, "before", false);
  const after = await inspect(candidate, "cabin", true);
  if (before) {
    assert.deepEqual(after.geometry, before.geometry, "typography must not alter device bounds, connector anchors or wires");
    if (checkSize) {
      for (const surface of ["inspectorSize", "scheduleSize"]) {
        assert(Math.abs(after[surface] - before[surface] - 4 / 3) < .02, surface);
      }
      const largestSdi = entry => Math.max(...entry.samples.filter(sample => sample.text === "SDI")
        .map(sample => Number(sample.font.match(/([\d.]+)px/)?.[1])));
      assert(largestSdi(after) > largestSdi(before), "Canvas connector text grows as well");
    } else assert.notDeepEqual(after.panelFont, before.panelFont);
  }
  console.log(JSON.stringify({ dir, geometryCompared: Boolean(before), inspector: after.panelFont,
    canvasTextSamples: after.samples.length }));
} finally { await browser.close(); }
