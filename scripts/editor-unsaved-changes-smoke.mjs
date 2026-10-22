import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";

const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-unsaved-2026-10-20/chrome";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage(), errors = [], alerts = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
const modal = page.locator(".editor-unsaved-modal");
const choose = async name => { await modal.getByRole("button", { name, exact: true }).click(); await modal.waitFor({ state: "detached" }); };
const openDevice = async () => { await page.click("#deviceEditorButton"); await page.locator("#deviceEditorModal:not(.hidden)").waitFor(); };
const closeDevice = () => page.click("#closeDeviceEditor");
const deviceClosed = () => page.locator("#deviceEditorModal.hidden").waitFor({ state: "attached" });
const canonical = () => page.evaluate(() => JSON.stringify({ devices: state.devices, library: deviceLibrary, connections: state.connections, multiCores: state.multiCores }));
const editTab = name => page.locator(`[data-editor-tab="${name}"]`).click();
const mcAction = name => page.locator(`.mc-editor [data-action="${name}"]`).click();
const mcTab = name => page.locator(`.mc-editor [data-tab="${name}"]`).click();
const mcOpen = async () => {
  await page.click("#zoomFit");
  const point = await page.evaluate(() => {
    const b = activeEngineBridge(), d = b.scene.devices.find(d => d.multiCoreIdentity?.role === "B"), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (d.x + d.width / 2 - b.camera.x) * b.camera.zoom, y: r.y + (d.y + 26 - b.camera.y) * b.camera.zoom };
  });
  await page.mouse.click(point.x, point.y); await page.locator("#inspectorBody [data-mc-edit]").click(); await page.locator(".mc-editor").waitFor();
};
try {
  await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773");
  await page.evaluate(() => wireNexusReady);
  await openDevice(); await editTab("faceplate"); await editTab("connectors"); await editTab("device");
  await closeDevice(); await deviceClosed(); assert.equal(await modal.count(), 0);
  checks.push("Device: clean open/close and tab changes");
  const before = await canonical();
  await openDevice(); await page.fill("#editorDeviceName", "Unsaved draft name");
  await closeDevice(); await modal.waitFor();
  assert.equal(await modal.getByRole("button").count(), 3);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Keep Editing");
  assert.equal(await page.evaluate(() => deviceEditorModal.inert), true);
  await page.screenshot({ path: `${dir}/dark.png` });
  await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Discard Changes");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Keep Editing");
  await page.keyboard.press("Enter"); assert.equal(await modal.count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), "closeDeviceEditor");
  await page.keyboard.press("Escape"); await modal.waitFor();
  await page.keyboard.press("Escape"); assert.equal(await modal.count(), 0);
  assert.equal(await page.inputValue("#editorDeviceName"), "Unsaved draft name");
  assert.equal(await page.evaluate(() => deviceEditorModal.inert), false);
  await page.evaluate(() => document.getElementById("pdfExportDialog").showModal());
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0); assert.equal(await modal.count(), 0);
  assert.equal(await page.locator("#deviceEditorModal:not(.hidden)").count(), 1);
  await page.keyboard.press("Escape"); await modal.waitFor(); await choose("Keep Editing");
  await closeDevice(); await choose("Discard Changes"); await deviceClosed(); assert.equal(await canonical(), before);
  checks.push("Device: name, Keep, Discard, Escape isolation, focus trap, inert background, canonical unchanged");

  await openDevice(); await page.fill("#editorDeviceName", "Saved through confirmation"); await closeDevice(); await choose("Save Changes"); await deviceClosed();
  assert(await page.evaluate(() => deviceLibrary.some(t => t.name === "Saved through confirmation" && isProjectCustomDeviceTemplate(t))));
  checks.push("Device: confirmation uses existing project-device Save");
  await openDevice(); const oldName = await page.inputValue("#editorDeviceName"); await page.fill("#editorDeviceName", "Temporary"); await page.fill("#editorDeviceName", oldName);
  await closeDevice(); await deviceClosed(); assert.equal(await modal.count(), 0);
  checks.push("Device: edit/revert is semantically clean");

  await openDevice(); await page.fill("#editorDeviceName", "Retain during replacement");
  await page.locator("#newDeviceTemplate").click(); await choose("Keep Editing");
  assert.equal(await page.inputValue("#editorDeviceName"), "Retain during replacement");
  await page.evaluate(() => captureEditorSessionBaseline());
  assert.equal(await page.evaluate(() => editorSessionHasUnsavedChanges()), true);
  await page.locator("#newDeviceTemplate").click(); await choose("Discard Changes");
  await page.waitForFunction(() => editorMode === "master-create");
  await page.fill("#editorDeviceName", "Async failure draft");
  await page.evaluate(() => { window.originalOwner = localUserSettingsOwner; localUserSettingsOwner = { ...localUserSettingsOwner, save: async () => { await new Promise(r => setTimeout(r, 150)); throw new Error("Simulated storage interruption"); } }; });
  const asyncBefore = await canonical(); await closeDevice(); await choose("Save Changes");
  await page.waitForFunction(() => !editorCloseGuard.saving);
  assert.match(alerts.at(-1), /Simulated storage interruption/);
  assert.equal(await page.inputValue("#editorDeviceName"), "Async failure draft"); assert.equal(await canonical(), asyncBefore);
  await page.evaluate(() => { localUserSettingsOwner = window.originalOwner; delete window.originalOwner; closeDeviceEditor(); closeDeviceEditor(); });
  assert.equal(await modal.count(), 1); await choose("Discard Changes"); await deviceClosed();
  checks.push("Device: replacement Keep retains baseline; async storage failure retains draft; repeated Close has one modal and Discard succeeds");

  // Seed only the invalid data; the exit, Save rejection and recovery use real controls.
  await openDevice();
  await page.evaluate(() => { currentEditorTemplate().connectorRelationships.push({ id: "invalid-exclusive", type: "exclusive", members: ["missing-node-a", "missing-node-b"] }); });
  const invalidBefore = await canonical(), historyBefore = await page.evaluate(() => undoStack.length);
  await closeDevice(); await choose("Save Changes");
  assert.equal(await page.locator("#deviceEditorModal:not(.hidden)").count(), 1);
  assert.match(alerts.at(-1), /missing connector|relationship/i);
  assert.equal(await canonical(), invalidBefore); assert.equal(await page.evaluate(() => undoStack.length), historyBefore);
  await closeDevice(); await choose("Discard Changes"); await deviceClosed();
  checks.push("Device: actual exclusive-reference validation failure retains draft, Discard exits, no canonical/history mutation");

  await openDevice(); await editTab("faceplate");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=", "base64");
  await page.locator("#editorFaceUpload").setInputFiles({ name: "test.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => currentEditorTemplate().faceImageNaturalWidth === 1);
  await closeDevice(); await modal.waitFor(); await choose("Keep Editing");
  assert.equal(await page.evaluate(() => editorActiveTab), "faceplate");
  await closeDevice(); await choose("Discard Changes"); await deviceClosed();
  assert.equal(await page.evaluate(() => editorEnginePreviewSurface), null);
  checks.push("Faceplate: artwork replacement, Keep preserves tab, Discard disposes preview");

  await openDevice(); await editTab("faceplate");
  await page.evaluate(() => {
    window.originalPrepareUpload = prepareAndCommitEditorFaceplateUpload;
    const pending = new Promise(resolve => { window.releaseTestUpload = resolve; });
    prepareAndCommitEditorFaceplateUpload = (...args) => window.testUploadDone = (async () => { await pending; return window.originalPrepareUpload(...args); })();
  });
  await page.locator("#editorFaceUpload").setInputFiles({ name: "pending.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => !!window.testUploadDone);
  await closeDevice(); await choose("Keep Editing");
  await closeDevice(); await choose("Discard Changes"); await deviceClosed(); await openDevice();
  const replacement = await page.evaluate(() => JSON.stringify(editorDraft));
  await page.evaluate(async () => {
    window.releaseTestUpload();
    await window.testUploadDone;
    prepareAndCommitEditorFaceplateUpload = window.originalPrepareUpload;
    delete window.originalPrepareUpload; delete window.releaseTestUpload; delete window.testUploadDone;
  });
  assert.equal(await page.evaluate(() => JSON.stringify(editorDraft)), replacement);
  await closeDevice(); await deviceClosed();
  checks.push("Faceplate: pending upload Keep/Discard and late completion cannot modify the replacement session");

  // A physical PD faceplate fixture exercises the real pointer handlers.
  await page.evaluate(async () => {
    const t = createBlankDeviceTemplate(); Object.assign(t, { id: "lifecycle-pd", name: "Lifecycle PD", isPowerDistro: true,
      connectors: [{ id: "iec", type: "iec", direction: "output", label: "Power", x: t.width, y: 300 }] });
    await openDeviceEditorForProjectTemplateDraft(t, "project-template-create");
  });
  await editTab("faceplate");
  const plug = page.locator('[data-editor-power-plug-id="iec"]');
  const plugPoint = async () => {
    await page.click("#editorZoomReset");
    await page.waitForFunction(() => !editorEnginePreviewFitPending);
    await plug.hover(); // Wait for stable hit geometry after the tab's fit.
    const r = await plug.boundingBox(); assert(r); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  let p = await plugPoint(); const pdBefore = await page.evaluate(() => JSON.stringify(currentEditorTemplate()));
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 100, p.y + 100, { steps: 5 });
  assert.equal(await page.evaluate(() => !!editorPowerPlugDrag?.moved), true);
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.equal(await modal.count(), 0); assert.equal(await page.evaluate(() => JSON.stringify(currentEditorTemplate())), pdBefore);
  await closeDevice(); await deviceClosed(); assert.equal(await modal.count(), 0);
  await page.evaluate(async () => {
    const t = createBlankDeviceTemplate(); Object.assign(t, { id: "lifecycle-pd", name: "Lifecycle PD", isPowerDistro: true,
      connectors: [{ id: "iec", type: "iec", direction: "output", label: "Power", x: t.width, y: 300 }] });
    await openDeviceEditorForProjectTemplateDraft(t, "project-template-create");
  });
  await editTab("faceplate"); p = await plugPoint();
  // Earlier committed project edits must not mask the editor-only unload check.
  await page.evaluate(() => projectUnsavedChanges?.reset());
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 100, p.y + 100, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => editorSessionHasUnsavedChanges()), true);
  await closeDevice(); await choose("Keep Editing"); assert.equal(await page.evaluate(() => editorSelectedPowerPlugIds.has("iec")), true);
  const unload = await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }); assert.equal(unload, true);
  await closeDevice(); await choose("Discard Changes"); await deviceClosed();
  assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), false);
  checks.push("Faceplate: native PD plug drag/cancel is clean; committed drag prompts; Keep retains selection; beforeunload installed only for live draft");

  await page.click("#darkModeToggle"); await openDevice(); await page.fill("#editorDeviceName", "Light modal"); await closeDevice();
  await page.screenshot({ path: `${dir}/light.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${dir}/mobile.png` });
  for (const button of await modal.getByRole("button").all()) { const r = await button.boundingBox(); assert(r.x >= 0 && r.x + r.width <= 390); }
  await choose("Discard Changes"); await deviceClosed(); await page.setViewportSize({ width: 1600, height: 1000 }); await page.click("#darkModeToggle");
  checks.push("Light/dark/mobile modal layout and all actions reachable");

  const project = connectedMultiCoreProject(); project.projectName = "Unsaved changes acceptance";
  await page.locator("#fileInput").setInputFiles({ name: "lifecycle.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => state.projectName === "Unsaved changes acceptance" && activeEngineBridge()?.ready);
  const mcBefore = await page.evaluate(() => structuredClone(state.multiCores[0]));
  await mcOpen(); await mcAction("cancel"); await page.locator(".mc-editor").waitFor({ state: "detached" });
  await mcOpen(); await page.selectOption('[data-path="ends.B.style"]', "fanout"); await mcAction("close");
  await modal.waitFor(); assert.match(await modal.innerText(), /this Multi-Core/); await choose("Keep Editing");
  assert.equal(await page.inputValue('[data-path="ends.B.style"]'), "fanout");
  await mcAction("close"); await choose("Save Changes"); await page.locator(".mc-editor").waitFor({ state: "detached" });
  const mcSaved = await page.evaluate(() => structuredClone(state.multiCores[0])); assert.equal(mcSaved.ends.B.style, "fanout"); assert.deepEqual(mcSaved.circuits, mcBefore.circuits);
  await page.keyboard.press("Meta+z"); assert.deepEqual(await page.evaluate(() => state.multiCores[0]), mcBefore);
  await page.keyboard.press("Meta+Shift+z"); assert.deepEqual(await page.evaluate(() => state.multiCores[0]), mcSaved);
  checks.push("Hybrid 14: clean Cancel, End B style Keep/Save, stable circuit IDs/mappings, atomic project undo/redo");

  await mcOpen(); await page.selectOption('[data-path="ends.B.style"]', "generic"); await mcAction("undo"); await mcAction("cancel");
  await page.locator(".mc-editor").waitFor({ state: "detached" }); assert.equal(await modal.count(), 0);
  await mcOpen(); await mcTab("General"); await page.fill('[data-path="name"]', "Typed without blur"); await page.keyboard.press("Escape"); await modal.waitFor();
  await choose("Keep Editing"); assert.equal(await page.inputValue('[data-path="name"]'), "Typed without blur");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.path), "name");
  await mcTab("Channels"); await page.selectOption('[data-path="circuits.1.endBPortId"]', "b-41");
  await mcAction("close"); await choose("Save Changes"); assert.match(await page.locator(".mc-diagnostics").innerText(), /Not saved/);
  assert.deepEqual(await page.evaluate(() => state.multiCores[0]), mcSaved);
  await mcAction("cancel"); await choose("Discard Changes"); await page.locator(".mc-editor").waitFor({ state: "detached" });
  checks.push("Multi-Core: full draft undo is clean; Escape flushes typed field; invalid mapping Save is recoverable, no partial mutation");

  assert.deepEqual(errors, []);
  await writeFile(`${dir}/results.json`, JSON.stringify({ checks, alerts, errors }, null, 2));
  console.log(JSON.stringify({ checks, screenshots: dir }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${dir}/failure.png` });
  console.error({ errors, alerts, checks }); throw error;
} finally { await browser.close(); }
