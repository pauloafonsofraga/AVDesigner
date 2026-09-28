import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const artifacts = mkdtempSync(join(tmpdir(), "company-logo-"));
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const ready = () => page.waitForFunction(() => typeof activeEngineBridge === "function" && activeEngineBridge()?.ready);
  await page.goto(`${base}/index.html`); await ready();
  const [first, second] = await page.evaluate(() => ["STUDIO AV", "EVENTS AV"].map(text => {
    const canvas = document.createElement("canvas"); canvas.width = 280; canvas.height = 88;
    const c = canvas.getContext("2d"); c.fillStyle = "#ffffff"; c.fillRect(0, 0, 280, 88);
    c.fillStyle = "#009c87"; c.fillRect(0, 0, 12, 88); c.font = "bold 32px sans-serif"; c.fillText(text, 28, 57);
    return canvas.toDataURL("image/png");
  }));
  const upload = (id, source, name) => page.locator(id).setInputFiles({ name, mimeType: "image/png", buffer: Buffer.from(source.split(",")[1], "base64") });
  await page.locator("#titleBlockButton").click();
  await upload("#titleCompanyLogo", first, "Studio AV.png");
  await page.waitForFunction(source => titleBlockDraft?.companyLogo === source && AVDesignerCompanyLogo.readCompanyLogo()?.source === source, first);
  await page.screenshot({ path: join(artifacts, "title-block-logo.png") });
  await page.locator("#closeTitleBlockEditor").click();
  await page.reload(); await ready();
  await page.locator("#titleBlockButton").click();
  assert.equal(await page.evaluate(() => titleBlockDraft.companyLogo), first);
  assert.equal(await page.locator("#titleCompanyLogoPreview span").textContent(), "Studio AV.png");
  pass("title-block logo and filename survive browser reload");

  await page.evaluate(() => {
    const block = createTitleBlockFromDraft(0, 0); window.logoBlockId = block.id;
    closeTitleBlockEditor(); state.titleBlocks = [block];
    openTitleBlockEditor(block.id);
  });
  assert.equal(await page.evaluate(() => titleBlockDraft.companyLogo), first);
  await page.evaluate(() => { closeTitleBlockEditor(); state.titleBlocks[0].fields.companyLogo = ""; openTitleBlockEditor(logoBlockId); });
  assert.equal(await page.evaluate(() => titleBlockDraft.companyLogo), "", "an intentionally empty existing title block stays empty");
  await page.evaluate(first => {
    closeTitleBlockEditor(); state.titleBlocks[0].fields.companyLogo = first;
    AVDesignerCompanyLogo.rememberCompanyLogo({ source: first, name: "Studio AV.png" });
    openPublishProjectModal();
  }, first);
  assert.equal(await page.locator("#publishCompanyLogo").isVisible(), false);
  assert.equal(await page.locator("#publishCompanyLogoPreview img").getAttribute("src"), first);
  await page.screenshot({ path: join(artifacts, "publish-title-block-logo.png") });
  pass("existing title-block identity preserved and automatically used by Publish");

  let request;
  await page.route("**/api/publish", route => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: { url: `${base}/viewer.html?id=logo-project` } });
  });
  await page.evaluate(() => {
    window.uploadedFiles = {};
    loadBlobClient = async () => ({ upload: async (pathname, blob, options) => {
      if (options.access !== "private") throw Error("Private storage required");
      uploadedFiles[pathname] = await blob.text(); return { pathname };
    } });
  });
  async function publish(expected) {
    request = null;
    await page.locator("#publishProjectPassword").fill("logo-test-password");
    await page.locator("#confirmPublishProject").click();
    await page.waitForFunction(() => document.getElementById("publishProjectStatus").textContent.startsWith("Published."));
    assert.ok(request);
    assert.equal(request.companyLogo, await page.evaluate(source => preparePublishedCompanyLogo(source), expected));
    return page.evaluate(path => uploadedFiles[path], request.htmlPath);
  }
  const hostedHtml = await publish(first);
  assert.ok(hostedHtml.includes('id="engineOutputPayload"'));
  assert.ok(!hostedHtml.includes(request.password));
  pass("actual Publish prepares the title-block PNG and keeps the Engine viewer private");

  const hosted = await context.newPage();
  hosted.on("console", message => { if (message.type() === "error" && !message.text().includes("401 (Unauthorized)")) errors.push(message.text()); });
  await hosted.route("**/api/project*", route => route.fulfill(route.request().method() === "GET"
    ? { json: { companyLogo: request.companyLogo } }
    : route.request().postDataJSON().password === "logo-test-password"
      ? { json: { html: hostedHtml, title: "Logo smoke" } }
      : { status: 401, json: { error: "Password is incorrect." } }));
  await hosted.goto(`${base}/viewer.html?id=logo-project`);
  await hosted.locator("#companyLogo").waitFor({ state: "visible" });
  assert.equal(await hosted.locator("#companyLogo").getAttribute("src"), request.companyLogo);
  assert.equal(await hosted.locator("#companyFavicon").getAttribute("href"), request.companyLogo);
  await hosted.screenshot({ path: join(artifacts, "hosted-company-logo.png") });
  await hosted.setViewportSize({ width: 375, height: 812 });
  assert.equal(await hosted.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await hosted.screenshot({ path: join(artifacts, "hosted-company-logo-mobile.png") });
  await hosted.locator("#projectPassword").fill("wrong"); await hosted.locator("#unlockButton").click();
  await hosted.waitForFunction(() => viewerStatus.textContent.includes("incorrect"));
  assert.equal(await hosted.locator("iframe").count(), 0);
  await hosted.locator("#projectPassword").fill("logo-test-password"); await hosted.locator("#unlockButton").click();
  await hosted.waitForSelector("iframe");
  const frame = hosted.frames().find(f => f.parentFrame());
  await frame.waitForFunction(() => window.engineOutputReady); await frame.evaluate(() => engineOutputReady);
  assert.ok(await frame.evaluate(() => outputViewer.model.contract.signature));
  pass("custom login branding and favicon work on desktop/mobile; password unlock still opens Engine");
  await hosted.close();

  await page.evaluate(() => { closePublishProjectModal(); state.titleBlocks = []; openPublishProjectModal(); });
  assert.equal(await page.locator("#publishCompanyLogo").isVisible(), true);
  await upload("#publishCompanyLogo", second, "Events AV.png");
  await page.waitForFunction(source => publishCompanyLogoDraft?.source === source && !document.getElementById("confirmPublishProject").disabled, second);
  const noTitleScene = await page.evaluate(async () => (await prepareEngineViewerOutput()).snapshot.engineScene.signature);
  const fallbackHtml = await publish(second);
  assert.equal(JSON.parse(fallbackHtml.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]).engineScene.signature, noTitleScene);
  await page.screenshot({ path: join(artifacts, "publish-uploaded-logo.png") });
  pass("no-title-block upload supplies the company logo without altering the drawing scene");

  await page.evaluate(first => {
    closePublishProjectModal(); state.titleBlocks = [{ id: "title-1", x: 0, y: 0, fields: { companyLogo: first } }]; openPublishProjectModal();
  }, first);
  assert.equal(await page.locator("#publishCompanyLogoPreview img").getAttribute("src"), first);
  pass("project title-block logo takes precedence over a different remembered upload");

  await page.evaluate(() => { closePublishProjectModal(); state.titleBlocks = []; openPublishProjectModal(); });
  await page.locator("#removePublishCompanyLogo").click();
  assert.equal(await page.evaluate(() => AVDesignerCompanyLogo.readCompanyLogo()), null);
  await publish("");
  const plain = await context.newPage();
  await plain.route("**/api/project*", route => route.fulfill({ json: { companyLogo: "" } }));
  await plain.goto(`${base}/viewer.html?id=logo-project`);
  assert.equal(await plain.locator("#companyLogo").isVisible(), false);
  assert.ok(!(await plain.content()).includes("VideoCoreLogo.png"));
  pass("logo can be removed; unbranded projects never fall back to VideoCore");
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks} browser checks; 0 console/page errors; screenshots: ${artifacts}`);
} finally { await browser.close(); }
