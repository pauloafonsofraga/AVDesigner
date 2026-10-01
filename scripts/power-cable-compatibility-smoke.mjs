import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const errors = [];
const fixture = {
  projectName: "Power cable adaptation",
  nodeLibrary: [{ id: "new-node", label: "Barrel Jack", color: "#cc0000", tags: ["power"] }],
  devices: [
    { instanceId: "source", name: "PDU", x: 0, y: 0, templateOverride: {
      id: "pdu", name: "PDU", width: 260, height: 260, schemaVersion: 2,
      connectors: [{ id: "out", type: "iec", physicalType: "iec", label: "IEC", direction: "output",
        signalDirection: "output", displaySide: "right", x: 260, y: 130 }]
    } },
    { instanceId: "target", name: "Controller", x: 650, y: 0, templateOverride: {
      id: "controller", name: "Controller", width: 260, height: 260, schemaVersion: 2,
      connectors: [{ id: "in", type: "new-node", physicalType: "new-node", label: "Barrel Jack", direction: "input",
        signalDirection: "input", displaySide: "left", x: 0, y: 130 }]
    } }
  ],
  connections: []
};

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(project => restoreSnapshot(project), fixture);
  const engine = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const source = bridge.scene.getDevice("source"), target = bridge.scene.getDevice("target");
    const sourceConnector = source.connectorsById.get("out"), targetConnector = target.connectorsById.get("in");
    const from = { device: source, connector: sourceConnector, point: bridge.scene.connectorWorldPoint(source, sourceConnector) };
    const to = { device: target, connector: targetConnector, point: bridge.scene.connectorWorldPoint(target, targetConnector) };
    bridge.beginWireCreate(from, from.point);
    bridge.wireCreate.target = to;
    const compatibility = bridge.currentWireCompatibility();
    bridge.completeWireCreate();
    return { compatibility, connections: state.connections.map(({ cableType, from, to }) => ({ cableType, from, to })) };
  });
  assert.equal(engine.compatibility.valid, true, engine.compatibility.reason);
  assert.equal(engine.connections.length, 1);
  assert.equal(engine.connections[0].cableType, "iec");
  assert.equal(engine.connections[0].from.connectorId, "out");
  assert.equal(engine.connections[0].to.connectorId, "in");
  await page.locator("#cableScheduleButton").click();
  await page.locator("#cableScheduleBody tr").first().waitFor();
  const schedule = await page.locator("#cableScheduleBody").innerText();
  assert.match(schedule, /Power/);
  assert.match(schedule, /IEC → Barrel Jack/);
  await page.close();

  const legacy = await browser.newPage();
  legacy.on("pageerror", error => errors.push(error.message));
  legacy.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await legacy.goto(`${base}/?legacy=1`);
  await legacy.waitForFunction(() => localUserSettingsLoaded);
  const legacyResult = await legacy.evaluate(() => ({
    valid: connectionError({ type: "iec", direction: "output", label: "IEC" },
      { type: "new-node", direction: "input", label: "Barrel Jack" }),
    invalid: connectionError({ type: "iec", direction: "output", label: "IEC" },
      { type: "new-node", direction: "output", label: "Barrel Jack" })
  }));
  assert.equal(legacyResult.valid, "");
  assert.match(legacyResult.invalid, /Output nodes cannot connect/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: 5, failed: 0, skipped: 0, checks: [
    "Engine creates an IEC-to-Barrel Jack physical wire",
    "Engine persists distinct source and destination endpoints",
    "Cable Schedule reports Power and IEC → Barrel Jack",
    "Legacy accepts the adapter pair but rejects output-to-output",
    "no browser page or console errors"
  ] }, null, 2));
} finally {
  await browser.close();
}
