import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-jump-attachment-"));
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  const fixture = jumpHoldFixture();
  fixture.jumpNodes.push({ id: "a2", x: 350, y: 300, label: "A2" });
  fixture.jumpNodes.push({ id: "a3", x: 380, y: 340, label: "A3" }, { id: "a4", x: 410, y: 380, label: "A4" });
  fixture.connections.push({ id: "wire-a2", cableType: "hdmi", from: { deviceId: "source", connectorId: "port" }, to: { jumpNodeId: "a2" } });
  fixture.devices.find(device => device.instanceId === "source").templateOverride.connectors.push(
    { id: "port2", label: "HDMI 2", type: "hdmi", direction: "output", displaySide: "right", x: 220, y: 100 },
    { id: "port3", label: "HDMI 3", type: "hdmi", direction: "output", displaySide: "right", x: 220, y: 180 }
  );
  fixture.devices.find(device => device.instanceId === "destination").templateOverride.connectors.push(
    { id: "port2", label: "HDMI 2", type: "hdmi", direction: "output", displaySide: "right", x: 220, y: 100 }
  );
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.evaluate(snapshot => restoreSnapshot(snapshot), fixture);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.getDevice("a2"));

  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectOnly("a3"); bridge.updateSelectionHud(); });
  assert.equal(await page.locator("#jumpAttachToDevice").count(), 0);
  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectMany(["a3", "a4"]); bridge.updateSelectionHud(); });
  assert.equal(await page.locator("#multiJumpAttach").isDisabled(), true);

  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectOnly("a"); bridge.updateSelectionHud(); });
  assert.equal(await page.locator("#jumpAttachToDevice").isChecked(), false);
  await page.locator("#jumpAttachToDevice").check();
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a").attachedDeviceId), "source");
  assert.equal(await page.locator("#jumpAttachToDevice").isChecked(), true);
  await page.screenshot({ path: join(screenshots, "jump-inspector-dark.png") });
  await page.evaluate(() => setDarkMode(false));
  await page.screenshot({ path: join(screenshots, "jump-inspector-light.png") });
  await page.evaluate(() => setDarkMode(true));

  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectOnly("source"); bridge.updateSelectionHud(); });
  assert.equal(await page.locator("#deviceAutoAttachJumpNodes").isChecked(), false);
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.beginDrag({ x: 0, y: 0 }, ["source"]);
    bridge.dragSession.update({ x: 100, y: 40 }, { snappingEnabled: false });
    bridge.scheduleRender();
  });
  await page.waitForTimeout(100);
  const preview = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    return { moved: [...bridge.dragSession.selectedIds], selected: [...bridge.scene.selectedIds],
      aOffset: bridge.dragSession.offsetMap().get("a"), a2Offset: bridge.dragSession.offsetMap().get("a2") };
  });
  assert.ok(preview.moved.includes("a"));
  assert.ok(!preview.moved.includes("a2"));
  assert.deepEqual(preview.selected, ["source"]);
  assert.equal(preview.aOffset.dx, 100);
  assert.equal(preview.a2Offset, undefined);
  await page.screenshot({ path: join(screenshots, "attached-drag-preview.png") });
  await page.evaluate(() => activeEngineBridge().completeDrag());
  const moved = await page.evaluate(() => ({
    source: state.devices.find(d => d.instanceId === "source").x,
    a: state.jumpNodes.find(n => n.id === "a").x,
    a2: state.jumpNodes.find(n => n.id === "a2").x
  }));
  assert.equal(moved.source, 140);
  assert.equal(moved.a, 440);
  assert.equal(moved.a2, 350);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a").x), 340);
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a").x), 440);

  await page.locator(".jump-auto-attach-row .feature-toggle").click();
  assert.equal(await page.locator("#deviceAutoAttachJumpNodes").isChecked(), true);
  await page.screenshot({ path: join(screenshots, "device-auto-attach-pill.png") });
  assert.deepEqual(await page.evaluate(() => state.jumpNodes.filter(n => ["a", "a2"].includes(n.id)).map(n => n.attachedDeviceId)), ["source", "source"]);
  const connectJump = id => page.evaluate(jumpId => {
    const bridge = activeEngineBridge();
    const source = bridge.scene.getDevice("source");
    const jump = bridge.scene.getDevice(jumpId);
    const connector = source.connectors.find(c => c.id === (jumpId === "a3" ? "port2" : "port3"));
    bridge.wireCreate = {
      from: { device: source, connector, point: bridge.scene.connectorWorldPoint(source, connector) },
      target: { device: jump, connector: jump.connectors[0], point: bridge.scene.connectorWorldPoint(jump, jump.connectors[0]) }
    };
    const compatibility = bridge.currentWireCompatibility();
    bridge.completeWireCreate();
    return { attached: state.jumpNodes.find(n => n.id === jumpId).attachedDeviceId || "", compatibility,
      wires: state.connections.filter(w => w.from?.jumpNodeId === jumpId || w.to?.jumpNodeId === jumpId).length };
  }, id);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a2").attachedDeviceId || ""), "");
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  const a3Connection = await connectJump("a3");
  assert.equal(a3Connection.attached, "source", JSON.stringify(a3Connection));
  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectOnly("source"); bridge.updateSelectionHud(); });
  await page.locator(".jump-auto-attach-row .feature-toggle").click();
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a2").attachedDeviceId), "source");
  assert.equal((await connectJump("a4")).attached, "");
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const wire = state.connections.find(w => w.from?.jumpNodeId === "a3" || w.to?.jumpNodeId === "a3");
    bridge.scene.selectWireOnly(wire.id);
    bridge.deleteSelectedWires();
  });
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a3").attachedDeviceId || ""), "");
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a3").attachedDeviceId), "source");

  const manual = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const before = state.jumpNodes.find(n => n.id === "a").x;
    bridge.beginDrag({ x: 0, y: 0 }, ["a"]);
    bridge.dragSession.update({ x: 30, y: 10 }, { snappingEnabled: false });
    bridge.completeDrag();
    return { before, after: state.jumpNodes.find(n => n.id === "a").x,
      attachment: state.jumpNodes.find(n => n.id === "a").attachedDeviceId };
  });
  assert.equal(manual.after, manual.before + 30);
  assert.equal(manual.attachment, "source");

  const pointerBefore = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const source = bridge.scene.getDevice("source");
    const point = bridge.worldToScreenPoint({ x: source.x + 45, y: source.y + 35 });
    const rect = bridge.canvas.getBoundingClientRect();
    const wire = bridge.scene.getWire("wire-a");
    return { x: rect.left + point.x, y: rect.top + point.y,
      deviceX: source.x, jumpX: bridge.scene.getDevice("a").x,
      fromX: bridge.scene.endpointForWire(wire, "from").x,
      toX: bridge.scene.endpointForWire(wire, "to").x };
  });
  await page.mouse.move(pointerBefore.x, pointerBefore.y);
  await page.mouse.down();
  await page.mouse.move(pointerBefore.x + 45, pointerBefore.y + 15, { steps: 5 });
  await page.mouse.up();
  const pointerAfter = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const wire = bridge.scene.getWire("wire-a");
    return { deviceX: bridge.scene.getDevice("source").x, jumpX: bridge.scene.getDevice("a").x,
      fromX: bridge.scene.endpointForWire(wire, "from").x,
      toX: bridge.scene.endpointForWire(wire, "to").x };
  });
  assert.ok(pointerAfter.deviceX > pointerBefore.deviceX);
  assert.equal(pointerAfter.jumpX - pointerBefore.jumpX, pointerAfter.deviceX - pointerBefore.deviceX);
  assert.equal(pointerAfter.fromX - pointerBefore.fromX, pointerAfter.deviceX - pointerBefore.deviceX);
  assert.equal(pointerAfter.toX - pointerBefore.toX, pointerAfter.deviceX - pointerBefore.deviceX);

  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectOnly("a2"); bridge.updateSelectionHud(); });
  await page.locator("#jumpAttachToDevice").uncheck();
  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectMany(["a", "a2"]); bridge.updateSelectionHud(); });
  assert.equal(await page.locator("#multiJumpAttach").evaluate(input => input.indeterminate), true);
  await page.locator("#multiJumpAttach").check();
  assert.equal(await page.locator("#multiJumpAttach").isChecked(), true);
  const saved = await page.evaluate(async () => JSON.parse(await projectJsonPayload()));
  assert.equal(saved.jumpNodes.find(n => n.id === "a").attachedDeviceId, "source");
  assert.equal(saved.devices.find(d => d.instanceId === "source").autoAttachJumpNodes, false);
  await page.evaluate(snapshot => restoreSnapshot(snapshot), saved);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  assert.deepEqual(await page.evaluate(() => state.jumpNodes.filter(n => ["a", "a2"].includes(n.id)).map(n => n.attachedDeviceId)), ["source", "source"]);
  assert.equal(await page.evaluate(() => Boolean(state.devices.find(d => d.instanceId === "source").autoAttachJumpNodes)), false);

  const rewireA3 = () => page.evaluate(() => {
    const bridge = activeEngineBridge();
    const raw = state.connections.find(w => w.from?.jumpNodeId === "a3" || w.to?.jumpNodeId === "a3");
    const wire = bridge.scene.getWire(raw.id);
    const source = bridge.scene.getDevice("source");
    const oldConnector = source.connectors.find(c => c.id === "port2");
    const detachedHit = { device: source, connector: oldConnector, point: bridge.scene.connectorWorldPoint(source, oldConnector) };
    const destination = bridge.scene.getDevice("destination");
    const connector = destination.connectors.find(c => c.id === "port2");
    if (!bridge.beginWireRewire(detachedHit, { wire, end: "from", otherEnd: "to" }, detachedHit.point)) return "start failed";
    bridge.wireCreate.target = { device: destination, connector, point: bridge.scene.connectorWorldPoint(destination, connector) };
    const compatibility = bridge.currentWireCompatibility();
    bridge.completeWireRewire();
    return { attached: state.jumpNodes.find(n => n.id === "a3").attachedDeviceId || "", compatibility };
  });
  const rewireOff = await rewireA3();
  assert.equal(rewireOff.attached, "", JSON.stringify(rewireOff));
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a3").attachedDeviceId), "source");
  await page.evaluate(() => activeEngineBridge().commitDeviceAutoAttach("destination", true));
  const rewireOn = await rewireA3();
  assert.equal(rewireOn.attached, "destination", JSON.stringify(rewireOn));
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a3").attachedDeviceId), "source");

  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectMany(["a", "a2"]); bridge.updateSelectionHud(); });
  assert.equal(await page.locator("#multiJumpAttach").isChecked(), true);
  await page.locator("#multiJumpAttach").uncheck();
  assert.deepEqual(await page.evaluate(() => state.jumpNodes.filter(n => ["a", "a2"].includes(n.id)).map(n => n.attachedDeviceId || "")), ["", ""]);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.deepEqual(await page.evaluate(() => state.jumpNodes.filter(n => ["a", "a2"].includes(n.id)).map(n => n.attachedDeviceId)), ["source", "source"]);
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  assert.deepEqual(await page.evaluate(() => state.jumpNodes.filter(n => ["a", "a2"].includes(n.id)).map(n => n.attachedDeviceId || "")), ["", ""]);
  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectOnly("source"); bridge.deleteSelectedDevices(["source"]); });
  assert.equal(await page.evaluate(() => state.devices.some(d => d.instanceId === "source")), false);
  assert.equal(await page.evaluate(() => state.jumpNodes.some(n => n.id === "a")), true);
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a3").attachedDeviceId || ""), "");
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await page.evaluate(() => state.devices.some(d => d.instanceId === "source")), true);
  assert.equal(await page.evaluate(() => state.jumpNodes.find(n => n.id === "a3").attachedDeviceId), "source");
  assert.deepEqual(errors, []);
  console.log(`Jump attachment browser smoke passed; screenshot: ${screenshots}/attached-drag-preview.png`);
} finally {
  await browser.close();
}
