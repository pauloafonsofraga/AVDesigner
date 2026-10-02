import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const alerts = [], errors = [];
  page.on("dialog", async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => typeof openDeviceEditorForTemplate === "function" && activeEngineBridge()?.ready);
  await page.evaluate(async () => {
    await openDeviceEditorForTemplate("custom-device-mq84dpgn");
    duplicateCurrentEditorDevice();
    for (const context of new Set(editorDependencyContexts)) {
      if (context) context.nodes = context.nodes.filter(node => node.id !== "sfp-plus-cage");
    }
  });
  await page.locator("#editorDeviceName").fill("P10 test copy");
  const context = await page.evaluate(() => {
    const nodes = editorNodeDefinitions();
    const scoped = editorDependencyContext().nodes;
    const explicit = completeEditorNodeDefinitions([{ id: "sfp-plus-cage", color: "#123456" }]);
    const missing = structuredClone(currentEditorTemplate());
    missing.connectors[0].type = "missing-user-node";
    let missingError = "";
    try { validateEditorTemplateForApply(missing, nodes); } catch (error) { missingError = error.message; }
    return { scopedHasCage: scoped.some(node => node.id === "sfp-plus-cage"),
      resolvedCage: nodes.find(node => node.id === "sfp-plus-cage"),
      scopedColor: explicit.find(node => node.id === "sfp-plus-cage").color,
      missingError };
  });
  assert.equal(context.scopedHasCage, false);
  assert.equal(context.resolvedCage?.label, "SFP+ Cage");
  assert.equal(context.scopedColor, "#123456", "an authored scope wins over the built-in fallback");
  assert.match(context.missingError, /Required node definition missing-user-node is missing/);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportDeviceLibrary").click();
  const download = await downloadPromise;
  const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.ok(exported.nodes.some(node => node.id === "sfp-plus-cage"));
  assert.ok(exported.devices.some(device => device.name === "P10 test copy"));

  await page.locator("#applyDeviceEditor").click();
  await page.waitForFunction(() => document.getElementById("statusText")?.textContent
    ?.includes("saved to Project Devices"));
  assert.ok(await page.evaluate(() => deviceLibrary.some(device => device.name === "P10 test copy")));
  assert.deepEqual(alerts, []);
  assert.deepEqual(errors, []);
  console.log("PASS duplicate P20, restore hidden SFP+ dependency, export JSON and apply P10 copy");
} finally {
  await browser.close();
}
