import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-rack-styles-"));
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1050 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html?renderer=engine&debugRackBuilder=1`);
  await page.waitForFunction(() => typeof createRack === "function" && activeEngineBridge()?.ready);
  const racks = await page.evaluate(() => {
    const template = { id: "rack-style-qa-device", name: "Rack Style QA Device", model: "RS-QA", category: "Network",
      width: 320, height: 220, connectors: [{ id: "qa-out", type: "sdi", physicalType: "SDI", compatibilityType: "sdi-video",
        label: "SDI OUT", direction: "output", displaySide: "right", x: 320, y: 110, color: "#48a5d6" }],
      cards: [], hasSwappableCards: false };
    const styles = [
      { key: "standard", name: "Rack Standard QA", color: "#23658A", x: 180 },
      { key: "professional", name: "Rack Professional QA", color: "#3D8054", x: 820 },
      { key: "touring", name: "Rack Touring QA", color: "#A14B32", x: 1460 }
    ];
    const created = styles.map(({ key, name, color, x }, index) => {
      const rack = createRack(name);
      rack.rackShell = { styleId: key, color };
      rack.devices = [hydrateDeviceInstance({ instanceId: `rack-style-source-${index}`, templateId: template.id,
        templateOverride: template, name: template.name, x: 100 + index * 60, y: 120 })];
      rack.exposedPorts = [{ id: `rack-style-exposed-${index}`, deviceId: `rack-style-source-${index}`, connectorId: "qa-out" }];
      rack.patchPanels = [{ id: `rack-style-panel-${index}`, label: "PATCH", rackFace: "front", placementSide: "left",
        y: 120, baseCapacity: 8, ports: [{ id: `rack-style-port-${index}`, slot: 3,
          sourceRackDeviceId: `rack-style-source-${index}`, sourceConnectorId: "qa-out" }] }];
      addRackInstanceToCanvas(rack.id, x, 120);
      return { id: rack.id, styleId: key, color };
    });
    renderCanvasOnly();
    const placed = created.map(item => ({ ...item,
      canvasId: state.racks.find(rack => rack.canvasInstance && rack.sourceRackId === item.id)?.id }));
    return { racks: placed, build: document.getElementById("appBuildLabel")?.textContent || "" };
  });
  assert.ok(racks.racks.every(rack => rack.canvasId), "each source rack has a placed canvas instance");
  await page.evaluate(() => document.querySelector("#zoomFit")?.click());
  await page.waitForFunction(() => activeEngineBridge()?.renderer?.textureStats?.().rackShellTexturesReady === 3);
  await page.evaluate(() => {
    activeEngineBridge().scene.clearSelection();
    activeEngineBridge().scheduleRender();
  });
  await page.waitForTimeout(400);
  const textureStats = await page.evaluate(() => activeEngineBridge().renderer.textureStats());
  assert.equal(textureStats.rackShellTextureCount, 3, "one source texture per selected rack style");
  assert.equal(textureStats.rackShellTexturesReady, 3);
  await page.screenshot({ path: join(screenshots, "three-rack-shell-styles.png"), fullPage: false });

  const baseline = await page.evaluate(({ rack }) => {
    const scene = activeEngineBridge().scene;
    const layout = scene.compactRackLayout(rack.canvasId);
    const child = scene.canvasDeviceForId(layout.devices[0].deviceId);
    return { sourceShell: rackById(rack.id).rackShell, sceneShell: scene.getRack(rack.canvasId).rackShell,
      content: layout.compactContentBounds, devices: layout.devices, panels: layout.patchPanels,
      connector: scene.connectorWorldPoint(child, scene.getConnector(child.id, "qa-out")), shellBounds: layout.shellBounds };
  }, { rack: racks.racks[0] });

  await page.evaluate(({ rackId }) => openRackBuilderForRack(rackId), { rackId: racks.racks[0].id });
  await page.waitForFunction(() => [...document.querySelectorAll("#rackBuilderStyle option")].some(option => option.value === "touring"));
  const styleSelect = page.locator("#rackBuilderStyle");
  assert.deepEqual(await styleSelect.locator("option").allTextContents(), ["Standard", "Professional AV Rack", "Touring Flight Case"]);
  assert.equal(await styleSelect.inputValue(), "standard");

  await styleSelect.selectOption("professional");
  await page.waitForFunction(({ id }) => rackById(id)?.rackShell?.styleId === "professional", racks.racks[0]);
  const synchronizedStyle = await page.evaluate(({ canvasId }) => activeEngineBridge()?.scene.getRack(canvasId)?.rackShell?.styleId, racks.racks[0]);
  assert.equal(synchronizedStyle, "professional", "placed rack receives the source rack's selected style");
  const professional = await page.evaluate(({ rack }) => {
    const scene = activeEngineBridge().scene, layout = scene.compactRackLayout(rack.canvasId);
    const child = scene.canvasDeviceForId(layout.devices[0].deviceId);
    return { shell: rackById(rack.id).rackShell, content: layout.compactContentBounds,
      devices: layout.devices, panels: layout.patchPanels,
      connector: scene.connectorWorldPoint(child, scene.getConnector(child.id, "qa-out")), shellBounds: layout.shellBounds };
  }, { rack: racks.racks[0] });
  assert.equal(professional.shell.color, "#23658A", "changing style preserves source rack color");
  assert.deepEqual(professional.content, baseline.content);
  assert.deepEqual(professional.devices, baseline.devices);
  assert.deepEqual(professional.panels, baseline.panels);
  assert.deepEqual(professional.connector, baseline.connector);
  assert.equal((await page.evaluate(() => activeEngineBridge().renderer.textureStats().rackShellTextureCount)), 3,
    "different Professional colors reuse the already-loaded source texture");

  await page.locator("#undoAction").dispatchEvent("click");
  await page.waitForFunction(({ id }) => rackById(id)?.rackShell?.styleId === "standard", racks.racks[0]);
  await page.locator("#redoAction").dispatchEvent("click");
  await page.waitForFunction(({ id }) => rackById(id)?.rackShell?.styleId === "professional", racks.racks[0]);
  await styleSelect.selectOption("touring");
  await page.waitForFunction(({ id }) => rackById(id)?.rackShell?.styleId === "touring", racks.racks[0]);
  assert.equal(await page.evaluate(({ canvasId }) => activeEngineBridge()?.scene.getRack(canvasId)?.rackShell?.styleId, racks.racks[0]),
    "touring", "live Engine scene updates when the source rack style changes again");
  const touringLayout = await page.evaluate(({ rack }) => {
    const scene = activeEngineBridge().scene, layout = scene.compactRackLayout(rack.canvasId);
    const child = scene.canvasDeviceForId(layout.devices[0].deviceId);
    return { content: layout.compactContentBounds, devices: layout.devices, panels: layout.patchPanels,
      connector: scene.connectorWorldPoint(child, scene.getConnector(child.id, "qa-out")) };
  }, { rack: racks.racks[0] });
  assert.deepEqual(touringLayout.content, baseline.content);
  assert.deepEqual(touringLayout.devices, baseline.devices);
  assert.deepEqual(touringLayout.panels, baseline.panels);
  assert.deepEqual(touringLayout.connector, baseline.connector);
  await page.locator("#rackBuilderColor").evaluate(input => {
    input.focus(); input.value = "#A14B32"; input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(({ id }) => rackById(id)?.rackShell?.styleId === "touring"
    && rackById(id)?.rackShell?.color === "#A14B32", racks.racks[0]);
  await page.locator("#undoAction").dispatchEvent("click");
  await page.waitForFunction(({ id }) => rackById(id)?.rackShell?.styleId === "touring"
    && rackById(id)?.rackShell?.color === "#23658A", racks.racks[0]);
  await page.locator("#redoAction").dispatchEvent("click");
  await page.waitForFunction(({ id }) => rackById(id)?.rackShell?.styleId === "touring"
    && rackById(id)?.rackShell?.color === "#A14B32", racks.racks[0]);
  const registryUnavailableResults = await page.evaluate(({ rackId }) => {
    const registry = rackShellStyleRegistry;
    const input = document.querySelector("#rackBuilderColor");
    const rack = rackById(rackId);
    rackShellStyleRegistry = null;
    try {
      const results = [];
      for (const [styleId, color] of [["professional", "#3D8054"], ["touring", "#7A8B91"]]) {
        rack.rackShell = { styleId, color: "#23658A" };
        input.value = color;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        results.push({ ...rack.rackShell });
      }
      return results;
    } finally {
      rackShellStyleRegistry = registry;
    }
  }, { rackId: racks.racks[0].id });
  assert.deepEqual(registryUnavailableResults, [
    { styleId: "professional", color: "#3D8054" },
    { styleId: "touring", color: "#7A8B91" }
  ], "color edits preserve Professional and Touring when the style registry is unavailable");
  await page.screenshot({ path: join(screenshots, "rack-style-selector.png"), fullPage: false });
  await page.locator("#closeRackBuilder").click();
  const pdfDownload = page.waitForEvent("download");
  await page.locator("#exportPdf").click();
  await page.locator("#confirmPdfExport").click();
  const pdf = await pdfDownload;
  const pdfPath = join(screenshots, "rack-shell-styles.pdf");
  await pdf.saveAs(pdfPath);
  assert.ok(statSync(pdfPath).size > 0, "the production PDF export produced data");
  assert.deepEqual(errors, [], "browser console has no page errors");
  console.log("PASS rack shell style browser acceptance", { screenshots, pdfPath, racks, textureStats, pageErrors: errors.length });
} finally {
  await browser.close();
}
