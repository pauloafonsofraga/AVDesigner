import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const launchOptions = { headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" };
let browser = await chromium.launch(launchOptions);
const shots = "/tmp/wirenexus-unified-jump-loom";
mkdirSync(shots, { recursive: true });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
try {
  let page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, acceptDownloads: true });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const restoreProject = async project => {
    await page.bringToFront();
    await page.evaluate(async data => {
      let timer;
      try {
        await Promise.race([restoreSnapshot(data), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Project restore did not settle within 30 seconds")), 30000);
        })]);
      } finally { clearTimeout(timer); }
    }, project);
    await page.waitForFunction(() => activeEngineBridge()?.ready);
  };
  const fixture = bidirectionalJumpFixture("output", "input"); fixture.connections = []; fixture.jumpNodes = [];
  await restoreProject(fixture);
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
  await restoreProject(saved);
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

  const insertJump = async point => {
    await page.locator("#jumpNodeTool").click();
    const p = await screen(point); await page.mouse.click(p.x, p.y); await page.keyboard.press("Escape");
    return (await read()).nodes.at(-1);
  };
  const pairNodes = async (first, second) => {
    const a = await screen(first), b = await screen(second);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(320);
    assert.equal(await page.evaluate(() => Boolean(activeEngineBridge().jumpLinkCreate)), true);
    await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
    assert.equal((await read()).links.length, 1);
  };
  const readLoom = () => page.evaluate(() => ({ looms: structuredClone(state.looms),
    plans: structuredClone(activeEngineBridge().scene.loomPlans), wires: structuredClone(state.connections),
    draft: activeEngineBridge().loomCreate && structuredClone({
      resumeLoomId: activeEngineBridge().loomCreate.resumeLoomId, pointerWorld: activeEngineBridge().loomCreate.pointerWorld,
      sideA: activeEngineBridge().loomCreate.sideA, routePoints: activeEngineBridge().loomCreate.routePoints,
      awaitingPointerDown: activeEngineBridge().loomCreate.awaitingPointerDown }),
    history: activeEngineBridge().commandIndex }));
  let stressProject;
  for (const { alreadyPaired, reverse, routeStyle } of [
    { alreadyPaired: true, reverse: false, routeStyle: "bezier" },
    { alreadyPaired: false, reverse: false, routeStyle: "orthogonal" },
    { alreadyPaired: false, reverse: true, routeStyle: "orthogonal" }
  ]) {
    const caseName = alreadyPaired ? "paired" : reverse ? "reverse-paired" : "later-paired";
    const project = structuredClone(fixture);
    project.devices = project.devices.slice(0, 2);
    project.devices[0].x = 0; project.devices[0].y = 550;
    project.devices[1].x = 800; project.devices[1].y = 550;
    project.connections = [{ id: "bundle-cable", cableType: "hdmi", length: "55 m", cableNumber: "V10", notes: "Keep me",
      from: { deviceId: "source", connectorId: "port" }, to: { deviceId: "destination", connectorId: "port" } }];
    await restoreProject(project);
    await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 1; bridge.scheduleRender(); });
    let entry = await insertJump({ x: 380, y: 250 });
    let exit = alreadyPaired ? await insertJump({ x: 800, y: 180 }) : null;
    if (alreadyPaired) await pairNodes(entry, exit);
    const wiresBefore = (await read()).wires;
    if (await page.evaluate(() => activeEngineBridge().currentWireRouteMode()) !== routeStyle) await page.locator("#wireModeToggle").click();
    await page.locator("#createCableLoom").click();
    const authored = [{ x: 250, y: 120 }, { x: 250, y: 220 }];
    for (const point of [{ x: 100, y: 120 }, ...authored]) {
      const p = await screen(point); await page.mouse.click(p.x, p.y);
    }
    const entryScreen = await screen(entry);
    await page.mouse.move(entryScreen.x, entryScreen.y, { steps: 4 }); await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => activeEngineBridge().loomCreate.jumpHover.valid), true);
    assert.ok(await page.evaluate(() => activeEngineBridge().loomJumpHoverStates().some(state => state.scale > 1.4)));
    assert.equal((await readLoom()).looms.length, 0, "hover enlargement does not persist a Loom or size edit");
    const expectedSection = await page.evaluate(async () => {
      const { loomTrunkPoints } = await import("./src/engine/loomGeometry.js");
      const draft = activeEngineBridge().loomCreate;
      return loomTrunkPoints({ ...draft, sideB: draft.jumpHover.point });
    });
    await page.screenshot({ path: `${shots}/pass-b-${alreadyPaired ? "paired" : "waiting"}-hover.png` });
    await page.mouse.click(entryScreen.x, entryScreen.y);
    let current = await readLoom();
    assert.equal(current.looms.length, 1); const loomId = current.looms[0].id;
    assert.equal(current.looms[0].jumpRouting.entryJumpId, entry.id);
    assert.equal(current.plans[0].visibleTrunkSections.length, 1);
    assert.equal(current.looms[0].routeStyle, routeStyle);
    assert.deepEqual(current.looms[0].routePoints.slice(0, -1).map(({ x, y }) => ({ x, y })), authored);
    const firstSection = current.plans[0].visibleTrunkSections[0];
    assert.deepEqual(firstSection, expectedSection, "attachment changes only the terminal endpoint, not the authored route");
    const firstPoints = current.looms[0].routePoints;
    const attached = structuredClone(current.looms[0]);
    await page.keyboard.press("Meta+z"); assert.equal((await readLoom()).looms.length, 0);
    assert.equal((await readLoom()).draft, null, "undo attachment cancels the now-invalid continuation");
    await page.keyboard.press("Meta+Shift+z"); assert.deepEqual((await readLoom()).looms[0], attached);
    if (alreadyPaired) { const p = await screen(exit); await page.mouse.click(p.x, p.y); }
    assert.deepEqual(current.wires, wiresBefore);
    if (!alreadyPaired) {
      assert.equal(current.draft, null, "unpaired attachment ends the gesture without a pointer ghost");
      const waitingSave = await page.evaluate(() => projectSnapshotData({ forEngine: true }));
      await restoreProject(waitingSave);
      await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 1; bridge.scheduleRender(); });
      assert.equal((await readLoom()).plans[0].hiddenHeadB, true);
      assert.deepEqual((await readLoom()).looms, waitingSave.looms);
      assert.equal((await read()).dots[0], "#ef4444");
      await page.screenshot({ path: `${shots}/${caseName}-waiting-red.png` });
      exit = await insertJump({ x: 800, y: 180 });
      const beforePair = (await readLoom()).history;
      await pairNodes(reverse ? exit : entry, reverse ? entry : exit);
      const auto = await readLoom();
      assert.equal(auto.draft.resumeLoomId, loomId, "successful pair commit immediately activates continuation");
      assert.equal(auto.history, beforePair + 1, "preview activation does not add history");
      assert.deepEqual(auto.draft.routePoints, [], "pair completion release adds no route corner");
      assert.equal(auto.draft.awaitingPointerDown, true);
      assert.deepEqual(auto.draft.pointerWorld, reverse ? { x: entry.x, y: entry.y } : { x: exit.x, y: exit.y });
      await page.screenshot({ path: `${shots}/${caseName}-auto-resume.png` });
    }
    current = await readLoom(); assert.equal(current.draft.resumeLoomId, loomId);
    assert.deepEqual(current.draft.sideA, { x: exit.x, y: exit.y });
    assert.deepEqual((await read()).dots, ["", ""]);
    assert.deepEqual(await page.evaluate(ids => ids.map(id => activeEngineBridge().scene.getDevice(id).visual.jumpColor), [entry.id, exit.id]),
      ["#32b6ff", "#fb7904"]);
    const corner = await screen({ x: 900, y: 280 }); await page.mouse.click(corner.x, corner.y);
    assert.equal((await readLoom()).draft.routePoints.length, 1, "next deliberate click is the first continuation corner");
    if (!alreadyPaired) {
      await page.keyboard.press("Escape");
      assert.equal((await readLoom()).draft, null); assert.equal((await read()).links.length, 1);
      assert.deepEqual((await readLoom()).plans[0].visibleTrunkSections[0], firstSection);
      await page.keyboard.press("Meta+z"); assert.equal((await read()).links.length, 0);
      await page.keyboard.press("Meta+Shift+z"); assert.equal((await read()).links.length, 1);
      const p = await screen(exit); await page.mouse.click(p.x, p.y);
      await page.mouse.click(corner.x, corner.y);
    }
    const end = await screen({ x: 1030, y: 400 }); await page.mouse.dblclick(end.x, end.y);
    current = await readLoom();
    assert.equal(current.looms.length, 1); assert.equal(current.looms[0].id, loomId);
    assert.equal(current.looms[0].jumpRouting.continuationComplete, true);
    assert.equal(current.plans[0].visibleTrunkSections.length, 2);
    assert.deepEqual(current.plans[0].visibleTrunkSections[0], firstSection);
    assert.deepEqual(current.looms[0].routePoints.slice(0, firstPoints.length), firstPoints);
    if (routeStyle === "orthogonal") for (const section of current.plans[0].visibleTrunkSections) {
      for (let index = 1; index < section.length; index++) assert.ok(section[index].x === section[index - 1].x || section[index].y === section[index - 1].y);
    }
    const complete = structuredClone(current.looms[0]);
    await page.keyboard.press("Meta+z"); assert.equal((await readLoom()).looms[0].jumpRouting.continuationComplete, false);
    assert.deepEqual((await readLoom()).plans[0].visibleTrunkSections[0], firstSection);
    await page.keyboard.press("Meta+Shift+z"); assert.deepEqual((await readLoom()).looms[0], complete);
    assert.deepEqual(current.plans[0].visibleTrunkSections[0].at(-1), { x: entry.x, y: entry.y });
    assert.deepEqual(current.plans[0].visibleTrunkSections[1][0], { x: exit.x, y: exit.y });
    assert.deepEqual(current.wires, wiresBefore);
    assert.deepEqual(current.looms[0].portalPairs, []);
    assert.equal(await page.evaluate(() => activeEngineBridge().visibleJumpLinkOverlays().length), 0);
    assert.equal(await page.evaluate(id => activeEngineBridge().addWiresToLoom(id, ["bundle-cable"]), loomId), true);
    await page.evaluate(id => activeEngineBridge().updateManagedLoom(id, { labelTextColor: "#ffccdd", labelBackgroundColor: "#334455" }), loomId);
    const membersBefore = (await readLoom()).wires;
    const completedSave = await page.evaluate(() => projectSnapshotData({ forEngine: true }));
    stressProject = structuredClone(completedSave);
    writeFileSync(`${shots}/stress-project.json`, JSON.stringify(stressProject));
    await restoreProject(completedSave);
    await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 1; bridge.scheduleRender(); });
    assert.deepEqual((await readLoom()).wires, membersBefore);
    assert.deepEqual((await readLoom()).looms, completedSave.looms);
    assert.equal((await readLoom()).plans[0].circuitCount, 1);
    for (const node of [entry, exit]) {
      const start = await screen(node);
      const beforeMove = await readLoom();
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x + 40, start.y + 35, { steps: 6 });
      const during = await page.evaluate(() => ({ root: JSON.stringify(state.connections),
        previews: activeEngineBridge().interactionRenderState().loomJumpPreviews,
        moved: activeEngineBridge().dragSession?.selectedIds }));
      assert.ok(during.moved?.includes(node.id));
      assert.equal(during.previews[0].plan.circuitCount, 1);
      await page.mouse.up();
      assert.equal((await readLoom()).history, beforeMove.history + 1);
      await page.keyboard.press("Meta+z");
      assert.deepEqual((await readLoom()).plans[0].visibleTrunkSections, beforeMove.plans[0].visibleTrunkSections);
      await page.keyboard.press("Meta+Shift+z");
      Object.assign(node, (await read()).nodes.find(item => item.id === node.id));
      assert.deepEqual((await readLoom()).wires, membersBefore);
    }
    const exported = await page.evaluate(async () => {
      const snapshot = buildCanonicalOutputSnapshot({ projectData: projectSnapshotData({ forEngine: true }), mode: "loom-jump-output" });
      const drawing = await buildEnginePrintDrawing(snapshot), [module, bundle] = await engineViewerResources();
      return { html: module.buildEngineViewerHtml(snapshot, { bundle }), svg: drawing.svg,
        plan: snapshot.engineScene.loomPlans[0] };
    });
    assert.deepEqual(exported.plan.visibleTrunkSections, (await readLoom()).plans[0].visibleTrunkSections);
    assert.match(exported.svg, /fill="#ffccdd"/);
    assert.match(exported.svg, /rgba\(50,182,255,1\)/);
    assert.match(exported.svg, /rgba\(251,121,4,1\)/);
    const output = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await output.route("**/*", route => route.abort()); await output.setContent(exported.html);
    await output.waitForFunction(() => Boolean(window.outputViewer));
    assert.deepEqual(await output.evaluate(() => outputViewer.model.contract.loomPlans[0].visibleTrunkSections),
      exported.plan.visibleTrunkSections);
    assert.ok(await output.evaluate(id => outputViewer.scene.getDevice(id).visual.jumpLoomId, entry.id));
    assert.deepEqual(await output.evaluate(ids => ids.map(id => outputViewer.scene.getDevice(id).visual.jumpColor), [entry.id, exit.id]),
      ["#32b6ff", "#fb7904"]);
    await output.screenshot({ path: `${shots}/pass-b-${caseName}-offline-viewer.png` });
    await output.close();
    const hosted = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await hosted.route("**/*", route => route.request().isNavigationRequest()
      ? route.fulfill({ status: 200, contentType: "text/html", body: exported.html }) : route.abort());
    await hosted.goto("https://wirenexus-publish.test/project");
    await hosted.waitForFunction(() => Boolean(window.outputViewer));
    assert.deepEqual(await hosted.evaluate(() => outputViewer.model.contract.loomPlans[0].visibleTrunkSections), exported.plan.visibleTrunkSections);
    assert.deepEqual(await hosted.evaluate(ids => ids.map(id => outputViewer.scene.getDevice(id).visual.jumpColor), [entry.id, exit.id]),
      ["#32b6ff", "#fb7904"]);
    await hosted.close();
    await page.locator("#exportPdf").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.locator("#confirmPdfExport").click();
    const download = await downloadPromise;
    const pdfPath = `${shots}/pass-b-${caseName}.pdf`;
    await download.saveAs(pdfPath); assert.equal(readFileSync(pdfPath).subarray(0, 4).toString(), "%PDF");
    const p = await screen(entry); await page.mouse.click(p.x, p.y);
    await page.locator("#jumpDisconnectPair").click();
    assert.equal((await readLoom()).plans[0].visibleTrunkSections.length, 1);
    assert.equal((await readLoom()).looms.length, 1);
    await page.keyboard.press("Meta+z");
    assert.equal((await readLoom()).plans[0].visibleTrunkSections.length, 2);
    await page.mouse.click(p.x, p.y); await page.locator("#jumpDisconnectPair").click();
    await pairNodes(entry, exit);
    assert.equal((await readLoom()).plans[0].visibleTrunkSections.length, 2);
    assert.equal((await readLoom()).draft, null, "repair restores completed sections without starting a tool");
    const deletePoint = await screen(exit); await page.mouse.click(deletePoint.x, deletePoint.y); await page.keyboard.press("Delete");
    assert.equal((await readLoom()).looms.length, 1); assert.deepEqual((await readLoom()).wires, membersBefore);
    assert.equal((await readLoom()).looms[0].jumpRouting.exitJumpId, "");
    await page.keyboard.press("Meta+z");
    assert.equal((await readLoom()).plans[0].visibleTrunkSections.length, 2);
    const removeEntry = await screen(entry); await page.mouse.click(removeEntry.x, removeEntry.y); await page.keyboard.press("Delete");
    assert.equal((await readLoom()).looms[0].jumpRouting, undefined);
    assert.deepEqual((await readLoom()).wires, membersBefore);
    await page.keyboard.press("Meta+z");
    assert.equal((await readLoom()).plans[0].visibleTrunkSections.length, 2);
    await page.screenshot({ path: `${shots}/pass-b-${caseName}-completed.png` });
    assert.equal(await page.evaluate(id => activeEngineBridge().dissolveManagedLoom(id), loomId), true);
    assert.equal((await readLoom()).looms.length, 0);
    const dissolved = (await readLoom()).wires.map(wire => { const copy = { ...wire }; delete copy.loomId; return copy; });
    assert.deepEqual(dissolved, membersBefore.map(wire => { const copy = { ...wire }; delete copy.loomId; return copy; }));
    await page.keyboard.press("Meta+z");
    assert.equal((await readLoom()).plans[0].visibleTrunkSections.length, 2);
    await page.evaluate(id => activeEngineBridge().selectLoomById(id), loomId);
    await page.mouse.move(500, 600); await page.keyboard.press("Delete");
    assert.equal((await readLoom()).looms.length, 0, "Delete releases the Jump association without deleting conductors");
    assert.equal((await readLoom()).wires.length, membersBefore.length);
    await page.keyboard.press("Meta+z");
    assert.equal((await readLoom()).plans[0].visibleTrunkSections.length, 2);
    console.log(`PASS ${caseName} ${routeStyle}: route preservation, auto-resume, statuses, history, save/reload, offline/hosted output, PDF, cable preservation`);
  }
  for (const count of [8, 32, 64]) {
    // Isolate performance fixtures from the preceding viewer/PDF contexts and from each other.
    await page.close(); await browser.close();
    browser = await chromium.launch(launchOptions);
    page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
    console.log(`START ${count}-circuit isolated stress fixture`);
    const project = structuredClone(stressProject);
    // Benchmark the saved Loom style without triggering Legacy ordinary-wire route freezing on restore.
    project.wireMode = "bezier";
    project.connections = Array.from({ length: count }, (_, index) => ({ ...structuredClone(project.connections[0]),
      id: `stress-${index}`, cableNumber: `V${index + 1}` }));
    await restoreProject(project);
    assert.equal(await page.evaluate(() => activeEngineBridge().scene.looms[0].routeStyle), "orthogonal");
    await page.evaluate(() => {
      window.jumpStressRestore?.();
      const bridge = activeEngineBridge(); bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 1;
      bridge.scheduleRender();
      const restores = [];
      window.jumpStressRestore = () => restores.forEach(restore => restore());
      window.jumpStressCounts = { composition: 0, loomGeometry: 0, wireIndex: 0, renderer: 0 };
      for (const [owner, method, key] of [[bridge, "refreshLoomComposition", "composition"],
        [bridge.scene, "rebuildLoomGeometry", "loomGeometry"], [bridge.scene, "rebuildWireSpatialIndex", "wireIndex"],
        [bridge.renderer, "rebuildWireGeometry", "renderer"]]) {
        const original = owner[method];
        restores.push(() => { owner[method] = original; });
        owner[method] = function (...args) { window.jumpStressCounts[key]++; return original.apply(this, args); };
      }
      window.jumpStressPointerTimes = [];
      const original = bridge.updateLoomCreationPointer;
      restores.push(() => { bridge.updateLoomCreationPointer = original; });
      bridge.updateLoomCreationPointer = function (...args) {
        const start = performance.now(); const result = original.apply(this, args);
        window.jumpStressPointerTimes.push(performance.now() - start); return result;
      };
    });
    const entry = project.jumpNodes.find(node => node.id === project.looms[0].jumpRouting.entryJumpId);
    const p = await screen(entry); await page.mouse.move(p.x, p.y); await page.mouse.down();
    const times = [];
    for (let frame = 1; frame <= 18; frame++) {
      await page.mouse.move(p.x + frame * 3, p.y + frame * 2);
      times.push(await page.evaluate(() => {
        const bridge = activeEngineBridge(), start = performance.now(); bridge.interactionRenderState();
        return performance.now() - start;
      }));
    }
    const drag = await page.evaluate(() => ({ counts: { ...jumpStressCounts },
      frames: activeEngineBridge().dragSession.loomJumpFrames,
      totalMs: activeEngineBridge().dragSession.loomJumpTotalMs,
      circuits: activeEngineBridge().interactionRenderState().loomJumpPreviews[0].plan.circuitCount }));
    assert.deepEqual(drag.counts, { composition: 0, loomGeometry: 0, wireIndex: 0, renderer: 0 });
    assert.equal(drag.circuits, count); await page.mouse.up();
    const committed = await page.evaluate(() => ({ ...jumpStressCounts }));
    const waiting = await page.evaluate(() => projectSnapshotData({ forEngine: true }));
    waiting.looms[0].jumpRouting.continuationComplete = false;
    await restoreProject(waiting);
    const exit = waiting.jumpNodes.find(node => node.id === waiting.looms[0].jumpRouting.exitJumpId);
    const exitPoint = await screen(exit); await page.mouse.click(exitPoint.x, exitPoint.y);
    await page.evaluate(() => { for (const key of Object.keys(jumpStressCounts)) jumpStressCounts[key] = 0; });
    const continuationTimes = [];
    for (let frame = 1; frame <= 18; frame++) {
      const start = performance.now();
      await page.mouse.move(exitPoint.x + frame * 4, exitPoint.y + frame * 3);
      continuationTimes.push(performance.now() - start);
    }
    assert.deepEqual(await page.evaluate(() => ({ ...jumpStressCounts })),
      { composition: 0, loomGeometry: 0, wireIndex: 0, renderer: 0 });
    await page.keyboard.press("Escape");
    const hoverNode = await insertJump({ x: 1100, y: 120 });
    await page.locator("#createCableLoom").click();
    const start = await screen({ x: 100, y: 90 }); await page.mouse.click(start.x, start.y);
    await page.evaluate(() => { for (const key of Object.keys(jumpStressCounts)) jumpStressCounts[key] = 0; });
    const hover = await screen(hoverNode);
    for (let step = 20; step >= 0; step--) await page.mouse.move(hover.x - step * 2, hover.y);
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => activeEngineBridge().loomCreate.jumpHover.valid), true);
    assert.deepEqual(await page.evaluate(() => ({ ...jumpStressCounts })),
      { composition: 0, loomGeometry: 0, wireIndex: 0, renderer: 0 });
    await page.keyboard.press("Escape");
    const pointerTimes = await page.evaluate(() => [...jumpStressPointerTimes]);
    console.log(JSON.stringify({ stress: count, dragFrames: drag.frames, geometryMeanMs: drag.totalMs / drag.frames,
      renderStateMaxMs: Math.max(...times), continuationInputMaxMs: Math.max(...continuationTimes),
      pointerUpdateMeanMs: pointerTimes.reduce((sum, time) => sum + time, 0) / pointerTimes.length,
      pointerUpdateMaxMs: Math.max(...pointerTimes),
      perFrameRebuilds: drag.counts, committedRebuilds: committed }));
  }
  assert.deepEqual(errors, []);
  await page.close();
  console.log("PASS unified Loom/Jump acceptance: all workflows and stress checks; zero page errors");
} catch (error) {
  console.error(error);
  throw error;
} finally { await browser.close(); }
