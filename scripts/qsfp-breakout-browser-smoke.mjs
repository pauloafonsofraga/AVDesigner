import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8891";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
const inspector = page.locator("#inspectorBody");
const action = name => inspector.locator(`[data-breakout-action="${name}"]`);
const snapshot = () => page.evaluate(() => state.breakoutAssemblies);
const waitReady = () => page.waitForFunction(() => typeof activeEngineBridge === "function" && activeEngineBridge()?.ready && localUserSettingsLoaded);
const scenePoint = async (kind, port, assemblyIndex = 0) => page.evaluate(({ kind, port, assemblyIndex }) => {
  const bridge = activeEngineBridge();
  const { scene } = bridge;
  let world;
  if (kind === "port") {
    const device = scene.getDevice(port[0]);
    world = scene.connectorWorldPoint(device, scene.getConnector(device.id, port[1]));
  } else {
    const plan = bridge.qsfpBreakoutPlans(null)[assemblyIndex];
    if (kind === "tip") world = plan.branches.find(branch => branch.lane === port).tip;
    else if (kind === "hub") world = plan.hub;
    else world = plan.trunk[Math.floor(plan.trunk.length / 2)];
  }
  const p = bridge.worldToScreenPoint(world);
  const box = bridge.canvas.getBoundingClientRect();
  return { x: p.x + box.x, y: p.y + box.y };
}, { kind, port, assemblyIndex });
const click = async (...args) => {
  const p = await scenePoint(...args);
  await page.mouse.click(p.x, p.y);
};
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 7 });
  await page.mouse.up();
};
const selectTrunk = async (index = 0) => {
  await click("trunk", null, index);
  await action("delete").waitFor();
};
const load = async () => {
  await page.evaluate(() => {
    const lab = window.WireNexusFactoryCatalogue.devices.find(device => device.id === "generic-qsfp-breakout-lab");
    restoreSnapshot({
      projectName: "QSFP breakout acceptance",
      devices: [["host", 50, 50], ["sink", 820, 50], ["spare", 820, 620]].map(([instanceId, x, y]) =>
        ({ instanceId, templateId: lab.id, x, y })),
      deviceLibrary: [lab], connections: []
    });
  });
  await waitReady();
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    Object.assign(bridge.camera, { x: -40, y: -20, zoom: .63 });
    bridge.scheduleRender();
  });
};

try {
  await page.goto(base);
  await waitReady();
  await page.locator("#deviceSearch").fill("Generic QSFP Breakout Lab");
  await page.locator("#deviceList").getByText("Generic QSFP Breakout Lab", { exact: true }).waitFor();
  await page.locator("#deviceSearch").fill("");
  await load();
  await click("port", ["host", "qsfp-plus"]);
  await action("create").click();
  const first = (await snapshot())[0];
  assert.equal(first.modeId, "qsfp-plus-4x10g");
  assert.equal(first.branches.length, 4);
  for (const lane of [4, 1, 3, 2]) {
    await drag(await scenePoint("tip", lane), await scenePoint("port", ["sink", `sfp-plus-${lane}`]));
    const record = (await snapshot())[0];
    assert.equal(record.branches[lane - 1].destination?.connectorId, `sfp-plus-${lane}`);
    assert.equal(record.branches[lane - 1].id, first.branches[lane - 1].id);
  }
  const occupied = await snapshot();
  await drag(await scenePoint("tip", 4), await scenePoint("port", ["sink", "sfp-plus-1"]));
  assert.deepEqual(await snapshot(), occupied);
  await drag(await scenePoint("tip", 4), await scenePoint("port", ["spare", "sfp-plus-1"]));
  assert.equal((await snapshot())[0].branches[3].destination.deviceId, "spare");
  await action("disconnect").click();
  assert.equal((await snapshot())[0].branches[3].destination, null);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal((await snapshot())[0].branches[3].destination.deviceId, "spare");
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  assert.equal((await snapshot())[0].branches[3].destination, null);
  await action("connect").click();
  await page.keyboard.press("Escape");
  assert.equal((await snapshot())[0].branches[3].destination, null);
  await selectTrunk();
  await inspector.locator('[name="length"]').fill("7.5");
  await inspector.locator("[data-breakout-length] button").click();
  assert.equal(await inspector.locator("[data-breakout-status]").innerText(), "Compatible");
  await inspector.locator("[data-breakout-routing]").selectOption("orthogonal");
  await action("add-point").click();
  const hub = await scenePoint("hub");
  await page.mouse.click(hub.x - 34, hub.y + 47);
  assert.equal((await snapshot())[0].routePoints.length, 1);
  await drag(hub, { x: hub.x + 40, y: hub.y - 25 });
  assert.ok((await snapshot())[0].fanoutOffset);
  const routed = await snapshot();
  assert.deepEqual(routed[0].length, { value: 7.5, unit: "m" });
  assert.equal(routed[0].routeStyle, "orthogonal");
  if (process.env.AVDESIGNER_BREAKOUT_SCREENSHOT) await page.screenshot({ path: process.env.AVDESIGNER_BREAKOUT_SCREENSHOT });
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.length), 0);
  const saved = await page.evaluate(() => projectJsonPayload());
  await page.locator("#fileInput").setInputFiles({ name: "breakout.avd", mimeType: "application/json",
    buffer: Buffer.from(typeof saved === "string" ? saved : JSON.stringify(saved)) });
  await waitReady();
  assert.deepEqual(await snapshot(), routed);

  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    Object.assign(bridge.camera, { x: -40, y: -20, zoom: .63 });
    bridge.scheduleRender();
  });
  await click("port", ["host", "qsfp28"]);
  await inspector.locator("[data-breakout-type]").selectOption("aoc");
  await action("create").click();
  assert.equal((await snapshot())[1].cableType, "breakout-qsfp28-4x25g-aoc");
  await drag(await scenePoint("tip", 2, 1), await scenePoint("port", ["sink", "sfp28-3"]));
  assert.equal((await snapshot())[1].branches[1].destination.connectorId, "sfp28-3");
  await action("trunk").click();
  await action("delete").click();
  assert.deepEqual(await snapshot(), routed);
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.scene.selectOnly("sink");
    bridge.deleteSelectedDevices();
  });
  assert.ok((await snapshot())[0].branches.every(branch => !branch.destination));
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.deepEqual(await snapshot(), routed);
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.scene.selectOnly("host");
    bridge.deleteSelectedDevices();
  });
  assert.deepEqual(await snapshot(), []);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.deepEqual(await snapshot(), routed);
  assert.deepEqual(errors, []);
  console.log("Chrome QSFP breakout acceptance passed: both modes, out-of-order branches, rejected drop, replug, disconnect, trunk routing/length, .avd reload and device deletion/undo.");
} finally {
  await browser.close();
}
