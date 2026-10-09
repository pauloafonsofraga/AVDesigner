import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { JUMP_NODE_ROLE, JUMP_NODE_ROLE_COLORS } from "../src/engine/jumpNodeModel.js";
import { jumpNodeBodyGlowEnabled } from "../src/engine/renderer.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const screenshotDir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-jump-glow";
mkdirSync(screenshotDir, { recursive: true });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

const connector = (id, direction, side, x) => ({ id, type: "hdmi", physicalType: "hdmi",
  connectorType: "hdmi", direction, signalDirection: direction, displaySide: side, x, y: 130 });
const device = (id, name, direction, x, side) => ({ instanceId: id, templateId: id, name, x, y: 160,
  templateOverride: { id, name, model: name, width: 240, height: 280,
    connectors: [connector(`${id}-port`, direction, side, side === "left" ? 0 : 240)] } });
const project = { version: 1, projectName: "Jump glow state smoke", nodeLibrary: [], deviceLibrary: [],
  devices: [device("out", "Output Device", "output", 0, "right"), device("in", "Input Device", "input", 900, "left")],
  connections: [
    { id: "wire-out", cableType: "hdmi", from: { deviceId: "out", connectorId: "out-port" }, to: { jumpNodeId: "jump-a" } },
    { id: "wire-in", cableType: "hdmi", from: { jumpNodeId: "jump-b" }, to: { deviceId: "in", connectorId: "in-port" } }
  ],
  jumpNodes: [{ id: "jump-a", x: 420, y: 270 }, { id: "jump-b", x: 660, y: 270 }],
  jumpLinks: [], ledSurfaces: [], areas: [], racks: [], looms: [], comments: [], titleBlocks: [], imageObjects: [] };

const readNodes = () => page.evaluate(() => {
  const bridge = activeEngineBridge();
  return ["jump-a", "jump-b"].map(id => {
    const node = bridge.scene.getDevice(id);
    return { id, role: node.visual.jumpRole, color: node.visual.jumpColor,
      localWire: node.visual.jumpLocalWireId, pair: node.visual.jumpPairedId,
      selected: bridge.scene.selectedIds.has(id) };
  });
});
const glowFor = node => jumpNodeBodyGlowEnabled({ visual: {
  jumpLocalWireId: node.localWire, jumpPairedId: node.pair
} });
const pointFor = id => page.evaluate(id => {
  const bridge = activeEngineBridge(), node = bridge.scene.getDevice(id);
  const rect = bridge.canvas.getBoundingClientRect();
  const point = bridge.worldToScreenPoint({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
  return { x: rect.left + point.x, y: rect.top + point.y };
}, id);
const screenshot = name => page.screenshot({ path: join(screenshotDir, `${name}.png`) });

try {
  const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  await page.evaluate(snapshot => restoreSnapshot(snapshot), project);
  await page.waitForFunction(() => activeEngineBridge()?.ready
    && activeEngineBridge().scene.getDevice("jump-a")?.visual.jumpLocalWireId
    && activeEngineBridge().scene.getDevice("jump-b")?.visual.jumpLocalWireId);
  await page.evaluate(() => activeEngineBridge().fitView());

  let nodes = await readNodes();
  assert.deepEqual(nodes.map(node => node.role), [JUMP_NODE_ROLE.output, JUMP_NODE_ROLE.input]);
  assert.deepEqual(nodes.map(node => node.color), [JUMP_NODE_ROLE_COLORS.output, JUMP_NODE_ROLE_COLORS.input]);
  assert.ok(nodes.every(node => node.localWire && !node.pair && !glowFor(node)),
    "device-connected unpaired nodes keep roles but disable normal glow");
  await screenshot("connected-unpaired");

  const jumpPoint = await pointFor("jump-a");
  await page.mouse.click(jumpPoint.x, jumpPoint.y);
  nodes = await readNodes();
  assert.equal(nodes[0].selected, true, "real canvas selection still selects the Jump");
  assert.equal(glowFor(nodes[0]), false,
    "selection state does not turn the normal role glow back on");
  await screenshot("selected-unpaired");
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.scene.selectedIds.clear();
    bridge.scheduleRender();
  });
  assert.equal((await readNodes())[0].selected, false, "Jump can be deselected independently of role glow");
  await page.mouse.move(8, 8);
  await page.mouse.move(jumpPoint.x, jumpPoint.y);
  await page.waitForTimeout(100);
  await screenshot("hovered-unpaired");
  await page.mouse.move(8, 8);

  const paired = await page.evaluate(() => {
    const scene = activeEngineBridge().scene;
    return scene.addJumpLink({ id: "link-a-b", outputJumpId: "jump-a", inputJumpId: "jump-b" });
  });
  assert.ok(paired, "existing pair operation accepts the connected output/input roles");
  await page.evaluate(() => activeEngineBridge().scheduleRender());
  nodes = await readNodes();
  assert.deepEqual(nodes.map(node => node.role), [JUMP_NODE_ROLE.output, JUMP_NODE_ROLE.input]);
  assert.ok(nodes.every(node => node.pair && glowFor(node)),
    "pairing turns normal glow on for both nodes without changing roles/colors");
  await screenshot("paired");

  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.scene.deleteJumpLink("link-a-b");
    bridge.scheduleRender();
  });
  nodes = await readNodes();
  assert.ok(nodes.every(node => node.localWire && !node.pair && !glowFor(node)),
    "removing the pair immediately restores connected/unpaired state");
  await screenshot("pair-disconnected");

  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.scene.deleteWire("wire-out");
    bridge.scheduleRender();
  });
  nodes = await readNodes();
  assert.equal(nodes[0].role, JUMP_NODE_ROLE.neutral);
  assert.equal(nodes[0].color, JUMP_NODE_ROLE_COLORS.neutral);
  assert.equal(nodes[0].localWire, "");
  assert.equal(glowFor(nodes[0]), true,
    "removing the device wire returns the Jump to its neutral normal rendering");
  assert.deepEqual(errors, [], "browser workflow has no console or page errors");
  await screenshot("device-wire-removed");
  console.log("Jump Node glow browser smoke PASS", JSON.stringify({
    states: ["connected-unpaired", "selected-unpaired", "hovered-unpaired", "paired", "pair-disconnected", "device-wire-removed"],
    finalNodes: nodes, browserErrors: errors.length, screenshots: screenshotDir
  }));
} finally {
  await browser.close();
}
