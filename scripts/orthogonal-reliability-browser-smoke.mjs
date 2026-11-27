import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = new URL(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8953");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname));
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = (x, y, id) => ({ x, y, ...(id ? { id } : {}) });
const authored = (wire, routePoints) => Object.assign(wire, {
  routeStyle: "orthogonal", routeAutomatic: false, manualRoute: true, manualRouteStyle: "orthogonal", routePoints
});
const patch = () => [p(425, 170, "A"), p(425, 230, "B"), p(640, 230, "C"), p(640, 330, "D")];
const orthogonal = points => points.slice(1).forEach((point, i) =>
  assert.ok(point.x === points[i].x || point.y === points[i].y, "every segment is orthogonal"));

function fixture(count = 1) {
  const project = cableTypeSelectionFixture();
  project.wireMode = "orthogonal";
  project.devices[1].y = 160;
  project.connections = project.connections.slice(0, count);
  project.connections.forEach((wire, i) => Object.assign(wire, {
    routeStyle: "orthogonal", routeAutomatic: true, cableNumber: "VX-" + String(i + 1).padStart(3, "0")
  }));
  return project;
}

try {
  const context = await browser.newContext({ viewport: { width: 2050, height: 1200 }, acceptDownloads: true });
  await context.route("**/*", route => new URL(route.request().url()).origin === base.origin &&
    route.request().method() === "GET" ? route.continue() : route.abort());
  await context.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto(base.href);
  await page.waitForFunction(() => typeof activeEngineBridge === "function" && activeEngineBridge()?.ready && localUserSettingsLoaded);
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const load = async (project, zoom = .85) => {
    const data = Buffer.isBuffer(project) ? project : Buffer.from(JSON.stringify(project));
    await page.locator("#fileInput").setInputFiles({ name: "routing.avd", mimeType: "application/json", buffer: data });
    await page.waitForFunction(() => activeEngineBridge()?.ready);
    await page.evaluate(zoom => activeEngineBridge().centerCameraAtWorldPoint({ x: 575, y: 425 }, "orthogonal-smoke", { zoom }), zoom);
    await frame();
  };
  const screen = point => page.evaluate(point => {
    const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect(), s = bridge.worldToScreenPoint(point);
    return [rect.x + s.x, rect.y + s.y];
  }, point);
  const port = (deviceId, connectorId = "port-0") => page.evaluate(([id, connector]) => {
    const { scene } = activeEngineBridge();
    return scene.connectorWorldPoint(scene.getDevice(id), scene.getConnector(id, connector));
  }, [deviceId, connectorId]);
  const read = (id = "cable-0") => page.evaluate(id => {
    const b = activeEngineBridge(), wire = b.scene.getWire(id);
    return structuredClone({ raw: state.connections.find(w => w.id === id), path: b.scene.wireRenderPolyline(wire),
      history: b.commandIndex, dirty: b.productionDirty, mutation: b.mutations.lastMutation });
  }, id);
  const drag = async (from, to, inspect, via) => {
    const start = await screen(from), end = await screen(to);
    await page.mouse.move(...start);
    await page.mouse.down();
    if (via) await page.mouse.move(...await screen(via), { steps: 8 });
    await page.mouse.move(...end, { steps: 12 });
    const result = inspect ? await inspect() : undefined;
    await page.mouse.up();
    await frame();
    return result;
  };
  const snapping = async enabled => {
    if ((await page.evaluate(() => activeEngineBridge().objectSnappingEnabled())) !== enabled) {
      await page.locator("#objectSnappingToggle").click();
    }
  };

  let project = fixture(2);
  authored(project.connections[0], patch());
  const spare = structuredClone(project.devices[1]);
  Object.assign(spare, { instanceId: "spare", x: 650, y: -180 });
  project.devices.push(spare);
  await load(project);
  const initial = await read();
  await drag(await port("sink"), await port("sink", "port-1"));
  assert.deepEqual(await read(), initial, "occupied destination is rejected without geometry or history changes");
  const preview = await drag(await port("sink"), await port("spare"), () => page.evaluate(() => {
    const temp = activeEngineBridge().interactionRenderState().tempWire;
    if (!temp.validTarget) throw Error("Expected compatible replug target");
    return [temp.from, ...temp.routePoints, temp.to];
  }));
  const replugged = await read();
  assert.deepEqual(replugged.path, preview, "visible preview agrees with committed geometry");
  assert.equal(replugged.raw.to.deviceId, "spare");
  assert.deepEqual(replugged.raw.routePoints.slice(0, 3), initial.raw.routePoints.slice(0, 3));
  assert.ok(preview.at(-1).x - preview.at(-2).x >= 33);
  orthogonal(preview);
  console.log("PASS: replug preview, clearance, preserved bends, occupied-target rejection");

  await snapping(false);
  const firstBend = p(425, 200);
  await drag(firstBend, p(460, 200));
  const edited = await read();
  assert.notDeepEqual(edited.path, replugged.path);
  for (const [command, expected] of [
    ["undoAction", replugged], ["undoAction", initial], ["redoAction", replugged], ["redoAction", edited]
  ]) {
    await page.locator("#" + command).click();
    const current = await read();
    assert.deepEqual(current.raw, expected.raw);
    assert.deepEqual(current.path, expected.path);
  }
  const download = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  await load(await readFile(await (await download).path()));
  assert.deepEqual((await read()).path, edited.path);
  assert.deepEqual((await read()).raw, edited.raw);
  const exportPending = page.waitForEvent("download");
  await page.locator("#exportHtml").click();
  const viewerPath = join(await mkdtemp(join(tmpdir(), "wirenexus-ortho-")), "routing.html");
  await (await exportPending).saveAs(viewerPath);
  const offline = await browser.newContext({ offline: true });
  const viewer = await offline.newPage();
  await viewer.goto(pathToFileURL(viewerPath).href);
  await viewer.waitForFunction(() => typeof outputViewer !== "undefined" && outputViewer?.model);
  assert.deepEqual(await viewer.evaluate(() => {
    const scene = outputViewer.scene;
    return scene.wireRenderPolyline(scene.getWire("cable-0"));
  }), edited.path);
  await offline.close();
  console.log("PASS: sequential Undo/Redo, saved route reopen, and offline HTML Viewer");

  project = fixture();
  authored(project.connections[0], patch());
  await load(project, .75);
  await drag(p(870, 213), p(870, 598));
  const beforeCrossing = await read();
  await drag(p(870, 598), p(220, 598));
  const crossed = await read(), last = crossed.path.at(-1), adjacent = crossed.path.at(-2);
  assert.ok(last.x < crossed.path[0].x, "destination moved past the source");
  assert.ok(last.x - adjacent.x >= 33 && last.y === adjacent.y, "left-facing socket is still approached from the left");
  assert.deepEqual(crossed.raw.routePoints.slice(0, 3), beforeCrossing.raw.routePoints.slice(0, 3));
  orthogonal(crossed.path);
  console.log("PASS: real device move across the opposite endpoint");

  project = fixture(2);
  authored(project.connections[0], [p(550, 170, "remote"), p(400, 170), p(400, 230), p(620, 230), p(620, 330)]);
  authored(project.connections[1], [p(650, 234), p(650, 394)]);
  await load(project, 1);
  await snapping(true);
  const beforeSnap = await read(), neighbor = await read("cable-1");
  const snap = await drag(p(620, 280), p(634, 280), () => page.evaluate(() => activeEngineBridge().wireSegmentDrag?.lastSnap));
  assert.equal(snap?.source, "spacing");
  assert.equal(snap.after, 635);
  assert.deepEqual((await read()).raw.routePoints.slice(0, 3), beforeSnap.raw.routePoints.slice(0, 3));
  assert.deepEqual((await read("cable-1")).raw, neighbor.raw);
  console.log("PASS: parallel snap leaves a distant authored backtrack and the other cable intact");

  await load(fixture());
  const beforeNoOp = await read(), bend = beforeNoOp.path[1], start = p(bend.x, bend.y + 70);
  await drag(start, p(start.x, start.y + 30));
  assert.deepEqual(await read(), beforeNoOp);
  await drag(start, start, null, p(start.x + 50, start.y));
  assert.deepEqual(await read(), beforeNoOp);
  console.log("PASS: along-axis and return-to-start drags do not change ownership, dirty state, mutations, or history");

  project = fixture(2);
  authored(project.connections[0], [p(464, 170), p(464, 179), p(630, 179), p(630, 330)]);
  authored(project.connections[1], [p(490, 234), p(490, 179), p(590, 179), p(590, 394)]);
  await load(project, .7);
  const overlapping = await read("cable-1");
  await page.mouse.click(...await screen(p(609, 179)));
  await drag(p(464, 174), p(505, 174));
  orthogonal((await read()).path);
  assert.deepEqual((await read("cable-1")).raw, overlapping.raw);
  assert.deepEqual((await read("cable-1")).path, overlapping.path);
  console.log("PASS: short runs and coincident routes leave the other cable unchanged");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
