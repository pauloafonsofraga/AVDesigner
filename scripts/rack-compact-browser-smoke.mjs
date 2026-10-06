import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-compact-rack-"));
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1540, height: 960 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html?renderer=engine&debugRackBuilder=1`);
  await page.waitForFunction(() => typeof createRack === "function" && activeEngineBridge()?.ready);
  const placed = await page.evaluate(() => {
    const connectors = [
      { id: "qa-hdmi-out", type: "hdmi", physicalType: "HDMI", compatibilityType: "hdmi", label: "HDMI OUT", direction: "output", displaySide: "right", x: 320, y: 60, color: "#e1c33a" },
      { id: "qa-sdi-in", type: "sdi", physicalType: "SDI", compatibilityType: "sdi-video", label: "SDI IN", direction: "input", displaySide: "left", x: 0, y: 110, color: "#56b57d" },
      { id: "qa-panel-only", type: "sdi", physicalType: "SDI", compatibilityType: "sdi-video", label: "PANEL SDI", direction: "input", displaySide: "left", x: 0, y: 145, color: "#56b57d" },
      { id: "qa-hidden", type: "usb-a", physicalType: "USB-A", compatibilityType: "usb", label: "HIDDEN USB", direction: "input", displaySide: "left", x: 0, y: 190, color: "#9886bc" }
    ];
    const expansionConnectors = Array.from({ length: 5 }, (_, index) => ({
      id: `qa-expand-${index + 1}`, type: "sdi", physicalType: "SDI", compatibilityType: "sdi-video",
      label: `EXPANSION ${index + 1}`, direction: "output", displaySide: "right", x: 320, y: 150 + index * 12, color: "#56b57d"
    }));
    const template = { id: "qa-compact-template", name: "Compact QA Switch", model: "QA-240", category: "Network",
      width: 320, height: 220, connectors: [...connectors, ...expansionConnectors], cards: [], hasSwappableCards: false };
    const rack = createRack("Compact Rack QA");
    rack.rackShell = { styleId: "standard", color: "#23658A" };
    rack.devices = [hydrateDeviceInstance({ instanceId: "qa-compact-source", templateId: template.id,
      templateOverride: template, name: template.name, x: 200, y: 180 }),
    hydrateDeviceInstance({ instanceId: "qa-compact-source-2", templateId: template.id,
      templateOverride: template, name: `${template.name} 2`, x: 200, y: 500 })];
    rack.exposedPorts = [{ id: "qa-exposed-hdmi", deviceId: "qa-compact-source", connectorId: "qa-hdmi-out" }];
    rack.patchPanels = [
      { id: "qa-panel-left", label: "LEFT PATCH", rackFace: "front", placementSide: "left", x: 0, y: 180, baseCapacity: 8,
        ports: [{ id: "qa-panel-left-port", slot: 2, sourceRackDeviceId: "qa-compact-source", sourceConnectorId: "qa-sdi-in" }] },
      { id: "qa-panel-right", label: "RIGHT PATCH", rackFace: "rear", placementSide: "right", x: 580, y: 275, baseCapacity: 8,
        ports: [{ id: "qa-panel-right-port", slot: 5, sourceRackDeviceId: "qa-compact-source", sourceConnectorId: "qa-panel-only" }] }
    ];
    rack.showInternalWiring = true;
    addRackInstanceToCanvas(rack.id, 900, 520);
    const redRack = createRack("Compact Rack QA Red");
    redRack.rackShell = { styleId: "standard", color: "#A14B32" };
    redRack.devices = [hydrateDeviceInstance({ instanceId: "qa-red-source", templateId: template.id,
      templateOverride: template, name: "Compact Rack QA Red Device", x: 40, y: 0 })];
    addRackInstanceToCanvas(redRack.id, 1580, 520);
    renderCanvasOnly();
    const canvasRack = state.racks.find(item => item.canvasInstance && item.sourceRackId === rack.id);
    const scene = activeEngineBridge().scene;
    const childId = canvasRack.sourceDeviceMap["qa-compact-source"];
    const secondChildId = canvasRack.sourceDeviceMap["qa-compact-source-2"];
    const child = scene.getDevice(childId);
    const secondChild = scene.getDevice(secondChildId);
    const compact = scene.canvasDeviceForId(childId);
    const layout = scene.compactRackLayout(canvasRack.id);
    return { rackId: rack.id, canvasRackId: canvasRack.id, childId, secondChildId, sourceId: "qa-compact-source",
      screen: { width: window.innerWidth, height: window.innerHeight },
      scene: { mode: scene.getRack(canvasRack.id).presentationMode, compact: child !== compact,
        sourceWidth: child.width, compactWidth: compact.width, compactHeight: compact.height,
        compactRect: { x: compact.x, y: compact.y, width: compact.width, height: compact.height },
        compactFaceplate: compact.visual.rackCompactFaceplateRect,
        secondCompactRect: { x: scene.canvasDeviceForId(secondChildId).x, y: scene.canvasDeviceForId(secondChildId).y,
          width: scene.canvasDeviceForId(secondChildId).width, height: scene.canvasDeviceForId(secondChildId).height },
        secondConnectorCount: scene.canvasDeviceForId(secondChildId).connectors.length,
        secondPortCount: scene.canvasDeviceForId(secondChildId).portCount,
      connectors: compact.connectors.map(connector => connector.id),
        hasHiddenConnectorHit: scene.isConnectorSelectableOnCanvas(child, scene.getConnector(childId, "qa-hidden")),
        directWorld: scene.connectorWorldPoint(child, scene.getConnector(childId, "qa-hdmi-out")),
        leftPanel: layout.patchPanels.find(panel => panel.panelId === "qa-panel-left"),
        rightPanel: layout.patchPanels.find(panel => panel.panelId === "qa-panel-right"),
        bounds: scene.getRack(canvasRack.id).bounds,
        contentBounds: layout.compactContentBounds,
        shellBounds: layout.shellBounds,
        diagnostics: layout.diagnostics },
      rackColor: rackById(rack.id).rackShell.color,
      redRack: { id: redRack.id, color: redRack.rackShell.color },
      appBuild: document.getElementById("appBuildLabel")?.textContent || "" };
  });
  assert.equal(placed.scene.mode, "compact");
  assert.equal(placed.scene.compact, true);
  assert.ok(placed.scene.compactWidth < placed.scene.sourceWidth, "placed device uses compact faceplate projection");
  assert.deepEqual(placed.scene.connectors, ["qa-hdmi-out", "qa-sdi-in", "qa-panel-only"]);
  assert.equal(placed.scene.secondConnectorCount, 0, "unexposed connectors do not survive as texture fallback ports");
  assert.equal(placed.scene.secondPortCount, 0, "compact tiles do not synthesize hidden fallback connector nodes");
  assert.equal(placed.scene.hasHiddenConnectorHit, false, "hidden internal connectors are not canvas hit targets");
  assert.ok(placed.scene.leftPanel.rect.x + placed.scene.leftPanel.rect.width < placed.scene.compactRect.x);
  assert.ok(placed.scene.rightPanel.rect.x > placed.scene.compactRect.x + placed.scene.compactRect.width);
  assert.equal(placed.scene.leftPanel.ports[0].slot, 2);
  assert.equal(placed.scene.rightPanel.ports[0].slot, 5);
  assert.equal(placed.scene.leftPanel.rackFace, "front");
  assert.equal(placed.scene.rightPanel.rackFace, "rear");
  assert.ok(placed.scene.bounds.width > placed.scene.compactWidth);
  assert.ok(placed.scene.shellBounds.width > placed.scene.contentBounds.width);
  assert.ok(placed.scene.shellBounds.height > placed.scene.contentBounds.height);
  assert.equal(placed.rackColor, "#23658A");
  assert.equal(placed.redRack.color, "#A14B32");
  assert.ok(placed.scene.secondCompactRect.y > placed.scene.compactRect.y, "source y order drives the compact device stack");
  await page.evaluate(() => { activeEngineBridge().scene.clearSelection(); activeEngineBridge().scheduleRender(); });
  await page.locator("#zoomFit").click();
  await page.waitForFunction(() => activeEngineBridge()?.renderer?.textureStats?.().rackShellTexturesReady === 1);
  const shellTextures = await page.evaluate(() => activeEngineBridge().renderer.textureStats());
  assert.equal(shellTextures.rackShellTextureCount, 1, "different rack colors reuse the single shell artwork texture");
  await page.screenshot({ path: join(screenshots, "compact-rack-canvas.png"), fullPage: false });

  await page.evaluate(({ rackId }) => openRackBuilderForRack(rackId), placed);
  await page.waitForFunction(() => rackBuilderPreviewAdapterModule?.rackPatchPanelPortForSource);
  const rackColorControl = page.locator("#rackBuilderColor");
  assert.equal(await rackColorControl.inputValue(), "#23658a");
  await rackColorControl.evaluate(input => {
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    input.value = "#3d8054"; input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(({ rackId, canvasRackId }) => rackById(rackId)?.rackShell?.color === "#3D8054"
    && activeEngineBridge()?.scene.getRack(canvasRackId)?.rackShell?.color === "#3D8054", placed);
  await page.waitForFunction(() => !document.querySelector("#undoAction")?.disabled);
  await page.locator("#undoAction").dispatchEvent("click");
  await page.waitForFunction(({ rackId }) => rackById(rackId)?.rackShell?.color === "#23658A", placed);
  await page.locator("#redoAction").dispatchEvent("click");
  await page.waitForFunction(({ rackId }) => rackById(rackId)?.rackShell?.color === "#3D8054", placed);
  await rackColorControl.evaluate(input => {
    input.focus(); input.value = "#23658A"; input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(({ rackId }) => rackById(rackId)?.rackShell?.color === "#23658A", placed);
  const wireState = await page.evaluate(({ canvasRackId, childId, rackId }) => {
    const scene = activeEngineBridge().scene;
    const layout = scene.compactRackLayout(canvasRackId);
    const panel = layout.patchPanels.find(item => item.panelId === "qa-panel-right");
    const port = panel.ports[0];
    const hit = scene.connectorIndex.queryPoint(port.point).map(item => item.payload || item)
      .find(item => item.rackPresentation?.patchPortId === port.portId);
    const external = scene.insertDevice({ id: "qa-external-device", label: "QA External Device", x: 80, y: 80, width: 120, height: 90,
      connectors: [{ id: "qa-external-sdi", type: "sdi", physicalType: "SDI", compatibilityType: "sdi-video",
        label: "SDI OUT", direction: "output", displaySide: "right", x: 120, y: 45, color: "#56b57d" },
      { id: "qa-external-hdmi", type: "hdmi", physicalType: "HDMI", compatibilityType: "hdmi",
        label: "HDMI IN", direction: "input", displaySide: "left", x: 0, y: 70, color: "#e1c33a" }] });
    state.devices.push({ instanceId: external.id, id: external.id, name: external.label, x: external.x, y: external.y,
      width: external.width, height: external.height,
      templateOverride: { id: "qa-external-template", name: external.label, width: external.width, height: external.height,
        connectors: external.connectors.map(connector => ({ ...connector, nameText: connector.label })) } });
    const wire = scene.addWire({ fromDeviceId: external.id, fromConnectorId: "qa-external-sdi",
      toDeviceId: childId, toConnectorId: hit.connector.id, toRackId: hit.rackPresentation.rackId,
      toPatchPanelId: hit.rackPresentation.patchPanelId, toPatchPortId: hit.rackPresentation.patchPortId });
    activeEngineBridge().mutations.commitCreatedWire(scene, wire);
    const directWire = scene.addWire({ fromDeviceId: childId, fromConnectorId: "qa-hdmi-out",
      toDeviceId: external.id, toConnectorId: "qa-external-hdmi" });
    activeEngineBridge().mutations.commitCreatedWire(scene, directWire);
    const rackDefinition = rackById(rackId);
    const panelRecord = rackDefinition.patchPanels.find(item => item.id === "qa-panel-right");
    const panelSource = panelRecord.ports.find(item => item.id === "qa-panel-right-port");
    const rackMapping = rackDefinition.patchPanels.some(item => item.ports.some(port =>
      port.sourceRackDeviceId === panelSource.sourceRackDeviceId && port.sourceConnectorId === panelSource.sourceConnectorId));
    const directSource = rackExposedPortFor(rackDefinition, "qa-compact-source", "qa-hdmi-out");
    const connectionsBefore = rackExternalConnectionsForConnector(rackDefinition, panelSource.sourceRackDeviceId, panelSource.sourceConnectorId).length;
    const directConnectionsBefore = rackExternalConnectionsForConnector(rackDefinition, directSource.deviceId, directSource.connectorId).length;
    exposeRackConnector(rackDefinition, panelSource.sourceRackDeviceId, panelSource.sourceConnectorId);
    hideRackConnector(rackDefinition, panelSource.sourceRackDeviceId, panelSource.sourceConnectorId);
    hideRackConnector(rackDefinition, directSource.deviceId, directSource.connectorId);
    deleteRackBuilderPatchPort(rackDefinition, panelRecord, "qa-panel-right-port");
    deleteRackBuilderPatchPanel(rackDefinition, "qa-panel-right");
    const guardState = {
      externalConnections: connectionsBefore,
      directExternalConnections: directConnectionsBefore,
      panelCount: rackDefinition.patchPanels.length,
      panelPortCount: panelRecord.ports.length,
      panelSource,
      rackId: rackDefinition.id,
      rackMapping: Boolean(rackMapping),
      panelConnectorExposed: Boolean(rackExposedPortFor(rackDefinition, "qa-compact-source", "qa-panel-only")),
      wiredDirectConnectorStillExposed: Boolean(rackExposedPortFor(rackDefinition, "qa-compact-source", "qa-hdmi-out"))
    };
    const endpoint = scene.rawEndpointForWire(wire, "to");
    const moved = scene.rawEndpointForWire(wire, "to", new Map([[childId, { dx: 80, dy: 45 }]]));
    return { wire: { id: wire.id, toDeviceId: wire.toDeviceId, toConnectorId: wire.toConnectorId,
      toRackId: wire.toRackId, toPatchPanelId: wire.toPatchPanelId, toPatchPortId: wire.toPatchPortId },
      hit: { connectorId: hit.connector.id, point: hit.point, presentation: hit.rackPresentation },
      endpoint, moved, expectedMoved: { x: endpoint.x + 80, y: endpoint.y + 45 }, guardState };
  }, placed);
  assert.equal(wireState.hit.presentation.patchPortId, "qa-panel-right-port");
  assert.equal(wireState.wire.toConnectorId, "qa-panel-only", "panel hit resolves to the original semantic connector");
  assert.equal(wireState.wire.toPatchPortId, "qa-panel-right-port");
  assert.deepEqual(wireState.moved, wireState.expectedMoved, "rack child translation moves the panel endpoint with the rack");
  assert.deepEqual(wireState.guardState, {
    externalConnections: 1,
    directExternalConnections: 1,
    panelCount: 2,
    panelPortCount: 1,
    panelSource: { id: "qa-panel-right-port", slot: 5, sourceRackDeviceId: "qa-compact-source", sourceConnectorId: "qa-panel-only" },
    rackId: placed.rackId,
    rackMapping: true,
    panelConnectorExposed: false,
    wiredDirectConnectorStillExposed: true
  }, "wired panel ports cannot be transferred, hidden, or deleted");

  const expanded = await page.evaluate(({ rackId, childId, secondChildId }) => {
    const rackDefinition = rackById(rackId);
    const rackDevice = rackDefinition.devices.find(device => device.instanceId === "qa-compact-source");
    const expansionConnectorIds = effectiveTemplateConnectors(templateForInstance(rackDevice)).map(connector => connector.id)
      .filter(id => id.startsWith("qa-expand-"));
    const scene = activeEngineBridge().scene;
    const beforeLayout = scene.compactRackLayout(state.racks.find(item => item.sourceRackId === rackId).id);
    const beforeFirst = scene.canvasDeviceForId(childId);
    const beforeSecond = scene.canvasDeviceForId(secondChildId);
    const beforePanelY = beforeLayout.patchPanels.map(panel => panel.rect.y);
    const sourcePositions = rackDefinition.devices.map(device => ({ id: device.instanceId, x: device.x, y: device.y }));
    for (let index = 1; index <= 5; index += 1) exposeRackConnector(rackDefinition, "qa-compact-source", `qa-expand-${index}`);
    renderRackBuilder();
    return { beforeHeight: beforeFirst.height, beforeSecondY: beforeSecond.y,
      beforeBoundsHeight: beforeLayout.bounds.height, beforePanelY,
      expansionConnectorIds, exposedIds: rackDefinition.exposedPorts.map(port => port.connectorId),
      sourcePositions };
  }, { rackId: placed.rackId, childId: placed.childId, secondChildId: placed.secondChildId });
  await page.locator("#closeRackBuilder").click();
  const expandedMetrics = await page.evaluate(({ canvasRackId, childId, secondChildId, rackId }) => {
    const scene = activeEngineBridge().scene;
    const layout = scene.compactRackLayout(canvasRackId);
    const sourceRack = rackById(rackId);
    return { expandedHeight: scene.canvasDeviceForId(childId).height,
      expandedSecondY: scene.canvasDeviceForId(secondChildId).y,
      expandedBoundsHeight: layout.bounds.height,
      expandedPanelY: layout.patchPanels.map(panel => panel.rect.y),
      currentSourcePositions: sourceRack.devices.map(device => ({ id: device.instanceId, x: device.x, y: device.y })) };
  }, placed);
  assert.ok(expandedMetrics.expandedHeight > expanded.beforeHeight, "additional exposed ports expand the first compact tile");
  assert.ok(expandedMetrics.expandedSecondY > expanded.beforeSecondY, "the following faceplate reflows downward");
  assert.ok(expandedMetrics.expandedBoundsHeight > expanded.beforeBoundsHeight, "compact rack bounds follow the expanded projection");
  assert.deepEqual(expandedMetrics.expandedPanelY, expanded.beforePanelY, "panel placement stays stable during direct-port reflow");
  assert.deepEqual(expandedMetrics.currentSourcePositions, expanded.sourcePositions, "compact reflow does not edit Rack Builder geometry");
  await page.screenshot({ path: join(screenshots, "compact-rack-expanded-ports.png"), fullPage: false });
  await page.evaluate(({ rackId }) => openRackBuilderForRack(rackId), placed);
  await page.waitForFunction(() => rackBuilderPreviewAdapterModule?.rackPatchPanelPortForSource);
  const contracted = await page.evaluate(({ rackId, secondChildId }) => {
    const rackDefinition = rackById(rackId);
    const sourcePositions = rackDefinition.devices.map(device => ({ id: device.instanceId, x: device.x, y: device.y }));
    for (let index = 1; index <= 5; index += 1) hideRackConnector(rackDefinition, "qa-compact-source", `qa-expand-${index}`);
    renderRackBuilder();
    return { sourcePositions };
  }, { rackId: placed.rackId, secondChildId: placed.secondChildId });
  await page.locator("#closeRackBuilder").click();
  const contractedMetrics = await page.evaluate(({ canvasRackId, childId, secondChildId, rackId }) => {
    const scene = activeEngineBridge().scene;
    const layout = scene.compactRackLayout(canvasRackId);
    const sourceRack = rackById(rackId);
    return { secondY: scene.canvasDeviceForId(secondChildId).y,
      boundsHeight: layout.bounds.height,
      firstHeight: scene.canvasDeviceForId(childId).height,
      sourcePositions: sourceRack.devices.map(device => ({ id: device.instanceId, x: device.x, y: device.y })) };
  }, placed);
  assert.ok(Math.abs(contractedMetrics.secondY - expanded.beforeSecondY) < 1e-6, "hiding exposed ports contracts the compact stack");
  assert.ok(Math.abs(contractedMetrics.boundsHeight - expanded.beforeBoundsHeight) < 1e-6, "rack bounds contract with the device stack");
  assert.deepEqual(contractedMetrics.sourcePositions, contracted.sourcePositions, "hide/reflow leaves builder positions unchanged");
  await page.screenshot({ path: join(screenshots, "compact-rack-contracted-ports.png"), fullPage: false });

  const drag = await page.evaluate(({ canvasRackId, wireId }) => {
    const bridge = activeEngineBridge();
    const rack = bridge.scene.getRack(canvasRackId);
    const childId = rack.childDeviceIds[0];
    const beforeDevice = bridge.scene.getDevice(childId);
    const beforeEndpoint = bridge.scene.rawEndpointForWire(bridge.scene.getWire(wireId), "to");
    const bounds = rack.bounds;
    const rect = bridge.canvas.getBoundingClientRect();
    return { start: { x: rect.left + (bounds.x + 5 - bridge.camera.x) * bridge.camera.zoom,
      y: rect.top + (bounds.y + bounds.height / 2 - bridge.camera.y) * bridge.camera.zoom },
      before: { x: beforeDevice.x, y: beforeDevice.y, endpoint: beforeEndpoint } };
  }, { canvasRackId: placed.canvasRackId, wireId: wireState.wire.id });
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.start.x + 64, drag.start.y + 32, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(({ childId, beforeX }) => {
    const device = activeEngineBridge()?.scene.getDevice(childId);
    return device && Math.abs(device.x - beforeX) >= 20;
  }, { childId: placed.childId, beforeX: drag.before.x });
  const movedRack = await page.evaluate(({ canvasRackId, childId, wireId, before }) => {
    const scene = activeEngineBridge().scene;
    const device = scene.getDevice(childId);
    const endpoint = scene.rawEndpointForWire(scene.getWire(wireId), "to");
    return { device: { x: device.x, y: device.y }, endpoint,
      delta: { x: device.x - before.x, y: device.y - before.y }, endpointDelta: { x: endpoint.x - before.endpoint.x, y: endpoint.y - before.endpoint.y },
      wire: scene.getWire(wireId) && { ...scene.getWire(wireId) } };
  }, { canvasRackId: placed.canvasRackId, childId: placed.childId, wireId: wireState.wire.id, before: drag.before });
  assert.ok(Math.abs(movedRack.delta.x) >= 20 || Math.abs(movedRack.delta.y) >= 20, "drag translates the placed rack as one unit");
  assert.ok(Math.abs(movedRack.endpointDelta.x - movedRack.delta.x) < 1e-6
    && Math.abs(movedRack.endpointDelta.y - movedRack.delta.y) < 1e-6,
  "external patch endpoint moves exactly with its compact rack");
  assert.equal(movedRack.wire.toPatchPortId, "qa-panel-right-port", "rack drag preserves panel presentation metadata");

  await page.evaluate(({ rackId }) => openRackBuilderForRack(rackId), placed);
  await page.waitForFunction(() => rackBuilderEnginePreviewSurface && rackBuilderEnginePreviewLastSceneData?.racks?.some(rack => rack.presentationMode === "builder"));
  await page.evaluate(() => fitRackBuilderPreviewToContent(selectedEditorRack()));
  await page.waitForTimeout(200);
  const builder = await page.evaluate(() => {
    const scene = rackBuilderEnginePreviewLastSceneData;
    const rack = scene.racks.find(item => item.presentationMode === "builder");
    const child = scene.devices.find(item => item.rackId === rack.id);
    return { mode: rack.presentationMode, width: child.width, height: child.height,
      connectors: child.connectors.length, build: document.getElementById("appBuildLabel")?.textContent || "" };
  });
  assert.equal(builder.mode, "builder");
  assert.ok(builder.width > placed.scene.compactWidth, "Rack Builder continues to use full device dimensions");
  assert.ok(builder.connectors >= 3, "Rack Builder retains its detailed connector population");
  await page.screenshot({ path: join(screenshots, "rack-builder-detailed.png"), fullPage: false });
  assert.deepEqual(errors, []);
  console.log("PASS compact rack browser acceptance", { screenshots, placed, wireState, builder, pageErrors: errors.length });
} finally {
  await browser.close();
}
