import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs/dist/exceljs.min.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const factory = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
const template = factory.devices.find(device => device.id === "custom-device-mq96wvk9");
assert.ok(template, "factory HDMI/SDI converter is available");
const ordinary = structuredClone(template), scoped = structuredClone(template);
ordinary.id = "smoke-ordinary-converter";
scoped.id = "smoke-scoped-converter";
scoped.connectors.find(connector => connector.id === "input-slot-1").type = "hdmi-personal-542ee7a2";
const fixture = {
  version: 1, projectName: "Scoped HDMI smoke", darkMode: true,
  nodeLibrary: [{ ...structuredClone(factory.nodeTypes.hdmi), id: "hdmi-personal-542ee7a2",
    label: "HDMI Personal", color: "#123456" }],
  deviceLibrary: [ordinary, scoped],
  devices: [
    { instanceId: "source", templateId: ordinary.id, name: "Resolume Main", x: 100, y: 100 },
    { instanceId: "target", templateId: scoped.id, name: "HDMI <> SDI Bi-Directional", x: 850, y: 100 }
  ],
  connections: [], ledSurfaces: [], racks: [], jumpNodes: [], jumpLinks: []
};
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const screenshots = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-scoped-node-labels";
mkdirSync(screenshots, { recursive: true });
const errors = [], checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 }, acceptDownloads: true });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.wireNexusReady);
  await page.evaluate(() => window.wireNexusReady);
  const upload = data => ({ name: "scoped-hdmi-project.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
  await page.locator("#fileInput").setInputFiles(upload(fixture));
  await page.waitForFunction(() => state.devices.length === 2 && activeEngineBridge()?.scene?.devices?.some(device => device.id === "target"));
  const initial = await page.evaluate(() => ({
    node: serializeNodeLibrary().find(node => node.id === "hdmi-personal-542ee7a2"),
    connector: activeEngineBridge().scene.getConnector("target", "input-slot-1"),
    undoEntries: undoStack.length
  }));
  assert.equal(initial.node.compatibilityType, "hdmi");
  assert.equal(initial.connector.type, "hdmi-personal-542ee7a2");
  assert.equal(initial.connector.compatibilityType, "hdmi");
  assert.equal(initial.connector.color, "#123456");
  assert.equal(initial.connector.typeLabel, "HDMI Personal");
  assert.equal(initial.undoEntries, 1, "load migration does not create an undo entry");
  checks.push("historical alias repaired on .avd load without replacing its node definition or creating undo history");

  await page.evaluate(() => activeEngineBridge().fitToView());
  const point = async (deviceId, connectorId) => page.evaluate(({ deviceId, connectorId }) => {
    const bridge = activeEngineBridge();
    const device = bridge.scene.getDevice(deviceId), connector = bridge.scene.getConnector(deviceId, connectorId);
    const screen = bridge.worldToScreenPoint({ x: device.x + connector.x, y: device.y + connector.y });
    const rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  }, { deviceId, connectorId });
  const source = await point("source", "output-slot-2");
  const wrong = await point("target", "input-slot-2");
  const target = await point("target", "input-slot-1");
  await page.mouse.move(source.x, source.y); await page.mouse.down();
  await page.mouse.move(wrong.x, wrong.y, { steps: 12 });
  const rejected = await page.evaluate(() => activeEngineBridge().wireCreate?.compatibility);
  assert.equal(rejected?.valid, false, "SDI input must reject HDMI output");
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const accepted = await page.evaluate(() => activeEngineBridge().wireCreate?.compatibility);
  assert.equal(accepted?.valid, true, "aliased HDMI input accepts ordinary HDMI output");
  assert.equal(accepted.targetType, "hdmi");
  await page.mouse.up();
  await page.waitForFunction(() => state.connections.length === 1);
  assert.equal(await page.evaluate(() => state.connections[0].cableType), "hdmi");
  checks.push("real pointer drag rejects SDI, accepts aliased HDMI, and commits a canonical HDMI cable");

  await page.evaluate(() => {
    window.scopedRenderedText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
      window.scopedRenderedText.push(String(value));
      return original.call(this, value, ...args);
    };
  });
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(350);
  const hovered = await page.evaluate(() => window.scopedRenderedText);
  assert.ok(hovered.some(value => value.includes("HDMI Personal")), "hover shows authored type label");
  assert.ok(hovered.every(value => !value.includes("-personal-")), "canvas and hover never print the scoped ID");
  await page.screenshot({ path: `${screenshots}/connector-hover.png` });
  await page.evaluate(() => renderConnectorInspector("target", "input-slot-1"));
  const connectorText = await page.locator("#inspectorBody").innerText();
  assert.match(connectorText, /HDMI Personal/);
  assert.doesNotMatch(connectorText, /-personal-/);
  await page.screenshot({ path: `${screenshots}/connector-inspector.png` });
  await page.evaluate(() => renderWireInspector(state.connections[0].id));
  assert.doesNotMatch(await page.locator("#inspectorBody").innerText(), /-personal-/);
  await page.evaluate(() => openSignalChainForWire(state.connections[0].id));
  await page.waitForFunction(() => document.getElementById("signalChainDialog").open);
  const chainText = await page.locator("#signalChainDialog").innerText();
  assert.match(chainText, /HDMI Personal/);
  assert.doesNotMatch(chainText, /-personal-/);
  await page.screenshot({ path: `${screenshots}/signal-chain.png` });
  await page.locator("#closeSignalChain").click();
  await page.evaluate(() => openCableSchedule());
  await page.waitForFunction(() => document.querySelector("#cableScheduleBody tr"));
  const scheduleText = await page.locator("#cableScheduleDialog").innerText();
  assert.match(scheduleText, /HDMI Personal/);
  assert.doesNotMatch(scheduleText, /-personal-/);
  await page.screenshot({ path: `${screenshots}/cable-schedule.png` });
  const csvDownload = page.waitForEvent("download");
  await page.locator("#downloadCableScheduleCsv").click();
  assert.doesNotMatch(readFileSync(await (await csvDownload).path(), "utf8"), /-personal-/);
  const xlsxDownload = page.waitForEvent("download");
  await page.locator("#downloadCableScheduleXlsx").click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(await (await xlsxDownload).path()));
  const cellText = workbook.worksheets.flatMap(sheet => {
    const values = [];
    sheet.eachRow(row => row.eachCell(cell => values.push(String(cell.text || ""))));
    return values;
  }).join("\n");
  assert.match(cellText, /HDMI Personal/);
  assert.doesNotMatch(cellText, /-personal-/);
  await page.locator("#closeCableSchedule").click();
  checks.push("hover, inspector, Signal Chain, schedule, CSV and XLSX show human labels without losing scoped artwork");

  await page.evaluate(id => openDeviceEditorForProjectTemplateDraft(
    structuredClone(deviceLibrary.find(item => item.id === id)), "project-template-edit",
    { dependencies: { nodes: serializeNodeLibrary(), devices: deviceLibrary } }), scoped.id);
  await page.locator('[data-editor-tab="connectors"]').click();
  await page.evaluate(() => {
    const template = currentEditorTemplate();
    setEditorNodeSelection(template, template.connectors.findIndex(item => item.id === "input-slot-1"));
    renderSelectedConnectorSettings();
  });
  const editorOptions = await page.locator("#deviceEditorModal select option").allTextContents();
  assert.ok(editorOptions.some(value => value.includes("HDMI Personal")), JSON.stringify(editorOptions.filter(value => /hdmi|personal/i.test(value))));
  assert.ok(editorOptions.every(value => !value.includes("-personal-")));
  await page.locator("#closeDeviceEditor").click();
  checks.push("Device Editor connector options display the scoped node label rather than its storage ID");

  const htmlDownload = page.waitForEvent("download");
  await page.locator("#exportHtml").click();
  const htmlPath = `${screenshots}/scoped-output.html`;
  copyFileSync(await (await htmlDownload).path(), htmlPath);
  const offline = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await offline.route(/^https?:/, route => route.abort());
  const viewerPage = await offline.newPage();
  viewerPage.on("pageerror", error => errors.push(error.message));
  await viewerPage.goto(`file://${htmlPath}`);
  await viewerPage.waitForFunction(() => window.engineOutputReady);
  await viewerPage.evaluate(() => window.engineOutputReady);
  await viewerPage.evaluate(() => outputViewer.select({ type: "connector", deviceId: "target", id: "input-slot-1" }));
  const viewerText = await viewerPage.locator(".output-inspector").innerText();
  assert.match(viewerText, /HDMI Personal/);
  assert.doesNotMatch(viewerText, /-personal-/);
  await viewerPage.screenshot({ path: `${screenshots}/offline-viewer.png` });
  await viewerPage.locator('[data-action="signal-chain"]').click();
  const viewerChain = await viewerPage.locator(".output-signal-chain").innerText();
  assert.match(viewerChain, /HDMI Personal/);
  assert.doesNotMatch(viewerChain, /-personal-/);
  await offline.close();
  checks.push("self-contained Engine HTML opens offline and keeps connector/Signal Chain labels human-readable");

  await page.locator("#exportPdf").click();
  const pdfDownload = page.waitForEvent("download");
  await page.locator("#confirmPdfExport").click();
  copyFileSync(await (await pdfDownload).path(), `${screenshots}/scoped-output.pdf`);
  checks.push("production PDF generated from the same scoped-node project");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveProject").click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  assert.equal(saved.nodeLibrary.find(node => node.id === "hdmi-personal-542ee7a2").compatibilityType, "hdmi");
  assert.equal(saved.connections[0].cableType, "hdmi");
  assert.equal(saved.deviceLibrary.find(device => device.id === scoped.id).connectors
    .find(connector => connector.id === "input-slot-1").type, "hdmi-personal-542ee7a2");
  await page.locator("#fileInput").setInputFiles(savedPath);
  await page.waitForFunction(() => state.connections.length === 1 &&
    activeEngineBridge()?.scene?.getWire(state.connections[0].id));
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.getConnector("target", "input-slot-1").compatibilityType), "hdmi");
  assert.equal(await page.evaluate(() => state.connections[0].cableType), "hdmi");
  await page.evaluate(() => renderConnectorInspector("target", "input-slot-1"));
  assert.doesNotMatch(await page.locator("#inspectorBody").innerText(), /-personal-/);
  checks.push("downloaded .avd keeps scoped node, canonical compatibility and cable across reopen");
  await context.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, screenshots, pass: checks.length, fail: 0, skip: 0 }, null, 2));
} finally { await browser.close(); }
