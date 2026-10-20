import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { multiCoreJumpProject } from "../fixtures/multi-core-jump.mjs";
import { buildOutputJumpNavigation } from "../src/engine/outputNavigation.js";
import { pdfPageLayout } from "../src/engine/outputPdfLayout.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-multi-core-jump";
await mkdir(dir, { recursive: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 2000, height: 1400 }, acceptDownloads: true });
  const errors = []; page.on("pageerror", e => { errors.push(e.message); console.error("PAGE ERROR", e.message); }); page.on("dialog", d => d.accept());
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773");
  await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  const project = connectedMultiCoreProject(); project.projectName = "Multi-Core Jump Acceptance";
  project.multiCores = []; project.multiCoreDefinitions = []; project.connections = [];
  project.devices[0].x = -400; project.devices[1].x = 2000;
  const load = async value => { await page.locator("#fileInput").setInputFiles({ name: "acceptance.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) }); await page.waitForFunction(name => state.projectName === name && activeEngineBridge()?.ready, value.projectName); };
  await load(project);
  const canvas = page.locator(".engine-bridge-canvas"), rect = await canvas.boundingBox();
  const screen = async point => page.evaluate(p => { const b = activeEngineBridge(), r = b.canvas.getBoundingClientRect(); return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom }; }, point);
  const point = async (id, connector = "") => page.evaluate(({ id, connector }) => {
    const b = activeEngineBridge(), d = ["A", "B"].includes(id) ? b.scene.devices.find(d => d.multiCoreIdentity?.role === id) : b.scene.getDevice(id);
    const p = connector ? b.scene.connectorWorldPoint(d, d.connectors.find(c => c.id === connector)) : { x: d.x + d.width / 2, y: d.y + (d.kind === "jump" ? d.height / 2 : 24) };
    const r = b.canvas.getBoundingClientRect(); return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom };
  }, { id, connector });
  const click = async p => page.mouse.click(p.x, p.y);
  const drag = async (a, b, hold = false) => {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    if (hold) { await page.waitForTimeout(350); assert(await page.evaluate(() => !!activeEngineBridge().jumpLinkCreate)); }
    await page.mouse.move(b.x, b.y, { steps: 12 });
    if (hold) assert(await page.evaluate(() => activeEngineBridge().jumpLinkCreate?.compatibility?.valid));
    await page.mouse.up();
  };
  const read = () => page.evaluate(() => ({ mc: structuredClone(state.multiCores[0]), nodes: structuredClone(state.jumpNodes), cables: structuredClone(state.connections), history: activeEngineBridge().commandHistory.length, index: activeEngineBridge().commandIndex }));
  const shot = name => page.screenshot({ path: `${dir}/${name}.png` });
  await page.locator("#createMultiCore").click(); await page.locator('dialog button[value="place"]').click();
  await page.waitForFunction(() => activeEngineBridge().multiCorePlacement);
  await click({ x: rect.x + 350, y: rect.y + 160 }); await click({ x: rect.x + 850, y: rect.y + 180 });
  await page.waitForFunction(() => state.multiCores.length === 1);
  await page.locator("#zoomFit").click();
  await drag(await point("server", "port"), await point("A", "a-91"));
  await drag(await point("B", "b-41"), await point("processor", "port"));
  assert.equal((await read()).cables.length, 2);
  const mapping = (await read()).mc.circuits;
  const trace = () => page.evaluate(async () => {
    const { createMultiCoreConnectivity, traceMultiCoreSignalPath } = await import("./src/engine/multiCoreConnectivity.js");
    const s = createMultiCoreConnectivity(projectSnapshotData()); return traceMultiCoreSignalPath(s, state.connections[0].id);
  });
  assert.equal((await trace()).valid, true);
  // Select a real patch lead through its visible geometry, then use its ordinary Loom command.
  const wirePoint = async (role = "", physical = false) => page.evaluate(({ role, physical }) => {
    const b = activeEngineBridge(), w = b.scene.wires.find(w => physical ? !w.multiCoreIdentity : w.multiCoreIdentity && (!role || w.multiCoreIdentity.sectionRole === role));
    const ps = b.scene.wireRenderPolyline(w), p = ps[Math.floor(ps.length * .45)], r = b.canvas.getBoundingClientRect();
    return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom };
  }, { role, physical });
  await page.locator("#createCableLoom").click();
  await click({ x: rect.x + 180, y: rect.y + 800 });
  await page.mouse.dblclick(rect.x + 380, rect.y + 850);
  await page.keyboard.press("Escape");
  await click(await wirePoint("", true));
  await page.locator("#wireLoom").selectOption(await page.evaluate(() => state.looms[0].id));
  assert.equal(await page.evaluate(() => state.looms.length), 1);
  const cables = (await read()).cables;
  assert(cables.some(c => c.loomId));
  // Place ordinary Jumps with the existing tool, then hold-drag to pair them.
  await page.locator("#jumpNodeTool").click();
  await click({ x: rect.x + 450, y: rect.y + rect.height - 150 });
  await click({ x: rect.x + 1050, y: rect.y + rect.height - 150 });
  await page.locator("#jumpNodeTool").click();
  const [ja, jb] = (await read()).nodes.map(n => n.id);
  assert(ja && jb);
  await drag(await point(ja), await point(jb), true);
  assert.equal(await page.evaluate(() => state.jumpLinks.length), 1);
  await click(await point("A")); await page.locator("[data-mc-jump]").click();
  const beforeCancel = await read(); await page.keyboard.press("Escape");
  assert.deepEqual((await read()).mc, beforeCancel.mc); assert.equal((await read()).history, beforeCancel.history);
  await click(await point("A")); await page.locator("[data-mc-jump]").click(); await click(await point(ja));
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.filter(w => w.multiCoreIdentity).length), 2);
  await page.locator("#zoomFit").click(); await shot("paired-sections");
  const association = (await read()).mc.trunk.jumpRouting;
  await page.keyboard.press("Meta+z"); assert.equal((await read()).mc.trunk.jumpRouting, undefined);
  await page.keyboard.press("Meta+Shift+z"); assert.deepEqual((await read()).mc.trunk.jumpRouting, association);
  const openTrunkEditor = async () => {
    await click(await point("A")); await page.locator("[data-mc-edit]").click();
    await page.locator('.mc-editor-backdrop [data-tab="Trunk"]').click();
    assert.equal(await page.getByLabel("Trunk Jump gateway").inputValue(), ja);
    assert((await page.locator(".mc-editor-content").innerText()).includes(association.sections.A.id));
  };
  await openTrunkEditor(); const beforeDraft = await read();
  await page.getByLabel("Trunk Jump gateway").selectOption("");
  assert.deepEqual((await read()).mc, beforeDraft.mc);
  await page.locator('.mc-editor-backdrop [data-action="cancel"]').click();
  assert.deepEqual(await read(), beforeDraft);
  await openTrunkEditor(); await page.getByLabel("Trunk Jump gateway").selectOption("");
  await page.locator('.mc-editor-backdrop [data-action="save"]').click();
  await page.waitForFunction(() => !activeEngineBridge().multiCoreEditor);
  assert.equal((await read()).mc.trunk.jumpRouting, undefined);
  await page.keyboard.press("Meta+z"); assert.deepEqual((await read()).mc, beforeDraft.mc);
  for (const id of [ja, jb, "A", "B"]) {
    const before = await read(), p = await point(id); await drag(p, { x: p.x + 35, y: p.y - 25 });
    const after = await read();
    if (id === ja || id === jb) {
      assert.notDeepEqual(after.nodes.find(n => n.id === id), before.nodes.find(n => n.id === id));
      assert.deepEqual(after.nodes.find(n => n.id !== id), before.nodes.find(n => n.id !== id));
      assert.deepEqual(after.mc.ends, before.mc.ends);
    } else assert.deepEqual(after.mc.ends[id === "A" ? "B" : "A"], before.mc.ends[id === "A" ? "B" : "A"]);
    assert.deepEqual(after.cables, cables);
  }
  for (const style of ["bezier", "orthogonal"]) {
    await click(await point("A")); await page.locator("[data-mc-route-style]").selectOption(style);
    for (const role of ["A", "B"]) {
      let p = await wirePoint(role); await click(p); await page.locator("[data-mc-route-add]").click(); await click({ x: p.x + 70, y: p.y - 50 });
      p = await wirePoint(role); const before = await read(); await drag(p, { x: p.x + 35, y: p.y + 30 });
      const after = await read(); assert.notDeepEqual(after.mc.ends[role], before.mc.ends[role]);
      assert.deepEqual(after.mc.ends[role === "A" ? "B" : "A"], before.mc.ends[role === "A" ? "B" : "A"]);
      assert.deepEqual(after.mc.circuits, mapping);
      await page.keyboard.press("Meta+z"); assert.deepEqual((await read()).mc, before.mc);
      await page.keyboard.press("Meta+Shift+z"); assert.deepEqual((await read()).mc, after.mc);
    }
    await shot(`${style}-moved`);
  }
  await click(await wirePoint("A"));
  await page.keyboard.down("Shift"); await click(await wirePoint("B")); await page.keyboard.up("Shift");
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.selectedWireIds.size), 2);
  await click(await point("A")); await page.locator("[data-mc-select-all]").click();
  const assemblyBefore = await read(), body = await point("A"); await drag(body, { x: body.x + 20, y: body.y + 15 });
  const assemblyAfter = await read(), dx = assemblyAfter.mc.ends.A.x - assemblyBefore.mc.ends.A.x;
  assert(dx); assert.equal(assemblyAfter.mc.ends.B.x - assemblyBefore.mc.ends.B.x, dx);
  for (const node of assemblyAfter.nodes) assert.equal(node.x - assemblyBefore.nodes.find(n => n.id === node.id).x, dx);
  for (const p of assemblyAfter.mc.trunk.routePoints) assert.equal(p.x - assemblyBefore.mc.trunk.routePoints.find(old => old.id === p.id).x, dx);
  await page.keyboard.press("Meta+z"); assert.deepEqual((await read()).mc, assemblyBefore.mc);
  await page.keyboard.press("Escape");
  await drag({ x: rect.x + 8, y: rect.y + 8 }, { x: rect.x + rect.width - 8, y: rect.y + rect.height - 8 });
  assert(await page.evaluate(() => activeEngineBridge().scene.selectedIds.size >= 6)); await shot("mixed-marquee");
  await page.keyboard.press("Escape");
  await click(await point(ja)); await page.locator("[data-jump-disconnect]").click();
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.filter(w => w.multiCoreIdentity).length), 1);
  assert((await page.locator("#inspectorBody").innerText()).includes("Waiting for Jump pair"));
  await shot("waiting");
  await drag(await point(ja), await point(jb), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.filter(w => w.multiCoreIdentity).length), 2);
  await click(await point(ja)); await page.locator("[data-jump-disconnect]").click();
  await click(await point(ja)); const beforeDelete = await read(); await page.keyboard.press("Backspace");
  assert.equal((await read()).mc.trunk.jumpRouting, undefined);
  assert.equal(await page.evaluate(() => !!activeEngineBridge().multiCoreRoutePlacement), false);
  assert.deepEqual((await read()).mc.trunk.routePoints, beforeDelete.mc.trunk.routePoints);
  await page.keyboard.press("Meta+z"); assert.deepEqual((await read()).mc, beforeDelete.mc);
  await page.keyboard.press("Meta+Shift+z"); assert.equal((await read()).mc.trunk.jumpRouting, undefined);
  await page.keyboard.press("Meta+z"); await drag(await point(ja), await point(jb), true);
  await page.keyboard.press("Escape"); await page.mouse.move((await point(ja)).x, (await point(ja)).y); await shot("gateway-hover");
  assert.equal((await trace()).valid, true); assert.deepEqual((await read()).mc.circuits, mapping);
  const final = await read();
  const download = page.waitForEvent("download"); await page.locator("#saveProject").click();
  const saved = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.deepEqual(saved.multiCores[0], final.mc); assert.equal(saved.connections.length, 2);
  saved.projectName = "Multi-Core Jump Reload"; await load(saved); await page.locator("#zoomFit").click();
  await writeFile(`${dir}/multi-core-jump.avd`, JSON.stringify(saved));
  assert.deepEqual((await read()).mc, final.mc); await shot("reloaded");
  const exported = await page.evaluate(async () => {
    await ensureEngineOutputSceneModule(); const result = await prepareEngineViewerOutput();
    const hosted = await prepareEngineViewerOutput({ mode: "hosted-viewer" });
    const b = activeEngineBridge(); return { html: result.html, hostedHtml: hosted.html,
      paths: b.scene.wires.map(w => ({ id: w.id, points: b.scene.wireRenderPolyline(w) })) };
  });
  await writeFile(`${dir}/multi-core-jump.html`, exported.html);
  for (const hosted of [false, true]) {
    const viewer = await browser.newPage({ viewport: { width: 1800, height: 1200 } }); viewer.on("pageerror", e => errors.push(e.message));
    await viewer.route("**/*", r => hosted && r.request().isNavigationRequest() ? r.fulfill({ status: 200, contentType: "text/html", body: exported.hostedHtml }) : r.abort());
    if (hosted) await viewer.goto("https://multi-core-jump.test/project"); else await viewer.setContent(exported.html, { waitUntil: "load" });
    await viewer.waitForFunction(() => window.outputViewer);
    assert.deepEqual(await viewer.evaluate(() => outputViewer.scene.wires.map(w => ({ id: w.id, points: outputViewer.scene.wireRenderPolyline(w) }))), exported.paths);
    assert.equal(await viewer.evaluate(() => outputViewer.scene.devices.filter(d => d.visual?.jumpMultiCoreId).length), 2);
    await viewer.screenshot({ path: `${dir}/${hosted ? "publish" : "offline-html"}.png` }); await viewer.close();
  }
  const pdfDrawing = await page.evaluate(async () => {
    const snapshot = buildCanonicalOutputSnapshot({ mode: "pdf-report", drawingDependency: "engine-svg" });
    const drawing = await buildEnginePrintDrawing(snapshot);
    return { engineScene: snapshot.engineScene, diagnostics: drawing.diagnostics, svg: drawing.svg };
  });
  const layout = pdfPageLayout({ svgViewBox: pdfDrawing.diagnostics.viewBox });
  const nodes = buildOutputJumpNavigation(pdfDrawing.engineScene).jumpNodes.map(node => ({ ...node, pageIndex: 0,
    pdfRect: layout.rect(node.bounds), paperHeight: layout.paperHeight, drawingRect: layout.drawingRect }));
  assert.equal(nodes.length, 2);
  await writeFile(`${dir}/pdf-expected.json`, JSON.stringify({ nodes, scene: pdfDrawing.engineScene }, null, 2));
  await writeFile(`${dir}/multi-core-jump.svg`, pdfDrawing.svg);
  await page.locator("#exportPdf").click(); const pdf = page.waitForEvent("download"); await page.locator("#confirmPdfExport").click(); await (await pdf).saveAs(`${dir}/multi-core-jump.pdf`);
  for (const conflict of ["signal", "loom", "other-multi-core"]) {
    const p = multiCoreJumpProject(); p.projectName = `Conflict ${conflict}`;
    if (conflict === "other-multi-core") {
      const owner = structuredClone(p.multiCores[0]); owner.id = "mc-other";
      owner.ends.A.id = "other-a"; owner.ends.B.id = "other-b"; owner.ends.A.x += 900; owner.ends.B.x += 900;
      p.multiCores.push(owner);
    }
    delete p.multiCores[0].trunk.jumpRouting;
    if (conflict === "signal") p.connections[0].to = { jumpNodeId: "gateway-b" };
    if (conflict === "loom") p.looms = [{ id: "loom-owner", name: "Owned Loom", sideA: { x: 100, y: 800 }, sideB: { x: 1800, y: 800 },
      routePoints: [{ id: "lrp-1", x: 500, y: 1000 }], jumpRouting: { usageMode: "loom", entryJumpId: "gateway-a", exitJumpId: "gateway-b", entryAnchorId: "lrp-1", continuationComplete: true } }];
    await load(p); await page.locator("#zoomFit").click();
    await click(await point("A")); await page.locator("[data-mc-jump]").click(); const before = await read(); await click(await point("gateway-a"));
    const after = await read(); assert.deepEqual(after.mc, before.mc); assert.equal(after.history, before.history); assert.equal(after.index, before.index);
    assert(await page.evaluate(() => activeEngineBridge().lastMultiCoreEditValidation?.blockingDiagnostics.some(d => d.category === "gateway")));
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ checks: "UI placement, typed patch leads, Signal Chain, Loom membership, paired/waiting gateways, cancellation, independent moves, both route styles, exact undo/redo, deletion, save/reload, offline HTML/Publish parity, PDF export", screenshots: dir, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${dir}/failure.png` });
  console.error(await page?.evaluate(() => ({ projectName: state.projectName, connections: activeEngineBridge().mutations.root.connections, looms: activeEngineBridge().mutations.root.looms,
    validation: activeEngineBridge().lastMultiCoreEditValidation, nodes: state.jumpNodes, links: state.jumpLinks, selection: [...activeEngineBridge().scene.selectedIds],
    tool: activeEngineBridge().activeCanvasTool(), jumpPlacement: activeEngineBridge().jumpPlacement, pending: activeEngineBridge().pendingJumpPress,
    rootNodes: activeEngineBridge().mutations.root.jumpNodes, rootLinks: activeEngineBridge().mutations.root.jumpLinks,
    rootIndexedNodes: [...activeEngineBridge().mutations.jumpNodeById.keys()], loomActive: activeEngineBridge().loomCreationActive,
    wireCreate: activeEngineBridge().wireCreate, lastDispatch: activeEngineBridge().lastCanvasToolDispatch,
    sceneLinks: activeEngineBridge().scene.jumpLinks, portal: activeEngineBridge().lastPortalCommand,
    status: document.querySelector("#status")?.textContent })));
  throw error;
} finally { await browser.close(); }
