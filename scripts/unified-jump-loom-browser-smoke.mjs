import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const shots = "/tmp/wirenexus-unified-jump-loom";
mkdirSync(shots, { recursive: true });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const fixture = bidirectionalJumpFixture("output", "input"); fixture.connections = []; fixture.jumpNodes = [];
  await page.evaluate(project => restoreSnapshot(project), fixture);
  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 1; bridge.scheduleRender(); });
  const screen = point => page.evaluate(point => {
    const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.top + (point.y - bridge.camera.y) * bridge.camera.zoom };
  }, point);
  const read = () => page.evaluate(async () => {
    const bridge = activeEngineBridge(), { jumpNodeStatusDotColor } = await import("./src/engine/renderer.js");
    return { nodes: structuredClone(state.jumpNodes), links: structuredClone(state.jumpLinks), wires: structuredClone(state.connections),
      dots: state.jumpNodes.map(node => jumpNodeStatusDotColor(bridge.scene.getDevice(node.id))),
      history: bridge.commandIndex };
  });
  await page.locator("#jumpNodeTool").click();
  for (const point of [{ x: 450, y: 270 }, { x: 720, y: 450 }]) {
    const p = await screen(point); await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press("Escape");
  const inserted = await read(); assert.equal(inserted.nodes.length, 2);
  const [a, b] = inserted.nodes;
  let from = await screen(a);
  const to = await screen(b);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.waitForTimeout(320);
  assert.equal(await page.evaluate(() => Boolean(activeEngineBridge().jumpLinkCreate)), true);
  await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
  const paired = await read();
  assert.equal(paired.links.length, 1); assert.equal(paired.links[0].deviceIndependent, true);
  assert.deepEqual(paired.wires, []); assert.deepEqual(paired.dots, ["#a855f7", "#a855f7"]);
  await page.screenshot({ path: `${shots}/pass-a-empty-paired.png` });
  await page.keyboard.press("Meta+z"); assert.equal((await read()).links.length, 0);
  await page.keyboard.press("Meta+Shift+z"); assert.deepEqual((await read()).links, paired.links);
  const saved = await page.evaluate(() => projectSnapshotData({ forEngine: true }));
  await page.evaluate(project => restoreSnapshot(project), saved);
  from = await screen(a);
  assert.deepEqual((await read()).dots, ["#a855f7", "#a855f7"]);
  const connector = await page.evaluate(() => {
    const bridge = activeEngineBridge(), device = bridge.scene.getDevice("source");
    return bridge.scene.connectorWorldPoint(device, bridge.scene.getConnector("source", "port"));
  });
  const port = await screen(connector);
  await page.mouse.move(port.x, port.y); await page.mouse.down(); await page.mouse.move(from.x, from.y, { steps: 5 }); await page.mouse.up();
  assert.equal((await read()).wires.length, 1);
  assert.deepEqual((await read()).dots, ["", "#a855f7"]);
  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.scene.selectWireOnly(bridge.scene.wires[0].id); bridge.updateSelectionHud(); });
  await page.keyboard.press("Delete");
  assert.deepEqual((await read()).dots, ["#a855f7", "#a855f7"]);
  assert.equal((await read()).links.length, 1);
  const artifacts = await page.evaluate(async () => {
    const snapshot = buildCanonicalOutputSnapshot({ projectData: projectSnapshotData({ forEngine: true }), mode: "unified-jump" });
    const drawing = await buildEnginePrintDrawing(snapshot), [module, bundle] = await engineViewerResources();
    return { html: module.buildEngineViewerHtml(snapshot, { bundle }), svg: drawing.svg };
  });
  assert.match(artifacts.svg, /rgba\(168,85,247,1\)/, "purple centered dots are vector artwork");
  const offline = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await offline.route("**/*", route => route.abort());
  await offline.setContent(artifacts.html); await offline.waitForFunction(() => Boolean(window.outputViewer));
  assert.equal(await offline.evaluate(() => outputViewer.scene.jumpLinks.length), 1);
  await offline.screenshot({ path: `${shots}/pass-a-offline-viewer.png` }); await offline.close();
  await page.mouse.click(from.x, from.y);
  await page.locator("#jumpDisconnectPair").click();
  assert.deepEqual((await read()).dots, ["", ""]);
  await page.mouse.move(port.x, port.y); await page.mouse.down(); await page.mouse.move(from.x, from.y, { steps: 5 }); await page.mouse.up();
  assert.deepEqual((await read()).dots, ["#ef4444", ""]);
  await page.screenshot({ path: `${shots}/pass-a-connected-unpaired.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passA: "PASS", shots, browserErrors: errors.length }));
} finally { await browser.close(); }
