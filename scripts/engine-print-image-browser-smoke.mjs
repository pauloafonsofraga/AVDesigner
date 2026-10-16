import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { outputPdfJumpFixture } from "../fixtures/output-pdf-jumps.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const dir = mkdtempSync(join(tmpdir(), "wirenexus-print-images-"));
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const projectPath = process.argv[2];
try {
  let page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const checks = await page.evaluate(async fixture => {
    const { preparePrintImage, printImageSource } = await import("./src/engine/outputPrintImage.js");
    const { prepareEnginePrintImages } = await import("./src/engine/outputSvgRenderer.js");
    const check = (value, message) => { if (!value) throw new Error(message); };
    const canvas = document.createElement("canvas"); canvas.width = 24; canvas.height = 16;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f86432"; ctx.fillRect(0, 0, 12, 16);
    ctx.fillStyle = "rgba(0,160,220,0.5)"; ctx.fillRect(12, 0, 6, 16);
    const pixels = async source => {
      const image = new Image(); image.src = source; await image.decode();
      ctx.clearRect(0, 0, 24, 16); ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(0, 0, 24, 16).data);
    };
    const png = canvas.toDataURL("image/png"), jpeg = canvas.toDataURL("image/jpeg", 1);
    const webp = canvas.toDataURL("image/webp", 1);
    const disguised = webp.replace("image/webp", "image/jpeg");
    const output = await preparePrintImage(disguised);
    check(output.width === 24 && output.height === 16, "Intrinsic dimensions must survive conversion");
    check(output.href.startsWith("data:image/png;"), "WebP must become PNG for PDFKit");
    const originalPixels = await pixels(webp), convertedPixels = await pixels(output.href);
    check(JSON.stringify(originalPixels) === JSON.stringify(convertedPixels), "Conversion must preserve decoded pixels and transparency");
    for (const source of [png, jpeg]) {
      check((await preparePrintImage(source)).href === source, "Supported originals must not be recompressed");
      const disguisedSource = source.replace(/^data:image\/[^;]+/, "data:image/webp");
      check((await preparePrintImage(disguisedSource)).href === source, "Bytes must override a misleading MIME label");
    }
    const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="red"/></svg>')}`;
    check((await preparePrintImage(svg)).href === svg, "Inline SVG must remain vector");
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
    check((await preparePrintImage(gif)).href.startsWith("data:image/png;"), "GIF must be converted for PDFKit");
    let rejected = false;
    try { await preparePrintImage("data:image/jpeg;base64,AAAA"); }
    catch (error) { rejected = /Print artwork could not be prepared/.test(error.message) && !error.message.includes("base64"); }
    check(rejected, "Invalid artwork must fail clearly without dumping embedded image data");
    let calls = 0;
    await prepareEnginePrintImages({ devices: [1, 2, 3].map(id => ({ id, visual: { faceImage: disguised } })) },
      async source => { calls++; return preparePrintImage(source); });
    check(calls === 1, "Repeated artwork must be converted once per export");
    fixture.devices.forEach(device => { device.templateOverride.faceImage = disguised; });
    await restoreSnapshot(fixture);
    const snapshot = buildCanonicalOutputSnapshot({ mode: "pdf-image-regression", drawingDependency: "engine-svg" });
    const drawing = await buildEnginePrintDrawing(snapshot);
    const { generatePdf } = await import(`./src/engine/generated/outputPdfBundle.js?v=${APP_BUILD_ID}`);
    const correct = await generatePdf({ ...drawing, engineScene: snapshot.engineScene });
    check(correct.warnings.length === 0, "Converted faceplates must export without artwork warnings");
    const originalSvg = drawing.svg.replaceAll(output.href, disguised);
    check(originalSvg !== drawing.svg, "Regression must contain the real faceplate artwork");
    const old = await generatePdf({ ...drawing, svg: originalSvg, engineScene: snapshot.engineScene });
    check(old.warnings.some(warning => warning.includes("failed to open image")), "Unconverted WebP must reproduce the reported failure");
    return { pixelParity: true, alpha: true, dimensions: [output.width, output.height],
      nativeBytesPreserved: true, svgVector: true, gif: true, invalidRejected: true,
      resolveCalls: calls, detected: printImageSource(disguised).mime,
      priorWarnings: old.warnings.length, warnings: correct.warnings.length, jumpAnnotations: correct.jumpAnnotations };
  }, outputPdfJumpFixture());
  console.log(JSON.stringify({ fixture: "PASS", ...checks }));
  const exportCurrent = async name => {
    await page.waitForFunction(() => activeEngineBridge()?.ready);
    await page.locator("#exportPdf").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 180000 });
    await page.locator("#confirmPdfExport").click();
    const download = await downloadPromise;
    const path = join(dir, name);
    await download.saveAs(path);
    assert.equal(readFileSync(path).subarray(0, 4).toString(), "%PDF");
    assert.equal(await page.locator("#statusText").textContent(), "PDF exported.");
    assert.equal(await page.locator("#exportPdf").isEnabled(), true);
    return path;
  };
  await exportCurrent("image-regression.pdf");
  if (projectPath) {
    const beforeHash = createHash("sha256").update(readFileSync(projectPath)).digest("hex");
    await page.close();
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
    console.log("Opening supplied project through the normal file input...");
    page.on("dialog", async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
    await page.locator("#fileInput").setInputFiles(projectPath);
    await page.waitForFunction(() => window.__AVD_PROJECT_LOAD_METRICS__?.totalMs && activeEngineBridge()?.ready,
      null, { timeout: 120000 });
    const inventory = await page.evaluate(() => ({ projectName: state.projectName,
      devices: state.devices.length, wires: state.connections.length }));
    const path = await exportCurrent(`${basename(projectPath, ".avd")}-report.pdf`);
    await page.screenshot({ path: join(dir, "project-exported.png") });
    assert.equal(createHash("sha256").update(readFileSync(projectPath)).digest("hex"), beforeHash);
    console.log(JSON.stringify({ project: "PASS", path, ...inventory, originalFileUnchanged: true }));
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(dir, "results.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, dir, pageErrors: errors.length }));
} finally { await browser.close(); }
