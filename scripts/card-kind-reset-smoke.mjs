import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8774";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-card-kind-reset";
await mkdir(dir, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
const errors = [], alerts = [], confirmations = [], checks = [];
let accept = true;
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", async dialog => {
  if (dialog.type() === "alert") { alerts.push(dialog.message()); await dialog.accept(); }
  else {
    confirmations.push(dialog.message());
    if (accept) await dialog.accept(); else await dialog.dismiss();
  }
});
const ready = async () => { await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady); };
const card = () => page.evaluate(() => structuredClone(currentEditorCard()));
const save = async () => {
  await page.locator('[data-editor-tab="defaults"]').click();
  await page.locator("#savePersonalDefault").click();
  await page.waitForFunction(() => !personalDefaultsBusy);
};
try {
  await page.goto(base); await ready();
  const projectBefore = await page.evaluate(() => JSON.stringify(projectSnapshotData()));
  await page.evaluate(async () => {
    await openDeviceEditorWithNewDevice();
    const device = currentEditorTemplate();
    device.id = "card-reset-smoke"; device.name = "Card Direction Reset";
    device.hasSwappableCards = true;
    const connectors = Array.from({ length: 12 }, (_, i) => ({ id: `original-${i + 1}`, type: i % 3 ? "sdi" : "hdmi",
      direction: "input", label: i % 3 ? "SDI" : "HDMI", x: 0, y: 100 + i * SLOT_HEIGHT }));
    device.cardTypes = [{ id: "original", name: "8xHDMI2.0 4x12G-SDI IN", kind: "input", connectors,
      connectorRelationships: Array.from({ length: 4 }, (_, i) => ({ id: `group-${i}`, type: "exclusive",
        members: connectors.slice(i * 3, i * 3 + 3).map(c => c.id) })) }];
    renderDeviceEditor();
  });
  await page.locator('[data-editor-tab="cards"]').click();
  const original = await card();
  await page.locator("#duplicateCardType").click();
  const copy = await card();
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.connectorRelationships.length, 4);
  await page.evaluate(() => {
    const device = currentEditorTemplate(), card = currentEditorCard();
    device.cardSlots = ["one", "two"].map((id, i) => ({ id, name: id, installedCardTypeId: card.id,
      y: 300 + i * 1000, connectorOverrides: { [card.connectors[0].id]: { nameText: "Installed name" } } }));
    renderDeviceEditor();
  });
  const before = await page.evaluate(() => JSON.stringify(currentEditorTemplate()));
  accept = false;
  await page.locator("#editorCardKind").selectOption("output");
  assert.equal(await page.locator("#editorCardKind").inputValue(), "input");
  assert.equal(await page.evaluate(() => JSON.stringify(currentEditorTemplate())), before);
  assert.match(confirmations.at(-1), /All nodes.*relationships.*deleted/);
  checks.push("Cancel restores the dropdown and leaves the entire draft unchanged");
  accept = true;
  await page.locator("#editorCardKind").selectOption("output");
  assert.equal((await card()).connectors.length, 0);
  assert.equal((await card()).connectorTopology.relationships.length, 0);
  assert.deepEqual(await page.evaluate(() => currentEditorTemplate().cardSlots.map(s => s.connectorOverrides)), [{}, {}]);
  assert.deepEqual(await page.evaluate(() => currentEditorTemplate().cardTypes[0]), original);
  await page.screenshot({ path: `${dir}/reset-output-card.png` });
  await page.locator("#addCardOutputNode").click();
  await page.locator("[data-card-physical-type]").selectOption("hdmi");
  assert.equal((await card()).connectors[0].direction, "output");
  assert.equal((await card()).connectorTopology.validation.errors.length, 0);
  await page.screenshot({ path: `${dir}/rebuilt-output-card.png` });
  await save();
  assert.deepEqual(alerts, []);
  const saved = await page.evaluate(() => structuredClone(localUserSettingsOwner.entry("card-reset-smoke").definition));
  assert.equal(saved.cardTypes[1].connectors.length, 1);
  assert.equal(saved.cardTypes[1].kind, "output");
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#exportDeviceLibrary").click();
  const exported = JSON.parse(await readFile(await (await downloadEvent).path(), "utf8"));
  assert.equal(exported.devices[0].cardTypes[1].connectors.length, 1);
  assert.equal(exported.devices[0].cardTypes[1].connectorRelationships.length, 0);
  await page.locator("#closeDeviceEditor").click();
  await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => JSON.stringify(projectSnapshotData())), projectBefore);
  checks.push("Duplicate, reset Input to Output, rebuild, personal save and JSON export pass; original card/project unchanged");

  await page.reload(); await ready();
  await page.evaluate(() => openDeviceEditorForTemplate("card-reset-smoke"));
  await page.locator('[data-editor-tab="cards"]').click();
  await page.locator("#editorCardSelect").selectOption("1");
  assert.equal((await card()).kind, "output");
  assert.equal((await card()).connectors.length, 1);
  await page.locator("#editorCardKind").selectOption("input");
  assert.equal((await card()).connectors.length, 0);
  await page.locator("#addCardInputNode").click();
  await page.locator("[data-card-physical-type]").selectOption("hdmi");
  await save(); assert.deepEqual(alerts, []);
  checks.push("Personal definition reopens after reload; reverse Output to Input reset and save pass");

  // Reproduce an old filtered-card draft, including all eight dangling IDs.
  await page.evaluate(copy => {
    Object.assign(currentEditorTemplate().cardTypes[1], copy);
    currentEditorTemplate().cardTypes[1].connectors = copy.connectors.filter((_, i) => i % 3 === 0);
    editorCardIndex = 1;
    renderDeviceEditor();
  }, copy);
  const persistedBefore = await page.evaluate(() => JSON.stringify(localUserSettingsOwner.entry("card-reset-smoke")));
  await save();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Personal definition was not saved:.*references missing connector/);
  assert.equal((alerts[0].match(/references missing connector/g) || []).length, 8);
  assert.equal(await page.evaluate(() => JSON.stringify(localUserSettingsOwner.entry("card-reset-smoke"))), persistedBefore);
  const invalidDraft = await page.evaluate(() => JSON.stringify(currentEditorTemplate()));
  await page.evaluate(() => { editorEngineDynamicCardArtworkActive = true; });
  await page.locator("#closeDeviceEditor").click();
  await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => JSON.stringify(currentEditorTemplate())), invalidDraft);
  checks.push("Actual failed personal save preserves existing data; Close works without rendering or discarding the invalid draft");
  // Resume that same in-memory draft to test repair without silently dropping groups at load time.
  await page.evaluate(() => { deviceEditorModal.classList.remove("hidden"); renderDeviceEditor(); });
  await page.locator('[data-editor-tab="cards"]').click();
  await page.locator("#editorCardKind").selectOption("output");
  assert.equal((await card()).connectorTopology.validation.errors.length, 0);
  await page.locator("#addCardOutputNode").click();
  await page.locator("[data-card-physical-type]").selectOption("hdmi");
  await save();
  assert.equal(alerts.length, 1, "repaired card must save without another error");
  assert.equal(await page.evaluate(() => localUserSettingsOwner.entry("card-reset-smoke").definition.cardTypes[1].connectors.length), 1);
  await page.locator('[data-editor-tab="cards"]').click();
  await page.screenshot({ path: `${dir}/repaired-card.png` });
  checks.push("Confirmed reset repairs an already-broken draft and permits rebuilding and saving");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, checks, artifacts: dir }, null, 2));
} finally { await browser.close(); }
