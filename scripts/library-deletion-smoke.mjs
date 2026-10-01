import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const errors = [];
const page = await browser.newPage();
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => dialog.accept());

try {
  await page.goto(base);
  await page.waitForFunction(() => window.wireNexusReady);
  await page.evaluate(() => wireNexusReady);

  await page.evaluate(async () => {
    const definition = createBlankDeviceTemplate();
    definition.id = "personal-delete-smoke";
    definition.name = "Delete Smoke Device";
    await localUserSettingsOwner.save(definition, { library: libraryDeviceTemplates(), nodes: personalLibraryNodes });
  });
  await page.evaluate(() => openDeviceEditorForTemplate("personal-delete-smoke"));
  assert.equal(await page.locator("#deleteEditorDevice").isEnabled(), true);
  const projectBefore = await page.evaluate(() => JSON.stringify(projectSnapshotData()));
  await page.locator("#deleteEditorDevice").click();
  assert.equal(await page.evaluate(() => localUserSettingsOwner.has("personal-delete-smoke")), false);
  assert.equal(await page.evaluate(() => Boolean(libraryTemplateById("personal-delete-smoke"))), false);
  assert.equal(await page.evaluate(() => JSON.stringify(projectSnapshotData())), projectBefore);

  await page.evaluate(() => openDeviceEditorForTemplate(builtInDeviceLibrary[0].id));
  assert.equal(await page.locator("#deleteEditorDevice").isDisabled(), true);
  await page.locator("#closeDeviceEditor").click();

  await page.locator("#nodeBuilderButton").click();
  assert.equal(await page.locator("#deleteNodeType").isVisible(), true);
  assert.equal(await page.locator("#deleteNodeType").isDisabled(), true);
  await page.locator("#newNodeType").click();
  const unusedId = await page.evaluate(() => nodeBuilderSelectedType);
  assert.equal(await page.locator("#deleteNodeType").isEnabled(), true);
  await page.locator("#newNodeType").click();
  const usedId = await page.evaluate(() => {
    const id = nodeBuilderSelectedType;
    const definition = createBlankDeviceTemplate();
    definition.connectors = [{ id: "in", type: id, direction: "input", x: 0, y: 100 }];
    deviceLibrary.push(definition);
    return id;
  });
  await page.evaluate(id => { nodeBuilderSelectedType = id; renderNodeBuilderForm(); }, unusedId);
  await page.locator("#deleteNodeType").click();
  assert.equal(await page.evaluate(id => Boolean(cableTypes[id]), unusedId), false);
  await page.evaluate(id => { nodeBuilderSelectedType = id; renderNodeBuilderForm(); }, usedId);
  await page.locator("#deleteNodeType").click();
  assert.equal(await page.evaluate(id => Boolean(cableTypes[id]), usedId), true);
  await page.locator("#closeNodeBuilder").click();

  await page.reload();
  await page.waitForFunction(() => window.wireNexusReady);
  await page.evaluate(() => wireNexusReady);
  assert.equal(await page.evaluate(() => Boolean(libraryTemplateById("personal-delete-smoke"))), false);
  assert.equal(await page.evaluate(id => Boolean(cableTypes[id]), unusedId), false);
  assert.deepEqual(errors, []);
  console.log("PASS: personal device deletion persists; factory device protected; custom node deletion persists; in-use node protected");
} finally {
  await browser.close();
}
