import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = mkdtempSync(join(tmpdir(), "avd-pair-picker-")), errors = [], checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.locator("#addLibraryDevice").click();
  const search = page.locator("#editorPairSearch"), list = page.locator("#editorPairList");
  const current = () => page.evaluate(() => ({
    id: currentEditorTemplate().id, pair: currentEditorTemplate().pairedTemplateId,
    first: currentEditorTemplate().pairPlaceFirst, enabled: currentEditorTemplate().isPartOfPair
  }));
  assert.equal(await search.isVisible(), false);
  await page.locator("label:has(#editorPartOfPair)").click();
  await search.fill("Beetek RX");
  assert.equal(await list.locator("input").count(), 1);
  assert.match(await list.textContent(), /Beetek \/ Extenders/);
  const receiverId = await list.locator("input").inputValue();
  await list.locator("input").check();
  assert.equal((await current()).pair, receiverId);
  assert.match(await page.locator("#editorPairCurrentName").textContent(), /M1-DP&HDMI-Pro RX/);
  assert.equal(await search.inputValue(), "Beetek RX");
  await page.screenshot({ path: join(directory, "paired-receiver.png") });
  checks.push("real Beetek receiver is searchable and selectable; selected name and Brand / Category are visible");

  await search.fill("not-a-device-987654");
  assert.equal(await page.locator("#editorPairEmpty").isVisible(), true);
  assert.equal((await current()).pair, receiverId);
  await page.locator("label:has(#editorPairPlaceFirst)").click();
  assert.equal((await current()).first, true); assert.equal((await current()).pair, receiverId);
  checks.push("zero matches do not clear pairing; Place This Device First preserves the filtered-out selection");

  await search.fill("beetek");
  const matches = await list.locator("input").evaluateAll(nodes => nodes.map(n => n.value));
  assert.ok(matches.length >= 2);
  await search.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.value), receiverId);
  await page.keyboard.press("ArrowDown");
  const nextId = matches[(matches.indexOf(receiverId) + 1) % matches.length];
  assert.equal((await current()).pair, nextId);
  assert.equal(await page.evaluate(() => document.activeElement.value), nextId);
  checks.push("native radio keyboard navigation changes the partner and retains focus");

  await page.locator("#editorPairClear").click();
  assert.equal((await current()).pair, "");
  assert.equal(await page.locator("#editorPairCurrent").isVisible(), false);
  assert.equal(await page.locator("#editorPairPlaceFirst").isDisabled(), true);
  assert.equal(await search.evaluate(node => node === document.activeElement), true);
  await search.fill("");
  const state = await current();
  assert.equal(await list.locator("input").evaluateAll((nodes, id) => nodes.some(n => n.value === id), state.id), false);
  const dimensions = await list.evaluate(node => ({ height: node.clientHeight, scrollHeight: node.scrollHeight, width: node.clientWidth, scrollWidth: node.scrollWidth }));
  assert.ok(dimensions.height <= 224 && dimensions.scrollHeight > dimensions.height);
  assert.equal(dimensions.width, dimensions.scrollWidth);
  checks.push("Clear is explicit, self-pairing is excluded, and the full list scrolls vertically without horizontal overflow");

  await search.fill("beetek rx"); await list.locator("input").check();
  await page.locator("label:has(#editorPartOfPair)").click();
  assert.equal(await search.isVisible(), false); assert.equal((await current()).pair, "");
  assert.equal((await current()).enabled, false);
  await page.locator("label:has(#editorPartOfPair)").click();
  await search.fill("beetek");
  await page.evaluate(id => openDeviceEditorForTemplate(id), receiverId);
  assert.equal(await search.inputValue(), "");
  assert.notEqual((await current()).id, state.id);
  checks.push("pair toggle retains its original clearing behavior; switching devices resets the search");
  if (!await page.locator("#editorPartOfPair").isChecked()) await page.locator("label:has(#editorPartOfPair)").click();

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await search.fill("beetek"); await search.scrollIntoViewIfNeeded();
    assert.ok(await list.locator("input").count() > 0);
    await list.locator("input").first().check();
    assert.equal((await current()).pair, await list.locator("input").first().inputValue());
    const overflow = await list.locator(".editor-pair-option").evaluateAll(nodes => nodes.some(n => n.scrollWidth > n.clientWidth));
    assert.equal(overflow, false);
    await page.screenshot({ path: join(directory, `picker-${viewport.width}.png`) });
  }
  checks.push("pair rows fit their containers at desktop and mobile viewport sizes");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, errors, directory }, null, 2));
} finally { await browser.close(); }
