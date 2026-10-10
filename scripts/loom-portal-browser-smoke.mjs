import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const shots = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-loom-portal";
mkdirSync(shots, { recursive: true });
const errors = [];

function loomFixture(count = 8, withPortal = false) {
  const project = cableTypeSelectionFixture();
  project.devices.forEach((device, side) => {
    device.x = side ? 1800 : 0;
    device.templateOverride.height = count * 25 + 150;
    device.templateOverride.connectors = Array.from({ length: count }, (_, index) => ({
      id: `port-${index}`, type: "hdmi", label: "HDMI",
      direction: side ? "input" : "output", signalDirection: side ? "input" : "output",
      displaySide: side ? "left" : "right", x: side ? 0 : 260, y: 80 + index * 25
    }));
  });
  project.connections = Array.from({ length: count }, (_, index) => ({ id: `cable-${index}`,
    cableType: "hdmi", loomId: "loom-1",
    from: { deviceId: "source", connectorId: `port-${index}` },
    to: { deviceId: "sink", connectorId: `port-${index}` } }));
  project.looms = [{ id: "loom-1", name: "LM-001", sideA: { label: "Side A", x: 390, y: 220 },
    sideB: { label: "Side B", x: 720, y: 220 }, routeStyle: "orthogonal", routePoints: [{ id: "lrp-1", x: 560, y: 280 }],
    ...(withPortal ? { portalPairs: [{ id: "loom-portal-1", name: "LP-001", attachment: {
      fromAnchorId: "sideA", toAnchorId: "lrp-1", fraction: 0.5 }, portalB: { x: 1100, y: 350 } }] } : {}) }];
  return project;
}

const cableSignature = wires => JSON.stringify(wires.map(({ id, from, to, cableType, cableNumber, length, notes, loomId }) =>
  ({ id, from, to, cableType, cableNumber, length, notes, loomId })));

try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, acceptDownloads: true });
  await page.addInitScript(() => {
    window.activeEngineBridge = () => window.avDesignerEngineBridge;
    window.cableSignature = wires => JSON.stringify(wires.map(({ id, from, to, cableType, cableNumber, length, notes, loomId }) =>
      ({ id, from, to, cableType, cableNumber, length, notes, loomId })));
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(project => restoreSnapshot(project), loomFixture(8));
  await page.waitForFunction(() => activeEngineBridge()?.scene?.loomPlans[0]?.circuitCount === 8, null,
    { timeout: 10000 }).catch(async error => {
    console.error("Initial Loom fixture did not load:", await page.evaluate(() => ({
      bridgeReady: activeEngineBridge()?.ready,
      circuitCounts: activeEngineBridge()?.scene?.loomPlans?.map(plan => plan.circuitCount),
      wires: activeEngineBridge()?.scene?.wires?.length,
      connections: activeEngineBridge()?.mutations?.root?.connections?.length,
      looms: activeEngineBridge()?.mutations?.root?.looms?.length,
      shellLooms: state?.looms?.length,
      shellLoomIds: state?.looms?.map(loom => loom.id),
      shellConnections: window.state?.connections?.length,
      bodyText: document.body.innerText.slice(0, 500)
    })), errors);
    throw error;
  });
  await page.evaluate(() => { const bridge = activeEngineBridge(); bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 0.62; bridge.scheduleRender(); });
  const toScreen = world => page.evaluate(point => {
    const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.top + (point.y - bridge.camera.y) * bridge.camera.zoom };
  }, world);
  const initial = await page.evaluate(() => ({
    cables: cableSignature(activeEngineBridge().mutations.root.connections),
    plan: structuredClone(activeEngineBridge().scene.loomPlans[0]),
    loom: structuredClone(activeEngineBridge().scene.looms[0])
  }));
  await page.screenshot({ path: join(shots, "01-before-portal.png") });

  const trunkPoint = initial.plan.trunk[Math.floor(initial.plan.trunk.length / 2)];
  const trunkScreen = await toScreen(trunkPoint);
  await page.mouse.click(trunkScreen.x, trunkScreen.y, { button: "right" });
  await page.locator('[data-loom-menu="add-portal"]').click();
  await page.waitForFunction(() => Boolean(activeEngineBridge().loomPortalPlacement));
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => activeEngineBridge().loomPortalPlacement), null);
  assert.equal(await page.evaluate(() => JSON.stringify(activeEngineBridge().mutations.root.looms)),
    JSON.stringify(initial.loom ? [initial.loom] : []), "Escape cancels without persisting a half-pair");
  assert.equal(await page.evaluate(() => activeEngineBridge().canUndoEngineCommand()), false,
    "cancelling placement creates no history command");
  await page.mouse.click(trunkScreen.x, trunkScreen.y, { button: "right" });
  await page.locator('[data-loom-menu="add-portal"]').click();
  await page.waitForFunction(() => Boolean(activeEngineBridge().loomPortalPlacement));
  const placementStart = await page.evaluate(() => ({
    rootLooms: JSON.stringify(activeEngineBridge().mutations.root.looms),
    placement: structuredClone(activeEngineBridge().loomPortalPlacement)
  }));
  const ghost = { x: placementStart.placement.portalA.x + 500, y: placementStart.placement.portalA.y + 160 };
  const ghostScreen = await toScreen(ghost);
  await page.mouse.move(ghostScreen.x, ghostScreen.y, { steps: 4 });
  await page.waitForFunction(() => activeEngineBridge().loomPortalPlacement?.portalB?.x > 800);
  assert.equal(await page.evaluate(() => JSON.stringify(activeEngineBridge().mutations.root.looms)), placementStart.rootLooms,
    "Portal B preview must not persist a half-pair");
  await page.screenshot({ path: join(shots, "02-placement-ghost.png") });
  await page.mouse.click(ghostScreen.x, ghostScreen.y);
  await page.waitForFunction(() => activeEngineBridge().scene.loomPlans[0]?.portalPair?.name === "LP-001");

  const created = await page.evaluate(() => ({
    loom: structuredClone(activeEngineBridge().mutations.root.looms[0]),
    plan: structuredClone(activeEngineBridge().scene.loomPlans[0]),
    counter: activeEngineBridge().mutations.root.loomPortalNumberCounter,
    cables: cableSignature(activeEngineBridge().mutations.root.connections)
  }));
  assert.equal(created.plan.visibleTrunkSections.length, 2);
  assert.deepEqual(created.plan.visibleTrunkSections[0].at(-1), created.plan.portalPair.portalA);
  assert.deepEqual(created.plan.visibleTrunkSections[1][0], created.plan.portalPair.portalB);
  assert.equal(created.loom.portalPairs[0].id, "loom-portal-1");
  assert.equal(created.counter, 1);
  assert.equal(created.cables, initial.cables);
  await page.screenshot({ path: join(shots, "03-completed-pair.png") });

  const outputArtifacts = await page.evaluate(async () => {
    const snapshot = buildCanonicalOutputSnapshot({ projectData: projectSnapshotData({ forEngine: true }),
      mode: "loom-portal-browser-acceptance" });
    const drawing = await buildEnginePrintDrawing(snapshot);
    const [module, bundle] = await engineViewerResources();
    const html = module.buildEngineViewerHtml(snapshot, { bundle });
    return { html, signature: snapshot.engineScene.signature,
      plan: snapshot.engineScene.loomPlans.find(item => item.loomId === "loom-1"),
      pdfHtml: buildPrintableReportHtml(snapshot.reportData, drawing.svg),
      pdfSvg: drawing.svg, pdfDiagnostics: drawing.diagnostics };
  });
  assert.equal(outputArtifacts.plan.visibleTrunkSections.length, 2);
  assert.equal(outputArtifacts.plan.portalPair.name, "LP-001");
  assert.equal(outputArtifacts.pdfDiagnostics.signature, outputArtifacts.signature);
  assert.match(outputArtifacts.pdfSvg, /LP-001 A/);
  assert.match(outputArtifacts.pdfSvg, /LP-001 B/);
  assert.doesNotMatch(outputArtifacts.pdfSvg, /data-jump-destination|data-loom-portal-link/,
    "PDF presentation stays vector-only without Portal navigation links");
  const pdfPage = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await pdfPage.setContent(outputArtifacts.pdfHtml, { waitUntil: "domcontentloaded" });
  await pdfPage.emulateMedia({ media: "print" });
  await pdfPage.evaluate(() => document.fonts.ready);
  await pdfPage.pdf({ path: join(shots, "portal-output.pdf"), format: "A3", landscape: true,
    printBackground: true, preferCSSPageSize: true });
  assert.equal(await pdfPage.locator(".drawing-frame svg[data-avdesigner-output=engine-svg]").count(), 1);
  assert.equal(await pdfPage.locator(".drawing-frame canvas, .drawing-frame foreignObject").count(), 0,
    "Portal PDF output remains vector SVG, not a raster canvas");
  await pdfPage.close();
  const offlineViewer = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await offlineViewer.route("**/*", route => route.abort());
  await offlineViewer.setContent(outputArtifacts.html, { waitUntil: "domcontentloaded" });
  await offlineViewer.waitForFunction(() => Boolean(window.outputViewer));
  const offlinePlan = await offlineViewer.evaluate(() => outputViewer.model.contract.loomPlans
    .find(item => item.loomId === "loom-1"));
  assert.equal(offlinePlan.portalPair.name, "LP-001");
  assert.deepEqual(offlinePlan.visibleTrunkSections, outputArtifacts.plan.visibleTrunkSections,
    "self-contained HTML/Publish viewer preserves the exact Portal geometry");
  await offlineViewer.screenshot({ path: join(shots, "09-offline-output-viewer.png") });
  await offlineViewer.close();

  const portalASelectedPoint = await toScreen(created.plan.portalPair.portalA);
  await page.mouse.click(portalASelectedPoint.x, portalASelectedPoint.y);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.selectedLoomPortalKey), "loom-portal-1:a");
  await page.keyboard.press("Delete");
  assert.equal(await page.evaluate(() => activeEngineBridge().mutations.root.looms[0].portalPairs.length), 0,
    "Delete on either selected endpoint removes the complete pair");
  assert.equal(await page.evaluate(() => cableSignature(activeEngineBridge().mutations.root.connections)), initial.cables);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].portalPair.name), "LP-001");
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);

  const loomTrunkScreen = await toScreen(created.plan.trunk[Math.floor(created.plan.trunk.length / 2)]);
  await page.mouse.click(loomTrunkScreen.x, loomTrunkScreen.y, { button: "right" });
  assert.equal(await page.locator('[data-loom-menu="remove-portal"]').count(), 1,
    "Loom context menu offers pair removal when a pair exists");
  assert.equal(await page.locator('[data-loom-menu="add-portal"]').count(), 0);
  await page.keyboard.press("Escape");

  const dragPortal = async side => {
    const start = await page.evaluate(side => {
      const plan = activeEngineBridge().scene.loomPlans[0];
      return side === "a" ? plan.portalPair.portalA : plan.portalPair.portalB;
    }, side);
    const screen = await toScreen(start);
    const before = await page.evaluate(() => JSON.stringify(activeEngineBridge().mutations.root.looms));
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    assert.equal(await page.evaluate(side => activeEngineBridge().loomHeadDrag?.part === `portal-${side}`, side), true);
    await page.mouse.move(screen.x + 45, screen.y + 35, { steps: 5 });
    await page.waitForFunction(() => Boolean(activeEngineBridge().loomHeadDrag?.previewPlan?.portalPair));
    const moving = await page.evaluate(() => ({
      root: JSON.stringify(activeEngineBridge().mutations.root.looms),
      circuits: activeEngineBridge().loomHeadDrag.previewPlan.circuitCount,
      timing: { averageMs: activeEngineBridge().loomHeadDrag.previewGeometryTotalMs
        / activeEngineBridge().loomHeadDrag.previewGeometryFrames,
      maxMs: activeEngineBridge().loomHeadDrag.previewGeometryMaxMs }
    }));
    assert.equal(moving.root, before, `${side}: transient Portal drag must not mutate project state`);
    assert.equal(moving.circuits, 8, `${side}: preview retains all cached Loom conductors`);
    await page.mouse.up();
    await page.waitForFunction(() => !activeEngineBridge().loomHeadDrag);
    assert.notEqual(await page.evaluate(() => JSON.stringify(activeEngineBridge().mutations.root.looms)), before,
      `${side}: release commits one Portal change`);
    return moving.timing;
  };
  const aTiming = await dragPortal("a");
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].portalPair.portalB.x), created.plan.portalPair.portalB.x,
    "moving Portal A leaves Portal B in place");
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  await page.screenshot({ path: join(shots, "04-moved-portal-a.png") });
  const bTiming = await dragPortal("b");
  await page.screenshot({ path: join(shots, "05-moved-portal-b.png") });
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);

  const beforeRouteEdit = await page.evaluate(() => structuredClone(activeEngineBridge().mutations.root.looms[0]));
  const portalAWorldBeforeEdit = await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].portalPair.portalA);
  assert.equal(await page.evaluate(point => activeEngineBridge().addLoomRoutePoint("loom-1", point), portalAWorldBeforeEdit), true);
  const rebased = await page.evaluate(() => ({ loom: structuredClone(activeEngineBridge().mutations.root.looms[0]),
    plan: structuredClone(activeEngineBridge().scene.loomPlans[0]) }));
  assert.equal(rebased.loom.portalPairs.length, 1);
  assert.notDeepEqual(rebased.loom.portalPairs[0].attachment, beforeRouteEdit.portalPairs[0].attachment,
    "inserting into the owner span rebases the stable anchor locator");
  const rebaseDistance = Math.hypot(rebased.plan.portalPair.portalA.x - portalAWorldBeforeEdit.x,
    rebased.plan.portalPair.portalA.y - portalAWorldBeforeEdit.y);
  assert.ok(rebaseDistance < 20,
  "rebased Portal A stays close to its pre-edit world location");
  assert.equal(rebased.plan.visibleTrunkSections.length, 2);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.deepEqual(await page.evaluate(() => activeEngineBridge().mutations.root.looms[0].portalPairs[0].attachment),
    beforeRouteEdit.portalPairs[0].attachment);
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  await page.screenshot({ path: join(shots, "06-route-rebased.png") });

  const locatorBeforeStyle = await page.evaluate(() => structuredClone(activeEngineBridge().mutations.root.looms[0].portalPairs[0].attachment));
  const portalBBeforeStyle = await page.evaluate(() => structuredClone(activeEngineBridge().mutations.root.looms[0].portalPairs[0].portalB));
  await page.evaluate(() => activeEngineBridge().updateManagedLoom("loom-1", { routeStyle: "bezier" }));
  assert.deepEqual(await page.evaluate(() => activeEngineBridge().mutations.root.looms[0].portalPairs[0].attachment), locatorBeforeStyle);
  assert.deepEqual(await page.evaluate(() => activeEngineBridge().mutations.root.looms[0].portalPairs[0].portalB), portalBBeforeStyle);
  const saved = await page.evaluate(() => projectSnapshotData({ forEngine: true }));
  await page.evaluate(snapshot => restoreSnapshot(snapshot), saved);
  const reopened = await page.evaluate(() => ({ loom: activeEngineBridge().mutations.root.looms[0],
    counter: activeEngineBridge().mutations.root.loomPortalNumberCounter,
    cables: cableSignature(activeEngineBridge().mutations.root.connections) }));
  assert.equal(reopened.loom.portalPairs[0].id, "loom-portal-1");
  assert.equal(reopened.loom.portalPairs[0].name, "LP-001");
  assert.deepEqual(reopened.loom.portalPairs[0].attachment, locatorBeforeStyle);
  assert.deepEqual(reopened.loom.portalPairs[0].portalB, portalBBeforeStyle);
  assert.equal(reopened.counter, 1);
  assert.equal(reopened.cables, created.cables);
  await page.evaluate(() => activeEngineBridge().toggleLoomExpanded("loom-1"));
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].visibleTrunkSections.length), 2);
  await page.screenshot({ path: join(shots, "07-expanded-pair.png") });
  assert.equal(await page.evaluate(() => activeEngineBridge().removeLoomPortalPair("loom-1")), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].visibleTrunkSections.length), 1);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].portalPair.name), "LP-001");
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  await page.screenshot({ path: join(shots, "08-removed-pair.png") });

  const performance = [];
  for (const count of [8, 32, 64]) {
    console.log(`Portal drag performance fixture: ${count} circuits`);
    await page.evaluate(project => restoreSnapshot(project), loomFixture(count, true));
    await page.waitForFunction(expected => activeEngineBridge().scene.loomPlans[0]?.circuitCount === expected, count,
      { timeout: 10000 }).catch(async error => {
      console.error("Portal performance fixture did not load:", await page.evaluate(() => ({
        planCount: activeEngineBridge()?.scene?.loomPlans?.length,
        circuitCounts: activeEngineBridge()?.scene?.loomPlans?.map(plan => plan.circuitCount),
        wires: activeEngineBridge()?.scene?.wires?.length,
        rootConnections: activeEngineBridge()?.mutations?.root?.connections?.length,
        rootLooms: activeEngineBridge()?.mutations?.root?.looms?.length
      })));
      throw error;
    });
    await page.evaluate(() => {
      const bridge = activeEngineBridge();
      window.__portalRebuildCounts = { composition: 0, loomGeometry: 0, wireIndex: 0, wireGeometry: 0 };
      for (const [name, owner, method] of [
        ["composition", bridge, "refreshLoomComposition"], ["loomGeometry", bridge.scene, "rebuildLoomGeometry"],
        ["wireIndex", bridge.scene, "rebuildWireSpatialIndex"], ["wireGeometry", bridge.renderer, "rebuildWireGeometry"]
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { window.__portalRebuildCounts[name]++; return original(...args); };
      }
    });
    const start = await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].portalPair.portalB);
    const point = await toScreen(start);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 30, point.y + 24, { steps: 5 });
    await page.waitForFunction(() => activeEngineBridge().loomHeadDrag?.previewGeometryFrames > 0);
    const during = await page.evaluate(() => ({ counts: { ...window.__portalRebuildCounts },
      circuits: activeEngineBridge().loomHeadDrag.previewPlan.circuitCount,
      averageMs: activeEngineBridge().loomHeadDrag.previewGeometryTotalMs / activeEngineBridge().loomHeadDrag.previewGeometryFrames,
      maxMs: activeEngineBridge().loomHeadDrag.previewGeometryMaxMs }));
    assert.deepEqual(during.counts, { composition: 0, loomGeometry: 0, wireIndex: 0, wireGeometry: 0 },
      `${count} circuits: drag frames must not rebuild project-wide composition or geometry`);
    assert.equal(during.circuits, count);
    performance.push({ circuits: count, averageMs: during.averageMs, maxMs: during.maxMs });
    await page.mouse.up();
  }
  assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);
  console.log(JSON.stringify({ passed: true, shots, portalA: aTiming, portalB: bTiming, rebaseDistance, performance }, null, 2));
} finally {
  await browser.close();
}
