import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { importFactoryPromotions } from "./import-factory-promotions.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const artifacts = await mkdtemp(join(tmpdir(), "factory-promotion-browser-")), build = join(artifacts, "authoring");
execFileSync(process.execPath, [new URL("./build-factory-authoring.mjs", import.meta.url).pathname, build, "--enable-factory-authoring"]);
const mime = { ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };
const server = createServer(async (request, response) => {
  try {
    const path = resolve(build, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (!path.startsWith(build + "/") && path !== build) throw new Error("Invalid path");
    const file = path === build ? join(path, "index.html") : path;
    response.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream"); response.setHeader("Cache-Control", "no-store"); response.end(await readFile(file));
  } catch { console.error(`Missing build resource: ${request.url}`); response.writeHead(404); response.end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const checks = [], errors = [], id = "barco-e2-gen2";
const ready = async page => { await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady); };
const open = async page => { await page.evaluate(id => openDeviceEditorForTemplate(id), id); await page.locator('[data-editor-tab="defaults"]').click(); };
const queue = async page => {
  await page.locator("#promoteToFactory").click(); await page.locator("#reviewFactoryPromotion").click();
  await page.locator("#confirmFactoryDependencies").waitFor(); await page.locator("#confirmFactoryDependencies").check();
  await page.screenshot({ path: join(artifacts, "review-desktop.png") });
  await page.locator("#queueFactoryPromotion").click(); await page.waitForFunction(() => !document.getElementById("exportFactoryPromotions").disabled);
};
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(`${m.text()} ${m.location().url}`); });
  page.on("dialog", dialog => dialog.accept());
  const publicUrl = new URL(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768/"); publicUrl.searchParams.set("factoryAuthoring", "1");
  await page.goto(publicUrl.href); await ready(page);
  assert.equal(await page.locator("#factoryAuthoring").count(), 0);
  assert.equal(await page.evaluate(() => WireNexusBuildCapabilities.factoryAuthoring), false);
  checks.push("public build hides authoring even with URL flag");

  await page.goto(base); await ready(page); await open(page);
  assert.equal(await page.locator("#factoryAuthoring").count(), 1);
  await page.locator('[data-editor-tab="device"]').click(); await page.locator("#editorDeviceName").fill("Reviewed browser E2");
  await page.locator('[data-editor-tab="defaults"]').click(); await page.locator("#savePersonalDefault").click(); await page.waitForFunction(() => !personalDefaultsBusy);
  await queue(page); await page.screenshot({ path: join(artifacts, "queued-desktop.png") });
  const event = page.waitForEvent("download"); await page.locator("#exportFactoryPromotions").click();
  const download = await event, file = join(artifacts, download.suggestedFilename()); await download.saveAs(file);
  const pkg = JSON.parse(await readFile(file, "utf8"));
  assert.equal(pkg.records.find(r => r.id === id).definition.name, "Reviewed browser E2");
  assert.ok(await page.evaluate(id => localUserSettingsOwner.has(id), id));
  assert.match(await page.locator("#factoryPromotionStatus").innerText(), /Awaiting deployment/);
  checks.push("real Defaults review, explicit dependency approval, immutable queue, JSON download and durable receipt");
  const dry = await importFactoryPromotions({ root: build, pkg }); assert.equal(dry.applied, false);
  await page.reload(); await ready(page); await open(page); assert.match(await page.locator("#factoryPromotionStatus").innerText(), /Awaiting deployment/);
  checks.push("export and dry-run retain personal definition across reload");
  await importFactoryPromotions({ root: build, pkg, apply: true });
  execFileSync(process.execPath, [new URL("./factory-catalogue-validation.mjs", import.meta.url).pathname, "--root", build]);
  await page.reload(); await ready(page); await open(page);
  assert.equal(await page.evaluate(id => localUserSettingsOwner.has(id), id), false);
  assert.match(await page.locator("#factoryPromotionStatus").innerText(), /WireNexus Library version active/);
  assert.equal(await page.evaluate(id => libraryTemplateById(id).name, id), "Reviewed browser E2");
  checks.push("temporary repository apply recognized at same origin; only exact exported override removed");

  await page.locator('[data-editor-tab="device"]').click(); await page.locator("#editorDeviceName").fill("Second promotion");
  await page.locator('[data-editor-tab="defaults"]').click(); await page.locator("#savePersonalDefault").click(); await page.waitForFunction(() => !personalDefaultsBusy); await queue(page);
  const event2 = page.waitForEvent("download"); await page.locator("#exportFactoryPromotions").click();
  const file2 = join(artifacts, "second.json"); await (await event2).saveAs(file2);
  await page.locator('[data-editor-tab="device"]').click(); await page.locator("#editorDeviceName").fill("Further personal changes");
  await page.locator('[data-editor-tab="defaults"]').click(); await page.locator("#savePersonalDefault").click(); await page.waitForFunction(() => !personalDefaultsBusy);
  await importFactoryPromotions({ root: build, pkg: JSON.parse(await readFile(file2, "utf8")), apply: true });
  await page.reload(); await ready(page); await open(page);
  assert.equal(await page.evaluate(id => localUserSettingsOwner.entry(id).definition.name, id), "Further personal changes");
  assert.match(await page.locator("#factoryPromotionStatus").innerText(), /further personal changes/);
  await page.screenshot({ path: join(artifacts, "recognized-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(artifacts, "recognized-mobile.png") });
  checks.push("new personal edits survive deployment; multiple receipt versions retained; desktop/mobile rendered");
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.locator("#closeDeviceEditor").click();
  await page.evaluate(id => {
    const placement = canvasDropTemplatePayload(libraryTemplateById(id)), instance = prepareDeviceInstanceFromTemplate(placement.template, 0, 0, placement);
    if (!activeEngineBridge().createDeviceFromLibraryDrop(instance)) throw new Error("Insertion failed");
  }, id);
  const htmlDownload = page.waitForEvent("download"); await page.evaluate(() => exportHtml());
  const html = join(artifacts, "promoted-offline.html"); await (await htmlDownload).saveAs(html);
  const offline = await browser.newContext(); await offline.setOffline(true); const viewer = await offline.newPage();
  viewer.on("pageerror", error => errors.push(error.message)); await viewer.goto(`file://${html}`);
  await viewer.waitForFunction(() => document.querySelector("canvas")?.width > 0); await viewer.waitForTimeout(1000);
  const image = await viewer.screenshot({ path: join(artifacts, "promoted-offline.png") }); assert.ok(image.length > 10000);
  checks.push("post-promotion actual Export HTML download opens offline with Engine canvas");
  await offline.close(); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, artifacts }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
