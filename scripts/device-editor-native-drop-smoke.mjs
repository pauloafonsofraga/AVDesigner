import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const baseUrl = (process.env.AVDESIGNER_BASE_URL || "http://localhost:8767").replace(/\/$/, "");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}),
  args: ["--no-sandbox"]
});

let cases = 0;
try {
  for (const mode of ["engine", "legacy"]) {
    for (const direction of ["input", "output"]) {
      for (const type of ["16a-1ph", "32a-3ph", "125a-3ph"]) {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        try {
          const query = mode === "legacy" ? "legacy=1&debugDeviceDrop=1" : "debugDeviceDrop=1";
          await page.goto(`${baseUrl}/index.html?${query}`);
          await page.locator("#deviceEditorButton").click();
          await page.locator("#newDeviceTemplate").click();
          await page.locator("#editorPowerDistro").check({ force: true });
          await page.locator('[data-editor-tab="connectors"]').click();
          await page.locator(direction === "input" ? "#addInputNode" : "#addOutputNode").click();
          if (type === "125a-3ph") await page.locator("#editorZoomOut").click();
          await page.locator("#nodePaletteSearch").fill(type);
          const connectorId = `${direction}-slot-1`;
          const source = page.locator(`[data-node-type="${type}"]`);
          const target = page.locator(`#deviceEditorPreviewHost [data-editor-node-id="${connectorId}"] .editor-slot-shape`).first();
          await source.dragTo(target);
          const result = await page.evaluate(id => ({
            connector: currentEditorTemplate()?.connectors?.find(connector => connector.id === id),
            events: window.__avDesignerDeviceDropDebug?.events || []
          }), connectorId);
          assert.deepEqual(errors, [], `${mode}/${direction}/${type}: browser errors`);
          assert.equal(result.connector?.type, type, `${mode}/${direction}/${type}: stable connector filled`);
          assert.equal(result.connector?.empty, false);
          assert.equal(result.connector?.direction, direction);
          assert.equal(result.connector?.anchors?.find(anchor => anchor.id === result.connector.primaryAnchorId)?.y, result.connector.y);
          assert.ok(result.events.some(event => event.event === "dragover" && event.candidateId === connectorId && event.prevented), "host must accept dragover");
          assert.ok(result.events.some(event => event.event === "drop" && event.candidateId === connectorId && event.committed), "host must commit drop");
          cases++;
        } finally {
          await page.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`Native Chrome Device Editor palette drops: ${cases} passed`);
