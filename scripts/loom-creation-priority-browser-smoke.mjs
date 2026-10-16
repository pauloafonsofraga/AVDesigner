import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const shots = "/tmp/wirenexus-loom-priority";
mkdirSync(shots, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const fixture = jumpHoldFixture();
  fixture.devices = fixture.devices.slice(0, 2);
  fixture.connections = []; fixture.jumpLinks = [];
  fixture.jumpNodes = [{ id: "empty-jump", x: 600, y: 450 }];
  fixture.objectSnapping = false;
  fixture.looms = [{ id: "existing", name: "Existing", routeStyle: "orthogonal",
    sideA: { x: 150, y: 550 }, sideB: { x: 500, y: 550 }, routePoints: [],
    portalPairs: [{ id: "loom-portal-1", name: "LP-001",
      attachment: { fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 },
      portalB: { x: 750, y: 550 } }] }];
  const reset = async style => {
    await page.evaluate(async project => {
      await restoreSnapshot(project);
      const bridge = activeEngineBridge();
      bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 1; bridge.scheduleRender();
    }, { ...fixture, wireMode: style });
    await page.waitForFunction(() => activeEngineBridge()?.ready);
    assert.deepEqual(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].portalPair.portalB),
      { x: 750, y: 550 }, "Priority fixture must include a real, normalized Portal hit target");
  };
  const screen = point => page.evaluate(point => {
    const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.top + (point.y - bridge.camera.y) * bridge.camera.zoom };
  }, point);
  const click = async (point, double = false) => { const p = await screen(point);
    await page.mouse[double ? "dblclick" : "click"](p.x, p.y); };
  const move = async point => { const p = await screen(point); await page.mouse.move(p.x, p.y, { steps: 3 }); };
  const read = () => page.evaluate(() => {
    const bridge = activeEngineBridge(), button = document.querySelector("#createCableLoom");
    return { active: bridge.loomCreationActive, pressed: button.getAttribute("aria-pressed"),
      buttonActive: button.classList.contains("active"), color: getComputedStyle(button).borderColor,
      cursor: bridge.canvas.style.cursor, shellTool: activeEngineCanvasLayoutTool(),
      draft: bridge.loomCreate && structuredClone({ sideA: bridge.loomCreate.sideA,
        placed: bridge.loomCreate.sideAPlaced, pointer: bridge.loomCreate.pointerWorld,
        points: bridge.loomCreate.routePoints, hover: bridge.loomCreate.jumpHover }),
      looms: structuredClone(state.looms), history: bridge.commandIndex,
      otherObjects: JSON.stringify([state.devices, state.connections, state.jumpNodes, state.areas, state.comments, state.titleBlocks]),
      intercepted: Boolean(bridge.loomHeadDrag || bridge.pendingDrag || bridge.wireCreate || bridge.marqueeState) };
  });
  let cases = 0;
  for (const style of ["bezier", "orthogonal"]) for (const tool of ["none", "commentTool", "areaTool", "title-block", "jumpNodeTool"]) {
    await reset(style);
    const before = await read();
    if (tool === "title-block") await page.evaluate(() => startTitleBlockPlacement());
    else if (tool !== "none") await page.locator(`#${tool}`).click();
    if (["commentTool", "areaTool"].includes(tool)) await click({ x: 90, y: 80 });
    await page.locator("#createCableLoom").click();
    let current = await read();
    assert.equal(current.active, true); assert.equal(current.pressed, "true");
    assert.equal(current.buttonActive, true); assert.equal(current.cursor, "crosshair");
    assert.equal(current.color, "rgb(251, 121, 4)", "Active Loom button uses the orange selection color");
    assert.equal(current.shellTool, "", `${tool} must be retired when Loom activates`);
    assert.equal(current.draft.placed, undefined);
    await click({ x: 120, y: 100 });
    current = await read(); assert.equal(current.draft.placed, true);
    assert.deepEqual(current.draft.sideA, { x: 120, y: 100 });
    await move({ x: 340, y: 180 });
    current = await read(); assert.deepEqual(current.draft.pointer, { x: 340, y: 180 });
    assert.equal(current.draft.points.length, 0);
    const preview = await page.evaluate(async () => {
      const { loomCreationPreviewPoints } = await import("./src/engine/loomGeometry.js");
      return loomCreationPreviewPoints(activeEngineBridge().loomCreate);
    });
    assert.ok(preview.length >= 2);
    if (style === "bezier" && tool === "areaTool") await page.screenshot({ path: `${shots}/live-preview.png` });
    await click({ x: 340, y: 180 }); await click({ x: 400, y: 280 });
    assert.equal((await read()).draft.points.length, 2);
    await click({ x: 850, y: 340 }, true);
    current = await read(); assert.equal(current.active, false); assert.equal(current.pressed, "false");
    assert.equal(current.looms.length, 2); assert.equal(current.history, before.history + 1);
    const loom = current.looms.at(-1);
    assert.equal(loom.routeStyle, style);
    assert.deepEqual(loom.routePoints.map(({ x, y }) => ({ x, y })), [{ x: 340, y: 180 }, { x: 400, y: 280 }]);
    assert.deepEqual({ x: loom.sideB.x, y: loom.sideB.y }, { x: 850, y: 340 });
    assert.equal(current.otherObjects, before.otherObjects);
    cases++;
  }
  await reset("bezier");
  const before = await read();
  const devicePort = await page.evaluate(() => {
    const bridge = activeEngineBridge(), device = bridge.scene.getDevice("source");
    return bridge.scene.connectorWorldPoint(device, device.connectors[0]);
  });
  for (const point of [{ x: 750, y: 550 }, { x: 600, y: 450 }, devicePort]) {
    await page.locator("#createCableLoom").click();
    await click(point);
    const current = await read();
    assert.equal(current.draft.placed, true, "First click must place Side A even over another hit target");
    assert.equal(current.intercepted, false);
    assert.equal(current.looms.length, before.looms.length);
    await page.keyboard.press("Backspace"); assert.equal((await read()).draft.placed, true);
    await page.keyboard.press("Escape");
    assert.equal((await read()).draft, null); assert.equal((await read()).history, before.history);
    assert.deepEqual((await read()).looms, before.looms);
    cases++;
  }
  for (let i = 0; i < 3; i++) {
    await page.locator("#createCableLoom").click();
    await click({ x: 120, y: 100 }); await click({ x: 340, y: 180 });
    await page.keyboard.press("Escape");
    assert.equal((await read()).draft, null); assert.equal((await read()).history, before.history);
    await page.locator("#createCableLoom").click(); await page.locator("#createCableLoom").click();
    assert.equal((await read()).active, false);
    cases++;
  }
  await page.locator("#createCableLoom").click();
  await click({ x: 120, y: 100 });
  await move({ x: 600, y: 450 });
  assert.equal((await read()).draft.hover.valid, true);
  await page.screenshot({ path: `${shots}/jump-hover.png` });
  await click({ x: 600, y: 450 });
  assert.equal((await read()).looms.at(-1).jumpRouting.entryJumpId, "empty-jump");
  cases++;
  await reset("bezier");
  await page.locator("#createCableLoom").click();
  await click({ x: 120, y: 100 }); await click({ x: 850, y: 340 }, true);
  assert.deepEqual((await read()).looms.at(-1).routePoints, [], "Simple two-endpoint Loom has no stray final waypoint");
  await page.screenshot({ path: `${shots}/completed.png` });
  cases++;
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, cases, errors, shots }));
} finally { await browser.close(); }
