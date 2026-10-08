import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { managedLoomMixedFixture } from "../fixtures/managed-looms.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const errors = [];

function loomFixture(count = 64) {
  const project = cableTypeSelectionFixture();
  project.devices.forEach((device, side) => {
    device.x = side ? 1800 : 0;
    device.templateOverride.height = count * 25 + 150;
    device.templateOverride.connectors = Array.from({ length: count }, (_, index) => ({
      id: `port-${index}`, type: "hdmi", label: "HDMI",
      direction: side ? "input" : "output", signalDirection: side ? "input" : "output",
      displaySide: side ? "left" : "right", x: side ? 0 : 260, y: 80 + index * 25
    }));
  });
  project.connections = Array.from({ length: count }, (_, index) => ({ id: `cable-${index}`,
    cableType: "hdmi", loomId: "loom-1",
    from: { deviceId: "source", connectorId: `port-${index}` },
    to: { deviceId: "sink", connectorId: `port-${index}` } }));
  project.looms = [{ id: "loom-1", name: "LM-001", sideA: { label: "Side A", x: 390, y: 220 },
    sideB: { label: "Side B", x: 720, y: 220 }, routeStyle: "orthogonal", routePoints: [] }];
  return project;
}

function withoutLoomFields(wire) {
  const copy = structuredClone(wire);
  for (const key of ["loomId", "loom", "loomEntrySide", "loomEntryRoutePoints", "loomExitRoutePoints"]) delete copy[key];
  return copy;
}

try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1050 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);

  await page.evaluate(project => restoreSnapshot(project), loomFixture());
  await page.waitForFunction(() => activeEngineBridge()?.scene?.loomPlans[0]?.circuitCount === 64);
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 0.55;
    const stats = window.__loomDragRebuildStats = { composition: 0, sceneGeometry: 0,
      wireIndex: 0, routeIndex: 0, fullWireGeometry: 0 };
    const originalComposition = bridge.refreshLoomComposition.bind(bridge);
    bridge.refreshLoomComposition = (...args) => { stats.composition++; return originalComposition(...args); };
    const originalSceneGeometry = bridge.scene.rebuildLoomGeometry.bind(bridge.scene);
    bridge.scene.rebuildLoomGeometry = (...args) => { stats.sceneGeometry++; return originalSceneGeometry(...args); };
    const originalWireIndex = bridge.scene.rebuildWireSpatialIndex.bind(bridge.scene);
    bridge.scene.rebuildWireSpatialIndex = (...args) => { stats.wireIndex++; return originalWireIndex(...args); };
    const originalRouteIndex = bridge.scene.rebuildRoutePointIndex.bind(bridge.scene);
    bridge.scene.rebuildRoutePointIndex = (...args) => { stats.routeIndex++; return originalRouteIndex(...args); };
    const originalWireGeometry = bridge.renderer.rebuildWireGeometry.bind(bridge.renderer);
    bridge.renderer.rebuildWireGeometry = (...args) => { stats.fullWireGeometry++; return originalWireGeometry(...args); };
    bridge.scheduleRender();
  });
  const toScreen = world => page.evaluate(point => {
    const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.top + (point.y - bridge.camera.y) * bridge.camera.zoom };
  }, world);
  const dragPart = async part => {
    const start = await page.evaluate(part => {
      const bridge = activeEngineBridge(), plan = bridge.scene.loomPlans[0];
      if (part === "trunk") return plan.trunk[Math.floor(plan.trunk.length / 2)];
      return part === "sideA" ? plan.headA : plan.headB;
    }, part);
    const before = await page.evaluate(() => JSON.stringify(state.looms[0]));
    const screen = await toScreen(start);
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    const dragStart = await page.evaluate(() => ({
      drag: activeEngineBridge().loomHeadDrag && { loomId: activeEngineBridge().loomHeadDrag.loomId,
        part: activeEngineBridge().loomHeadDrag.part },
      hover: activeEngineBridge().hoverState,
      screen: { x: window.__lastMouseX || 0, y: window.__lastMouseY || 0 }
    }));
    assert.equal(dragStart.drag?.loomId, "loom-1", `${part}: pointer should capture Loom drag; got ${JSON.stringify(dragStart)}`);
    await page.mouse.move(screen.x + 42, screen.y + 26, { steps: 5 });
    await page.waitForFunction(() => activeEngineBridge().loomHeadDrag?.previewPlan?.circuitCount === 64);
    const moving = await page.evaluate(() => ({
      projectUnchanged: JSON.stringify(state.looms[0]),
      stats: { ...window.__loomDragRebuildStats },
      previewVertices: activeEngineBridge().renderer.lastLoomDragPreviewStats?.vertices || 0,
      geometryTiming: { averageMs: activeEngineBridge().loomHeadDrag.previewGeometryTotalMs
        / activeEngineBridge().loomHeadDrag.previewGeometryFrames,
        maxMs: activeEngineBridge().loomHeadDrag.previewGeometryMaxMs }
    }));
    assert.equal(moving.projectUnchanged, before, `${part}: persisted geometry stays unchanged during pointer movement`);
    assert.deepEqual(moving.stats, { composition: 0, sceneGeometry: 0, wireIndex: 0, routeIndex: 0, fullWireGeometry: 0 },
      `${part}: pointer frames do not rebuild canonical Loom composition or wire buffers`);
    assert.ok(moving.previewVertices > 0, `${part}: transient geometry is rendered`);
    await page.mouse.up();
    await page.waitForFunction(() => !activeEngineBridge().loomHeadDrag);
    assert.deepEqual(await page.evaluate(() => ({ ...window.__loomDragRebuildStats })),
      { composition: 1, sceneGeometry: 1, wireIndex: 1, routeIndex: 1, fullWireGeometry: 1 }, `${part}: one canonical rebuild occurs on release`);
    dragDiagnostics.push({ part, ...moving.geometryTiming });
    const committed = await page.evaluate(() => JSON.stringify(state.looms[0]));
    assert.notEqual(committed, before, `${part}: final authored geometry is committed`);
    await page.evaluate(() => Object.keys(window.__loomDragRebuildStats)
      .forEach(key => { window.__loomDragRebuildStats[key] = 0; }));
  };
  const dragDiagnostics = [];
  await dragPart("trunk");
  await dragPart("sideA");
  await dragPart("sideB");

  const hoverPoints = await page.evaluate(() => {
    const bridge = activeEngineBridge(), plan = bridge.scene.loomPlans[0];
    const breakout = plan.breakouts.find(item => item.end === "A");
    return { sideA: plan.headA, sideB: plan.headB,
      trunk: plan.trunk[Math.floor(plan.trunk.length / 2)],
      breakout: { x: (breakout.points[0].x + breakout.points.at(-1).x) / 2,
        y: (breakout.points[0].y + breakout.points.at(-1).y) / 2 } };
  });
  for (const part of ["sideA", "sideB", "trunk"]) {
    const point = await toScreen(hoverPoints[part]);
    await page.mouse.move(point.x, point.y);
    await page.waitForFunction(expected => activeEngineBridge().hoverState.loom?.part === expected, part);
    assert.equal(await page.evaluate(() => activeEngineBridge().hoverState.wire), null,
      `${part}: Loom owns hover rather than one internal cable breakout`);
  }
  const breakout = await toScreen(hoverPoints.breakout);
  await page.mouse.move(breakout.x, breakout.y);
  await page.waitForFunction(() => activeEngineBridge().hoverState.wire?.wire?.loomId === "loom-1");
  assert.equal(await page.evaluate(() => activeEngineBridge().hoverState.loom), null,
    "breakout tail away from a gateway retains ordinary member-wire hover");

  const rewireProject = cableTypeSelectionFixture();
  rewireProject.connections = [0, 1].map(index => ({ id: `rewire-${index}`, cableType: "hdmi",
    loomId: "loom-1", loomEntrySide: "sideA", loomEntryRoutePoints: [{ x: 420, y: 300 }],
    loomExitRoutePoints: [{ x: 700, y: 360 }], length: "12m", notes: `cable ${index}`,
    from: { deviceId: "source", connectorId: `port-${index}` },
    to: { deviceId: "sink", connectorId: `port-${index}` } }));
  rewireProject.looms = [{ id: "loom-1", name: "LM-Rewire", sideA: { x: 410, y: 300 },
    sideB: { x: 740, y: 300 }, routeStyle: "orthogonal", routePoints: [] }];
  await page.evaluate(project => restoreSnapshot(project), rewireProject);
  await page.waitForFunction(() => activeEngineBridge()?.scene.loomPlans[0]?.circuitCount === 2);
  const performTailRewire = async end => {
    const initial = await page.evaluate(end => {
      const bridge = activeEngineBridge(), wire = bridge.scene.getWire("rewire-0");
      const plan = bridge.scene.loomPlans[0];
      const breakout = plan.breakouts.find(item => item.externalWireId === wire.id && item.externalEnd === end);
      const endpoint = bridge.scene.wireEndpointAtConnector(
        end === "from" ? wire.fromDeviceId : wire.toDeviceId,
        end === "from" ? wire.fromConnectorId : wire.toConnectorId);
      const fixedEnd = end === "from" ? "to" : "from";
      const detachedHit = bridge.hitForExistingWireEndpoint(wire, end);
      const targetDevice = bridge.scene.getDevice(end === "from" ? "source" : "sink");
      const targetConnector = bridge.scene.getConnector(targetDevice.id, "port-2");
      return { breakout: structuredClone(breakout), endpoint, detachedHit, fixedEnd,
        targetDeviceId: targetDevice.id, targetConnectorId: targetConnector.id,
        routeField: wire.loomEntrySide === (breakout.end === "A" ? "sideA" : "sideB")
          ? "loomEntryRoutePoints" : "loomExitRoutePoints",
        before: structuredClone(wire) };
    }, end);
    assert.ok(initial.breakout, `${end}: expected external Loom breakout metadata`);
    const started = await page.evaluate(({ end, data }) => {
      const bridge = activeEngineBridge();
      const point = bridge.scene.endpointForWire(bridge.scene.getWire("rewire-0"), end);
      return bridge.beginWireRewire(data.detachedHit, data.endpoint, point);
    }, { end, data: initial });
    assert.equal(started, true);
    const configured = await page.evaluate(({ data, end }) => {
      const bridge = activeEngineBridge(), wire = bridge.scene.getWire("rewire-0");
      const device = bridge.scene.getDevice(data.targetDeviceId);
      const connector = bridge.scene.getConnector(device.id, data.targetConnectorId);
      const point = bridge.scene.connectorWorldPoint(device, connector);
      const tail = bridge.wireCreate.rewire.loomTail;
      bridge.wireCreate.manual = true;
      bridge.wireCreate.routePoints = [{ x: point.x + (end === "from" ? 38 : -38), y: point.y + 24 }];
      bridge.wireCreate.target = { device, connector, point, anchorId: connector.primaryAnchorId || "" };
      return { routeField: tail?.routeField || "", gateway: tail?.gatewayPoint || null,
        loomId: tail?.loomId || "", compatibility: bridge.currentWireCompatibility(),
        rejection: bridge.wireRewireRejectionReason(bridge.wireCreate.target) };
    }, { data: initial, end });
    assert.equal(configured.loomId, "loom-1");
    assert.equal(configured.routeField, initial.routeField);
    assert.equal(configured.compatibility.valid, true, `${end}: endpoint compatibility ${JSON.stringify(configured)}`);
    assert.equal(configured.rejection, "", `${end}: rewire rejection ${JSON.stringify(configured)}`);
    await page.evaluate(() => activeEngineBridge().completeWireRewire());
    const result = await page.evaluate(({ routeField }) => {
      const bridge = activeEngineBridge(), wire = bridge.scene.getWire("rewire-0");
      return { wire: structuredClone(wire), root: structuredClone(bridge.mutations.root.connections.find(item => item.id === wire.id)),
        plan: structuredClone(bridge.scene.loomPlans[0]), routeField };
    }, { routeField: configured.routeField });
    assert.equal(result.wire.loomId, "loom-1", `${end}: membership remains intact`);
    assert.equal(result.root.length, "12m");
    assert.equal(result.root.notes, "cable 0");
    assert.notDeepEqual(result.wire[configured.routeField], initial.before[configured.routeField],
      `${end}: detached breakout route metadata is updated`);
    const otherRoute = configured.routeField === "loomEntryRoutePoints" ? "loomExitRoutePoints" : "loomEntryRoutePoints";
    assert.deepEqual(result.wire[otherRoute], initial.before[otherRoute], `${end}: opposite breakout stays unchanged`);
    assert.equal(result.plan.hiddenWireIds.includes("rewire-0"), true);
    assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
    assert.deepEqual(await page.evaluate(() => activeEngineBridge().scene.getWire("rewire-0").loomEntryRoutePoints),
      initial.before.loomEntryRoutePoints);
    assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
    const reopened = await page.evaluate(async () => JSON.parse(await projectJsonPayload()));
    await page.evaluate(snapshot => restoreSnapshot(snapshot), reopened);
    await page.waitForFunction(() => activeEngineBridge()?.scene.loomPlans[0]?.circuitCount === 2);
    assert.equal(await page.evaluate(() => activeEngineBridge().scene.getWire("rewire-0").loomId), "loom-1");
    return { end, routeField: configured.routeField, routePoints: result.wire[configured.routeField] };
  };
  const rewireResults = [await performTailRewire("from"), await performTailRewire("to")];

  const deleteProject = managedLoomMixedFixture();
  deleteProject.connections.forEach(wire => Object.assign(wire, { loomId: "loom-1",
    cableNumber: `C-${wire.id}`, length: "17m", notes: "keep notes", customColor: "#2468ac" }));
  deleteProject.looms = [{ id: "loom-1", name: "LM-Delete", sideA: { x: 350, y: 300 }, sideB: { x: 760, y: 300 } }];
  await page.evaluate(project => restoreSnapshot(project), deleteProject);
  await page.waitForFunction(() => activeEngineBridge()?.scene.loomPlans[0]?.circuitCount === 5);
  const originalRecords = await page.evaluate(() => state.connections.map(without => {
    const copy = structuredClone(without);
    for (const key of ["loomId", "loom", "loomEntrySide", "loomEntryRoutePoints", "loomExitRoutePoints"]) delete copy[key];
    return copy;
  }));
  await page.evaluate(() => { activeEngineBridge().selectLoomById("loom-1"); activeEngineBridge().canvas.focus(); });
  let dialogs = 0;
  page.on("dialog", dialog => { dialogs++; void dialog.dismiss(); });
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => state.looms.length === 0);
  const deleted = await page.evaluate(() => ({ records: state.connections.map(wire => {
    const copy = structuredClone(wire);
    for (const key of ["loomId", "loom", "loomEntrySide", "loomEntryRoutePoints", "loomExitRoutePoints"]) delete copy[key];
    return copy;
  }), wiresVisible: activeEngineBridge().scene.wires.every(wire => !activeEngineBridge().scene.isWireHiddenByLoom(wire.id)),
  indexed: activeEngineBridge().scene.wireIndex.items.size }));
  assert.deepEqual(deleted.records, originalRecords, "Delete removes Loom fields only; all complete connection records remain");
  assert.equal(deleted.wiresVisible, true);
  assert.equal(deleted.indexed, deleteProject.connections.length, "ordinary former member routes are reindexed");
  assert.equal(dialogs, 0, "keyboard deletion has no confirmation modal");
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms.length), 1);
  assert.ok(await page.evaluate(() => state.connections.every(wire => wire.loomId === "loom-1")));
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms.length), 0);
  const saved = await page.evaluate(async () => JSON.parse(await projectJsonPayload()));
  await page.evaluate(snapshot => restoreSnapshot(snapshot), saved);
  await page.waitForFunction(() => activeEngineBridge()?.scene?.looms.length === 0);
  assert.equal(await page.evaluate(() => state.connections.length), deleteProject.connections.length,
    "save/reload after Loom deletion preserves all physical cable legs");
  assert.equal(dialogs, 0);

  await page.evaluate(project => restoreSnapshot(project), deleteProject);
  await page.waitForFunction(() => activeEngineBridge()?.scene.loomPlans[0]?.circuitCount === 5);
  await page.evaluate(() => activeEngineBridge().selectLoomById("loom-1"));
  await page.evaluate(() => deleteSelection());
  await page.waitForFunction(() => state.looms.length === 0);
  assert.equal(await page.evaluate(() => state.connections.length), deleteProject.connections.length,
    "application Delete action routes selected Loom through cable-preserving deletion");

  await page.evaluate(project => restoreSnapshot(project), loomFixture(2));
  await page.waitForFunction(() => activeEngineBridge()?.scene.loomPlans[0]?.circuitCount === 2);
  await page.evaluate(() => activeEngineBridge().selectLoomById("loom-1"));
  await page.locator("#loomDissolve").click();
  await page.waitForFunction(() => state.looms.length === 0);
  assert.equal(await page.evaluate(() => state.connections.length), 2,
    "visible Delete Loom inspector action shares the cable-preserving path");
  assert.equal(dialogs, 0);
  assert.deepEqual(errors, []);
  console.log("Managed Loom stability browser acceptance PASS", JSON.stringify({
    dragCircuits: 64, pointerFrames: 15, canonicalRebuildsPerDrop: 1, previewGeometry: dragDiagnostics,
    hoverOwners: ["gateway Side A", "gateway Side B", "trunk", "breakout wire"],
    rewireResults, deleteCablesPreserved: originalRecords.length,
    jumpLegsPreserved: deleteProject.connections.filter(wire => wire.from?.jumpNodeId || wire.to?.jumpNodeId).length,
    dialogs, consoleErrors: errors.length
  }));
} finally {
  await browser.close();
}
