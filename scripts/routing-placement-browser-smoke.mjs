import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { loomBundleWidths, loomCoreColors } from "../src/engine/routingPlacement.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-routing-placement-"));
const errors = [];
function projectWithLoom(types) {
  const snapshot = structuredClone(cableTypeSelectionFixture());
  const loomId = "loom-core-browser";
  for (const [deviceIndex, device] of snapshot.devices.entries()) {
    const template = structuredClone(device.templateOverride);
    template.height = 150 + types.length * 28;
    template.connectors = types.map((type, index) => ({ id: `core-port-${index}`, type,
      physicalType: type, connectorType: type, label: type.toUpperCase(),
      direction: deviceIndex ? "input" : "output", signalDirection: deviceIndex ? "input" : "output",
      displaySide: deviceIndex ? "left" : "right", x: deviceIndex ? 0 : template.width,
      y: 96 + index * 28 }));
    device.templateOverride = template;
  }
  snapshot.connections = types.map((cableType, index) => ({ id: `progressive-cable-${index + 1}`,
    cableType, loomId, from: { deviceId: "source", connectorId: `core-port-${index}` },
    to: { deviceId: "sink", connectorId: `core-port-${index}` } }));
  snapshot.looms = [{ id: loomId, name: "LM-Core-Test", kind: "loom",
    sideA: { label: "Side A", x: 500, y: 300 }, sideB: { label: "Side B", x: 760, y: 300 },
    routeStyle: "bezier", routePoints: [], trunkLength: "", notes: "" }];
  return snapshot;
}
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  const project = cableTypeSelectionFixture();
  project.connections = [];
  project.devices[0].x = 80;
  project.devices[1].x = 900;
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8769"}/index.html`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.evaluate(snapshot => restoreSnapshot(snapshot), project);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.getDevice("sink"));
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 0.8;
    bridge.scheduleRender();
  });
  const screen = world => page.evaluate(point => {
    const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.top + (point.y - bridge.camera.y) * bridge.camera.zoom };
  }, world);
  const connector = (deviceId, id) => page.evaluate(({ deviceId, id }) => {
    const scene = activeEngineBridge().scene;
    return scene.connectorWorldPoint(scene.getDevice(deviceId), scene.getConnector(deviceId, id));
  }, { deviceId, id });
  const clickWorld = async world => {
    const point = await screen(world);
    await page.mouse.click(point.x, point.y);
  };

  await page.locator("#wirePlacementSelect").selectOption("manual");
  assert.equal(await page.evaluate(() => state.wirePlacement), "manual");
  await clickWorld(await connector("source", "port-0"));
  await page.mouse.move(...Object.values(await screen({ x: 440, y: 330 })));
  assert.equal(await page.evaluate(() => activeEngineBridge().interactionRenderState().tempWire.opacity), 0.5);
  await clickWorld({ x: 440, y: 330 });
  await clickWorld({ x: 720, y: 330 });
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate.routePoints.length), 2);
  await clickWorld(await connector("sink", "port-0"));
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.length), 1);
  const first = await page.evaluate(() => ({ root: JSON.parse(JSON.stringify(activeEngineBridge().mutations.root.connections[0])),
    wire: JSON.parse(JSON.stringify(activeEngineBridge().scene.wires[0])), events: window.__routeDebug }));
  assert.equal(first.root.manualRoute, true);
  assert.equal(first.root.manualRouteStyle, "bezier");
  assert.equal(first.root.routePoints.length, 2);

  await page.locator("#wireModeToggle").click();
  assert.equal(await page.evaluate(() => state.wireMode), "orthogonal");
  await clickWorld(await connector("source", "port-1"));
  await clickWorld({ x: 450, y: 410 });
  await clickWorld({ x: 740, y: 410 });
  await page.keyboard.press("Backspace");
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate.routePoints.length), 1);
  await clickWorld(await connector("sink", "port-1"));
  const second = await page.evaluate(() => JSON.parse(JSON.stringify(activeEngineBridge().mutations.root.connections[1])));
  assert.equal(second.manualRouteStyle, "orthogonal");
  assert.equal(second.routePoints.length, 1);
  await clickWorld(await connector("source", "port-2"));
  await clickWorld({ x: 480, y: 500 });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate), null);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.length), 2);

  await page.locator("#createCableLoom").click();
  await clickWorld({ x: 330, y: 540 });
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => activeEngineBridge().mutations.root.looms.length), 0);
  assert.equal(await page.evaluate(() => activeEngineBridge().loomCreate), null);
  await page.locator("#createCableLoom").click();
  await clickWorld({ x: 430, y: 600 });
  await clickWorld({ x: 580, y: 650 });
  const end = await screen({ x: 750, y: 600 });
  await page.mouse.dblclick(end.x, end.y, { delay: 80 });
  const drawn = await page.evaluate(() => ({ looms: activeEngineBridge().mutations.root.looms,
    plans: activeEngineBridge().scene.loomPlans }));
  assert.equal(drawn.looms.length, 1);
  assert.equal(drawn.looms[0].routePoints.length, 1, "double-click must not add an extra waypoint");
  assert.equal(drawn.looms[0].routeStyle, "orthogonal");
  await page.screenshot({ path: join(screenshots, "orthogonal-loom.png") });

  await page.locator("#wirePlacementSelect").selectOption("auto");
  assert.equal(await page.evaluate(() => state.wirePlacement), "auto");
  const source = await screen(await connector("source", "port-2"));
  const gateway = await screen({ x: 430, y: 600 });
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(gateway.x, gateway.y, { steps: 8 });
  assert.equal(await page.evaluate(() => activeEngineBridge().interactionRenderState().gatewayHover?.part), "sideA");
  await page.mouse.up();
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate?.loomEntrySide), "sideA");
  assert.deepEqual(await page.evaluate(() => activeEngineBridge().wireCreate?.loomExitPoint),
    { x: 750, y: 600 });
  const destination = await screen(await connector("sink", "port-2"));
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  const cable = await page.evaluate(() => activeEngineBridge().mutations.root.connections.at(-1));
  assert.equal(cable.loomId, drawn.looms[0].id);
  assert.equal(cable.loomEntrySide, "sideA");
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 1);

  const sourceB = await screen(await connector("source", "port-3"));
  const gatewayB = await screen({ x: 750, y: 600 });
  await page.mouse.move(sourceB.x, sourceB.y);
  await page.mouse.down();
  await page.mouse.move(gatewayB.x, gatewayB.y, { steps: 8 });
  assert.equal(await page.evaluate(() => activeEngineBridge().interactionRenderState().gatewayHover?.part), "sideB");
  await page.mouse.up();
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate?.loomEntrySide), "sideB");
  assert.deepEqual(await page.evaluate(() => activeEngineBridge().wireCreate?.loomExitPoint), { x: 430, y: 600 });
  const destinationB = await screen(await connector("sink", "port-3"));
  await page.mouse.move(destinationB.x, destinationB.y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  const cableB = await page.evaluate(() => activeEngineBridge().mutations.root.connections.at(-1));
  assert.equal(cableB.loomEntrySide, "sideB");
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 2);
  await page.evaluate(() => { const b = activeEngineBridge(); b.scene.clearSelection(); b.scheduleRender(); });
  await page.screenshot({ path: join(screenshots, "loom-with-cable.png") });

  const saved = await page.evaluate(async () => JSON.parse(await projectJsonPayload()));

  const runGatewayCreation = async (type, side, screenshot = false, targetType = type) => {
    const gatewayProject = structuredClone(cableTypeSelectionFixture());
    gatewayProject.connections = [];
    for (const [index, device] of gatewayProject.devices.entries()) {
      const template = structuredClone(device.templateOverride);
      template.height = 280;
      const connectorType = index ? targetType : type;
      template.connectors = [{ id: "gateway-port", type: connectorType, physicalType: connectorType, connectorType,
        label: connectorType, direction: index ? "input" : "output", signalDirection: index ? "input" : "output",
        displaySide: index ? "left" : "right", x: index ? 0 : template.width, y: 190 }];
      device.templateOverride = template;
      device.x = index ? 900 : 80;
    }
    gatewayProject.looms = [{ id: "gateway-test-loom", name: "LM-Gateway-Test", kind: "loom",
      sideA: { label: "Side A", x: 480, y: 360 }, sideB: { label: "Side B", x: 720, y: 360 },
      routeStyle: "bezier", routePoints: [], trunkLength: "", notes: "" }];
    await page.evaluate(snapshot => restoreSnapshot(snapshot), gatewayProject);
    await page.waitForFunction(() => activeEngineBridge()?.scene.getDevice("sink")
      && activeEngineBridge().scene.loomPlans[0]?.loomId === "gateway-test-loom");
    await page.locator("#wirePlacementSelect").selectOption("manual");
    await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.camera.x = 0;
      bridge.camera.y = 0; bridge.camera.zoom = 0.8; bridge.scheduleRender(); });
    const from = await connector("source", "gateway-port");
    const to = await connector("sink", "gateway-port");
    await clickWorld(from);
    assert.ok(await page.evaluate(() => activeEngineBridge().wireCreate), `${type}: source should start wire creation`);
    const plan = await page.evaluate(() => activeEngineBridge().scene.loomPlans[0]);
    await clickWorld(plan[side === "sideA" ? "headA" : "headB"]);
    const gatewayState = await page.evaluate(() => ({ loomId: activeEngineBridge().wireCreate?.loomId,
      entrySide: activeEngineBridge().wireCreate?.loomEntrySide }));
    await page.mouse.move(...Object.values(await screen(to)));
    const compatibility = await page.evaluate(() => {
      const bridge = activeEngineBridge(), summary = bridge.currentWireCompatibility();
      const source = bridge.wireCreate?.from?.connector, target = bridge.wireCreate?.target?.connector;
      return { valid: summary.valid, rule: summary.rule, reason: summary.reason,
        source: source && { type: source.type, compatibilityType: source.compatibilityType || "",
          effectiveType: summary.sourceType },
        target: target && { type: target.type, compatibilityType: target.compatibilityType || "",
          effectiveType: summary.targetType }, resolvedCableType: summary.sourceType || summary.targetType };
    });
    await clickWorld(to);
    const wires = await page.evaluate(() => activeEngineBridge().scene.wires.map(wire => ({ id: wire.id,
      loomId: wire.loomId, loomEntrySide: wire.loomEntrySide, cableType: wire.cableType,
      color: wire.customColor || wire.color })));
    assert.equal(wires.length, 1, `${type}: loom traversal creates one logical cable`);
    assert.equal(wires[0].loomId, "gateway-test-loom", `${type}: cable retains loom membership`);
    const result = { type, targetType, side, gatewayState, compatibility, wires };
    if (screenshot) await page.screenshot({ path: join(screenshots, `gateway-${type}-${side}.png`) });
    return result;
  };
  const gatewayReproductions = [];
  for (const type of ["hdmi", "sdi", "speakon-nl4", "display-port"]) {
    for (const side of ["sideA", "sideB"]) {
      gatewayReproductions.push(await runGatewayCreation(type, side,
        type === "speakon-nl4" || type === "display-port"));
    }
  }
  for (const [sourceType, targetType] of [["speakon", "speakon-nl4"], ["displayport", "display-port"]]) {
    for (const side of ["sideA", "sideB"]) {
      const result = await runGatewayCreation(sourceType, side, false, targetType);
      assert.equal(result.compatibility.valid, true,
        `${sourceType}/${targetType}: legacy alias pair must route through ${side}`);
      assert.equal(result.wires[0].loomId, "gateway-test-loom");
      gatewayReproductions.push(result);
    }
  }
  const runGatewayRewire = async (type, side) => {
    const rewireProject = structuredClone(cableTypeSelectionFixture());
    rewireProject.connections = [{ id: "existing-gateway-cable", cableType: type, length: "5m",
      cableLabel: `Existing ${type}`, customColor: "#123456", color: "#123456",
      from: { deviceId: "source", connectorId: "port-0" },
      to: { deviceId: "sink", connectorId: "port-0" } }];
    for (const [index, device] of rewireProject.devices.entries()) {
      const template = structuredClone(device.templateOverride);
      template.height = 280;
      template.connectors = [{ id: "port-0", type, physicalType: type, connectorType: type,
        label: type, direction: index ? "input" : "output", signalDirection: index ? "input" : "output",
        displaySide: index ? "left" : "right", x: index ? 0 : template.width, y: 190 }];
      device.templateOverride = template;
      device.x = index ? 900 : 80;
    }
    rewireProject.looms = [{ id: "rewire-test-loom", name: "LM-Rewire-Test", kind: "loom",
      sideA: { label: "Side A", x: 480, y: 360 }, sideB: { label: "Side B", x: 720, y: 360 },
      routeStyle: "bezier", routePoints: [], trunkLength: "", notes: "" }];
    await page.evaluate(snapshot => restoreSnapshot(snapshot), rewireProject);
    await page.waitForFunction(() => activeEngineBridge()?.scene.getDevice("sink")
      && activeEngineBridge().scene.loomPlans[0]?.loomId === "rewire-test-loom");
    await page.waitForFunction(() => activeEngineBridge()?.scene.wires.length === 1);
    await page.locator("#wirePlacementSelect").selectOption("manual");
    await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.camera.x = 0;
      bridge.camera.y = 0; bridge.camera.zoom = 0.8; bridge.scheduleRender(); });
    const from = await connector("source", "port-0"), to = await connector("sink", "port-0");
    const plan = await page.evaluate(() => activeEngineBridge().scene.loomPlans[0]);
    const start = await screen(to), gateway = await screen(plan[side === "sideA" ? "headA" : "headB"]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(gateway.x, gateway.y, { steps: 8 });
    await page.mouse.up();
    const gatewayState = await page.evaluate(() => ({ loomId: activeEngineBridge().wireCreate?.loomId,
      entrySide: activeEngineBridge().wireCreate?.loomEntrySide }));
    assert.deepEqual(gatewayState, { loomId: "rewire-test-loom", entrySide: side },
      `${type}: dragging the connected cable into ${side} must enter loom traversal`);
    await page.mouse.move(...Object.values(await screen(to)));
    const compatibility = await page.evaluate(() => {
      const bridge = activeEngineBridge(), summary = bridge.currentWireCompatibility();
      return { valid: summary.valid, rule: summary.rule, reason: summary.reason,
        sourceType: summary.sourceType, targetType: summary.targetType };
    });
    await page.mouse.click(...Object.values(await screen(to)));
    const inspect = () => page.evaluate(() => {
        const b = activeEngineBridge(), wire = b.scene.getWire("existing-gateway-cable");
        return wire && { id: wire.id, sourceId: wire.sourceId, fromDeviceId: wire.fromDeviceId,
          fromConnectorId: wire.fromConnectorId, toDeviceId: wire.toDeviceId,
          toConnectorId: wire.toConnectorId, cableType: wire.cableType,
          customColor: wire.customColor, color: wire.color, loomId: wire.loomId,
          loomEntrySide: wire.loomEntrySide,
          root: b.mutations.root.connections.find(item => item.id === wire.id) };
    });
    const committed = await inspect();
    assert.equal(committed.loomId, "rewire-test-loom", `${type}: rewire persists loom membership`);
    assert.equal(committed.loomEntrySide, side);
    assert.equal(committed.id, "existing-gateway-cable");
    assert.equal(committed.cableType, type);
    assert.equal(committed.customColor, "#123456");
    assert.equal(committed.root.loomId, "rewire-test-loom");
    assert.equal(committed.root.cableLabel, `Existing ${type}`);
    assert.equal(committed.root.length, "5m");
    assert.equal(committed.root.from.deviceId, "source");
    assert.equal(committed.root.to.deviceId, "sink");
    assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.length), 1);

    assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true,
      `${type}: loom rewire should be undoable`);
    await page.waitForFunction(() => !activeEngineBridge().scene.getWire("existing-gateway-cable")?.loomId);
    const undone = await inspect();
    assert.equal(undone.root.loomId, undefined);
    assert.equal(undone.root.cableLabel, `Existing ${type}`);
    assert.equal(undone.root.customColor, "#123456");

    assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true,
      `${type}: loom rewire should be redoable`);
    await page.waitForFunction(() => activeEngineBridge().scene.getWire("existing-gateway-cable")?.loomId
      === "rewire-test-loom");
    const redone = await inspect();
    assert.equal(redone.loomEntrySide, side);
    assert.equal(redone.root.loomId, "rewire-test-loom");

    const roundTrip = await page.evaluate(async () => JSON.parse(await projectJsonPayload()));
    await page.evaluate(snapshot => restoreSnapshot(snapshot), roundTrip);
    await page.waitForFunction(() => activeEngineBridge()?.scene.getWire("existing-gateway-cable")?.loomId
      === "rewire-test-loom");
    const reopened = await inspect();
    assert.equal(reopened.loomEntrySide, side);
    assert.equal(reopened.id, "existing-gateway-cable");
    assert.equal(reopened.root.cableLabel, `Existing ${type}`);
    return { type, side, from, gatewayState, compatibility, wire: reopened };
  };
  const rewireReproductions = [];
  for (const type of ["speakon-nl4", "display-port"]) {
    for (const side of ["sideA", "sideB"]) rewireReproductions.push(await runGatewayRewire(type, side));
  }
  console.log("Gateway creation reproduction", JSON.stringify(gatewayReproductions));
  console.log("Gateway existing-wire rewire reproduction", JSON.stringify(rewireReproductions));

  const renderCoreCase = async (types, name) => {
    await page.evaluate(snapshot => restoreSnapshot(snapshot), projectWithLoom(types));
    await page.waitForFunction(count => activeEngineBridge()?.scene.loomPlans[0]?.circuitCount === count, types.length);
    const state = await page.evaluate(() => {
      const bridge = activeEngineBridge(), plan = bridge.scene.loomPlans[0];
      return { circuitCount: plan.circuitCount, coreColors: [...plan.coreColors],
        wires: bridge.scene.wires.map(wire => ({ id: wire.id, color: wire.customColor || wire.color })),
        loomVertices: bridge.renderer.wireVertexMap.get(`loom:${plan.loomId}`).length };
    });
    const orderedWires = types.map((_, index) => state.wires.find(wire => wire.id === `progressive-cable-${index + 1}`));
    assert.ok(orderedWires.every(Boolean));
    assert.deepEqual(state.coreColors, loomCoreColors(orderedWires));
    assert.ok(state.coreColors.length <= 8);
    assert.ok(state.loomVertices > 0);
    assert.ok(loomBundleWidths(state.coreColors.length).sheath <= loomBundleWidths(8).sheath);
    assert.equal(loomBundleWidths(9).sheath, loomBundleWidths(8).sheath);
    await page.screenshot({ path: join(screenshots, `${name}.png`) });
    if (name === "cores-mixed-eight") {
      await page.evaluate(() => { const bridge = activeEngineBridge();
        bridge.camera.x = 475; bridge.camera.y = 255; bridge.camera.zoom = 2.6; bridge.scheduleRender(); });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(screenshots, "loom-8core-jacket-tape.png") });
      await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.camera.x = 0;
        bridge.camera.y = 0; bridge.camera.zoom = 0.8; bridge.scheduleRender(); });
    }
    return state.coreColors;
  };
  await renderCoreCase(["hdmi"], "cores-01-hdmi");
  await renderCoreCase(Array(4).fill("hdmi"), "cores-04-hdmi");
  await renderCoreCase(Array(20).fill("hdmi"), "cores-20-hdmi-capped");
  await renderCoreCase([...Array(12).fill("hdmi"), "xlr-3pin"], "cores-12-hdmi-1-xlr");
  const diverseBase = [...Array(3).fill("hdmi"), ...Array(3).fill("xlr-3pin"), ...Array(2).fill("sdi")];
  await renderCoreCase(diverseBase, "cores-mixed-eight");
  await renderCoreCase([...diverseBase, "fiber-lc"], "cores-add-fibre");
  await renderCoreCase([...diverseBase, "fiber-lc", "ethercon"], "cores-add-network");
  await renderCoreCase([...diverseBase, "fiber-lc", "ethercon", "usb-a"], "cores-add-usb");
  await renderCoreCase([...diverseBase, "fiber-lc", "ethercon", "usb-a", "iec"], "cores-add-power");
  const eightUnique = [...diverseBase, "fiber-lc", "ethercon", "usb-a", "iec", "speakon-nl4"];
  const capped = await renderCoreCase(eightUnique, "cores-eight-unique");
  assert.deepEqual(await renderCoreCase([...eightUnique, "dmx-5pin"], "cores-ninth-hidden"), capped);
  assert.deepEqual(await renderCoreCase([...eightUnique, "dmx-5pin", "rca"], "cores-tenth-hidden"), capped);
  assert.deepEqual(await renderCoreCase([...eightUnique, "dmx-5pin", "rca", "hdmi"], "cores-add-existing-at-cap"), capped);
  await renderCoreCase([...eightUnique.slice(1), "dmx-5pin", "rca"], "cores-remove-and-reveal");

  await page.evaluate(snapshot => restoreSnapshot(snapshot), saved);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ screenshots, manualWires: 2, loomId: cable.loomId,
    circuits: 2, coreCompositionCases: 14, browserErrors: errors.length }));
} finally {
  await browser.close();
}
