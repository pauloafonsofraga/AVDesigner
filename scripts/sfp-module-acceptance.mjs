import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

// Run against the existing local server. Never attach to a user's Chrome profile.
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "Acceptance requires a loopback server");
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-sfp-2026-10-20/chrome";
const chrome = process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
await mkdir(dir, { recursive: true });
const report = { startedAt: new Date().toISOString(), base, chrome, phases: [], checks: [], alerts: [],
  pageErrors: [], consoleErrors: [], blockedRequests: [], fixtures: [], artifacts: [], limitations: [], sourceHashes: {} };
for (const path of ["index.html", "src/engine/transceiverModules.js", "src/engine/productionBridge.js",
  "src/engine/generated/outputViewerBundle.json", "src/engine/generated/outputPdfBundle.js", "scripts/sfp-module-acceptance.mjs"]) {
  try { report.sourceHashes[path] = createHash("sha256").update(await readFile(new URL(`../${path}`, import.meta.url))).digest("hex"); }
  catch { report.sourceHashes[path] = "not present"; }
}
const browser = await chromium.launch({ headless: true, executablePath: chrome });
report.browserVersion = browser.version();
const context = await browser.newContext({ viewport: { width: 1700, height: 1050 }, acceptDownloads: true, serviceWorkers: "block" });
await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
await context.route("**/*", route => {
  const request = route.request(), url = new URL(request.url());
  if (["data:", "blob:", "about:"].includes(url.protocol)
    || (url.origin === new URL(base).origin && ["GET", "HEAD"].includes(request.method()))) return route.continue();
  report.blockedRequests.push({ url: request.url(), method: request.method() });
  return route.abort();
});
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", error => report.pageErrors.push(error.message));
page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
page.on("dialog", async dialog => { report.alerts.push({ phase: currentPhase, type: dialog.type(), message: dialog.message() }); await dialog.accept(); });
let currentPhase = "startup", sourceTemplate, cardTemplate, sdiSnapshot;
const dacSnapshots = new Map();
const check = (name, details) => { report.checks.push({ phase: currentPhase, name, ...(details === undefined ? {} : { details }) }); console.log(`PASS ${currentPhase}: ${name}`); };
const shot = async name => {
  const path = join(dir, `${name}.png`); await page.screenshot({ path, fullPage: true }); report.artifacts.push(path);
};
const writeJson = async (name, value) => { const path = join(dir, name); await writeFile(path, JSON.stringify(value, null, 2)); report.artifacts.push(path); };
const flush = () => writeFile(join(dir, "results.json"), JSON.stringify(report, null, 2));
const phase = async (name, action) => {
  const previousPhase = currentPhase;
  currentPhase = name; const started = Date.now(); console.log(`START ${name}`);
  try { await action(); report.phases.push({ name, status: "passed", durationMs: Date.now() - started }); }
  catch (error) {
    report.phases.push({ name, status: "failed", durationMs: Date.now() - started, error: error.stack });
    console.error(`FAIL ${name}: ${error.message}`);
    await shot(`failure-${name}`).catch(() => {});
    await writeJson(`failure-${name}.json`, await page.evaluate(() => ({
      editorMode: typeof editorMode === "undefined" ? null : editorMode,
      draft: typeof currentEditorTemplate === "function" ? currentEditorTemplate() : null,
      project: typeof projectSnapshotData === "function" ? projectSnapshotData() : null,
      inspector: document.querySelector("#inspectorBody")?.innerText,
      dialogs: [...document.querySelectorAll("dialog[open], .editor-unsaved-modal")].map(d => d.innerText)
    })).catch(() => ({ unavailable: true })));
  }
  await flush(); currentPhase = previousPhase;
};
const ready = async () => {
  await page.goto(base);
  await page.waitForFunction(() => window.wireNexusReady, null, { timeout: 60000 });
  await page.evaluate(() => wireNexusReady);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded && engineTransceiverApi()?.transceiverModulePatch, null, { timeout: 60000 });
};
const quiet = () => page.waitForFunction(() => !editorPlacementMotionState?.entries?.size && !editorEnginePreviewFitPending);
const tab = name => page.locator(`[data-editor-tab="${name}"]`).click();
const draft = () => page.evaluate(() => structuredClone(currentEditorTemplate()));
const persisted = value => JSON.parse(JSON.stringify(value));
const normalizedWire = value => persisted({ ...value,
  loom: value.loom || "", loomId: value.loomId || "", loomEntrySide: value.loomEntrySide || "",
  loomEntryRoutePoints: value.loomEntryRoutePoints || [], loomExitRoutePoints: value.loomExitRoutePoints || [] });
const moduleShot = async name => {
  await page.locator("#selectedConnectorModule").scrollIntoViewIfNeeded(); await shot(name);
};
const clickCenter = async locator => {
  await locator.scrollIntoViewIfNeeded(); const box = await locator.boundingBox(); assert(box, "Visible hit target required");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const directionControl = value => page.locator(`[data-connector-signal-direction="${value}"]`).locator("..");
const structure = connector => {
  const { id, type, physicalType, connectorType, x, y, anchors, primaryAnchorId, direction, signalDirection,
    displaySide, cardSlotId, sourceConnectorId } = connector;
  return { id, type, physicalType, connectorType, x, y, anchors, primaryAnchorId, direction, signalDirection, displaySide, cardSlotId, sourceConnectorId };
};
const selectEditorNode = async id => {
  await tab("connectors"); await page.locator("#editorZoomReset").click(); await quiet();
  await clickCenter(page.locator(`#deviceEditorPreview [data-editor-node-id="${id}"] circle`).first());
  await page.locator("#selectedConnectorPhysicalType").waitFor();
};
const newDevice = async name => {
  await page.locator("#deviceEditorButton").click(); await tab("device"); await page.locator("#newDeviceTemplate").click();
  await page.locator("#editorDeviceName").fill(name); await page.locator("#editorDeviceName").press("Tab");
};
const addCage = async (type, direction = "output") => {
  await tab("connectors"); await page.locator(direction === "input" ? "#addInputNode" : "#addOutputNode").click();
  const id = (await draft()).connectors.at(-1).id;
  await selectEditorNode(id);
  await page.locator('[data-sfp-owner="device"] [data-sfp-enabled]').check();
  await page.locator('[data-sfp-owner="device"] [data-sfp-family]').selectOption(type); await quiet();
  await directionControl(direction).click();
  await page.locator("#selectedConnectorModule").waitFor(); return id;
};
const setModule = async (id, value) => {
  const before = await draft(), connector = before.connectors.find(c => c.id === id);
  await page.locator("#selectedConnectorModule").selectOption(value); await quiet();
  const after = await draft(), changed = after.connectors.find(c => c.id === id);
  assert.equal(changed.installedModuleType, value, "Module selector commits its value");
  assert.equal(after.connectors.length, before.connectors.length, "Module edit cannot create another node");
  assert.deepEqual(structure(changed), structure(connector), "Module edit preserves structural identity and geometry");
  assert.equal(await page.locator("#selectedConnectorModule").inputValue(), value);
  return changed;
};
const closeEditor = async () => {
  if (await page.locator("#deviceEditorModal:not(.hidden)").count()) {
    await page.locator("#closeDeviceEditor").click();
    const discard = page.getByRole("button", { name: "Discard Changes", exact: true });
    if (await discard.isVisible()) await discard.click();
    await page.locator("#deviceEditorModal.hidden").waitFor({ state: "attached" });
  }
};
const saveEditor = async () => {
  await page.locator("#applyDeviceEditor").click();
  await page.locator("#deviceEditorModal.hidden").waitFor({ state: "attached" });
};
const reopenLibrary = async template => {
  await page.locator("#deviceSearch").fill(template.name);
  const item = page.locator(`.library-device[data-template-id="${template.id}"]`);
  await item.click({ button: "right" });
  await page.locator('[data-library-device-menu="edit"]').click();
  await page.locator("#deviceEditorModal:not(.hidden)").waitFor();
};
const download = async (name, action) => {
  const pending = page.waitForEvent("download", { timeout: 120000 });
  await action(); const result = await pending, path = join(dir, name);
  await result.saveAs(path); report.artifacts.push(path); return path;
};
const upload = async (project, name = "sfp-acceptance.avd") => {
  await closeEditor();
  await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(name => state.projectName === name && activeEngineBridge()?.ready, project.projectName);
  await page.waitForFunction(ids => ids.every(id => activeEngineBridge().scene.getDevice(id)), project.devices.map(d => d.instanceId));
  await page.locator("#zoomFit").click();
};
const node = (id, type, direction, extra = {}) => ({ id, type, physicalType: type, connectorType: type, label: id,
  direction, signalDirection: direction, displaySide: direction === "output" ? "right" : "left",
  x: direction === "output" ? 380 : 0, y: 190, ...extra });
const template = (id, connectors, extra = {}) => ({ id, name: id, width: 380, height: 280,
  schemaVersion: 2, deviceDefinitionVersion: 2, category: "Misc.", connectors, cardSlots: [], cardTypes: [], connectorRelationships: [], ...extra });
const projectFor = (name, definitions) => ({ version: 1, projectName: name, darkMode: true,
  deviceLibrary: [], nodeLibrary: [], devices: definitions.map((t, i) => ({ instanceId: t.id, templateId: t.id,
    name: t.name, x: 100 + (i % 2) * 750, y: 100 + Math.floor(i / 2) * 430, templateOverride: t })),
  connections: [], ledSurfaces: [], racks: [], jumpNodes: [], jumpLinks: [], multiCores: [], looms: [] });
const point = (kind, id, connectorId) => page.evaluate(({ kind, id, connectorId }) => {
  const b = activeEngineBridge(), scene = b.scene; let p;
  if (kind === "connector") p = scene.connectorWorldPoint(scene.getDevice(id), scene.getConnector(id, connectorId));
  else if (kind === "device") { const d = scene.getDevice(id); p = { x: d.x + d.width / 2, y: d.y + 26 }; }
  else {
    const pts = scene.wireRenderPolyline(scene.getWire(id));
    const a = pts[Math.floor((pts.length - 1) / 2)], z = pts[Math.ceil((pts.length - 1) / 2)];
    p = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 };
  }
  const s = b.worldToScreenPoint(p), r = b.canvas.getBoundingClientRect(); return { x: r.x + s.x, y: r.y + s.y };
}, { kind, id, connectorId });
const clickPoint = async (kind, id, connectorId, options) => { const p = await point(kind, id, connectorId); await page.mouse.click(p.x, p.y, options); };
const openInstance = async id => {
  await clickPoint("device", id, "", { button: "right" }); await page.locator('[data-device-menu="edit"]').click();
  await page.locator("#deviceEditorModal:not(.hidden)").waitFor();
};
const wireDrag = async (from, to, accepted, name) => {
  const count = await page.evaluate(() => state.connections.length);
  const a = await point("connector", ...from), b = await point("connector", ...to);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 });
  const compatibility = await page.evaluate(() => structuredClone(activeEngineBridge().wireCreate?.compatibility || null));
  await shot(`${name}-compatibility`);
  await page.mouse.up();
  assert.equal(compatibility?.valid, accepted, `${name}: ${JSON.stringify(compatibility)}`);
  if (accepted) await page.waitForFunction(count => state.connections.length === count + 1, count);
  else { await page.keyboard.press("Escape"); assert.equal(await page.evaluate(() => state.connections.length), count, "Rejected cable creates no record"); }
  check(name, compatibility); return compatibility;
};
const canonicalWire = id => page.evaluate(id => structuredClone(state.connections.find(w => w.id === id)), id);
const saveReload = async label => {
  const before = await page.evaluate(() => structuredClone(state.connections));
  const file = await download(`${label}.avd`, () => page.locator("#saveProject").click());
  const saved = JSON.parse(await readFile(file, "utf8"));
  const expected = persisted(before).map(w => {
    const actual = saved.connections.find(item => item.id === w.id); assert(actual, "Save preserves cable UUID");
    // First serialization allocates the user-facing cable number; UUID/assembly remain unchanged.
    if (!w.cableNumber) { assert(actual.cableNumber, "Save assigns a cable number"); w.cableNumber = actual.cableNumber; }
    return w;
  });
  assert.deepEqual(saved.connections, expected, "Downloaded project retains canonical wires");
  await page.reload(); await page.evaluate(() => wireNexusReady);
  await upload(saved, `${label}.avd`);
  assert.deepEqual((await page.evaluate(() => state.connections)).map(normalizedWire), saved.connections.map(normalizedWire),
    "Reload retains wire records and IDs (absent empty Loom defaults are equivalent)");
  return saved;
};

try {
  await phase("startup", async () => {
    await ready();
    const api = await page.evaluate(() => ({ ready: !!engineTransceiverApi()?.transceiverModulePatch,
      options: engineTransceiverApi().TRANSCEIVER_MODULE_OPTIONS?.map(o => o.value) }));
    assert(api.ready); check("Fresh isolated real Chrome; module API ready", api);
  });

  await phase("ordinary-editor", async () => {
    await newDevice("Acceptance SFP SDI Source");
    const id = await addCage("sfp-plus-cage");
    assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "");
    const empty = await page.evaluate(id => effectiveConnectorType(currentEditorTemplate().connectors.find(c => c.id === id)), id);
    assert(!empty || empty === "sfp-plus-cage", "Empty cage has no active external connector");
    check("Create device and SFP+ cage using editor controls; select empty cage");
    await setModule(id, "lc-singlemode"); await moduleShot("editor-lc"); check("Install LC with stable connector and anchors");
    await setModule(id, "rj45-ethernet"); await moduleShot("editor-rj45"); check("Replace LC with RJ45");
    await directionControl("bidirectional").click();
    const options = await page.locator("#selectedConnectorModule option").evaluateAll(list => list.map(o => ({ value: o.value, label: o.textContent })));
    for (const rate of ["", "-3g", "-6g", "-12g"]) for (const direction of ["rx", "tx"]) {
      assert(options.some(o => o.value === `sfp-sdi${rate}-${direction}`), `Selectable SDI ${rate || "generic"} ${direction}`);
    }
    check("All generic/3G/6G/12G SDI RX/TX options exposed for suitable node", options);
    await directionControl("output").click();
    assert.equal(await page.locator('#selectedConnectorModule option[value="sfp-sdi-rx"]').count(), 0, "RX must not become an output");
    await setModule(id, "sfp-sdi-tx");
    assert.deepEqual((await draft()).connectors[0].moduleCapabilities.supportedRates, [], "Generic SDI cannot imply 12G");
    await setModule(id, "sfp-sdi-12g-tx"); await moduleShot("editor-sdi");
    await setModule(id, ""); await setModule(id, "sfp-sdi-12g-tx");
    sourceTemplate = await draft(); await saveEditor();
    const stored = await page.evaluate(id => localUserSettingsOwner.entry(id), sourceTemplate.id);
    assert.equal(stored.definition.connectors.find(c => c.id === id).installedModuleType, "sfp-sdi-12g-tx");
    await reopenLibrary(sourceTemplate); await selectEditorNode(id);
    assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "sfp-sdi-12g-tx");
    assert.deepEqual(structure((await draft()).connectors.find(c => c.id === id)), structure(sourceTemplate.connectors.find(c => c.id === id)));
    check("Remove/reinstall SDI; save personal definition and reopen through library menu");
    const libraryPath = await download("portable-device-library.json", () => page.locator("#exportDeviceLibrary").click());
    const libraryExport = JSON.parse(await readFile(libraryPath, "utf8"));
    const portableSource = libraryExport.devices.find(device => device.id === sourceTemplate.id);
    assert(portableSource);
    for (const connector of sourceTemplate.connectors) {
      const exported = portableSource.connectors.find(item => item.id === connector.id);
      assert(exported);
      for (const [key, value] of Object.entries(persisted(connector))) assert.deepEqual(exported[key], value);
    }
    sourceTemplate = portableSource;
    check("Portable Device JSON export preserves cage IDs and complete SDI metadata; exported definition feeds later project import");
    await moduleShot("editor-reopened");
    await tab("device"); await page.locator("#duplicateEditorDevice").click();
    await page.waitForFunction(id => currentEditorTemplate().id !== id && !personalDefaultsBusy, sourceTemplate.id);
    const copy = await draft();
    assert.notEqual(copy.id, sourceTemplate.id); assert.equal(copy.connectors.length, sourceTemplate.connectors.length);
    for (const connector of sourceTemplate.connectors) {
      const duplicate = copy.connectors.find(c => c.id === connector.id); assert(duplicate);
      for (const [key, value] of Object.entries(persisted(connector))) assert.deepEqual(duplicate[key], value, `Duplicate preserves ${key}`);
    }
    assert(await page.evaluate(id => localUserSettingsOwner.has(id), copy.id));
    await shot("editor-duplicate"); check("Device Editor duplicate preserves original connector IDs, metadata and geometry", { original: sourceTemplate.id, copy: copy.id });
    await closeEditor(); await page.reload(); await page.evaluate(() => wireNexusReady);
    await reopenLibrary(sourceTemplate); await selectEditorNode(id);
    assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "sfp-sdi-12g-tx");
    await closeEditor(); check("Personal library survives browser page reload");
    await writeJson("authored-source.json", sourceTemplate);
  });

  await phase("modular-card", async () => {
    await closeEditor(); await newDevice("Acceptance Modular SFP");
    await page.locator("#editorHasCards").locator("..").click(); await tab("cards"); await page.locator("#newCardType").click();
    await page.locator("#addCardOutputNode").click();
    const cardBefore = await page.evaluate(() => structuredClone(currentEditorCard()));
    const index = cardBefore.connectors.length - 1;
    await page.locator('[data-sfp-owner="card"] [data-sfp-enabled]').check();
    await page.locator('[data-sfp-owner="card"] [data-sfp-family]').selectOption("sfp-plus-cage");
    await page.locator("#selectedCardConnectorModule").selectOption("lc-singlemode");
    const geometry = await page.evaluate(() => structuredClone(currentEditorCard().connectors.at(-1)));
    await page.locator("#selectedCardConnectorModule").selectOption("sfp-sdi-3g-tx");
    const after = await page.evaluate(() => structuredClone(currentEditorCard().connectors.at(-1)));
    assert.equal(after.installedModuleType, "sfp-sdi-3g-tx"); assert.deepEqual(structure(after), structure(geometry));
    assert.deepEqual(await page.locator(`[data-card-preview-node="${index}"] text > tspan`).allTextContents(),
      ["Installed Module", "SFP SDI 3G TX"], "Card authoring uses the shared module caption, not the old cage/module concatenation");
    await shot("card-definition-sdi"); check("Create modular card cage and install/replace module using card controls");
    // Only the installed slot is a fixture; its module edit below must use the actual Inspector.
    await page.evaluate(() => {
      const t = currentEditorTemplate(), c = currentEditorCard();
      t.cardSlots = [{ id: "acceptance-slot", installedCardTypeId: c.id, y: connectorStartYForTemplate(t), connectorOverrides: {} }];
      ensureDeviceDefinitionV2(t); normalizeConnectorRows(t); renderDeviceEditor();
    });
    report.fixtures.push("modular-card: one deterministic installed card slot; card/node creation and module installation use controls");
    await tab("connectors"); await page.locator("#editorZoomReset").click(); await quiet();
    const generated = await page.evaluate(() => structuredClone(generatedCardConnectors(currentEditorTemplate())));
    const target = generated.find(c => c.sourceConnectorId === after.id); assert(target);
    const hit = await page.evaluate(id => {
      const surface = editorEnginePreviewSurface, device = surface.scene.devices[0];
      const c = device.connectors.find(c => c.id === id); if (!c) throw new Error("Installed card connector missing from Engine preview");
      const p = surface.worldToScreen({ x: device.x + c.x, y: device.y + c.y }), r = surface.dom.root.getBoundingClientRect();
      return { x: r.x + p.x, y: r.y + p.y };
    }, target.id);
    await page.mouse.click(hit.x, hit.y);
    assert.equal(await page.locator('[data-sfp-owner="device"] [data-sfp-enabled]').isChecked(), true);
    await page.locator('[data-sfp-owner="device"] [data-sfp-family]').selectOption("sfp28-cage");
    const changedFamily = await page.evaluate(id => generatedCardConnectors(currentEditorTemplate()).find(c => c.id === id), target.id);
    assert.equal(changedFamily.type, "sfp28-cage");
    assert.equal(changedFamily.installedModuleType, target.installedModuleType);
    assert.equal(changedFamily.id, target.id); assert.equal(changedFamily.x, target.x); assert.equal(changedFamily.y, target.y);
    await page.locator('[data-sfp-owner="device"] [data-sfp-family]').selectOption("sfp-plus-cage");
    await page.locator("#selectedConnectorModule").selectOption("sfp-sdi-12g-tx");
    const installed = await page.evaluate(id => generatedCardConnectors(currentEditorTemplate()).find(c => c.id === id), target.id);
    assert.equal(installed.installedModuleType, "sfp-sdi-12g-tx"); assert.deepEqual(structure(installed), structure(target));
    cardTemplate = await draft(); await moduleShot("card-installed-sdi"); await saveEditor(); await reopenLibrary(cardTemplate);
    const reopened = await page.evaluate(id => generatedCardConnectors(currentEditorTemplate()).find(c => c.id === id), target.id);
    assert.equal(reopened.installedModuleType, "sfp-sdi-12g-tx"); assert.deepEqual(structure(reopened), structure(target));
    await closeEditor(); check("Installed-card Inspector edit, stable ownership/geometry and personal save/reopen");
    await writeJson("authored-card.json", cardTemplate);
  });

  await phase("cage-family-options", async () => {
    await newDevice("Acceptance Cage Families");
    for (const [type, included, excluded] of [
      ["sfp-cage", ["lc-singlemode", "lc-multimode", "rj45-ethernet", "sfp-sdi-3g-rx", "sfp-sdi-3g-tx"],
        ["dac-sfp-plus", "dac-sfp28", "sfp-sdi-12g-tx", "mpo-fiber"]],
      ["qsfp-cage", ["lc-singlemode", "lc-multimode", "mpo-fiber", "dac-qsfp"],
        ["dac-sfp-plus", "dac-sfp28", "sfp-sdi-tx", "rj45-ethernet"]]
    ]) {
      const id = await addCage(type); await directionControl("bidirectional").click();
      const options = await page.locator("#selectedConnectorModule option:not([disabled])").evaluateAll(nodes => nodes.map(n => n.value));
      assert(options.includes("")); included.forEach(value => assert(options.includes(value), `${type} exposes ${value}`));
      excluded.forEach(value => assert(!options.includes(value), `${type} excludes incompatible ${value}`));
      if (type === "qsfp-cage") { await setModule(id, "mpo-fiber"); await setModule(id, ""); }
      await moduleShot(`${type}-options`); check(`${type} filters module families without removing valid optical choices`, options);
    }
    await closeEditor();
  });

  await phase("sdi-canvas", async () => {
    assert(sourceTemplate, "Ordinary UI-created source required; no setter-based substitute");
    const source = structuredClone(sourceTemplate); source.id = "sdi-source"; source.name = "SFP SDI Source";
    const sink = template("sdi-sink", [node("sdi-in", "sdi", "input"), node("hdmi-in", "hdmi", "input", { y: 244 })]);
    const project = projectFor("SFP SDI acceptance", [source, sink]);
    report.fixtures.push("sdi-canvas: place UI-authored source and deterministic ordinary SDI/HDMI receiver; no seeded wires");
    await upload(project);
    const id = source.connectors[0].id;
    await wireDrag([source.id, id], [sink.id, "hdmi-in"], false, "sdi-reject-hdmi");
    await wireDrag([source.id, id], [sink.id, "sdi-in"], true, "sdi-accept-bnc");
    assert.equal(await page.evaluate(() => state.connections[0].cableType), "sdi");
    await shot("sdi-connected");
    const saved = await saveReload("sdi-project"); sdiSnapshot = saved;
    const persisted = await page.evaluate(id => connectorById("sdi-source", id), id);
    assert.equal(persisted.installedModuleType, "sfp-sdi-12g-tx"); assert.equal(persisted.signalDirection, "output");
    assert.equal(saved.connections.length, 1); check("SDI cable creation, module direction and project save/reload");
    await openInstance(source.id); await selectEditorNode(id);
    const connectedDraft = await draft(), cablesBefore = await page.evaluate(() => structuredClone(state.connections));
    await page.locator('[data-sfp-owner="device"] [data-sfp-enabled]').uncheck();
    await page.locator('[data-sfp-owner="device"] [data-sfp-ordinary]').selectOption("hdmi");
    assert.match(report.alerts.at(-1).message, /Disconnect/);
    assert.deepEqual(await draft(), connectedDraft);
    assert.deepEqual(await page.evaluate(() => structuredClone(state.connections)), cablesBefore);
    assert.equal(await page.locator('[data-sfp-owner="device"] [data-sfp-enabled]').isChecked(), true);
    await closeEditor();
    check("Connected checkbox conversion is rejected atomically with original cage and canonical cables intact");
  });

  for (const [form, rate] of [["sfp-plus", "10G"], ["sfp28", "25G"]]) {
    await phase(`dac-${form}`, async () => {
      const cableType = `dac-${form}`, cageType = `${form}-cage`;
      const source = template("dac-source", [node("cage", cageType, "output")]);
      const sink = template("dac-sink", [node("cage", cageType, "input")]);
      const wrong = template("wrong-cage", [node("cage", form === "sfp-plus" ? "sfp28-cage" : "sfp-plus-cage", "input")]);
      report.fixtures.push(`${cableType}: three empty deterministic cages placed; module installation and cable creation use controls`);
      await upload(projectFor(`${cableType} acceptance`, [source, sink, wrong]));
      await wireDrag(["dac-source", "cage"], ["dac-sink", "cage"], false, `${cableType}-empty-cages-inactive`);
      for (const id of ["dac-source", "dac-sink", "wrong-cage"]) {
        await openInstance(id); await selectEditorNode("cage");
        const module = id === "wrong-cage" ? `dac-${form === "sfp-plus" ? "sfp28" : "sfp-plus"}` : cableType;
        assert.match(await page.locator(`#selectedConnectorModule option[value="${module}"]`).innerText(), /integrated cable end/i);
        await setModule("cage", module); await saveEditor();
      }
      await page.locator("#zoomFit").click();
      await wireDrag(["dac-source", "cage"], ["wrong-cage", "cage"], false, `${cableType}-reject-mixed-cages`);
      await wireDrag(["dac-source", "cage"], ["dac-sink", "cage"], true, `${cableType}-connect`);
      const initial = await page.evaluate(() => structuredClone(state.connections[0]));
      assert.equal(initial.cableType, cableType);
      assert.equal(initial.cableAssembly?.kind, "direct-attach-copper", "Wire must persist cableAssembly at creation");
      assert.equal(initial.cableAssembly.cableType, cableType);
      for (const end of ["from", "to"]) {
        assert.equal(initial.cableAssembly.ends[end].formFactor, form);
        assert.equal(initial.cableAssembly.ends[end].moduleType, cableType);
      }
      assert.deepEqual(initial.cableAssembly.supportedRates, [rate]);
      assert(initial.cableAssembly.warnings.some(w => /unverified/i.test(w)), "Unknown platform support must be explicit");
      assert.equal(await page.evaluate(() => state.connections.length), 1);
      check("One physical DAC wire with integrated ends and capability diagnostics persisted on create", initial);
      await page.keyboard.press("Meta+z"); await page.waitForFunction(() => state.connections.length === 0);
      await page.keyboard.press("Meta+Shift+z"); await page.waitForFunction(() => state.connections.length === 1);
      assert.deepEqual(persisted(await canonicalWire(initial.id)), persisted(initial), "Redo restores exact wire identity and assembly");
      await clickPoint("wire", initial.id);
      const historyBeforeLength = await page.evaluate(() => activeEngineBridge().commandIndex);
      await page.locator("#wireLength").fill("3m"); await page.locator("#wireLength").press("Enter");
      await page.waitForFunction(index => activeEngineBridge().commandIndex === index + 1, historyBeforeLength);
      const edited = await canonicalWire(initial.id);
      assert.match(edited.length, /^3\s*m$/); assert.equal(edited.id, initial.id); assert.deepEqual(edited.cableAssembly, initial.cableAssembly);
      await page.keyboard.press("Escape"); await page.locator("#zoomFit").click();
      await page.keyboard.press("Meta+z"); assert.equal((await canonicalWire(initial.id)).length || "", initial.length || "");
      await page.keyboard.press("Meta+Shift+z"); assert.deepEqual(await canonicalWire(initial.id), edited);
      await shot(`${cableType}-3m`);
      check("DAC creation and length edit undo/redo preserve one cable and stable ID");
      await clickPoint("wire", initial.id, "", { button: "right" }); await page.locator('[data-wire-menu="signal-chain"]').click();
      await page.locator("#signalChainDialog[open]").waitFor();
      const chain = await page.locator("#signalChainBody").innerText();
      assert.match(chain, /DAC/i); assert.match(chain, /3\s*m/); assert.doesNotMatch(chain, /invalid|inconsistent|mismatch/i);
      await shot(`${cableType}-signal-chain`); await page.locator("#closeSignalChain").click();
      check("DAC Signal Chain displays assembly and 3 m", chain);
      const saved = await saveReload(`${cableType}-project`);
      assert.equal(saved.connections.length, 1); dacSnapshots.set(form, saved);
      check("DAC downloaded .avd and real reload preserve exact wire/assembly/length");
    });
  }

  await phase("connected-module-guard", async () => {
    const saved = dacSnapshots.get("sfp-plus") || dacSnapshots.get("sfp28"); assert(saved, "Successful DAC workflow required");
    await upload(saved);
    const before = await page.evaluate(() => structuredClone(state.connections));
    const original = await page.evaluate(() => structuredClone(connectorById("dac-source", "cage")));
    await openInstance("dac-source"); await selectEditorNode("cage");
    for (const value of ["", "lc-singlemode", "rj45-ethernet"]) {
      const alertCount = report.alerts.length; await page.locator("#selectedConnectorModule").selectOption(value);
      assert.equal(report.alerts.length, alertCount + 1, "Connected change must visibly alert");
      assert.match(report.alerts.at(-1).message, /disconnect|connected|remap/i);
      assert.equal((await draft()).connectors.find(c => c.id === "cage").installedModuleType, original.installedModuleType);
      assert.deepEqual(await page.evaluate(() => state.connections), before);
    }
    await moduleShot("connected-editor-module-guard"); await closeEditor();
    check("Device Editor blocks connected module removal/replacement without changing cable");
    await clickPoint("device", "dac-source");
    await page.locator('#inspectorBody [data-connected-device="dac-source"][data-connected-connector="cage"]').click();
    await page.locator("#connectorModule").waitFor();
    for (const value of ["", "rj45-ethernet"]) {
      const alertCount = report.alerts.length; await page.locator("#connectorModule").selectOption(value);
      assert.equal(report.alerts.length, alertCount + 1); assert.match(report.alerts.at(-1).message, /disconnect|connected|remap/i);
      assert.equal(await page.locator("#connectorModule").inputValue(), original.installedModuleType);
      assert.deepEqual(await page.evaluate(() => state.connections), before);
    }
    await shot("connected-canvas-module-guard"); check("Editor and canvas Inspector block removal/replacement with alerts and preserve exact wire");
  });

  await phase("export-fixture", async () => {
    assert.equal(dacSnapshots.size, 2, "Both UI-created DAC variants required for export parity");
    const definitions = [], connections = [];
    for (const [form, snapshot] of dacSnapshots) {
      snapshot.devices.filter(d => d.instanceId !== "wrong-cage").forEach((d, index) => {
        const copy = structuredClone(d); copy.instanceId = `${form}-${d.instanceId}`;
        copy.name = `${form.toUpperCase()} ${index ? "Sink" : "Source"}`; copy.y = form === "sfp-plus" ? 100 : 530; definitions.push(copy);
      });
      const w = structuredClone(snapshot.connections[0]); w.from.deviceId = `${form}-${w.from.deviceId}`; w.to.deviceId = `${form}-${w.to.deviceId}`;
      w.id = `${form}-${w.id}`; w.cableNumber = ""; connections.push(w);
    }
    assert(sdiSnapshot && cardTemplate, "UI-authored SDI/card fixtures required for export parity");
    definitions.push(...structuredClone(sdiSnapshot.devices).map(d => ({ ...d, y: 960 })));
    connections.push(...structuredClone(sdiSnapshot.connections));
    definitions.push({ instanceId: "modular-export", templateId: cardTemplate.id, name: cardTemplate.name,
      x: 100, y: 1390, templateOverride: structuredClone(cardTemplate) });
    const project = { ...structuredClone(dacSnapshots.get("sfp-plus")), projectName: "SFP Acceptance Exports", devices: definitions, connections };
    report.fixtures.push("exports: merge UI-authored/reloaded DAC, SDI and modular-card snapshots; namespace colliding IDs and allocate fresh display numbers for combined fixture");
    await upload(project); await shot("export-canvas");
    await phase("cable-schedule-export", async () => {
    await page.locator("#cableScheduleButton").click(); await page.locator("#cableScheduleBody tr").first().waitFor();
    const rows = await page.evaluate(() => structuredClone(cableScheduleRows));
    assert.equal(rows.length, 3, "One schedule row per physical cable: two DAC and one SDI");
    assert.equal(new Set(rows.map(r => r.cableNumber)).size, 3, "Unique cable IDs");
    const dacRows = rows.filter(row => /DAC/.test(row.cable)); assert.equal(dacRows.length, 2);
    for (const row of dacRows) { assert.match(row.length, /^3\s*m$/); assert.match(row.notes, /Integrated DAC assembly/i); }
    assert.match(rows.find(row => row.cableTypeId === "sdi")?.connector || "", /SDI/);
    await shot("cable-schedule"); await writeJson("cable-schedule.json", rows);
    const csv = await download("cable-schedule.csv", () => page.locator("#downloadCableScheduleCsv").click());
    const csvText = await readFile(csv, "utf8");
    for (const row of rows) assert(csvText.includes(row.cableNumber));
    assert.match(csvText, /Integrated DAC assembly/); assert.match(csvText, /SFP28 DAC/); assert.match(csvText, /SFP\+ DAC/);
    const xlsx = await download("cable-schedule.xlsx", () => page.locator("#downloadCableScheduleXlsx").click());
    const ExcelJS = createRequire(import.meta.url)("exceljs"); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(xlsx);
    const cells = []; for (const sheet of workbook.worksheets) sheet.eachRow(row => row.eachCell(cell => cells.push(cell.text)));
    for (const row of rows) assert(cells.includes(row.cableNumber));
    assert.match(cells.join("\n"), /Integrated DAC assembly/);
    await page.locator("#closeCableSchedule").click(); check("Cable Schedule, CSV and XLSX agree on two DAC assemblies plus SDI, stable IDs, 3 m lengths and DAC metadata", rows);
    });
    await phase("offline-html-export", async () => {
    await page.keyboard.press("Escape");
    const htmlPath = await download("sfp-offline.html", () => page.locator("#exportHtml").click());
    const viewer = await context.newPage(), viewerErrors = [];
    viewer.on("pageerror", e => viewerErrors.push(e.message));
    await viewer.route("**/*", route => route.abort());
    await viewer.setContent(await readFile(htmlPath, "utf8"), { waitUntil: "load" });
    await viewer.waitForFunction(() => window.outputViewer, null, { timeout: 60000 });
    await viewer.evaluate(() => engineOutputReady);
    const exported = await viewer.evaluate(() => ({ wires: outputViewer.scene.wires, devices: outputViewer.scene.devices }));
    const viewerScreenshot = join(dir, "offline-viewer.png");
    await viewer.screenshot({ path: viewerScreenshot, fullPage: true }); report.artifacts.push(viewerScreenshot);
    await writeJson("offline-scene.json", exported);
    assert.equal(exported.wires.length, 3);
    for (const wire of connections) {
      const out = exported.wires.find(w => w.id === wire.id); assert(out); assert.equal(out.length, wire.length); assert.equal(out.cableType, wire.cableType);
      if (wire.cableAssembly) assert.deepEqual(out.cableAssembly, wire.cableAssembly, "Offline viewer preserves assembly contract");
    }
    const liveModules = await page.evaluate(() => activeEngineBridge().scene.devices.map(d => ({ id: d.id,
      connectors: d.connectors.filter(c => c.installedModuleType).map(c => ({ id: c.id, type: c.type, physicalType: c.physicalType,
        installedModuleType: c.installedModuleType, moduleCapabilities: c.moduleCapabilities, x: c.x, y: c.y })) })));
    for (const device of liveModules) for (const c of device.connectors) {
      const out = exported.devices.find(d => d.id === device.id)?.connectors.find(connector => connector.id === c.id); assert(out);
      for (const key of Object.keys(c)) assert.deepEqual(out[key], c[key], `Offline module retains ${device.id}.${c.id}.${key}`);
    }
    assert.deepEqual(viewerErrors, []); await viewer.close(); check("Self-contained HTML renders without network and retains ordinary/card modules, cable count/identity/length and DAC assemblies");
    });
    await phase("pdf-export", async () => {
    await page.keyboard.press("Escape");
    await page.locator("#exportPdf").click();
    const pdf = await download("sfp-export.pdf", () => page.locator("#confirmPdfExport").click());
    assert.equal((await readFile(pdf)).subarray(0, 4).toString(), "%PDF");
    try {
      execFileSync(process.env.AVDESIGNER_PDFTOPPM || "pdftoppm", ["-scale-to", "1800", "-png", pdf, join(dir, "pdf-page")], { timeout: 120000 });
      report.artifacts.push(...(await readdir(dir)).filter(name => /^pdf-page-\d+\.png$/.test(name)).map(name => join(dir, name)));
      check("Production PDF downloaded and all pages rasterized for visual inspection");
    } catch (error) { report.limitations.push(`PDF rasterization unavailable: ${error.message}`); }
    let pdfText;
    try {
      pdfText = execFileSync(process.env.AVDESIGNER_PDF_PYTHON || "python3", ["-c",
        "import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1]); print('\\n'.join(p.extract_text() or '' for p in r.pages))", pdf],
      { encoding: "utf8", timeout: 30000 });
    } catch (error) { report.limitations.push(`PDF text inspection unavailable; set AVDESIGNER_PDF_PYTHON to a Python with pypdf: ${error.message}`); }
    if (pdfText !== undefined) {
      await writeFile(join(dir, "pdf-text.txt"), pdfText); report.artifacts.push(join(dir, "pdf-text.txt"));
      for (const pattern of [/SFP\+ DAC/, /SFP28 DAC/, /SFP SDI Source/, /Acceptance Modular SFP/, /3\s*m/]) assert.match(pdfText, pattern);
      check("PDF text includes both DAC families, 3 m, SDI source and modular-card device");
    }
    });
  });
} finally {
  report.finishedAt = new Date().toISOString();
  report.sourceHashesAfter = {};
  for (const path of Object.keys(report.sourceHashes)) {
    try { report.sourceHashesAfter[path] = createHash("sha256").update(await readFile(new URL(`../${path}`, import.meta.url))).digest("hex"); }
    catch { report.sourceHashesAfter[path] = "not present"; }
  }
  report.changedSourcesDuringRun = Object.keys(report.sourceHashes).filter(path => report.sourceHashes[path] !== report.sourceHashesAfter[path]);
  if (report.changedSourcesDuringRun.length) report.limitations.push(`Source changed during acceptance; rerun on a settled revision: ${report.changedSourcesDuringRun.join(", ")}`);
  if (report.pageErrors.length) report.phases.push({ name: "uncaught-browser-errors", status: "failed", error: report.pageErrors.join("\n") });
  report.status = report.phases.some(p => p.status === "failed") ? "failed" : "passed";
  await context.tracing.stop({ path: join(dir, "trace.zip") }).catch(error => report.limitations.push(error.message));
  report.artifacts.push(join(dir, "trace.zip"), join(dir, "results.json"));
  await flush(); await browser.close();
  console.log(JSON.stringify({ status: report.status, phases: report.phases, checks: report.checks.length,
    limitations: report.limitations, evidence: dir }, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
}
