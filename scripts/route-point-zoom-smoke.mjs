import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = mkdtempSync(join(tmpdir(), "avd-route-point-zoom-")), checks = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const screen = p => page.evaluate(p => {
    const b = activeEngineBridge(), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom };
  }, p);
  const points = () => page.evaluate(() => structuredClone(activeEngineBridge().scene.getWire("cable-0").routePoints));
  for (const route of ["bezier", "orthogonal"]) {
    for (const zoom of [0.34, 0.2, 1]) {
      console.log(`Checking ${route} at ${zoom * 100}%`);
      const project = { ...cableTypeSelectionFixture(), wireMode: route };
      if (route === "orthogonal") project.connections.forEach(wire => { wire.orthogonalRoutePoints = []; });
      await page.evaluate(({ project, zoom }) => {
        restoreSnapshot(project);
        activeEngineBridge().centerCameraAtWorldPoint({ x: 520, y: 170 }, "route-point-test", { zoom });
      }, { project, zoom });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const center = await screen({ x: 520, y: 170 });
      await page.mouse.click(center.x, center.y, { button: "right" });
      await page.getByRole("button", { name: "Create Corner", exact: true }).click();
      assert.equal(await page.evaluate(() => activeEngineBridge().scene.getWire("cable-0").routeStyle), route === "orthogonal" ? "orthogonal" : "custom");
      const initial = await points(), index = initial.findIndex(p => Math.hypot(p.x - 520, p.y - 170) < 2);
      assert.ok(index >= 0, "real context menu creates a custom point at the clicked position");
      const start = await screen(initial[index]);
      const before = await page.evaluate(() => {
        const b = activeEngineBridge(), wire = b.scene.getWire("cable-0");
        return { history: b.commandHistory.length, rebuilds: b.renderer.fullRebuildCount,
          otherWires: structuredClone(state.connections.filter(w => w.id !== "cable-0")),
          endpoints: [b.scene.endpointForWire(wire, "from"), b.scene.endpointForWire(wire, "to")] };
      });
      // Start outside the tiny visible ring, inside the stable screen-space hit area.
      await page.mouse.move(start.x, start.y - 9);
      await page.waitForFunction(index => activeEngineBridge().hoverState.routePoint?.pointIndex === index, index);
      await page.mouse.down();
      assert.equal(await page.evaluate(() => activeEngineBridge().routePointDrag?.wireId), "cable-0");
      assert.equal(await page.evaluate(() => Boolean(activeEngineBridge().wireCreate || activeEngineBridge().wireSegmentDrag)), false);
      const target = { x: 600, y: 50 }, end = await screen(target);
      await page.mouse.move(end.x, end.y, { steps: 8 });
      const activeIndex = await page.evaluate(() => activeEngineBridge().routePointDrag.pointIndex);
      await page.mouse.up();
      const moved = await points();
      assert.ok(Math.hypot(moved[activeIndex].x - target.x, moved[activeIndex].y - target.y) < 1);
      const after = await page.evaluate(() => {
        const b = activeEngineBridge(), wire = b.scene.getWire("cable-0");
        return { history: b.commandHistory.length, rebuilds: b.renderer.fullRebuildCount,
          otherWires: structuredClone(state.connections.filter(w => w.id !== "cable-0")),
          endpoints: [b.scene.endpointForWire(wire, "from"), b.scene.endpointForWire(wire, "to")] };
      });
      assert.deepEqual(after, { ...before, history: before.history + 1 }, "only the edited route and one history entry change");
      await page.screenshot({ path: join(directory, `${route}-${Math.round(zoom * 100)}-dragged.png`) });
      await page.keyboard.press("Control+z"); assert.deepEqual(await points(), initial);
      await page.keyboard.press("Control+Shift+z"); assert.deepEqual(await points(), moved);
      checks.push(`${route} at ${Math.round(zoom * 100)}%: native create/hover/drag, constant grab radius, one undo/redo, no endpoint changes or full rebuild`);

      await page.evaluate(() => restoreSnapshot(projectSnapshot()));
      assert.deepEqual(await points(), moved.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })), "project normalization retains logical-pixel precision");
      await page.evaluate(({ target, zoom }) => {
        const b = activeEngineBridge(); b.scene.selectWireOnly("cable-0"); b.updateSelectionHud();
        b.centerCameraAtWorldPoint(target, "route-point-reloaded", { zoom });
      }, { target: moved[activeIndex], zoom });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const reloaded = await screen(moved[activeIndex]);
      assert.equal(await page.evaluate(p => activeEngineBridge().contextMenuTarget({ clientX: p.x, clientY: p.y - 9 })?.type, reloaded), "wire-corner");
      await page.mouse.click(reloaded.x, reloaded.y - 9, { button: "right" });
      try { await page.getByRole("button", { name: "Delete Corner", exact: true }).waitFor({ timeout: 5000 }); }
      catch (error) {
        console.error(JSON.stringify({ route, zoom, reloaded, errors, state: await page.evaluate(p => {
          const b = activeEngineBridge();
          return { target: b.contextMenuTarget({ clientX: p.x, clientY: p.y - 9 }), camera: b.camera,
            selected: [...b.scene.selectedWireIds], ready: b.ready, mode: state.wireMode,
            menu: deviceContextMenu.outerHTML, wire: state.connections.find(w => w.id === "cable-0") };
        }, reloaded) }));
        throw error;
      }
      await page.keyboard.press("Escape");
      await page.mouse.click(reloaded.x - 100, reloaded.y - 100);
      checks.push(`${route} at ${Math.round(zoom * 100)}%: saved route reloads and its point context menu remains reachable`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, errors, directory }, null, 2));
} finally { await browser.close(); }
