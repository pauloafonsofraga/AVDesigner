import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-patch-panel-"));
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html?renderer=engine&debugRackBuilder=1`);
  await page.waitForFunction(() => typeof createRack === "function" && activeEngineBridge()?.ready);
  await page.evaluate(() => {
    const connectors = ["hdmi", "sdi", "nl4", "display-port", "fiber", "ethernet", "xlr", "powercon", "usb-a"]
      .map((type, index) => ({
        id: `qa-${type}-${index + 1}`, type, connectorType: type, physicalType: type,
        compatibilityType: type, label: `${type.toUpperCase()} ${index + 1}`, nameText: `${type.toUpperCase()} ${index + 1}`,
        direction: "output", signalDirection: "output", displaySide: "right", x: 240, y: 60 + index * 28,
        color: ["#e2b93b", "#47b27d", "#d060d0", "#438be0", "#80bbaa", "#c18a47", "#df7aa3", "#d66b3e", "#777"] [index],
        ...(type === "fiber" ? { fiberMode: "single-mode", fiberCapability: "single-mode" } : {})
      }));
    const template = { id: "patch-panel-qa-device", name: "Patch QA Switch", category: "Network", width: 240, height: 340,
      connectors, cards: [], hasSwappableCards: false };
    const rack = createRack("Patch Panel QA");
    rack.devices = [hydrateDeviceInstance({ instanceId: "patch-qa-device-1", templateId: template.id,
      templateOverride: template, name: template.name, x: 120, y: 120 })];
    rack.exposedPorts = [{ id: "patch-qa-exposure", deviceId: "patch-qa-device-1", connectorId: connectors[0].id }];
    openRackBuilderForRack(rack.id);
  });
  await page.waitForFunction(() => rackBuilderEnginePreviewSurface && rackBuilderPreviewAdapterModule?.createRackPatchPanel);
  await page.locator("#rackBuilderAddPatchPanel").click();
  await page.waitForFunction(() => document.querySelector(".rack-patch-panel") && rackBuilderSelectedPatchPanelId);
  const visuals = await page.evaluate(() => ({
    body: document.querySelector(".rack-patch-panel-body") ? getComputedStyle(document.querySelector(".rack-patch-panel-body")).stroke : "",
    slots: document.querySelectorAll(".rack-patch-panel .rack-patch-empty").length,
    label: document.querySelector(".rack-patch-label")?.textContent,
    face: rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId)?.rackFace,
    side: rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId)?.placementSide
  }));
  assert.equal(visuals.body, "rgb(251, 121, 4)");
  assert.equal(visuals.slots, 8);
  assert.equal(visuals.label, "PATCH PANEL 1");
  assert.equal(visuals.face, "rear");
  assert.equal(visuals.side, "right");

  const pointToScreen = async world => page.evaluate(point => {
    const surface = rackBuilderEnginePreviewSurface;
    const rect = surface.dom.root.getBoundingClientRect();
    return { x: rect.left + (point.x - surface.camera.x) * surface.camera.zoom,
      y: rect.top + (point.y - surface.camera.y) * surface.camera.zoom };
  }, world);
  const source = await page.evaluate(() => rackBuilderEngineConnectorEntry(selectedEditorRack(), "patch-qa-device-1", "qa-hdmi-1").world);
  const panelTarget = await page.evaluate(() => {
    const panel = rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId);
    const box = rackPatchPanelGeometry(panel);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  const from = await pointToScreen(source), to = await pointToScreen(panelTarget);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  assert.equal(await page.evaluate(() => rackBuilderHoverPatchPanelId === rackBuilderSelectedPatchPanelId), true);
  await page.mouse.up();
  await page.waitForFunction(() => selectedEditorRack()?.patchPanels?.[0]?.ports?.length === 1);
  let state = await page.evaluate(() => ({
    panel: structuredClone(selectedEditorRack().patchPanels[0]),
    exposed: selectedEditorRack().exposedPorts.some(port => port.connectorId === "qa-hdmi-1"),
    lead: document.querySelectorAll(".rack-patch-lead").length,
    projectWires: state.connections.length,
    regularRackWires: selectedEditorRack().internalConnections.length,
    path: document.querySelector(".rack-patch-lead")?.getAttribute("d"),
    sourceStillExists: Boolean(rackConnectorById(selectedEditorRack(), "patch-qa-device-1", "qa-hdmi-1"))
  }));
  assert.equal(state.panel.ports[0].sourceConnectorId, "qa-hdmi-1");
  assert.equal(state.panel.ports[0].slot, 1);
  assert.equal(state.exposed, false, "direct exposure transfers to the Patch Panel proxy");
  assert.equal(state.lead, 1, "one rack-internal lead is rendered");
  assert.equal(state.projectWires, 0, "the lead is not a project cable");
  assert.equal(state.regularRackWires, 0, "the lead is not an ordinary internalConnections wire");
  assert.equal(state.sourceStillExists, true);
  const endpoints = await page.evaluate(() => {
    const rack = selectedEditorRack(), panel = rack.patchPanels[0], port = panel.ports[0];
    const source = rackPointForConnector(rack, port.sourceRackDeviceId, port.sourceConnectorId);
    const destination = rackPatchPanelPortPoint(panel, port);
    return { start: `M ${source.x} ${source.y}`, end: `${destination.x} ${destination.y}` };
  });
  assert.ok(state.path.startsWith(endpoints.start), "internal lead begins at Engine connector world coordinates");
  assert.ok(state.path.endsWith(endpoints.end), "internal lead ends at the stable Patch Panel port location");

  await page.locator("[data-patch-panel-label]").fill("VIDEO PATCH QA");
  await page.locator("[data-patch-panel-face]").selectOption("front");
  await page.locator("[data-patch-panel-side]").selectOption("left");
  assert.equal(await page.evaluate(() => {
    const panel = rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId);
    return [panel.label, panel.rackFace, panel.placementSide];
  }).then(values => values.join("/")), "VIDEO PATCH QA/front/left");
  const fitted = await page.evaluate(() => {
    const panel = rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId);
    const box = rackPatchPanelGeometry(panel), surface = rackBuilderEnginePreviewSurface;
    const camera = surface.camera, zoom = camera.zoom;
    const width = surface.dom.root.clientWidth, height = surface.dom.root.clientHeight;
    return { left: (box.x - camera.x) * zoom, top: (box.y - camera.y) * zoom,
      right: (box.x + box.width - camera.x) * zoom,
      bottom: (box.y + box.height - camera.y) * zoom, width, height };
  });
  assert.ok(fitted.left >= -1 && fitted.top >= -1 && fitted.right <= fitted.width + 1 && fitted.bottom <= fitted.height + 1,
    "fitting after a side change keeps the whole panel in view");

  await page.evaluate(() => {
    const rack = selectedEditorRack();
    const panel = rackPatchPanelById(rack, rackBuilderSelectedPatchPanelId);
    for (let index = 1; index < 9; index += 1) {
      const connector = rackConnectorById(rack, "patch-qa-device-1", `qa-${["sdi", "nl4", "display-port", "fiber", "ethernet", "xlr", "powercon", "usb-a"][index - 1]}-${index + 1}`);
      if (connector) createRackPatchPanelPort(rack, panel, "patch-qa-device-1", connector.id);
    }
    renderRackBuilder();
  });
  state = await page.evaluate(() => {
    const panel = rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId);
    return { capacity: rackBuilderPreviewAdapterModule.rackPatchPanelCapacity(panel),
      slots: panel.ports.map(port => port.slot), types: panel.ports.map(port => rackConnectorById(selectedEditorRack(), port.sourceRackDeviceId, port.sourceConnectorId)?.type) };
  });
  assert.equal(state.capacity, 9, "ninth physical port expands panel capacity");
  for (const type of ["hdmi", "sdi", "nl4", "display-port", "fiber", "ethernet", "xlr", "powercon", "usb-a"]) assert.ok(state.types.includes(type), `live ${type} semantics resolve`);
  assert.ok(state.slots.includes(5));
  await page.evaluate(() => {
    const rack = selectedEditorRack(), panel = rackPatchPanelById(rack, rackBuilderSelectedPatchPanelId);
    deleteRackBuilderPatchPort(rack, panel, panel.ports.find(port => port.slot === 4)?.id);
  });
  state = await page.evaluate(() => {
    const panel = rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId);
    return { slots: panel.ports.map(port => port.slot), capacity: rackBuilderPreviewAdapterModule.rackPatchPanelCapacity(panel) };
  });
  assert.ok(!state.slots.includes(4));
  assert.ok(state.slots.includes(5), "later physical slots are not renumbered");
  assert.equal(state.capacity, 9);

  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(projectSnapshot())));
  const panelBeforeReload = await page.evaluate(() => JSON.parse(JSON.stringify(
    rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId)
  )));
  await page.evaluate(snapshot => restoreSnapshot(snapshot), saved);
  await page.waitForFunction(() => selectedEditorRack()?.patchPanels?.[0]?.ports?.length === 8);
  const roundTrip = await page.evaluate(() => JSON.parse(JSON.stringify(selectedEditorRack().patchPanels[0])));
  assert.equal(roundTrip.id, panelBeforeReload.id);
  assert.equal(roundTrip.ports[0].id, panelBeforeReload.ports[0].id);
  assert.equal(roundTrip.label, "VIDEO PATCH QA");
  assert.equal(roundTrip.rackFace, "front");
  assert.equal(roundTrip.placementSide, "left");
  assert.ok(roundTrip.ports.some(port => port.slot === 5));
  await page.evaluate(() => {
    const rack = selectedEditorRack(), panel = rack.patchPanels[0];
    exposeRackConnector(rack, "patch-qa-device-1", "qa-hdmi-1");
  });
  let transfer = await page.evaluate(() => ({
    exposed: selectedEditorRack().exposedPorts.some(port => port.connectorId === "qa-hdmi-1"),
    mapped: Boolean(rackBuilderPreviewAdapterModule.rackPatchPanelPortForSource(selectedEditorRack().patchPanels, "patch-qa-device-1", "qa-hdmi-1"))
  }));
  assert.deepEqual(transfer, { exposed: true, mapped: false }, "exposure action removes the proxy rather than duplicating it");
  await page.evaluate(() => createRackPatchPanelPort(selectedEditorRack(), selectedEditorRack().patchPanels[0], "patch-qa-device-1", "qa-hdmi-1"));
  transfer = await page.evaluate(() => ({
    exposed: selectedEditorRack().exposedPorts.some(port => port.connectorId === "qa-hdmi-1"),
    mapped: Boolean(rackBuilderPreviewAdapterModule.rackPatchPanelPortForSource(selectedEditorRack().patchPanels, "patch-qa-device-1", "qa-hdmi-1"))
  }));
  assert.deepEqual(transfer, { exposed: false, mapped: true }, "panel assignment transfers a direct exposure");
  const originalLabel = roundTrip.label;
  await page.evaluate(() => {
    pushUndo();
    rackPatchPanelById(selectedEditorRack(), rackBuilderSelectedPatchPanelId).label = "UNDO PROBE";
    renderRackBuilder();
  });
  await page.evaluate(() => undoAction());
  await page.waitForFunction(label => selectedEditorRack()?.patchPanels?.[0]?.label === label, originalLabel);
  await page.evaluate(() => redoAction());
  await page.waitForFunction(() => selectedEditorRack()?.patchPanels?.[0]?.label === "UNDO PROBE");
  await page.evaluate(() => undoAction());
  await page.waitForFunction(label => selectedEditorRack()?.patchPanels?.[0]?.label === label, originalLabel);
  await page.screenshot({ path: join(screenshots, "rack-builder-patch-panel.png"), fullPage: false });
  assert.deepEqual(errors, []);
  console.log("PASS Rack Builder Patch Panel browser acceptance", { screenshots, panels: 1, ports: roundTrip.ports.length, expandedCapacity: 9 });
} finally {
  await browser.close();
}
