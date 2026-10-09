import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const errors = [];
function scaleFixture(count) {
  const project = cableTypeSelectionFixture();
  project.devices.forEach((device, side) => {
    device.templateOverride.height = count * 25 + 150;
    device.templateOverride.connectors = Array.from({ length: count }, (_, index) => ({
      id: `port-${index}`, type: index % 4 ? "hdmi" : "ethercon", label: "Port",
      direction: side ? "input" : "output", signalDirection: side ? "input" : "output",
      displaySide: side ? "left" : "right", x: side ? 0 : 260, y: 80 + index * 25
    }));
  });
  project.connections = Array.from({ length: count }, (_, index) => ({
    id: `cable-${index}`, cableType: index % 4 ? "hdmi" : "ethercon",
    from: { deviceId: "source", connectorId: `port-${index}` },
    to: { deviceId: "sink", connectorId: `port-${index}` }
  }));
  return project;
}
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1050 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(project => { restoreSnapshot(project); zoomToFit(); }, cableTypeSelectionFixture());
  await page.waitForFunction(() => activeEngineBridge()?.scene?.wires?.length === 4);
  const created = await page.evaluate(() => activeEngineBridge().createLoomFromWires(["cable-0", "cable-1"]));
  assert.equal(created, true);
  const first = await page.evaluate(() => ({ looms: structuredClone(state.looms),
    ids: state.connections.map(wire => wire.loomId || ""),
    selected: activeEngineBridge().scene.selectedLoomId,
    plan: structuredClone(activeEngineBridge().scene.loomPlans[0]) }));
  assert.equal(first.looms.length, 1);
  assert.equal(first.looms[0].name, "LM-001");
  assert.deepEqual(first.ids, ["loom-1", "loom-1", "", ""]);
  assert.equal(first.selected, "loom-1");
  assert.equal(first.plan.circuitCount, 2);
  assert.equal(first.plan.breakouts.length, 4);
  assert.equal(await page.locator("#loomName").inputValue(), "LM-001");
  const setColor = async (selector, value) => page.locator(selector).evaluate((control, color) => {
    control.value = color;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  const previewColor = async (selector, value) => {
    const control = page.locator(selector);
    await control.focus();
    await control.evaluate((element, color) => {
      element.value = color;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  const historyState = () => page.evaluate(() => activeEngineBridge().engineHistoryState());
  const historyBeforeCancel = await historyState();
  assert.deepEqual(await page.evaluate(() => [Object.hasOwn(state.looms[0], "labelTextColor"),
    Object.hasOwn(state.looms[0], "labelBackgroundColor")]), [false, false]);
  await previewColor("#loomLabelTextColor", "#ff0000");
  assert.deepEqual(await page.evaluate(() => ({ root: Object.hasOwn(state.looms[0], "labelTextColor"),
    scene: activeEngineBridge().scene.looms.find(loom => loom.id === "loom-1").labelTextColor })),
  { root: false, scene: "#ff0000" });
  assert.deepEqual(await historyState(), historyBeforeCancel, "text preview creates no history entry");
  await page.locator("#loomLabelTextColor").blur();
  assert.deepEqual(await page.evaluate(() => ({ root: Object.hasOwn(state.looms[0], "labelTextColor"),
    scene: activeEngineBridge().scene.looms.find(loom => loom.id === "loom-1").labelTextColor,
    control: document.querySelector("#loomLabelTextColor").value })),
  { root: false, scene: "#ffffff", control: "#ffffff" });
  assert.deepEqual(await historyState(), historyBeforeCancel, "text cancel creates no history entry");

  await previewColor("#loomLabelBackgroundColor", "#00ff00");
  assert.deepEqual(await page.evaluate(() => ({ root: Object.hasOwn(state.looms[0], "labelBackgroundColor"),
    scene: activeEngineBridge().scene.looms.find(loom => loom.id === "loom-1").labelBackgroundColor })),
  { root: false, scene: "#00ff00" });
  assert.deepEqual(await historyState(), historyBeforeCancel, "background preview creates no history entry");
  await page.locator("#loomLabelBackgroundColor").blur();
  assert.deepEqual(await page.evaluate(() => ({ root: Object.hasOwn(state.looms[0], "labelBackgroundColor"),
    scene: activeEngineBridge().scene.looms.find(loom => loom.id === "loom-1").labelBackgroundColor,
    control: document.querySelector("#loomLabelBackgroundColor").value })),
  { root: false, scene: "#000000", control: "#000000" });
  assert.deepEqual(await historyState(), historyBeforeCancel, "background cancel creates no history entry");

  await page.evaluate(() => {
    state.looms[0].labelTextColor = "not-a-color";
    renderLoomInspector("loom-1");
  });
  assert.equal(await page.locator("#loomLabelTextColor").inputValue(), "#ffffff",
    "malformed historical color initializes to the normalized effective default");
  const invalidHistory = await historyState();
  await previewColor("#loomLabelTextColor", "#112233");
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.looms.find(loom => loom.id === "loom-1").labelTextColor), "#112233");
  assert.equal(await page.evaluate(() => state.looms[0].labelTextColor), "not-a-color");
  await page.locator("#loomLabelTextColor").blur();
  assert.deepEqual(await page.evaluate(() => ({ root: state.looms[0].labelTextColor,
    scene: activeEngineBridge().scene.looms.find(loom => loom.id === "loom-1").labelTextColor,
    control: document.querySelector("#loomLabelTextColor").value })),
  { root: "not-a-color", scene: "#ffffff", control: "#ffffff" });
  assert.deepEqual(await historyState(), invalidHistory, "invalid-value cancel creates no history entry");
  await page.evaluate(() => { delete state.looms[0].labelTextColor; renderLoomInspector("loom-1"); });

  const beforeTextCommit = await historyState();
  await setColor("#loomLabelTextColor", "#ff00ff");
  assert.equal(await page.evaluate(() => state.looms[0].labelTextColor), "#ff00ff");
  const afterTextCommit = await historyState();
  assert.equal(afterTextCommit.commandIndex, beforeTextCommit.commandIndex + 1);
  assert.equal(afterTextCommit.commandCount, beforeTextCommit.commandCount + 1);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms[0].labelTextColor || "#ffffff"), "#ffffff");
  assert.equal(await page.locator("#loomLabelTextColor").inputValue(), "#ffffff",
    "undo synchronizes the selected Loom inspector control");
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms[0].labelTextColor), "#ff00ff");
  const beforeBackgroundCommit = await historyState();
  await setColor("#loomLabelBackgroundColor", "#00ff00");
  assert.deepEqual(await page.evaluate(() => [state.looms[0].labelTextColor, state.looms[0].labelBackgroundColor]),
    ["#ff00ff", "#00ff00"]);
  const afterBackgroundCommit = await historyState();
  assert.equal(afterBackgroundCommit.commandIndex, beforeBackgroundCommit.commandIndex + 1);
  assert.equal(afterBackgroundCommit.commandCount, beforeBackgroundCommit.commandCount + 1);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.deepEqual(await page.evaluate(() => [state.looms[0].labelTextColor || "#ffffff", state.looms[0].labelBackgroundColor || "#000000"]),
    ["#ff00ff", "#000000"]);
  assert.equal(await page.locator("#loomLabelBackgroundColor").inputValue(), "#000000",
    "background undo synchronizes its inspector control");
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  assert.deepEqual(await page.evaluate(() => [state.looms[0].labelTextColor, state.looms[0].labelBackgroundColor]),
    ["#ff00ff", "#00ff00"]);
  assert.equal(await page.locator("#loomLabelBackgroundColor").inputValue(), "#00ff00");
  await page.screenshot({ path: "/tmp/wirenexus-managed-loom-editor.png" });

  const points = await page.evaluate(() => {
    const bridge = activeEngineBridge(), plan = bridge.scene.loomPlans[0];
    const rect = bridge.canvas.getBoundingClientRect();
    const screen = point => ({ x: rect.x + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.y + (point.y - bridge.camera.y) * bridge.camera.zoom });
    return { trunk: screen({ x: (plan.headA.x + plan.headB.x) / 2,
      y: (plan.headA.y + plan.headB.y) / 2 }), headA: screen(plan.headA) };
  });
  await page.mouse.click(points.trunk.x, points.trunk.y);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.selectedLoomId), "loom-1");
  const originalHeadX = await page.evaluate(() => state.looms[0].sideA.x);
  await page.mouse.move(points.headA.x, points.headA.y);
  await page.mouse.down();
  await page.mouse.move(points.headA.x + 35, points.headA.y + 18, { steps: 4 });
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => [state.looms[0].labelTextColor, state.looms[0].labelBackgroundColor]),
    ["#ff00ff", "#00ff00"], "geometry preview/commit preserves Loom label styling");
  assert.ok(await page.evaluate(x => state.looms[0].sideA.x > x + 10, originalHeadX));
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms[0].sideA.x), originalHeadX);
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);

  assert.equal(await page.evaluate(() => activeEngineBridge().addWiresToLoom("loom-1", ["cable-2"])), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 3);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 2);
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 3);

  await page.evaluate(() => Object.assign(state.connections.find(wire => wire.id === "cable-0"),
    { length: "90 m", notes: "Main screen feed" }));
  for (const [selector, value, key] of [
    ["#loomOrigin", "FOH", "origin"], ["#loomDestination", "Stage Rack", "destination"],
    ["#loomTrunkLength", "75 m", "trunkLength"]
  ]) {
    await page.locator(selector).fill(value);
    await page.locator(selector).press("Tab");
    await page.waitForFunction(([field, expected]) => state.looms[0]?.[field] === expected, [key, value]);
  }
  await page.screenshot({ path: "/tmp/wirenexus-managed-loom-metadata.png" });
  await page.evaluate(() => renderWireInspector("cable-2"));
  assert.equal(await page.locator("#wireLength").inputValue(), "75 m");
  assert.equal(await page.locator("#wireLengthSource").innerText(), "Inherited from LM-001");
  await page.locator("#wireLength").focus();
  await page.locator("#wireLength").evaluate(control => control.blur());
  assert.equal(await page.evaluate(() => state.connections.find(wire => wire.id === "cable-2").length || ""), "",
    "viewing or leaving the inherited field must not materialize it as a cable override");
  await page.locator("#wireLength").fill("60 m");
  await page.locator("#wireLength").blur();
  await page.waitForFunction(() => state.connections.find(wire => wire.id === "cable-2")?.length === "60 m");
  assert.equal(await page.locator("#wireLengthSource").count(), 0,
    "a cable-specific length replaces the inherited value and hint");
  const reportAt75 = await page.evaluate(async () => {
    const module = await loadCableScheduleModule();
    return module.buildCableSchedule(state, { assignNumbers: "readOnly" }).find(row => row.wireIds.includes("cable-0"));
  });
  assert.equal(reportAt75.length, "90 m");
  assert.equal(reportAt75.notes, "Main screen feed\nLoom: LM-001 — FOH → Stage Rack\nLoom length: 75 m — Derived from LM-001");
  assert.equal(await page.evaluate(async () => {
    const module = await loadCableScheduleModule();
    const wire = state.connections.find(item => item.id === "cable-0"), original = wire.length;
    wire.length = "";
    const derived = module.buildCableSchedule(state, { assignNumbers: "readOnly" })
      .find(row => row.wireIds.includes("cable-0")).length;
    wire.length = original;
    return derived;
  }), "75 m — Derived from LM-001");
  assert.equal(await page.evaluate(() => state.connections.find(wire => wire.id === "cable-0").notes), "Main screen feed");
  assert.equal(await page.evaluate(async () => {
    const { wireCaption } = await import(engineImportUrl("./src/engine/cableCaption.js"));
    const wire = activeEngineBridge().scene.getWire("cable-0");
    wire.length = "";
    return wireCaption(activeEngineBridge().scene, wire);
  }), "Cable source to Cable sink - 75 m — Derived from LM-001");
  await page.locator("#cableScheduleButton").click();
  await page.waitForFunction(() => document.querySelector("#cableScheduleBody")?.innerText.includes("Loom length: 75 m — Derived from LM-001"));
  assert.match(await page.locator("#cableScheduleBody").innerText(), /Main screen feed[\s\S]*Loom: LM-001 — FOH → Stage Rack[\s\S]*Loom length: 75 m — Derived from LM-001/);
  await page.locator("#closeCableSchedule").click();
  await page.evaluate(() => {
    activeEngineBridge().selectLoomById("loom-1");
    renderInspector();
  });
  await page.locator("#loomTrunkLength").fill("80 m");
  await page.locator("#loomTrunkLength").press("Tab");
  await page.waitForFunction(() => state.looms[0]?.trunkLength === "80 m");
  const reportAt80 = await page.evaluate(async () => {
    const module = await loadCableScheduleModule();
    return module.buildCableSchedule(state, { assignNumbers: "readOnly" }).find(row => row.wireIds.includes("cable-0"));
  });
  assert.equal(reportAt80.length, "90 m");
  assert.match(reportAt80.notes, /Loom length: 80 m — Derived from LM-001/);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms[0].trunkLength), "75 m");
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms[0].trunkLength), "80 m");
  await page.locator("#loomName").fill("LM-BROWSER");
  await page.locator("#loomName").press("Tab");
  await page.waitForFunction(() => state.looms[0]?.name === "LM-BROWSER");
  await page.locator("#cableScheduleButton").click();
  await page.waitForFunction(() => document.querySelector("#cableScheduleBody")?.innerText.includes("Loom length: 80 m — Derived from LM-BROWSER"));
  assert.match((await page.evaluate(async () => {
    const module = await loadCableScheduleModule();
    return module.buildCableSchedule(state, { assignNumbers: "readOnly" }).find(row => row.wireIds.includes("cable-0")).notes;
  })), /Derived from LM-BROWSER/);
  assert.equal(await page.evaluate(() => activeEngineBridge().removeWiresFromLoom(["cable-0"])), true);
  assert.equal(await page.evaluate(async () => {
    const module = await loadCableScheduleModule();
    return module.buildCableSchedule(state, { assignNumbers: "readOnly" }).find(row => row.wireIds.includes("cable-0")).notes;
  }), "Main screen feed");
  await page.locator("#closeCableSchedule").click();
  assert.equal(await page.evaluate(() => activeEngineBridge().addWiresToLoom("loom-1", ["cable-0"])), true);

  const saved = await page.evaluate(() => structuredClone(projectSnapshotData({ forEngine: true })));
  await page.evaluate(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  const projectDownload = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const download = await projectDownload;
  const avdPath = join(mkdtempSync(join(tmpdir(), "wirenexus-loom-")), download.suggestedFilename());
  await download.saveAs(avdPath);
  const savedFile = JSON.parse(readFileSync(avdPath, "utf8"));
  assert.deepEqual([savedFile.looms[0].name, savedFile.looms[0].origin, savedFile.looms[0].destination, savedFile.looms[0].trunkLength],
    ["LM-BROWSER", "FOH", "Stage Rack", "80 m"]);
  assert.deepEqual([savedFile.looms[0].labelTextColor, savedFile.looms[0].labelBackgroundColor], ["#ff00ff", "#00ff00"]);
  assert.equal(savedFile.connections.filter(wire => wire.loomId === "loom-1").length, 3);
  assert.equal(savedFile.connections.find(wire => wire.id === "cable-0").notes, "Main screen feed");
  await page.evaluate(() => { activeEngineBridge().dissolveManagedLoom("loom-1"); });
  assert.equal(await page.evaluate(() => state.looms.length), 0);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#loadProject").click();
  const chooser = await chooserPromise;
  await chooser.setFiles(avdPath);
  await page.waitForFunction(() => activeEngineBridge()?.scene?.loomPlans?.[0]?.circuitCount === 3);
  assert.deepEqual(await page.evaluate(() => [state.looms[0].name, state.looms[0].origin, state.looms[0].destination,
    state.looms[0].trunkLength, state.looms[0].labelTextColor, state.looms[0].labelBackgroundColor]),
  ["LM-BROWSER", "FOH", "Stage Rack", "80 m", "#ff00ff", "#00ff00"]);
  const reselected = await page.evaluate(() => {
    const bridge = activeEngineBridge(), plan = bridge.scene.loomPlans[0];
    const rect = bridge.canvas.getBoundingClientRect();
    const world = { x: (plan.headA.x + plan.headB.x) / 2, y: (plan.headA.y + plan.headB.y) / 2 };
    return { x: rect.x + (world.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.y + (world.y - bridge.camera.y) * bridge.camera.zoom };
  });
  await page.mouse.click(reselected.x, reselected.y);
  assert.deepEqual(await Promise.all(["#loomOrigin", "#loomDestination", "#loomTrunkLength"].map(selector => page.locator(selector).inputValue())),
    ["FOH", "Stage Rack", "80 m"]);
  await page.screenshot({ path: "/tmp/wirenexus-managed-loom-reloaded.png" });
  const output = buildEngineOutputScene(saved);
  const viewer = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  viewer.on("pageerror", error => errors.push(error.message));
  await viewer.goto(`${base}/output-viewer.html?empty=1`);
  await viewer.evaluate(snapshot => mountOutputViewer(snapshot), output);
  const viewerState = await viewer.evaluate(() => ({ count: outputViewer.scene.loomPlans[0]?.circuitCount,
    hidden: outputViewer.scene.hiddenLoomWireIds.size, signature: outputViewer.model.contract.signature,
    labelTextColor: outputViewer.model.contract.looms[0]?.labelTextColor,
    labelBackgroundColor: outputViewer.model.contract.looms[0]?.labelBackgroundColor }));
  assert.equal(viewerState.count, 3);
  assert.equal(viewerState.hidden, 3);
  assert.equal(viewerState.signature, output.signature);
  assert.deepEqual([viewerState.labelTextColor, viewerState.labelBackgroundColor], ["#ff00ff", "#00ff00"]);
  await viewer.screenshot({ path: "/tmp/wirenexus-managed-loom-viewer.png" });
  await viewer.close();

  const stress = [];
  for (const count of [8, 16, 32, 64]) {
    await page.evaluate(project => {
      window.loomStressStart = performance.now();
      restoreSnapshot(project);
    }, scaleFixture(count));
    await page.waitForFunction(expected => activeEngineBridge()?.ready
      && activeEngineBridge().scene.wires.length === expected, count);
    const result = await page.evaluate(() => {
      const refreshMs = performance.now() - window.loomStressStart;
      const bridge = activeEngineBridge(), wireIds = state.connections.map(wire => wire.id);
      const createStart = performance.now();
      const created = bridge.createLoomFromWires(wireIds);
      const createMs = performance.now() - createStart;
      zoomToFit();
      return { created, count: bridge.scene.loomPlans[0]?.circuitCount,
        hidden: bridge.scene.hiddenLoomWireIds.size, refreshMs, createMs };
    });
    assert.equal(result.created, true);
    assert.equal(result.count, count);
    assert.equal(result.hidden, count);
    stress.push(result);
  }
  const camera = await page.evaluate(async () => {
    const bridge = activeEngineBridge(), before = bridge.renderer.fullRebuildCount;
    for (let index = 0; index < 20; index++) {
      bridge.camera.x += 4;
      bridge.camera.zoom *= index % 2 ? 1.01 : 1 / 1.01;
      bridge.scheduleRender();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return { rebuilds: bridge.renderer.fullRebuildCount - before,
      count: bridge.scene.loomPlans[0].circuitCount };
  });
  assert.equal(camera.rebuilds, 0);
  assert.equal(camera.count, 64);
  assert.ok(await page.locator("#loomComposition").evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  const expanded = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const before = bridge.renderer.wireVertexMap.get("loom:loom-1").length;
    bridge.toggleLoomExpanded("loom-1");
    return { before, after: bridge.renderer.wireVertexMap.get("loom:loom-1").length,
      expanded: bridge.scene.expandedLoomIds.has("loom-1") };
  });
  assert.equal(expanded.expanded, true);
  assert.equal(expanded.after, expanded.before, "large Loom expansion stays bounded");
  await page.screenshot({ path: "/tmp/wirenexus-managed-loom-64-circuits.png" });

  await page.evaluate(project => { restoreSnapshot(project); zoomToFit(); }, cableTypeSelectionFixture());
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.wires.length === 4);
  const wirePoint = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.selectWiresBySourceIds(["cable-0", "cable-1"]);
    const points = bridge.scene.wireRenderPolyline(bridge.scene.getWire("cable-0"));
    const middle = points[Math.floor(points.length / 2)];
    const rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.x + (middle.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.y + (middle.y - bridge.camera.y) * bridge.camera.zoom };
  });
  await page.mouse.click(wirePoint.x, wirePoint.y, { button: "right" });
  await page.locator('[data-wire-menu="create-loom"]').click();
  assert.equal(await page.evaluate(() => state.looms.length), 1);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 2);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms.length), 0);
  assert.equal(await page.evaluate(() => activeEngineBridge().createLoomFromWires(["cable-0", "cable-1"])), true);
  assert.equal(await page.evaluate(() => state.looms[0].name), "LM-002");
  assert.deepEqual(errors, []);
  console.log("Managed Loom browser smoke PASS: metadata editing, dynamic report notes, cable/loom length independence, membership changes, save/reload, output viewer, stress; screenshots in /tmp", stress, camera);
} finally {
  await browser.close();
}
