import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { canvasClipboardFixture } from "../fixtures/canvas-clipboard.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const results = [], errors = [];
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
const open = async () => {
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.avDesignerEngineBridge?.ready && canvasClipboardModule);
  await page.evaluate(() => {
    window.clipboardEvents = [];
    window.nativeClipboardWrites = 0;
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function(...args) { window.nativeClipboardWrites++; return setData.apply(this, args); };
    for (const type of ["copy", "paste"]) document.addEventListener(type, e => window.clipboardEvents.push({ type, trusted: e.isTrusted }));
  });
  return page;
};
const snapshot = page => page.evaluate(() => JSON.parse(JSON.stringify(canvasClipboardProject())));
const shortcut = async (page, key) => {
  await page.bringToFront(); await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(`${modifier}+${key}`);
};
const count = page => page.evaluate(() => state.devices.length);
const loaded = async (page, fixture) => {
  await page.evaluate(project => { applySerializedNodeLibrary(project.nodeLibrary || []); restoreSnapshot(project); state.projectName = project.projectName; }, fixture);
  await page.waitForFunction(() => window.avDesignerEngineBridge.ready);
};
const select = page => page.evaluate(() => {
  const bridge = activeEngineBridge();
  bridge.scene.selectMany(bridge.scene.devices.filter(d => d.sourceId !== "external").map(d => d.id));
  bridge.scene.selectedRackIds = new Set(["rack"]); bridge.updateSelectionHud();
});
try {
  const a = await open(), b = await open(), fixture = canvasClipboardFixture();
  fixture.project.nodeLibrary = [{ id: "clipboard-custom-sdi", label: "Custom SDI", color: "#123456", custom: true }];
  fixture.project.deviceLibrary[0].connectors[0].type = "clipboard-custom-sdi";
  await loaded(a, { ...fixture.project, projectName: "Source clipboard project" });
  await a.evaluate(async () => {
    const image = state.imageObjects[0];
    image.image = URL.createObjectURL(await (await fetch(image.image)).blob());
  });
  const destination = { devices: [{ ...structuredClone(fixture.project.devices.find(d => d.instanceId === "ordinary-b")),
    instanceId: "destination-only", x: 10000, y: 10000 }],
    deviceLibrary: [{ ...fixture.project.deviceLibrary[0], name: "Destination definition collision" }],
    nodeLibrary: [{ id: "clipboard-custom-sdi", label: "Other custom port", color: "#654321", custom: true }], projectName: "Different destination" };
  await loaded(b, destination); await select(a);
  const source = await snapshot(a), before = await snapshot(b);
  const camera = await b.evaluate(() => ({ ...activeEngineBridge().camera }));
  await shortcut(a, "c");
  await a.waitForFunction(() => document.querySelector("#statusText").textContent.includes("system clipboard"));
  const text = await a.evaluate(() => navigator.clipboard.readText());
  assert.ok(text.startsWith("AVDESIGNER_SELECTION_V1:"));
  const payload = JSON.parse(text.slice(text.indexOf(":") + 1));
  await shortcut(b, "v");
  await b.waitForFunction(n => state.devices.length === n, 1 + payload.devices.length);
  const after = await snapshot(b), plan = await b.evaluate(() => ({ selected: state.selected, history: activeEngineBridge().commandHistory.length }));
  assert.deepEqual(await snapshot(a), source, "source project unchanged");
  assert.equal(plan.history, 1); assert.ok(plan.selected.items.length > 10);
  assert.deepEqual(await b.evaluate(() => ({ ...activeEngineBridge().camera })), camera);
  assert.ok(after.devices.slice(1).every(d => !source.devices.some(s => s.instanceId === d.instanceId)));
  assert.equal(after.imageObjects.length, 1); assert.equal(after.racks.length, 1);
  assert.ok(after.imageObjects[0].image.startsWith("data:image/png;"));
  assert.equal(after.jumpLinks.length, 1); assert.equal(after.jumpNodes.length, 3);
  assert.equal(after.jumpNodes[0].pairId, after.jumpNodes[1].pairId); assert.equal(after.jumpNodes[2].pairId, undefined);
  assert.equal(after.connections.length, payload.connections.length);
  assert.ok(after.connections.every(w => !w.id.includes("external")));
  assert.equal(after.deviceLibrary.length, 2);
  const delta = { x: after.devices[1].x - payload.devices[0].x, y: after.devices[1].y - payload.devices[0].y };
  payload.devices.forEach((d, i) => {
    assert.equal(after.devices[i + 1].x - d.x, delta.x); assert.equal(after.devices[i + 1].y - d.y, delta.y);
  });
  payload.connections.forEach((w, i) => {
    for (const key of ["routePoints", "orthogonalRoutePoints"]) if (w[key]) assert.deepEqual(after.connections[i][key], w[key].map(p => ({ x: p.x + delta.x, y: p.y + delta.y })));
  });
  assert.equal(await b.evaluate(() => activeEngineBridge().scene.meta.skippedWires), 0);
  results.push("native trusted two-tab copy/paste, mixed objects, geometry, dependencies, source isolation");
  await shortcut(b, "z"); await b.waitForFunction(() => state.devices.length === 1);
  const undone = await snapshot(b);
  for (const key of ["devices", "connections", "racks", "imageObjects", "deviceLibrary", "nodeLibrary"]) assert.deepEqual(undone[key], before[key]);
  await b.keyboard.press(`${modifier}+Shift+z`); await b.waitForFunction(n => state.devices.length === n, after.devices.length);
  const redone = await snapshot(b);
  for (const key of ["devices", "connections", "racks", "imageObjects", "deviceLibrary", "nodeLibrary"]) assert.deepEqual(redone[key], after[key]);
  results.push("one-step undo and redo including imported definitions and racks");
  await shortcut(b, "v"); await b.waitForFunction(n => state.devices.length === n, 1 + 2 * payload.devices.length);
  const twice = await snapshot(b);
  assert.equal(new Set(twice.devices.map(d => d.instanceId)).size, twice.devices.length);
  assert.equal(twice.deviceLibrary.length, 2);
  assert.notEqual(twice.devices[1].x, twice.devices[1 + payload.devices.length].x);
  await a.close();
  // Remove every fallback so this paste can only come from the real clipboard.
  await b.evaluate(() => { localStorage.removeItem(canvasClipboardModule.CLIPBOARD_STORAGE_KEY); });
  await shortcut(b, "v"); await b.waitForFunction(n => state.devices.length === n, 1 + 3 * payload.devices.length);
  results.push("repeat IDs/placement and system clipboard after source tab closes");
  const rollback = await b.evaluate(text => {
    const bridge = activeEngineBridge(), data = JSON.stringify(canvasClipboardProject()), history = bridge.commandIndex;
    const plan = canvasClipboardModule.prepareCanvasClipboardPaste(canvasClipboardModule.parseCanvasClipboard(text), canvasClipboardProject(), { x: 30000, y: 30000 });
    const original = bridge.renderer.setStaticScene.bind(bridge.renderer);
    let first = true;
    bridge.renderer.setStaticScene = scene => { if (first) { first = false; throw new Error("injected render failure"); } return original(scene); };
    let failed = false;
    try { bridge.commitCanvasClipboardPaste(plan); } catch { failed = true; }
    finally { bridge.renderer.setStaticScene = original; }
    return { failed, unchanged: data === JSON.stringify(canvasClipboardProject()), history: history === bridge.commandIndex };
  }, text);
  assert.deepEqual(rollback, { failed: true, unchanged: true, history: true });
  const invalidBefore = await count(b), historyBefore = await b.evaluate(() => activeEngineBridge().commandIndex);
  await b.evaluate(() => navigator.clipboard.writeText("AVDESIGNER_SELECTION_V1:{"));
  await shortcut(b, "v"); await b.waitForFunction(() => document.querySelector("#statusText").textContent.includes("corrupt JSON"));
  assert.equal(await count(b), invalidBefore); assert.equal(await b.evaluate(() => activeEngineBridge().commandIndex), historyBefore);
  results.push("invalid paste creates no undo entry; rendering failure rolls back objects, definitions and selection");
  const input = b.locator("#projectNameInput");
  await input.fill("Native text only"); await input.selectText(); await b.keyboard.press(`${modifier}+c`);
  await input.fill(""); await b.keyboard.press(`${modifier}+v`); assert.equal(await input.inputValue(), "Native text only");
  const textCount = await count(b);
  await shortcut(b, "v"); await b.waitForTimeout(150); assert.equal(await count(b), textCount);
  assert.ok(await b.evaluate(() => document.querySelector("#statusText").textContent.includes("not an AV Designer")));
  await b.keyboard.press("Alt+c"); await b.keyboard.press("Alt+v"); await b.waitForTimeout(150); assert.equal(await count(b), textCount);
  for (const type of ["search", "number"]) {
    await b.evaluate(type => { const input = document.createElement("input"); input.id = "clipboard-isolation"; input.type = type; input.value = "123"; document.body.append(input); input.focus(); input.select(); }, type);
    await b.keyboard.press(`${modifier}+c`); await b.keyboard.press(`${modifier}+v`);
    assert.equal(await count(b), textCount); await b.locator("#clipboard-isolation").evaluate(el => el.remove());
  }
  for (const tag of ["textarea", "div"]) {
    await b.evaluate(tag => { const el = document.createElement(tag); el.id = "clipboard-isolation"; el.contentEditable = "true";
      document.body.append(el); el.focus(); }, tag);
    const field = b.locator("#clipboard-isolation"); await field.fill("Editable text");
    await b.keyboard.press(`${modifier}+a`); await b.keyboard.press(`${modifier}+c`);
    await field.fill(""); await b.keyboard.press(`${modifier}+v`);
    assert.equal(await field.evaluate(el => el.value ?? el.textContent), "Editable text");
    await field.evaluate(el => el.remove()); assert.equal(await count(b), textCount);
  }
  await b.evaluate(() => openDeviceEditorForInstance("destination-only"));
  const deviceName = b.locator("#editorDeviceName"); await deviceName.fill("Draft text"); await deviceName.selectText();
  await b.keyboard.press(`${modifier}+c`); await deviceName.fill(""); await b.keyboard.press(`${modifier}+v`);
  assert.equal(await deviceName.inputValue(), "Draft text"); await b.evaluate(() => closeDeviceEditor());
  const matrixId = await b.evaluate(() => state.devices.find(d => d.templateOverride?.isMatrixRouter).instanceId);
  await b.evaluate(id => openMatrixRoutingModal(id), matrixId);
  await b.evaluate(() => { const field = document.createElement("input"); field.id = "clipboard-isolation"; document.querySelector("#matrixRoutingModalBody").append(field); });
  const matrixField = b.locator("#clipboard-isolation"); await matrixField.fill("Matrix text"); await matrixField.selectText();
  await b.keyboard.press(`${modifier}+c`); await matrixField.fill(""); await b.keyboard.press(`${modifier}+v`);
  assert.equal(await matrixField.inputValue(), "Matrix text"); await b.evaluate(() => closeMatrixRoutingModal());
  assert.equal(await count(b), textCount);
  results.push("native text, search/numeric fields and Alt shortcuts are isolated");
  const c = await open(); await loaded(c, fixture.project); await select(c);
  await shortcut(c, "c");
  await c.waitForFunction(() => document.querySelector("#statusText").textContent.includes("system clipboard"));
  assert.equal(await c.evaluate(() => window.nativeClipboardWrites), 1, "ordinary copy writes through the trusted native event");
  const session = await context.newCDPSession(c);
  await session.send("Browser.setPermission", { permission: { name: "clipboard-read" }, setting: "denied", origin: base });
  // Permission denial does not block trusted clipboard events in Chrome. Simulate
  // an enterprise policy that also denies DataTransfer access, using real shortcuts.
  await c.evaluate(() => { DataTransfer.prototype.setData = () => { throw new DOMException("policy denied", "NotAllowedError"); }; });
  await shortcut(c, "c");
  await c.waitForFunction(() => document.querySelector("#statusText").textContent.includes("using the fallback"));
  await b.evaluate(() => { DataTransfer.prototype.getData = () => { throw new DOMException("policy denied", "NotAllowedError"); }; });
  const deniedBefore = await count(b); await shortcut(b, "v");
  await b.waitForFunction(n => state.devices.length === n, deniedBefore + payload.devices.length);
  results.push("denied async permission plus denied native transport uses same-origin fallback");
  await b.evaluate(() => {
    const key = canvasClipboardModule.CLIPBOARD_STORAGE_KEY, record = JSON.parse(localStorage.getItem(key));
    record.copiedAt -= 31 * 60 * 1000; localStorage.setItem(key, JSON.stringify(record));
  });
  const expiredBefore = await count(b); await shortcut(b, "v"); await b.waitForTimeout(200); assert.equal(await count(b), expiredBefore);
  const nativeEvents = await b.evaluate(() => window.clipboardEvents);
  assert.ok(nativeEvents.some(e => e.type === "paste" && e.trusted));
  assert.deepEqual(errors, []);
  results.push("expired fallback rejected, trusted paste events, no browser errors");
  console.log(JSON.stringify({ passed: results.length, failed: 0, skipped: 0, results }, null, 2));
} finally { await context.close(); await browser.close(); }
