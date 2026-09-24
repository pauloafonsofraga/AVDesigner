import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { adapterThumbnailProject } from "../fixtures/adapter-thumbnails.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-adapter-thumbnails";
await mkdir(dir, { recursive: true });
const checks = [], errors = [], timings = [];
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.on("pageerror", e => errors.push(`${mode}: ${e.message}`));
    page.on("console", m => { if (m.type() === "error") errors.push(`${mode}: ${m.text()}`); });
    page.on("dialog", d => d.accept());
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => adapterThumbnailCache && (!activeEngineBridge() || activeEngineBridge().ready));
    await page.evaluate(project => restoreSnapshot(project), adapterThumbnailProject());
    await page.locator("#deviceSearch").fill("Topology");
    const library = page.locator("#deviceList");
    const expected = [5, 2, 5, 4, 33];
    const verify = async (parent, expectedCounts = expected) => {
      const counts = await parent.locator("svg[data-adapter-thumbnail]").evaluateAll(svgs => svgs.map(svg => svg.querySelectorAll("g[data-connector-id]").length));
      assert.deepEqual(counts, expectedCounts);
      const signatures = await parent.locator("svg[data-adapter-thumbnail]").evaluateAll(svgs => svgs.map(svg => svg.dataset.adapterThumbnail));
      assert.equal(new Set(signatures).size, signatures.length);
      assert.equal(await parent.locator("svg text, svg image, svg script, svg foreignObject").count(), 0);
    };
    await verify(library);
    await verify(page.locator("#customDeviceList"));
    const before = await page.evaluate(() => ({ data: JSON.stringify(projectSnapshotData()), scene: activeEngineBridge()?.scene.devices.map(d => ({ id: d.id, x: d.x, y: d.y, width: d.width, height: d.height, connectors: d.connectors })) }));
    const colours = await library.locator('svg g[data-connector-id] > circle:first-child').evaluateAll(circles => circles.map(c => c.getAttribute("fill")));
    assert.ok(colours.includes("#ffd600") && colours.includes("#0b6b3a") && colours.includes("#90a4ae") && colours.includes("#ffff00"));
    assert.equal(await library.locator('[data-route-kind="shared-bus"]').count(), 1);
    await page.locator("aside.library").screenshot({ path: `${dir}/${mode}-library-project.png` });
    checks.push(`${mode}: five distinct main-library and Project Device thumbnails, full anchor counts and canonical colours`);

    const timing = await page.evaluate(() => {
      const start = performance.now(), builds = adapterThumbnailCache.stats().builds;
      for (let i = 0; i < 30; i++) { renderDeviceLibrary(); deviceList.scrollTop = i % 2 ? 0 : deviceList.scrollHeight; }
      return { ms: performance.now() - start, before: builds, after: adapterThumbnailCache.stats().builds, size: adapterThumbnailCache.stats().size };
    });
    assert.equal(timing.before, timing.after); assert.ok(timing.size <= 128);
    timings.push({ mode, ...timing });
    for (const query of ["hdmi-1x4", "mixed-network-fiber", "Topology"]) await page.locator("#deviceSearch").fill(query);
    await verify(library);
    assert.deepEqual(await page.evaluate(() => ({ data: JSON.stringify(projectSnapshotData()), scene: activeEngineBridge()?.scene.devices.map(d => ({ id: d.id, x: d.x, y: d.y, width: d.width, height: d.height, connectors: d.connectors })) })), before);
    checks.push(`${mode}: repeated render/search/scroll reuses cache and does not mutate saved data or placed Engine geometry`);

    await page.locator("#rackBuilderButton").click();
    await page.locator("#rackBuilderSourceSearch").fill("Topology");
    await verify(page.locator("#rackBuilderDefaultDevices"));
    await page.locator("#rackBuilderModal").screenshot({ path: `${dir}/${mode}-rack-sources.png` });
    await page.locator("#closeRackBuilder").click();
    checks.push(`${mode}: real Rack Builder source cards share generated thumbnails`);

    const card = page.locator('#deviceList [data-template-id="hdmi-1x4"]');
    await card.locator("h3").hover(); await page.mouse.down();
    const drop = await page.locator("#canvasWrap").boundingBox();
    await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height * .65, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => state.devices.length === 6);
    assert.deepEqual(await page.evaluate(() => templateForInstance(state.devices.at(-1)).connectors.map(c => [c.id, c.type])),
      adapterThumbnailProject().deviceLibrary[0].connectors.map(c => [c.id, c.type]));
    checks.push(`${mode}: native library pointer drag places the original adapter`);

    const projectRow = page.locator('#customDeviceList [data-instance-id="instance-hdmi-to-sdi"]');
    const oldSignature = await projectRow.locator("svg").getAttribute("data-adapter-thumbnail");
    await page.evaluate(() => openDeviceEditorForInstance("instance-hdmi-to-sdi"));
    await page.locator('[data-editor-tab="connectors"]').click();
    assert.equal(await page.locator("#editorDeviceList").isVisible(), false, "obsolete editor list stays hidden");
    const node = page.locator('[data-editor-node-id="in"] circle').first();
    const p = await node.evaluate(circle => {
      const q = circle.ownerSVGElement.createSVGPoint(); q.x = Number(circle.getAttribute("cx")) - Math.min(3, Number(circle.getAttribute("r")) / 2); q.y = Number(circle.getAttribute("cy"));
      const r = q.matrixTransform(circle.getScreenCTM()); return { x: r.x, y: r.y };
    });
    await page.mouse.click(p.x, p.y);
    assert.ok(await page.evaluate(() => editorSelectedNodeIds.has("in")), `${mode}: native adapter connector selection`);
    await page.locator("#selectedConnectorPhysicalType").selectOption("dvi");
    await page.locator("#applyDeviceEditor").click();
    await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
    assert.notEqual(await projectRow.locator("svg").getAttribute("data-adapter-thumbnail"), oldSignature);
    assert.equal(await projectRow.locator('[data-connector-id="in"] > circle').first().getAttribute("fill"), "#00e676");
    await page.locator("aside.library").screenshot({ path: `${dir}/${mode}-after-apply.png` });
    checks.push(`${mode}: actual Device Editor type change and Apply immediately update the instance thumbnail`);

    await page.evaluate(() => {
      const first = templateById("hdmi-1x4"), second = templateById("hdmi-to-sdi");
      first.pairedTemplateId = second.id; first.isPartOfPair = true; first.pairPlaceFirst = true;
      second.pairedTemplateId = first.id; second.isPartOfPair = true; renderDeviceLibrary();
    });
    const pair = page.locator('#deviceList [data-template-id="hdmi-1x4"][data-pair-template-id]');
    assert.equal(await pair.locator('svg g[data-connector-id]').count(), 5);
    checks.push(`${mode}: paired adapter listing retains combined title and topology thumbnail`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, checks, timings, artifacts: dir,
    notApplicable: ["Device Editor device browser is intentionally hidden in the existing UI; its thumbnail helper is exercised by Rack Builder and unit tests."] }, null, 2));
} finally { await browser.close(); }
