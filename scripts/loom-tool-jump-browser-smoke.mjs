import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);

  await page.locator("#createCableLoom").click();
  let tool = await page.evaluate(() => ({
    active: document.querySelector("#createCableLoom").classList.contains("active"),
    pressed: document.querySelector("#createCableLoom").getAttribute("aria-pressed"),
    cursor: activeEngineBridge().canvas.style.cursor
  }));
  assert.deepEqual(tool, { active: true, pressed: "true", cursor: "crosshair" });
  await page.keyboard.press("Escape");
  tool = await page.evaluate(() => ({
    active: document.querySelector("#createCableLoom").classList.contains("active"),
    pressed: document.querySelector("#createCableLoom").getAttribute("aria-pressed"),
    cursor: activeEngineBridge().canvas.style.cursor,
    preview: activeEngineBridge().loomCreate
  }));
  assert.equal(tool.active, false);
  assert.equal(tool.pressed, "false");
  assert.notEqual(tool.cursor, "crosshair");
  assert.equal(tool.preview, null);

  await page.locator("#createCableLoom").click();
  await page.locator("#jumpNodeTool").click();
  tool = await page.evaluate(() => ({
    loomActive: document.querySelector("#createCableLoom").classList.contains("active"),
    loomPressed: document.querySelector("#createCableLoom").getAttribute("aria-pressed"),
    jumpActive: document.querySelector("#jumpNodeTool").classList.contains("active")
  }));
  assert.deepEqual(tool, { loomActive: false, loomPressed: "false", jumpActive: true });
  await page.keyboard.press("Escape");

  const fixture = jumpHoldFixture();
  fixture.objectSnapping = true;
  fixture.jumpNodes = [];
  fixture.jumpLinks = [];
  fixture.connections = [];
  fixture.devices = fixture.devices.slice(0, 2);
  fixture.devices[0].x = 40; fixture.devices[0].y = 80;
  fixture.devices[1].x = 760; fixture.devices[1].y = 250;
  fixture.looms = [];
  await page.evaluate(project => restoreSnapshot(project), fixture);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.devices.length === 2);

  const creation = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const source = bridge.scene.getDevice("source");
    const connector = source.connectors[0];
    const connectorPoint = bridge.scene.connectorWorldPoint(source, connector);
    bridge.toggleLoomCreation();
    const firstRaw = { x: connectorPoint.x + 16, y: connectorPoint.y + 4 };
    bridge.updateLoomCreationPointer(firstRaw);
    const first = { ...bridge.loomCreate.pointerWorld };
    bridge.handleLoomCreationClick(firstRaw, 1);
    const middle = { x: first.x + 100, y: first.y + 60 };
    bridge.updateLoomCreationPointer(middle);
    bridge.handleLoomCreationClick(middle, 1);
    const destination = bridge.scene.getDevice("destination");
    const destinationConnector = destination.connectors[0];
    const destinationPoint = bridge.scene.connectorWorldPoint(destination, destinationConnector);
    const secondRaw = { x: destinationPoint.x + 16, y: destinationPoint.y + 9 };
    bridge.updateLoomCreationPointer(secondRaw);
    bridge.handleLoomCreationClick(bridge.loomCreate.pointerWorld, 1);
    bridge.updateLoomCreationPointer(secondRaw, { endpoint: true });
    const second = { ...bridge.loomCreate.pointerWorld };
    bridge.completeLoomCreation(secondRaw);
    const created = bridge.scene.looms.at(-1);
    return {
      first, connectorPoint, second,
      loom: created,
      pressed: document.querySelector("#createCableLoom").getAttribute("aria-pressed"),
      active: document.querySelector("#createCableLoom").classList.contains("active")
    };
  });
  assert.equal(creation.first.y, creation.connectorPoint.y, "Side A uses the frozen connector alignment target");
  assert.equal(creation.loom.routePoints.length, 1, "one single-click waypoint is retained");
  assert.deepEqual(creation.loom.sideB && { x: creation.loom.sideB.x, y: creation.loom.sideB.y }, creation.second);
  assert.equal(creation.active, false, "successful create deactivates the tool");
  assert.equal(creation.pressed, "false");

  const wireProject = jumpHoldFixture();
  wireProject.devices = wireProject.devices.slice(0, 2);
  const spareDestination = structuredClone(wireProject.devices[1]);
  spareDestination.instanceId = "destination-free";
  spareDestination.templateOverride.id = "destination-free-template";
  spareDestination.x = 1320;
  wireProject.devices.push(spareDestination);
  const manualSource = structuredClone(wireProject.devices[0]);
  manualSource.instanceId = "source-manual";
  manualSource.templateOverride.id = "source-manual-template";
  manualSource.x = 40; manualSource.y = 460;
  wireProject.devices.push(manualSource);
  wireProject.connections = [];
  wireProject.jumpNodes = [
    { id: "free-output", x: 1020, y: 220, label: "Free Output" },
    { id: "free-input", x: 1020, y: 600, label: "Free Input" },
    { id: "free-manual", x: 1020, y: 460, label: "Free Manual" }
  ];
  wireProject.jumpLinks = [];
  wireProject.wireMode = "orthogonal";
  wireProject.looms = [
    { id: "loom-output", name: "LM-OUT", sideA: { x: 380, y: 220 }, sideB: { x: 690, y: 220 }, routeStyle: "orthogonal", routePoints: [] },
    { id: "loom-input", name: "LM-IN", sideA: { x: 380, y: 600 }, sideB: { x: 690, y: 600 }, routeStyle: "orthogonal", routePoints: [] },
    { id: "loom-manual", name: "LM-MANUAL", sideA: { x: 380, y: 460 }, sideB: { x: 690, y: 460 }, routeStyle: "orthogonal", routePoints: [] }
  ];
  await page.evaluate(project => restoreSnapshot(project), wireProject);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.looms.length === 3);
  const wireResults = await page.evaluate(async () => {
    const bridge = activeEngineBridge();
    const hit = (deviceId, connectorId) => {
      const device = bridge.scene.getDevice(deviceId);
      const connector = device.connectors.find(item => item.id === connectorId);
      return { device, connector, point: bridge.scene.connectorWorldPoint(device, connector), anchorId: connector.id };
    };
    const jumpHit = id => {
      const device = bridge.scene.getDevice(id);
      const connector = device.connectors[0];
      return { device, connector, point: bridge.scene.connectorWorldPoint(device, connector), anchorId: connector.id };
    };
    const routeThrough = (source, loomId, target, { manual = false, tailPoint = null } = {}) => {
      bridge.beginWireCreate(source, source.point);
      if (manual) {
        bridge.wireCreate.manual = true;
      }
      const plan = bridge.scene.loomPlans.find(item => item.loomId === loomId);
      bridge.enterWireLoomGateway({ loomId, part: "sideA", point: plan.headA });
      if (manual && tailPoint) bridge.wireCreate.routePoints = [tailPoint];
      bridge.wireCreate.target = target;
      bridge.wireCreate.pointerWorld = target.point;
      bridge.completeWireCreate();
      return bridge.scene.wires.at(-1);
    };
    const outputSource = hit("source", "port");
    const outputWire = routeThrough(outputSource, "loom-output", jumpHit("free-output"));
    const inputSource = hit("destination", "port");
    const inputWire = routeThrough(inputSource, "loom-input", jumpHit("free-input"));
    const manualPoint = { x: 820, y: 500 };
    const manualWire = routeThrough(hit("source-manual", "port"), "loom-manual", jumpHit("free-manual"), {
      manual: true, tailPoint: manualPoint
    });
    const beforeRewire = { loomId: outputWire.loomId, entrySide: outputWire.loomEntrySide,
      exitRoute: structuredClone(outputWire.loomExitRoutePoints), wireId: outputWire.id };
    const endpoint = bridge.scene.wireEndpointAtConnector(outputWire.toDeviceId, outputWire.toConnectorId);
    const detached = jumpHit("free-output");
    const rewireStart = bridge.beginWireRewire(detached, endpoint, detached.point);
    bridge.wireCreate.target = hit("destination-free", "port");
    const firstRewireCompatibility = bridge.currentWireCompatibility();
    const firstRewireRejection = bridge.wireRewireRejectionReason(bridge.wireCreate.target, firstRewireCompatibility);
    bridge.completeWireRewire();
    const rewiredToDevice = bridge.scene.getWire(outputWire.id);
    const afterFirstRewireTarget = rewiredToDevice.toDeviceId;
    const destinationEndpoint = bridge.scene.wireEndpointAtConnector("destination-free", "port");
    const destinationHit = hit("destination-free", "port");
    const reverseRewireStart = bridge.beginWireRewire(destinationHit, destinationEndpoint, destinationHit.point);
    bridge.wireCreate.target = jumpHit("free-output");
    const secondRewireCompatibility = bridge.currentWireCompatibility();
    const secondRewireRejection = bridge.wireRewireRejectionReason(bridge.wireCreate.target, secondRewireCompatibility);
    bridge.completeWireRewire();
    const rewiredBack = bridge.scene.getWire(outputWire.id);
    bridge.undoEngineCommand();
    const undoTarget = bridge.scene.getWire(outputWire.id)?.toDeviceId;
    bridge.redoEngineCommand();
    const savedOutputRoute = structuredClone(bridge.scene.getWire(outputWire.id)?.loomExitRoutePoints || []);
    const serialized = bridge.mutations.exportJson({ pretty: false });
    await restoreSnapshot(JSON.parse(serialized));
    const reloadedOutput = activeEngineBridge().scene.getWire(outputWire.id);
    const reloadedInput = activeEngineBridge().scene.getWire(inputWire.id);
    const refreshedOutput = bridge.scene.loomPlans.find(item => item.loomId === "loom-output");
    const outputBreakout = refreshedOutput.breakouts.find(item => item.wireId === outputWire.id && item.gatewayAtStart);
    return {
      output: { id: outputWire.id, loomId: outputWire.loomId, entrySide: outputWire.loomEntrySide,
        source: outputWire.fromDeviceId, target: outputWire.toDeviceId,
        tailPoints: outputBreakout?.points, tailRoute: outputWire.loomExitRoutePoints },
      input: { id: inputWire.id, loomId: inputWire.loomId, entrySide: inputWire.loomEntrySide,
        source: inputWire.fromDeviceId, target: inputWire.toDeviceId,
        entryRoute: inputWire.loomEntryRoutePoints, exitRoute: inputWire.loomExitRoutePoints },
      manual: { id: manualWire.id, loomId: manualWire.loomId, target: manualWire.toDeviceId,
        routeStyle: manualWire.routeStyle, manualRoute: manualWire.manualRoute,
        exitRoute: manualWire.loomExitRoutePoints },
      rewire: { beforeRewire, toDevice: { loomId: rewiredToDevice.loomId, id: rewiredToDevice.id },
        back: { loomId: rewiredBack.loomId, target: rewiredBack.toDeviceId }, undoTarget,
        rewireStart, reverseRewireStart, afterFirstRewireTarget, firstRewireRejection,
        secondRewireRejection,
        reloadedOutput: reloadedOutput && { id: reloadedOutput.id, loomId: reloadedOutput.loomId,
          entrySide: reloadedOutput.loomEntrySide, target: reloadedOutput.toDeviceId,
          exitRoute: reloadedOutput.loomExitRoutePoints, savedExitRoute: savedOutputRoute },
        reloadedInput: reloadedInput && { id: reloadedInput.id, loomId: reloadedInput.loomId,
          entrySide: reloadedInput.loomEntrySide, source: reloadedInput.fromDeviceId,
          target: reloadedInput.toDeviceId, entryRoute: reloadedInput.loomEntryRoutePoints,
          exitRoute: reloadedInput.loomExitRoutePoints } },
      wireCount: bridge.scene.wires.length
    };
  });
  assert.equal(wireResults.output.loomId, "loom-output", "output cable remains a member of its Loom");
  assert.equal(wireResults.output.target, "free-output", "Loom tail terminates at the actual Jump Node");
  assert.equal(wireResults.output.tailPoints.at(-1).x, 1020, "committed breakout reaches the Jump center");
  assert.equal(wireResults.input.loomId, "loom-input");
  assert.equal(wireResults.input.source, "free-input", "input-side Jump canonicalization reverses endpoint order");
  assert.equal(wireResults.input.target, "destination");
  assert.equal(wireResults.input.entrySide, "sideB", "canonical reversal swaps the Loom gateway orientation");
  assert.equal(wireResults.manual.loomId, "loom-manual");
  assert.equal(wireResults.manual.target, "free-manual");
  assert.equal(wireResults.manual.routeStyle, "orthogonal");
  assert.equal(wireResults.manual.manualRoute, true);
  assert.deepEqual(wireResults.manual.exitRoute, [{ x: 820, y: 500 }], "manual tail waypoints stay on the Loom exit path");
  assert.equal(wireResults.rewire.toDevice.loomId, "loom-output", "rewiring the tail keeps Loom membership");
  assert.equal(wireResults.rewire.back.loomId, "loom-output", "rewiring back to Jump keeps Loom membership");
  assert.equal(wireResults.rewire.back.target, "free-output");
  assert.equal(wireResults.wireCount, 3, "Auto and Manual Loom-to-Jump tails each remain one wire per member");
  assert.equal(wireResults.rewire.undoTarget, "destination-free", "undo restores the previous ordinary target");
  assert.equal(wireResults.rewire.reloadedOutput.loomId, "loom-output", "saved output-side Loom membership reloads");
  assert.equal(wireResults.rewire.reloadedOutput.target, "free-output");
  assert.equal(wireResults.rewire.reloadedOutput.entrySide, "sideA");
  assert.deepEqual(wireResults.rewire.reloadedOutput.exitRoute, wireResults.rewire.reloadedOutput.savedExitRoute);
  assert.equal(wireResults.rewire.reloadedInput.source, "free-input", "canonical input-side Jump orientation reloads");
  assert.equal(wireResults.rewire.reloadedInput.entrySide, "sideB");

  await page.screenshot({ path: "/tmp/loom-tool-jump-browser-smoke.png", fullPage: false });
  assert.deepEqual(errors, [], "browser has no page or console errors");
  console.log("Loom tool lifecycle, mutual exclusion, connector snapping, waypoint creation and clean completion PASS");
} finally {
  await page.close();
  await browser.close();
}
