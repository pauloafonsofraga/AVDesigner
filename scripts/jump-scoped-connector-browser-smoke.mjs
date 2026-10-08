import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
const canonicalHdmi = structuredClone(catalogue.nodes.find(node => node.id === "hdmi"));
const scopedHdmi = { ...structuredClone(canonicalHdmi), id: "hdmi-personal-12345678",
  compatibilityType: "hdmi", label: "Personal HDMI" };
const definition = (id, name, connector) => ({ id, name, model: name, width: 300, height: 300,
  schemaVersion: 2, deviceDefinitionVersion: 2, connectors: [connector] });
const project = {
  version: 1,
  projectName: "Jump scoped connector browser regression",
  nodeLibrary: [canonicalHdmi, scopedHdmi],
  deviceLibrary: [
    definition("editable-device", "Editable Device", { id: "existing-out", label: "Existing HDMI",
      type: "hdmi", physicalType: "hdmi", connectorType: "hdmi", direction: "output",
      signalDirection: "output", displaySide: "right", x: 300, y: 100 }),
    definition("target-device", "Target Device", { id: "target-in", label: "HDMI In",
      type: "hdmi", physicalType: "hdmi", connectorType: "hdmi", direction: "input",
      signalDirection: "input", displaySide: "left", x: 0, y: 100 })
  ],
  devices: [
    { instanceId: "editable", templateId: "editable-device", name: "Editable Device", x: 0, y: 100 },
    { instanceId: "target", templateId: "target-device", name: "Target Device", x: 760, y: 100 }
  ],
  connections: [], jumpNodes: [], jumpLinks: [], ledSurfaces: [], racks: [], looms: [],
  comments: [], areas: [], titleBlocks: [], imageObjects: []
};

const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.evaluate(snapshot => restoreSnapshot(snapshot), project);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.getDevice("editable"));

  // Exercise the actual existing-device editor, its add-slot control, type selector and Apply action.
  await page.evaluate(() => openDeviceEditorForInstance("editable"));
  await page.locator('[data-editor-tab="connectors"]').click();
  await page.locator("#addOutputNode").click();
  const typeSelect = page.locator("#selectedConnectorPhysicalType");
  await typeSelect.waitFor();
  const scopedOption = await typeSelect.locator(`option[value="${scopedHdmi.id}"]`).count();
  assert.equal(scopedOption, 1, "the scoped HDMI node is available in the real editor picker");
  await typeSelect.selectOption(scopedHdmi.id);
  const editedDefinition = await page.evaluate(() => {
    const template = currentEditorTemplate();
    return structuredClone(template.connectors.at(-1));
  });
  assert.equal(editedDefinition.type, scopedHdmi.id);
  const newConnectorId = editedDefinition.id;
  await page.locator("#applyDeviceEditor").click();
  await page.waitForFunction(() => document.getElementById("deviceEditorModal")?.classList.contains("hidden"));
  await page.waitForFunction(id => activeEngineBridge().scene.getConnector("editable", id)?.type === "hdmi-personal-12345678", newConnectorId);
  const liveNewConnector = await page.evaluate(id => {
    const connector = activeEngineBridge().scene.getConnector("editable", id);
    return { id: connector.id, type: connector.type, compatibilityType: connector.compatibilityType,
      typeLabel: connector.typeLabel, color: connector.color,
      electricalType: window.__avDesignerEngine?.connectorCompatibilityType?.(connector) || "" };
  }, newConnectorId);
  assert.equal(liveNewConnector.type, scopedHdmi.id);
  assert.equal(liveNewConnector.compatibilityType, "hdmi");

  // Add an unassigned Jump Node using the visible Jump tool and a real canvas click.
  await page.locator("#jumpNodeTool").click();
  const jumpPoint = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const local = bridge.worldToScreenPoint({ x: 520, y: 300 });
    const rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + local.x, y: rect.top + local.y };
  });
  await page.mouse.click(jumpPoint.x, jumpPoint.y);
  await page.waitForFunction(() => activeEngineBridge().scene.devices.some(device => device.kind === "jump"));
  const jumpId = await page.evaluate(() => activeEngineBridge().scene.devices.find(device => device.kind === "jump").id);
  await page.locator("#jumpNodeTool").click();

  // First connect the same newly authored node to an ordinary canonical HDMI input.
  const ordinaryPreview = await page.evaluate(newConnectorId => {
    const bridge = activeEngineBridge();
    const source = bridge.scene.getDevice("editable");
    const sourceConnector = bridge.scene.getConnector("editable", newConnectorId);
    const target = bridge.scene.getDevice("target");
    const targetConnector = bridge.scene.getConnector("target", "target-in");
    const sourceHit = { device: source, connector: sourceConnector,
      point: bridge.scene.connectorWorldPoint(source, sourceConnector) };
    const targetHit = { device: target, connector: targetConnector,
      point: bridge.scene.connectorWorldPoint(target, targetConnector) };
    bridge.beginWireCreate(sourceHit, sourceHit.point);
    bridge.wireCreate.target = targetHit;
    const compatibility = bridge.currentWireCompatibility();
    bridge.completeWireCreate();
    return compatibility;
  }, newConnectorId);
  assert.equal(ordinaryPreview.valid, true, JSON.stringify(ordinaryPreview));
  assert.equal(ordinaryPreview.sourceType, "hdmi");
  assert.equal(ordinaryPreview.targetType, "hdmi");
  const ordinaryWire = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const wire = bridge.scene.wires[0];
    return { wireId: wire?.id, cableType: wire?.cableType, count: bridge.scene.wires.length,
      fromType: bridge.scene.getConnector(wire?.fromDeviceId, wire?.fromConnectorId)?.type,
      toType: bridge.scene.getConnector(wire?.toDeviceId, wire?.toConnectorId)?.type };
  });
  assert.equal(ordinaryWire.count, 1, "device-to-device path creates one wire");
  assert.equal(ordinaryWire.cableType, "hdmi");
  assert.equal(ordinaryWire.fromType, scopedHdmi.id);

  // Rewire the ordinary endpoint to the placed Jump through the production bridge rewire transaction.
  const rewireCompatibility = await page.evaluate(({ jumpId }) => {
    const bridge = activeEngineBridge();
    const wire = bridge.scene.wires[0];
    const endpoint = bridge.scene.wireEndpointAtConnector("target", "target-in");
    const detachedDevice = bridge.scene.getDevice("target");
    const detachedConnector = bridge.scene.getConnector("target", "target-in");
    const detachedHit = { device: detachedDevice, connector: detachedConnector,
      point: bridge.scene.endpointForWire(wire, endpoint.end) };
    bridge.beginWireRewire(detachedHit, endpoint, detachedHit.point);
    const jumpDevice = bridge.scene.getDevice(jumpId);
    const jumpConnector = bridge.scene.getConnector(jumpId, "jump-center");
    bridge.wireCreate.target = { device: jumpDevice, connector: jumpConnector,
      point: bridge.scene.connectorWorldPoint(jumpDevice, jumpConnector) };
    const compatibility = bridge.currentWireCompatibility();
    bridge.completeWireCreate();
    return compatibility;
  }, { jumpId });
  const rewireState = await page.evaluate(newConnectorId => {
    const bridge = activeEngineBridge();
    const wire = bridge.scene.wires[0];
    const jump = bridge.scene.devices.find(device => device.kind === "jump");
    return { count: bridge.scene.wires.length, wireId: wire?.id, cableType: wire?.cableType,
      jumpEndpoint: wire?.fromDeviceId === jump?.id || wire?.toDeviceId === jump?.id,
      jumpRole: bridge.scene.jumpNodeRole(jump?.id)?.role,
      rawDeviceType: bridge.scene.getConnector("editable", newConnectorId)?.type,
      compatibilityType: bridge.scene.getConnector("editable", newConnectorId)?.compatibilityType,
      currentCompatibility: bridge.currentWireCompatibility() };
  }, newConnectorId);
  assert.equal(rewireCompatibility.valid, true, JSON.stringify(rewireCompatibility));
  assert.equal(rewireCompatibility.sourceType, "hdmi");
  assert.equal(rewireCompatibility.targetType, "hdmi");
  assert.equal(rewireState.count, 1, "rewire retains the single cable");
  assert.equal(rewireState.wireId, ordinaryWire.wireId);
  assert.equal(rewireState.cableType, "hdmi");
  assert.equal(rewireState.jumpEndpoint, true);
  assert.equal(rewireState.jumpRole, "output");
  assert.equal(rewireState.rawDeviceType, scopedHdmi.id);
  assert.equal(rewireState.compatibilityType, "hdmi");

  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires[0]?.toDeviceId), "target",
    "undo restores the original ordinary endpoint");
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  assert.equal(await page.evaluate(jumpId => activeEngineBridge().scene.wires[0]?.toDeviceId === jumpId
    || activeEngineBridge().scene.wires[0]?.fromDeviceId === jumpId, jumpId), true,
  "redo restores the Jump endpoint");

  // Give the other Jump an input-side physical leg, then pair through the shared Jump-link transaction.
  const secondJumpPoint = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const local = bridge.worldToScreenPoint({ x: 560, y: 620 });
    const rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + local.x, y: rect.top + local.y };
  });
  await page.locator("#jumpNodeTool").click();
  await page.mouse.click(secondJumpPoint.x, secondJumpPoint.y);
  await page.waitForFunction(() => activeEngineBridge().scene.devices.filter(device => device.kind === "jump").length === 2);
  const secondJumpId = await page.evaluate(jumpId => activeEngineBridge().scene.devices
    .find(device => device.kind === "jump" && device.id !== jumpId).id, jumpId);
  const secondJumpLeg = await page.evaluate(secondJumpId => {
    const bridge = activeEngineBridge();
    const target = bridge.scene.getDevice("target");
    const input = bridge.scene.getConnector("target", "target-in");
    const jump = bridge.scene.getDevice(secondJumpId);
    const jumpConnector = bridge.scene.getConnector(secondJumpId, "jump-center");
    const sourceHit = { device: target, connector: input, point: bridge.scene.connectorWorldPoint(target, input) };
    bridge.beginWireCreate(sourceHit, sourceHit.point);
    bridge.wireCreate.target = { device: jump, connector: jumpConnector,
      point: bridge.scene.connectorWorldPoint(jump, jumpConnector) };
    const compatibility = bridge.currentWireCompatibility();
    bridge.completeWireCreate();
    return { compatibility, count: bridge.scene.wires.length,
      cableType: bridge.scene.wires.at(-1)?.cableType, role: bridge.scene.jumpNodeRole(secondJumpId)?.role };
  }, secondJumpId);
  assert.equal(secondJumpLeg.compatibility.valid, true, JSON.stringify(secondJumpLeg.compatibility));
  assert.equal(secondJumpLeg.compatibility.sourceType, "hdmi");
  assert.equal(secondJumpLeg.compatibility.targetType, "hdmi");
  assert.equal(secondJumpLeg.count, 2);
  assert.equal(secondJumpLeg.cableType, "hdmi");
  assert.equal(secondJumpLeg.role, "input");

  const jumpPair = await page.evaluate(({ jumpId, secondJumpId }) => {
    const bridge = activeEngineBridge();
    const first = bridge.scene.getDevice(jumpId);
    const second = bridge.scene.getDevice(secondJumpId);
    const firstConnector = bridge.scene.getConnector(jumpId, "jump-center");
    const secondConnector = bridge.scene.getConnector(secondJumpId, "jump-center");
    const firstHit = { device: first, connector: firstConnector, point: bridge.scene.connectorWorldPoint(first, firstConnector) };
    const secondHit = { device: second, connector: secondConnector, point: bridge.scene.connectorWorldPoint(second, secondConnector) };
    bridge.beginJumpLinkCreate(firstHit, firstHit.point);
    bridge.jumpLinkCreate.target = secondHit;
    const compatibility = bridge.currentJumpLinkCompatibility(secondJumpId);
    bridge.completeJumpLinkCreate();
    return { compatibility, linkCount: bridge.scene.jumpLinks.length,
      pairedId: bridge.scene.pairedJumpId(jumpId) };
  }, { jumpId, secondJumpId });
  assert.equal(jumpPair.compatibility.valid, true, JSON.stringify(jumpPair.compatibility));
  assert.equal(jumpPair.linkCount, 1);
  assert.equal(jumpPair.pairedId, secondJumpId);

  const saved = await page.evaluate(() => projectJsonPayload());
  await page.evaluate(text => loadProjectFile(new File([text], "jump-scoped-connector.avd", { type: "application/json" })), saved);
  await page.waitForFunction(({ jumpId, secondJumpId }) => activeEngineBridge()?.ready
    && activeEngineBridge().scene.getDevice(jumpId) && activeEngineBridge().scene.getDevice(secondJumpId)
    && activeEngineBridge().scene.wires.length === 2 && activeEngineBridge().scene.jumpLinks.length === 1,
  { jumpId, secondJumpId });
  const reloaded = await page.evaluate(async ({ jumpId, secondJumpId, newConnectorId }) => {
    const bridge = activeEngineBridge();
    const connector = bridge.scene.getConnector("editable", newConnectorId);
    const wire = bridge.scene.wires[0];
    const jumpInfo = bridge.scene.jumpNodeConnectionInfo(jumpId);
    const pairedJumpInfo = bridge.scene.jumpNodeConnectionInfo(secondJumpId);
    return { type: connector?.type, compatibilityType: connector?.compatibilityType,
      cableType: wire?.cableType, endpointRetained: wire?.fromDeviceId === jumpId || wire?.toDeviceId === jumpId,
      jumpRole: bridge.scene.jumpNodeRole(jumpId)?.role, jumpCableType: jumpInfo?.cableType || "",
      jumpConnectorName: jumpInfo?.connectorName || "", pairedId: bridge.scene.pairedJumpId(jumpId),
      pairedJumpConnectorName: pairedJumpInfo?.connectorName || "",
      project: JSON.parse(await projectJsonPayload()) };
  }, { jumpId, secondJumpId, newConnectorId });
  const schedule = buildCableSchedule(reloaded.project, { assignNumbers: "readOnly" })
    .find(row => row.cableTypeId === "hdmi");
  assert.equal(reloaded.type, scopedHdmi.id);
  assert.equal(reloaded.compatibilityType, "hdmi");
  assert.equal(reloaded.cableType, "hdmi");
  assert.equal(reloaded.endpointRetained, true);
  assert.equal(reloaded.jumpRole, "output");
  assert.equal(reloaded.jumpCableType, "hdmi");
  assert.equal(reloaded.jumpConnectorName, "HDMI");
  assert.equal(reloaded.pairedJumpConnectorName, "Personal HDMI");
  assert.equal(reloaded.pairedId, secondJumpId);
  assert.doesNotMatch(reloaded.jumpConnectorName, /personal-/i);
  assert.equal(schedule?.cableTypeId, "hdmi");
  assert.equal(schedule?.cable, "HDMI");
  assert.deepEqual(errors, [], "browser workflow has no page or console errors");
  console.log("Jump scoped connector Device Editor/browser smoke PASS", JSON.stringify({
    editedDefinition, liveNewConnector, ordinaryWire, rewireState, secondJumpLeg, jumpPair,
    reloaded: { ...reloaded, project: undefined }, browserErrors: errors.length
  }));
} finally {
  await browser.close();
}
