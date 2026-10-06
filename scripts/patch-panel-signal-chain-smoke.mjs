import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-patch-chain-"));
const errors = [], checks = [];

try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1080 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html?renderer=engine`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);

  await page.evaluate(() => {
    const makeDevice = (instanceId, name, direction, rackId, sourceRackDeviceId, x) => {
      const connectors = [
        { id: "main", type: "sdi", physicalType: "SDI", compatibilityType: "sdi", label: direction === "output" ? "SDI Out" : "SDI In",
          nameText: direction === "output" ? "SDI Out" : "SDI In", direction, signalDirection: direction,
          displaySide: direction === "output" ? "right" : "left", x: direction === "output" ? 240 : 0, y: 70, color: "#27a8df" },
        { id: "spare", type: "hdmi", physicalType: "HDMI", compatibilityType: "hdmi", label: "Spare HDMI",
          nameText: "Spare HDMI", direction: "input", signalDirection: "input", displaySide: "left", x: 0, y: 120, color: "#e8bd38" }
      ];
      const template = { id: `${instanceId}-template`, name, category: "Test", width: 240, height: 180,
        connectors, cards: [], hasSwappableCards: false };
      return { id: instanceId, instanceId, templateId: template.id, templateOverride: template, name,
        x, y: 120, width: 240, height: 180, rackId, sourceRackDeviceId };
    };
    const panel = (id, sourceDeviceId, connectorId, slot) => ({ id, label: "VIDEO PATCH", rackFace: "rear", placementSide: "right", x: 600, y: 100,
      ports: [{ id: `${id}-port-main`, slot, sourceRackDeviceId: sourceDeviceId, sourceConnectorId: connectorId },
        { id: `${id}-port-spare`, slot: slot + 1, sourceRackDeviceId: sourceDeviceId, sourceConnectorId: "spare" }] });
    const sourcePanel = panel("panel-foh", "source-device-def", "main", 3);
    const destinationPanel = panel("panel-stage", "destination-device-def", "main", 5);
    const source = makeDevice("source-device", "Camera Processor", "output", "rack-foh", "source-device-def", 100);
    const destination = makeDevice("destination-device", "LED Processor", "input", "rack-stage", "destination-device-def", 820);
    const external = { id: "external-device", instanceId: "external-device", name: "Direct Monitor", x: 1320, y: 160,
      templateId: "external-template", templateOverride: { id: "external-template", name: "Direct Monitor", width: 220, height: 160,
        connectors: [{ id: "in", type: "sdi", physicalType: "SDI", compatibilityType: "sdi", label: "SDI In", nameText: "SDI In",
          direction: "input", signalDirection: "input", displaySide: "left", x: 0, y: 70, color: "#27a8df" }] } };
    const rackDefinition = (id, name, patchPanel) => ({ id, name, devices: [], patchPanels: [patchPanel], exposedPorts: [], internalConnections: [] });
    const rackInstance = (id, name, sourceRackId, sourceDeviceId, deviceId, patchPanel) => ({ id, name, sourceRackId,
      canvasInstance: true, presentationMode: "compact", sourceDeviceMap: { [sourceDeviceId]: deviceId },
      childDeviceIds: [deviceId], exposedPorts: [], internalConnections: [], patchPanels: [patchPanel] });
    const sourcePresentation = { rackId: "rack-foh", patchPanelId: sourcePanel.id, patchPortId: `${sourcePanel.id}-port-main` };
    const destinationPresentation = { rackId: "rack-stage", patchPanelId: destinationPanel.id, patchPortId: `${destinationPanel.id}-port-main` };
    restoreSnapshot({ projectName: "Patch Panel Signal Chain QA", deviceLibrary: [], nodeLibrary: [],
      devices: [source, destination, external],
      racks: [rackDefinition("rack-foh-def", "FOH Rack", sourcePanel), rackDefinition("rack-stage-def", "Stage Rack", destinationPanel),
        rackInstance("rack-foh", "FOH Rack", "rack-foh-def", "source-device-def", source.instanceId, sourcePanel),
        rackInstance("rack-stage", "Stage Rack", "rack-stage-def", "destination-device-def", destination.instanceId, destinationPanel)],
      connections: [{ id: "patched-main", cableType: "sdi", from: { deviceId: source.instanceId, connectorId: "main", ...sourcePresentation },
        to: { deviceId: destination.instanceId, connectorId: "main", ...destinationPresentation } },
      { id: "direct-spare", cableType: "sdi", from: { deviceId: source.instanceId, connectorId: "spare" },
        to: { deviceId: external.instanceId, connectorId: "in" } }], jumpNodes: [], jumpLinks: [], ledSurfaces: [], imageObjects: [],
      comments: [], titleBlocks: [], areas: [], looms: [], cableNumberCounters: {} });
    zoomToFit();
  });

  const patchWorld = (rackId, panelId, portId) => page.evaluate(ids => {
    const bridge = activeEngineBridge();
    const port = bridge.scene.rackPatchPortByPresentation(...ids);
    if (!port) throw new Error(`Patch port not found: ${ids.join("/")}`);
    return port.point;
  }, [rackId, panelId, portId]);
  const rightClickWorld = async world => {
    const point = await page.evaluate(position => {
      const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect();
      return { x: rect.left + (position.x - bridge.camera.x) * bridge.camera.zoom,
        y: rect.top + (position.y - bridge.camera.y) * bridge.camera.zoom };
    }, world);
    await page.mouse.click(point.x, point.y, { button: "right" });
  };
  const menu = page.locator("#deviceContextMenu");

  await rightClickWorld(await patchWorld("rack-foh", "panel-foh", "panel-foh-port-spare"));
  assert.equal(await menu.locator('[data-connector-menu="signal-chain"]').count(), 0,
    "unconnected patch port has no Signal Chain action even though its semantic connector is in the rack");
  checks.push("unconnected patch port does not offer Signal Chain");

  await rightClickWorld(await patchWorld("rack-foh", "panel-foh", "panel-foh-port-main"));
  await menu.locator('[data-connector-menu="signal-chain"]').click();
  await page.locator("#signalChainDialog").waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-signal-chain-patch-role="from"]').count(), 1);
  assert.equal(await page.locator('[data-signal-chain-patch-role="to"]').count(), 1);
  assert.match(await page.locator("#signalChainBody").innerText(), /Camera Processor[\s\S]*SDI Out[\s\S]*VIDEO PATCH[\s\S]*Port 3[\s\S]*FOH Rack[\s\S]*V-001[\s\S]*VIDEO PATCH[\s\S]*Port 5[\s\S]*Stage Rack[\s\S]*LED Processor/);
  await page.screenshot({ path: join(screenshots, "both-ends-patched-signal-chain.png") });
  checks.push("right-clicking a connected physical patch port opens the full two-ended passive-patch topology");
  await page.locator("#closeSignalChain").click();

  await rightClickWorld(await patchWorld("rack-foh", "panel-foh", "panel-foh-port-spare"));
  assert.equal(await menu.locator('[data-connector-menu="signal-chain"]').count(), 0,
    "stale context-menu state does not leak the prior patch action");
  checks.push("patch-port context action does not leak between interactions");

  const details = await page.evaluate(async () => {
    const module = await import(engineImportUrl("./src/engine/cableSchedule.js"));
    const nodeDefinitions = Object.entries(cableTypes).map(([id, node]) => ({ ...node, id }));
    const rows = module.buildCableSchedule({ ...state, deviceLibrary }, {
      assignNumbers: "readOnly", getConnector: connectorById, nodeDefinitions
    });
    return {
    rows: rows.map(row => ({ source: row.sourceDevice, destination: row.destinationDevice,
      sourcePatch: row.sourcePatch?.portId || "", destinationPatch: row.destinationPatch?.portId || "" })),
    wires: state.connections.length,
    derivedLeads: [...activeEngineBridge().scene.racks].reduce((count, rack) => count
      + (activeEngineBridge().scene.compactRackLayoutById.get(rack.id)?.patchPanels || []).reduce((sum, panel) => sum + panel.ports.length, 0), 0),
    visibleWires: activeEngineBridge().scene.wires.length
    };
  });
  assert.equal(details.wires, 2, "derived internal leads never become project connections");
  assert.equal(details.visibleWires, 2, "only the two explicit external cables are in the Engine wire graph");
  assert.equal(details.rows.length, 2, "schedule row count remains the number of explicit external cables");
  assert.deepEqual(details.rows[0], { source: "FOH Rack / VIDEO PATCH", destination: "Stage Rack / VIDEO PATCH",
    sourcePatch: "panel-foh-port-main", destinationPatch: "panel-stage-port-main" });
  assert.equal(details.rows[1].source, "Camera Processor", "direct endpoints remain semantic device labels");
  checks.push("patch leads remain derived presentation, not extra project/Engine wires");

  const reportPromise = page.waitForEvent("popup");
  await page.locator("#projectReportButton").click();
  const report = await reportPromise;
  const cableSummary = report.locator(".summary-card").filter({ hasText: "Cables" });
  await cableSummary.waitFor();
  assert.equal(await cableSummary.locator("strong").innerText(), "2",
    "project report counts only the two explicit external cable connections");
  await report.close();
  checks.push("Project Report cable total excludes all derived internal patch leads");

  assert.deepEqual(errors, []);
  console.log("PASS Patch Panel Signal Chain browser acceptance", { checks, screenshots, errors });
} finally {
  await browser.close();
}
