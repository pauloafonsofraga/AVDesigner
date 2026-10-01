import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-signal-chain-"));
const checks = [], errors = [];
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768");
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const project = cableTypeSelectionFixture(), jumps = jumpHoldFixture();
  project.devices[0].name = "E2 Gen2";
  project.devices[0].templateOverride.name = "E2 Gen2";
  project.devices[0].templateOverride.faceImage = "Devices/faceplates/E2.png";
  project.devices[0].templateOverride.thumbnailImage = "Devices/faceplates/library/thumbs/barco-e2-gen2-barco-e2-gen2.png";
  project.devices[1].name = "PT-RQ25K";
  project.devices[1].templateOverride.name = "PT-RQ25K";
  project.devices[1].templateOverride.faceImage = "Devices/faceplates/library/panasonic-pt-rq25k-panasonic-pt-rq25k.png";
  project.devices[1].templateOverride.thumbnailImage = "Devices/faceplates/library/thumbs/panasonic-pt-rq25k-panasonic-pt-rq25k.png";
  project.connections[0].length = "20 m";
  project.connections[0].loom = "FOH-1";
  jumps.devices.forEach(device => {
    device.instanceId = `jump-${device.instanceId}`;
    device.name = `Jump ${device.name}`;
    device.templateOverride.id = `jump-${device.templateOverride.id}`;
  });
  jumps.connections.forEach(wire => {
    for (const end of ["from", "to"]) if (wire[end]?.deviceId) wire[end].deviceId = `jump-${wire[end].deviceId}`;
  });
  project.devices.push(...jumps.devices);
  jumps.jumpNodes.find(node => node.id === "a").x = 540;
  jumps.jumpNodes.find(node => node.id === "b").x = 390;
  project.jumpNodes = jumps.jumpNodes;
  project.jumpLinks = [{ id: "jump-link", outputJumpId: "a", inputJumpId: "b" }];
  project.connections.push(...jumps.connections.slice(0, 2));
  project.devices[1].templateOverride.connectors.push({ id: "unused", type: "hdmi", label: "HDMI",
    nameText: "Unused", direction: "input", signalDirection: "input", displaySide: "left", x: 0, y: 420 });
  project.connections.push({ id: "parallel", cableType: "hdmi", from: { deviceId: "source", connectorId: "port-2" },
    to: { deviceId: "sink", connectorId: "port-2" } });
  await page.evaluate(data => { restoreSnapshot(data); zoomToFit(); }, project);

  const canvasPoint = async (kind, id, connectorId = "") => page.evaluate(({ kind, id, connectorId }) => {
    const bridge = activeEngineBridge(), scene = bridge.scene;
    let point;
    if (kind === "wire") {
      const route = scene.wireRenderPolyline(scene.getWire(id));
      const before = route[Math.max(0, Math.floor((route.length - 1) / 2))];
      const after = route[Math.min(route.length - 1, Math.ceil((route.length - 1) / 2))];
      point = { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 };
    } else {
      const device = [...scene.devices.values()].find(item => item.sourceId === id || item.id === id);
      const connector = scene.getConnector(device.id, connectorId);
      point = scene.connectorWorldPoint(device, connector);
    }
    const screen = bridge.worldToScreenPoint(point), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  }, { kind, id, connectorId });

  const direct = await canvasPoint("wire", "cable-0");
  const beforeOpen = await page.evaluate(() => ({ history: activeEngineBridge().commandHistory.length,
    numbers: state.connections.map(wire => wire.cableNumber || "") }));
  await page.mouse.click(direct.x, direct.y, { button: "right" });
  await page.locator('[data-wire-menu="signal-chain"]').click();
  await page.locator("#signalChainDialog[open]").waitFor();
  assert.match(await page.locator("#signalChainBody").innerText(), /E2 Gen2/);
  assert.match(await page.locator("#signalChainBody").innerText(), /PT-RQ25K/);
  assert.match(await page.locator("#signalChainBody").innerText(), /20 m/);
  assert.match(await page.locator("#signalChainBody").innerText(), /FOH-1/);
  assert.match(await page.locator("#signalChainTitle").innerText(), /V-001/);
  await page.waitForFunction(() => [...document.querySelectorAll("#signalChainBody img")].every(image => image.complete && image.naturalWidth > 0));
  assert.equal(await page.locator("#signalChainBody .signal-chain-device img").count(), 2);
  assert.deepEqual(await page.evaluate(() => ({ history: activeEngineBridge().commandHistory.length,
    numbers: state.connections.map(wire => wire.cableNumber || "") })), beforeOpen);
  await page.screenshot({ path: join(screenshots, "signal-chain-direct.png") });
  checks.push("cable right-click opens illustrated direct chain with ID, image, ports, length and Loom");

  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#signalChainDialog").evaluate(dialog => dialog.open), false);
  await page.mouse.click(direct.x, direct.y);
  await page.locator("#wireSignalChain").click();
  assert.equal(await page.locator("#signalChainDialog").evaluate(dialog => dialog.open), true);
  checks.push("Escape closes; Wire Inspector opens the same chain");

  const before = await page.locator("#signalChainBody").getAttribute("data-render-count");
  await page.evaluate(() => { activeEngineBridge().camera.zoom *= 1.04; activeEngineBridge().scheduleRender(); });
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#signalChainBody").getAttribute("data-render-count"), before);
  await page.evaluate(() => activeEngineBridge().commitWireInspectorFields("cable-0", { length: "33 m" }));
  await page.waitForFunction(() => document.querySelector("#signalChainBody")?.textContent.includes("33 m"));
  await page.evaluate(() => activeEngineBridge().commitConnectorInspectorFields("source", "port-0", { nameText: "Program Out" }));
  await page.waitForFunction(() => document.querySelector("#signalChainBody")?.textContent.includes("Program Out"));
  await page.evaluate(() => commitCanvasDeviceInspectorName(instanceById("source"), "Renamed Source"));
  await page.waitForFunction(() => document.querySelector("#signalChainBody")?.textContent.includes("Renamed Source"));
  checks.push("camera change does not rebuild; Engine length, connector rename and device rename commits update the open chain");
  await page.locator("#closeSignalChain").click();

  const connector = await canvasPoint("connector", "source", "port-0");
  await page.evaluate(() => { state.selected = { type: "connector", deviceId: "source", connectorId: "port-0" }; renderInspector(); });
  await page.locator("#connectorSignalChain").click();
  assert.match(await page.locator("#signalChainTitle").innerText(), /V-001/);
  await page.locator("#closeSignalChain").click();
  await page.mouse.click(connector.x, connector.y, { button: "right" });
  await page.locator('[data-connector-menu="signal-chain"]').click();
  assert.equal(await page.locator("#signalChainDialog").evaluate(dialog => dialog.open), true);
  await page.locator("#closeSignalChain").click();
  checks.push("connected Connector Inspector and connector context menu open chain");

  const unused = await canvasPoint("connector", "sink", "unused");
  await page.mouse.click(unused.x, unused.y, { button: "right" });
  assert.equal(await page.locator('[data-connector-menu="signal-chain"]').count(), 0);
  checks.push("unconnected connector has no misleading action");

  await page.evaluate(() => { state.selected = { type: "connector", deviceId: "source", connectorId: "port-2" }; renderInspector(); });
  await page.locator("#connectorSignalChain").click();
  assert.equal(await page.locator("[data-signal-chain-choice]").count(), 2);
  await page.locator("[data-signal-chain-choice]").last().click();
  assert.equal(await page.locator(".signal-chain-graph").count(), 1);
  await page.locator("#closeSignalChain").click();
  const multiConnector = await canvasPoint("connector", "source", "port-2");
  await page.mouse.click(multiConnector.x, multiConnector.y, { button: "right" });
  await page.locator('[data-connector-menu="signal-chain"]').click();
  assert.equal(await page.locator("[data-signal-chain-choice]").count(), 2);
  await page.locator("#closeSignalChain").click();
  checks.push("multi-connected connector offers an explicit logical-cable choice");

  for (const wireId of ["wire-a", "wire-b"]) {
    const point = await canvasPoint("wire", wireId);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.locator('[data-wire-menu="signal-chain"]').click();
    assert.deepEqual((await page.locator(".signal-chain-graph").getAttribute("data-signal-chain-wire-ids")).split(",").sort(), ["wire-a", "wire-b"]);
    assert.match(await page.locator("#signalChainBody").innerText(), /Jump source/);
    assert.match(await page.locator("#signalChainBody").innerText(), /Jump destination/);
    assert.doesNotMatch(await page.locator("#signalChainBody").innerText(), /Jump A|Jump B/);
    if (wireId === "wire-a") await page.screenshot({ path: join(screenshots, "signal-chain-jump.png") });
    await page.locator("#closeSignalChain").click();
  }
  checks.push("either Jump physical leg opens the same real end-to-end cable");
  await page.evaluate(() => { state.selected = { type: "wire", id: "cable-0" }; renderInspector(); });
  await page.locator("#wireSignalChain").click();
  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectWireOnly("cable-0"); bridge.deleteSelectedWires(); });
  await page.waitForFunction(() => !document.querySelector("#signalChainDialog").open);
  checks.push("deleting viewed cable closes the chain cleanly");
  await page.evaluate(() => setDarkMode(false));
  await page.evaluate(() => { state.selected = { type: "wire", id: "cable-1" }; renderInspector(); });
  await page.locator("#wireSignalChain").click();
  await page.screenshot({ path: join(screenshots, "signal-chain-light.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator("#signalChainDialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.screenshot({ path: join(screenshots, "signal-chain-mobile.png") });
  checks.push("light theme and narrow viewport keep the dialog visible");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: checks.length, fail: 0, checks, screenshots }, null, 2));
} finally {
  await browser.close();
}
