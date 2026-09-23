import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";

try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => typeof deviceLibrary !== "undefined" && (!activeEngineBridge() || activeEngineBridge().ready));
    const source = await page.evaluate(() => {
      const template = libraryDeviceTemplates().find(device => device.id === "barco-e2-gen2");
      return { id: template.id, name: template.name, brand: deviceBrandLabel(template), category: template.category,
        model: template.model, thumbnail: deviceThumbnailMarkup(template), favorite: !!template.favorite };
    });
    assert.equal(source.brand, "Barco");
    assert.equal(source.category, "Switchers");
    assert.equal(source.model, "E2 Gen2");
    await page.locator("#deviceSearch").fill("E2 Gen2");
    const card = page.locator(`#deviceList [data-template-id="${source.id}"]`);
    await card.waitFor({ state: "visible" });
    const checkIdentity = async (row, title) => {
      assert.equal(await row.locator("h3").innerText(), title);
      assert.equal(await row.locator("p").innerText(), "Barco / Switchers");
      assert.equal(await row.locator(".device-thumb").evaluate(el => el.outerHTML), source.thumbnail.trim());
    };
    await checkIdentity(card, "E2 Gen2");
    const favorite = card.locator(".library-favorite");
    assert.equal(await favorite.getAttribute("aria-label"), source.favorite ? "Remove from favorites" : "Add to favorites");
    await favorite.click();
    assert.equal(await favorite.getAttribute("aria-label"), source.favorite ? "Add to favorites" : "Remove from favorites");
    await checkIdentity(card, "E2 Gen2");
    await favorite.click();

    // Exercise the real pointer handler without placing a device or altering its definition.
    await card.locator("h3").hover();
    await page.mouse.down();
    assert.equal(await page.locator(".drag-ghost strong").innerText(), "E2 Gen2");
    assert.equal(await page.locator(".drag-ghost span").innerText(), "Barco / Switchers");
    await page.keyboard.press("Escape");
    await page.mouse.up();

    await page.evaluate(id => restoreSnapshot({ devices: [{ instanceId: "identity-device", templateId: id, name: "FOH Switcher", x: 0, y: 0 }], connections: [] }), source.id);
    await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
    await page.locator("#customDeviceSearch").fill("E2 Gen2");
    const projectCard = page.locator('#customDeviceList [data-instance-id="identity-device"]');
    await projectCard.waitFor({ state: "visible" });
    await checkIdentity(projectCard, "FOH Switcher");
    assert.equal(await projectCard.getAttribute("aria-label"), "Select FOH Switcher on canvas");
    assert.equal(await page.evaluate(id => templateById(id).model, source.id), source.model);
    if (process.env.AVDESIGNER_SCREENSHOT_DIR) {
      await page.locator("aside.library").screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR}/${mode}-device-card-identity.png` });
    }
    const pair = await page.evaluate(() => {
      const entry = deviceLibraryEntries().find(entry => entry.kind === "pair" && entry.first.name === "M1-DP&HDMI-Pro TX");
      return { firstId: entry.first.id, secondId: entry.second.id, firstName: entry.first.name, secondName: entry.second.name,
        title: `${entry.first.name} + ${entry.second.name}`, thumbnail: deviceThumbnailMarkup(entry.first), favorite: !!entry.first.favorite };
    });
    const pairCard = page.locator(`#deviceList [data-template-id="${pair.firstId}"][data-pair-template-id="${pair.secondId}"]`);
    for (const query of [pair.firstName, pair.secondName, "Beetek", "Extenders"]) {
      await page.locator("#deviceSearch").fill(query);
      await pairCard.waitFor({ state: "visible" });
      assert.equal(await pairCard.locator("h3").innerText(), pair.title);
      assert.equal(await pairCard.locator("p").innerText(), "Beetek / Extenders");
    }
    await page.locator("#deviceSearch").fill(pair.firstName);
    assert.equal(await pairCard.locator(".device-thumb").evaluate(el => el.outerHTML), pair.thumbnail.trim());
    const pairFavorite = pairCard.locator(".library-favorite");
    await pairFavorite.click();
    assert.equal(await pairFavorite.getAttribute("aria-label"), pair.favorite ? "Add to favorites" : "Remove from favorites");
    await pairFavorite.click();
    assert.equal(await pairFavorite.getAttribute("aria-label"), pair.favorite ? "Remove from favorites" : "Add to favorites");
    await pairCard.locator("h3").hover();
    await page.mouse.down();
    assert.equal(await page.evaluate(() => libraryDrag.pairTemplateId), pair.secondId);
    assert.equal(await page.locator(".drag-ghost strong").innerText(), pair.title);
    assert.equal(await page.locator(".drag-ghost span").innerText(), `Device pair / ${pair.title}`);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    if (process.env.AVDESIGNER_SCREENSHOT_DIR) {
      await page.locator("aside.library").screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR}/${mode}-paired-device-brand.png` });
    }
    assert.deepEqual(errors, [], `${mode}: console/page errors`);
    console.log(`${mode}: real Barco E2 Gen2 and Beetek pair, library/project identity, search, favorite, thumbnail and drag preview PASS`);
    await page.close();
  }
} finally { await browser.close(); }
