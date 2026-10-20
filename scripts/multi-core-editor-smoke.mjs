import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-multi-core-editor";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors = [], checks = [], timings = [];
const context = await browser.newContext({ viewport: { width: 1700, height: 1050 }, acceptDownloads: true });
await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
const page = await context.newPage();
page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept());
const tab = name => page.locator(`.mc-editor [data-tab="${name}"]`).click();
const action = name => page.locator(`.mc-editor [data-action="${name}"]`).click();
const editField = async (path, value) => { const input = page.locator(`.mc-editor [data-path="${path}"]`); await input.fill(String(value)); await input.press("Tab"); };
const draft = () => page.evaluate(() => structuredClone(activeEngineBridge().multiCoreEditor.session.value));
const canonical = () => page.evaluate(() => structuredClone(state.multiCores[0]));
const point = async role => page.evaluate(role => {
  const b = activeEngineBridge(), r = b.canvas.getBoundingClientRect();
  let p;
  if (role === "trunk") { const w = b.scene.wires.find(w => w.multiCoreIdentity); const points = b.scene.wireRenderPolyline(w); p = points[Math.floor(points.length / 2)]; }
  else { const d = b.scene.devices.find(d => d.multiCoreIdentity?.role === role); p = { x: d.x + d.width / 2, y: d.y + 26 }; }
  return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom };
}, role);
const open = async role => { await page.locator("#zoomFit").click(); const p = await point(role); await page.mouse.click(p.x, p.y); await page.locator("#inspectorBody [data-mc-edit]").click(); await page.locator(".mc-editor").waitFor(); };
const portPoint = async id => page.evaluate(id => {
  const editor = activeEngineBridge().multiCoreEditor, entry = editor.entries().find(e => e.connector.id === id), r = editor.overlay.getBoundingClientRect();
  const p = editor.surface.worldToScreen({ x: entry.cx, y: entry.cy }); return { x: r.x + p.x, y: r.y + p.y };
}, id);
const dragPort = async (id, dx, dy) => {
  const p = await portPoint(id); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + dy, { steps: 10 }); await page.mouse.up();
};
try {
  await page.goto(base); await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  const project = connectedMultiCoreProject(); project.projectName = "Phase 5 acceptance";
  Object.assign(project.multiCores[0].ends.A, { x: 0, y: 200 }); Object.assign(project.multiCores[0].ends.B, { x: 800, y: 200 });
  Object.assign(project.devices[0], { x: -400, y: 200 }); Object.assign(project.devices[1], { x: 1200, y: 200 });
  await page.locator("#fileInput").setInputFiles({ name: "phase5.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => state.projectName === "Phase 5 acceptance" && activeEngineBridge()?.ready);
  const before = await canonical(), cables = await page.evaluate(() => structuredClone(state.connections));
  for (const role of ["A", "B", "trunk"]) {
    await open(role); assert.equal(await page.locator(".mc-editor .editor-tab.active[data-tab]").innerText(), role === "trunk" ? "Trunk" : `End ${role}`); await action("cancel");
  }
  checks.push("real end A, end B and trunk inspector entry points");
  await open("B"); await page.locator('[data-path="ends.B.style"]').selectOption("fanout");
  assert.deepEqual((await draft()).circuits, before.circuits); assert.deepEqual(await canonical(), before);
  await tab("End A"); await editField("ends.A.faces.0.width", 520); await action("fit");
  await dragPort("a-91", 70, 20);
  assert((await draft()).ends.A.faces[0].portPlacements.some(p => p.connectorId === "a-91"));
  assert.deepEqual(await canonical(), before);
  await action("zoom-in"); await dragPort("a-91", 20, 25); await action("zoom-out");
  await page.getByRole("button", { name: /^01 - SDI$/, exact: false }).first().click();
  await page.getByLabel("Connector X", { exact: true }).fill("130"); await page.getByLabel("Connector X", { exact: true }).press("Tab");
  assert.equal((await draft()).ends.A.faces[0].portPlacements.find(p => p.connectorId === "a-91").x, 130);
  await action("delete-ports"); assert.match(await page.locator(".mc-diagnostics").innerText(), /uses this port/);
  await action("duplicate-ports"); const duplicated = (await draft()).ends.A.connectors.at(-1).id;
  assert.notEqual(duplicated, "a-91"); await action("delete-ports"); assert(!(await draft()).ends.A.connectors.some(p => p.id === duplicated));
  await page.getByLabel("New connector type", { exact: true }).selectOption("bnc"); await action("add-port");
  const newPort = (await draft()).ends.A.connectors.at(-1).id;
  await page.getByLabel("Connector face", { exact: true }).selectOption("rear");
  await page.locator('[data-face="rear"]').click(); assert.equal(await page.locator(".mc-preview [data-port-id]").count(), 1);
  await action("delete-ports"); // selection clears on face switch; select explicitly before delete
  await page.locator(`.mc-port-row[data-port="${newPort}"]`).click(); await action("delete-ports");
  await page.locator('[data-face="front"]').click();
  const artwork = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect x="20" y="20" width="1160" height="560" fill="#666" stroke="#ddd" stroke-width="8"/><text x="300" y="100" font-size="60" fill="white">HYBRID 14 PANEL</text></svg>');
  await page.getByLabel("Face artwork", { exact: true }).setInputFiles({ name: "panel.svg", mimeType: "image/svg+xml", buffer: artwork });
  await page.waitForFunction(() => activeEngineBridge().multiCoreEditor.session.value.ends.A.faces[0].image.startsWith("data:"));
  await page.evaluate(() => { const e = activeEngineBridge().multiCoreEditor; e.testImageElement = e.faceImageElement; });
  await dragPort("a-91", 12, 12);
  assert(await page.evaluate(() => { const e = activeEngineBridge().multiCoreEditor; return e.testImageElement === e.faceImageElement; }));
  await page.screenshot({ path: `${dir}/end-a-artwork.png` });
  await page.locator('[data-face="rear"]').click(); await page.locator('[data-face="front"]').click();
  await tab("Trunk"); await editField("trunk.length", 100);
  await tab("General"); await editField("description", "Hybrid 14 edited physical assembly");
  await tab("Channels"); assert(await page.locator('tr[data-circuit-id="c-a1"] select[data-path$="endAPortId"]').isDisabled());
  assert.equal(await page.locator('tr[data-circuit-id="c-a1"] [data-channel-status]').innerText(), "Occupied");
  await page.locator('[data-path="circuits.1.endBPortId"]').selectOption("b-41");
  assert.equal(await page.locator('[data-tab="Channels"]').getAttribute("data-errors"), "true");
  await action("save"); assert.match(await page.locator(".mc-diagnostics").innerText(), /Not saved/); assert.deepEqual(await canonical(), before);
  await page.locator('[data-path="circuits.1.endBPortId"]').selectOption("b-42");
  await page.screenshot({ path: `${dir}/channel-mappings.png` });
  const edited = await draft(); await action("save"); await page.locator(".mc-editor").waitFor({ state: "detached" });
  assert.deepEqual(await canonical(), edited); assert.deepEqual(await page.evaluate(() => state.connections), cables);
  await page.keyboard.press("Meta+z"); assert.deepEqual(await canonical(), before);
  await page.keyboard.press("Meta+Shift+z"); assert.deepEqual(await canonical(), edited);
  checks.push("independent fanout style, layout, drag at zoom, numeric placement, connector duplication/deletion/insertion, rear face, artwork upload, trunk edit", "occupied port protection, invalid mapping blocks Save, corrected atomic Save, exact project undo/redo and cable retention");
  await open("A"); await tab("Channels"); await page.locator('[data-path="circuits.1.endBPortId"]').selectOption("b-41"); await action("save"); await page.keyboard.press("Escape");
  assert.equal(await page.locator(".mc-editor").count(), 0); assert.deepEqual(await canonical(), edited);
  checks.push("failed Save never traps Escape/Close");
  const download = page.waitForEvent("download"); await page.locator("#saveProject").click();
  const saved = JSON.parse(await readFile(await (await download).path(), "utf8"));
  await page.locator("#fileInput").setInputFiles({ name: "reopen.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  await open("A"); assert.deepEqual((await draft()).ends.A.faces, edited.ends.A.faces); await action("cancel");
  checks.push("project save/reopen retains physical artwork, styles and mappings");
  await page.locator("#deviceEditorButton").click(); await page.screenshot({ path: `${dir}/device-editor-reference.png` }); await page.locator("#closeDeviceEditor").click();
  await page.locator("#darkModeToggle").click(); await open("A"); await page.screenshot({ path: `${dir}/light-editor.png` }); await action("cancel"); await page.locator("#darkModeToggle").click();
  await open("A"); await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => { const e = activeEngineBridge().multiCoreEditor, b = e.faceBounds(), p = e.surface.worldToScreen({ x: b.width / 2, y: b.height / 2 }); return p.x > 0 && p.x < e.overlay.clientWidth && p.y > 0 && p.y < e.overlay.clientHeight; });
  await page.screenshot({ path: `${dir}/narrow-editor.png` });
  const saveBounds = await page.locator('[data-action="save"]').boundingBox(); assert(saveBounds.x >= 0 && saveBounds.x + saveBounds.width <= 390);
  await action("cancel"); await page.setViewportSize({ width: 1700, height: 1050 });
  checks.push("existing editor visual reference, light theme and narrow-viewport controls");

  // Personal create/duplicate/reopen use the actual picker and existing storage owner.
  await page.locator("#createMultiCore").click(); await page.locator("[data-definition-create]").click();
  await editField("name", "Personal Hybrid Test"); await tab("Trunk");
  await page.getByLabel("Group media", { exact: true }).selectOption("coax");
  await page.getByLabel("Group connector", { exact: true }).selectOption("sdi");
  await page.getByLabel("Group specification", { exact: true }).fill("12G-SDI");
  await page.getByLabel("Group quantity", { exact: true }).fill("8"); await action("add-group");
  await tab("End A"); await page.locator('[data-path="ends.A.style"]').selectOption("rack-panel");
  const initialPorts = (await draft()).ends.A.connectors;
  const facePoint = async (x, y) => page.evaluate(({ x, y }) => {
    const e = activeEngineBridge().multiCoreEditor, r = e.overlay.getBoundingClientRect(), p = e.surface.worldToScreen({ x, y }); return { x: r.x + p.x, y: r.y + p.y };
  }, { x, y });
  let start = await facePoint(15, 15), finish = await facePoint(100, 50);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(finish.x, finish.y, { steps: 4 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => activeEngineBridge().multiCoreEditor.selected.size), 2);
  const groupBefore = (await draft()).ends.A.faces[0].portPlacements;
  await dragPort(initialPorts[0].id, 40, 40);
  const groupAfter = (await draft()).ends.A.faces[0].portPlacements;
  const delta = id => { const a = groupBefore.find(p => p.connectorId === id), b = groupAfter.find(p => p.connectorId === id); return [b.x - a.x, b.y - a.y]; };
  assert.deepEqual(delta(initialPorts[0].id), delta(initialPorts[1].id));
  start = await portPoint(initialPorts[0].id); const cancelBefore = await draft();
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 25, start.y + 20, { steps: 3 });
  await page.keyboard.press("Escape"); await page.mouse.up(); assert.deepEqual(await draft(), cancelBefore);
  await page.locator(`.mc-port-row[data-port="${initialPorts[2].id}"]`).click();
  start = await portPoint(initialPorts[2].id); finish = await facePoint(128, 33);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(finish.x + 20, finish.y, { steps: 3 });
  assert(await page.locator("[data-snap-guide]").count() > 0); await page.screenshot({ path: `${dir}/snap-guides.png` }); await page.mouse.up();
  const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==", "base64");
  await page.getByLabel("Face artwork", { exact: true }).setInputFiles({ name: "alpha.png", mimeType: "image/png", buffer: transparentPng });
  await page.waitForFunction(() => activeEngineBridge().multiCoreEditor.session.value.ends.A.faces[0].image.startsWith("data:image/png"));
  await page.getByLabel("Face artwork", { exact: true }).setInputFiles({ name: "panel.svg", mimeType: "image/svg+xml", buffer: artwork });
  await page.waitForFunction(() => activeEngineBridge().multiCoreEditor.session.value.ends.A.faces[0].image.startsWith("data:image/svg"));
  checks.push("marquee multi-selection, group movement, Escape drag cancellation, shared snap guides, transparent PNG and artwork replacement");
  await tab("End B"); await page.locator('[data-path="ends.B.style"]').selectOption("stage-box");
  const personalId = (await draft()).id; await action("save"); await page.locator(".mc-editor").waitFor({ state: "detached" });
  await page.locator("#createMultiCore").click(); await page.getByLabel("Multi-Core definition", { exact: true }).selectOption({ label: "Personal Hybrid Test (8 circuits)" });
  await page.locator("[data-definition-copy]").click(); const copyId = (await draft()).id; assert.notEqual(copyId, personalId);
  await editField("name", "Personal Hybrid Copy"); await action("save"); await page.locator(".mc-editor").waitFor({ state: "detached" });
  await page.locator("#createMultiCore").click(); await page.getByLabel("Multi-Core definition", { exact: true }).selectOption({ label: "Personal Hybrid Copy (8 circuits)" });
  await page.locator("[data-definition-edit]").click(); await editField("description", "Unsaved stale draft");
  const other = await context.newPage(); await other.goto(base); await other.waitForFunction(() => window.wireNexusReady); await other.evaluate(() => wireNexusReady);
  await other.locator("#createMultiCore").click(); await other.getByLabel("Multi-Core definition", { exact: true }).selectOption({ label: "Personal Hybrid Copy (8 circuits)" });
  await other.locator("[data-definition-edit]").click(); await other.locator('[data-path="description"]').fill("Newer tab revision"); await other.locator('[data-path="description"]').press("Tab");
  await other.locator('[data-action="save"]').click(); await other.locator(".mc-editor").waitFor({ state: "detached" });
  await action("save"); await page.waitForFunction(() => document.querySelector(".mc-diagnostics")?.textContent.includes("changed in another tab"));
  assert.match(await page.locator(".mc-diagnostics").innerText(), /changed in another tab/);
  await tab("Defaults"); await action("reload-definition");
  await page.waitForFunction(() => activeEngineBridge().multiCoreEditor.session.value.description === "Newer tab revision");
  assert.equal((await draft()).description, "Newer tab revision");
  await action("cancel"); await other.close();
  checks.push("personal create, explicit group mapping, independent ends, save/reopen/duplicate, real cross-tab revision conflict, Defaults reload and safe Cancel");
  await page.locator("#createMultiCore").click(); await page.getByLabel("Multi-Core definition", { exact: true }).selectOption({ label: "Personal Hybrid Copy (8 circuits)" });
  await page.locator('button[value="place"]').click();
  for (const world of [{ x: 400, y: 100 }, { x: 400, y: 620 }]) {
    const p = await page.evaluate(world => { const b = activeEngineBridge(), r = b.canvas.getBoundingClientRect(); return { x: r.x + (world.x - b.camera.x) * b.camera.zoom, y: r.y + (world.y - b.camera.y) * b.camera.zoom }; }, world);
    await page.mouse.click(p.x, p.y);
  }
  assert.equal(await page.evaluate(() => state.multiCores.length), 2);
  assert.equal(await page.evaluate(id => localUserSettingsOwner.entry(id).definition.name, personalId), "Personal Hybrid Test");
  checks.push("personal duplicate placed without changing original product");

  // Measured UI operations include browser event/render time. Fixture setup only
  // is programmatic; timed edits use mouse/keyboard controls.
  for (const count of [8, 16, 32, 64]) {
    await page.locator("#createMultiCore").click(); await page.locator("[data-definition-create]").click(); await editField("name", `Performance ${count}`);
    const measured = { circuits: count };
    await tab("Trunk"); await page.getByLabel("Group connector", { exact: true }).selectOption("sdi"); await page.getByLabel("Group media", { exact: true }).selectOption("coax");
    await page.getByLabel("Group quantity", { exact: true }).fill(String(count)); await action("add-group");
    await action("save"); await page.locator(".mc-editor").waitFor({ state: "detached" });
    await page.locator("#createMultiCore").click(); await page.getByLabel("Multi-Core definition", { exact: true }).selectOption({ label: `Performance ${count} (${count} circuits)` });
    const started = performance.now(); await page.locator("[data-definition-edit]").click(); measured.openMs = performance.now() - started;
    let t = performance.now(); await tab("End A"); measured.tabMs = performance.now() - t;
    const p = (await draft()).ends.A.connectors[0].id;
    await page.evaluate(() => { const e = activeEngineBridge().multiCoreEditor, original = e.pointerMove; e.moveTimings = []; e.pointerMove = function(event) { const t = performance.now(); original.call(this, event); this.moveTimings.push(performance.now() - t); }; });
    t = performance.now(); await dragPort(p, 16, 12); measured.dragMs = performance.now() - t;
    measured.maxDragHandlerMs = await page.evaluate(() => Math.max(...activeEngineBridge().multiCoreEditor.moveTimings));
    t = performance.now(); await page.locator('[data-face="rear"]').click(); await page.locator('[data-face="front"]').click(); measured.facesMs = performance.now() - t;
    await tab("Channels"); t = performance.now(); await page.locator('[data-path="circuits.0.endBPortId"]').selectOption(""); measured.mappingMs = performance.now() - t;
    await page.locator('[data-path="circuits.0.endBPortId"]').selectOption((await draft()).ends.B.connectors[0].id);
    measured.validationMs = await page.evaluate(() => { const e = activeEngineBridge().multiCoreEditor, start = performance.now(); e.validate(); return performance.now() - start; });
    t = performance.now(); await action("save"); await page.locator(".mc-editor").waitFor({ state: "detached" }); measured.saveAndCloseMs = performance.now() - t;
    await page.locator("#createMultiCore").click(); await page.getByLabel("Multi-Core definition", { exact: true }).selectOption({ label: `Performance ${count} (${count} circuits)` }); await page.locator("[data-definition-edit]").click();
    t = performance.now(); await action("cancel"); measured.closeMs = performance.now() - t;
    timings.push(measured);
  }
  const output = await page.evaluate(async () => { await ensureEngineOutputSceneModule(); return (await prepareEngineViewerOutput()).html; });
  for (const hosted of [false, true]) {
    const viewer = await context.newPage();
    await viewer.route("**/*", route => hosted && route.request().isNavigationRequest() ? route.fulfill({ status: 200, contentType: "text/html", body: output }) : route.abort());
    if (hosted) await viewer.goto("https://multi-core-editor-publish.test/project"); else await viewer.setContent(output, { waitUntil: "load" });
    await viewer.waitForFunction(() => window.outputViewer);
    assert.equal(await viewer.evaluate(() => outputViewer.scene.devices.filter(d => d.multiCoreIdentity).length), 4);
    assert.equal(await viewer.evaluate(() => outputViewer.scene.devices.filter(d => d.multiCoreIdentity).some(d => d.visual.faceImage)), false);
    await viewer.screenshot({ path: `${dir}/${hosted ? "simulated-publish" : "offline-schematic"}.png` }); await viewer.close();
  }
  checks.push("offline HTML and simulated Publish schematic output exclude editor artwork");
  await page.screenshot({ path: `${dir}/main-canvas.png` });
  await page.locator("#exportPdf").click(); const pdfDownload = page.waitForEvent("download"); await page.locator("#confirmPdfExport").click();
  await (await pdfDownload).saveAs(`${dir}/edited-multi-core.pdf`);
  assert.equal((await readFile(`${dir}/edited-multi-core.pdf`)).subarray(0, 4).toString(), "%PDF");
  checks.push("edited assembly exported through production PDF action");
  const future = { ...saved, projectName: "Future schema inspection", multiCores: [{ schemaVersion: 99, id: "future-mc", name: "Future assembly", opaque: { retain: true } }],
    multiCoreDefinitions: [null, { schemaVersion: 99, id: "future-definition", name: "Future definition", opaque: { retain: true } }], connections: [] };
  await page.locator("#fileInput").setInputFiles({ name: "future.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(future)) });
  await page.waitForFunction(() => state.projectName === "Future schema inspection" && activeEngineBridge()?.ready);
  await page.locator("#createMultiCore").click();
  await page.getByLabel("Multi-Core definition", { exact: true }).selectOption({ label: "Future definition (0 circuits)" });
  assert(await page.locator('button[value="place"]').isDisabled()); assert(await page.locator("[data-definition-copy]").isDisabled());
  await page.locator("[data-assembly-edit]").click();
  assert(await page.locator('[data-action="save"]').isDisabled()); await action("close");
  assert.deepEqual(await canonical(), future.multiCores[0]);
  checks.push("future schema accessible through project picker, opaque/read-only, safe Close");
  assert.deepEqual(errors, []);
  await writeFile(`${dir}/results.json`, JSON.stringify({ checks, timings, errors }, null, 2));
  console.log(JSON.stringify({ checks, timings, errors, screenshots: dir }, null, 2));
} catch (error) { await page.screenshot({ path: `${dir}/failure.png` }); console.error(await page.locator(".mc-diagnostics").allTextContents()); throw error; }
finally { await browser.close(); }
