import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { POWER_CATALOG, POWER_ALIASES, VISIBLE_POWER_TYPES, powerCatalogProject } from "../fixtures/power-distro-catalog.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const baseUrl = (process.env.AVDESIGNER_BASE_URL || "http://localhost:8767").replace(/\/$/, "");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}),
  args: ["--no-sandbox"]
});

const totals = { nativeDrops: 0, insertedDevices: 0, decodedMappings: 0, aliasMappings: 0, previewMappings: 0, savedMappings: 0, duplicatedMappings: 0, offlineExportMappings: 0 };

async function newPage(mode) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", request => errors.push(`${request.failure()?.errorText} ${request.url()}`));
  await page.addInitScript(() => {
    window.__powerImageDraws = [];
    for (const prototype of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
      const draw = prototype.drawImage;
      prototype.drawImage = function(image, ...args) {
        if (image instanceof HTMLImageElement && /PowerPlugs|Thumbnails\/C13/.test(image.src)) {
          window.__powerImageDraws.push({ src: image.src, decoded: image.complete && image.naturalWidth > 0 });
        }
        return draw.call(this, image, ...args);
      };
    }
  });
  await page.goto(`${baseUrl}/index.html?${mode === "legacy" ? "legacy=1&" : ""}debugDeviceDrop=1`);
  return { page, errors };
}

async function inventory(page, mode, { preview = false, id = "" } = {}) {
  if (mode === "engine") await page.waitForFunction(({ preview, id }) => {
    const scene = preview ? editorEnginePreviewSurface?.scene : window.avDesignerEngineBridge?.scene;
    return preview ? scene?.devices?.some(d => d.visual?.powerDistro) : Boolean(scene?.getDevice(id)?.visual?.powerDistro);
  }, { preview, id });
  return page.evaluate(({ mode, preview, id }) => {
    const template = preview ? currentEditorTemplate() : templateForInstance(instanceById(id));
    const legacy = powerPlugLayout(template).map(p => ({ id: p.connector.id, href: p.href, x: p.x, y: p.y, width: p.width, height: p.height }));
    const scene = preview ? editorEnginePreviewSurface?.scene : window.avDesignerEngineBridge?.scene;
    const device = mode === "engine" ? (preview ? scene.devices.find(d => d.visual?.powerDistro) : scene.getDevice(id)) : null;
    const entries = device ? device.visual.powerDistro.plugEntries.map(p => ({ id: p.connectorId, href: p.href, x: p.x, y: p.y, width: p.width, height: p.height })) : legacy;
    return { entries, legacy, connectors: template.connectors, face: powerDistroFaceRect(template) };
  }, { mode, preview, id });
}

async function assertRendered(page, mode, result, preview) {
  assert.equal(result.entries.length, result.connectors.length);
  for (const c of result.connectors) {
    const expected = POWER_CATALOG[c.type], matches = result.entries.filter(p => p.id === c.id);
    assert.equal(matches.length, 1, c.id);
    assert.equal(matches[0].href, `Nodes/PowerPlugs/${expected[c.direction === "input" ? 0 : 1]}`);
    assert.equal(matches[0].width, expected[3]);
    assert.equal(matches[0].height, expected[4]);
    assert.ok(Number.isFinite(matches[0].x) && Number.isFinite(matches[0].y));
  }
  assert.deepEqual(result.entries, result.legacy, "Engine and Legacy artwork agree");
  if (mode === "engine") {
    try {
      await page.waitForFunction(hrefs => hrefs.every(href => window.__powerImageDraws.some(draw => draw.decoded && draw.src === new URL(href, location.href).href)), result.entries.map(p => p.href));
    } catch (error) {
      console.error("Artwork draw diagnostic", await page.evaluate(() => [...new Set(window.__powerImageDraws.map(d => d.src))]), result.entries);
      throw error;
    }
  } else {
    const actual = await page.locator(preview ? "#deviceEditorPreview image.power-plug-image" : "#devices image.power-plug-image").evaluateAll(images => images.map(image => ({ href: image.getAttribute("href"), width: Number(image.getAttribute("width")), height: Number(image.getAttribute("height")) })));
    for (const p of result.entries) assert.ok(actual.some(i => i.href === p.href && i.width === p.width && i.height === p.height), `rendered SVG ${p.id}`);
  }
  await page.evaluate(async entries => {
    for (const p of entries) {
      const image = new Image(); image.src = p.href; await image.decode();
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error(`Broken ${p.id}`);
    }
  }, result.entries);
}

async function loadProject(page, project) {
  await page.evaluate(data => {
    window.__powerBeforeDevices = state.devices;
    loadProjectFile(new File([JSON.stringify(data)], "power-catalog.avd", { type: "application/json" }));
  }, project);
  await page.waitForFunction(count => state.devices !== window.__powerBeforeDevices && state.devices.length === count && state.devices[0]?.templateId === "power-catalog", project.devices.length);
}

try {
  for (const mode of ["engine", "legacy"]) {
    for (const type of VISIBLE_POWER_TYPES) {
      const { page, errors } = await newPage(mode);
      try {
        await page.locator("#deviceEditorButton").click();
        await page.locator("#newDeviceTemplate").click();
        await page.locator("#editorPowerDistro").check({ force: true });
        await page.locator('[data-editor-tab="connectors"]').click();
        if (type === VISIBLE_POWER_TYPES[0]) {
          const palette = await page.evaluate(ids => ({
            actual: [...document.querySelectorAll("#nodePalette [data-node-type]")].map(e => e.dataset.nodeType).filter(id => ids.includes(id)),
            ordered: nodeTypeOrder.filter(id => ids.includes(id) && cableTypes[id].palette !== false)
          }), Object.keys(POWER_CATALOG));
          assert.deepEqual(palette.actual, palette.ordered, "palette respects saved node order");
          assert.deepEqual([...palette.actual].sort(), [...VISIBLE_POWER_TYPES].sort(), "canonical choices only, no duplicate aliases");
        }
        await page.locator("#addInputNode").click();
        await page.locator("#addOutputNode").click();
        const slots = await page.evaluate(() => currentEditorTemplate().connectors.map(c => ({ id: c.id, direction: c.direction })));
        assert.equal(slots.length, 2);
        for (const { id: connectorId, direction } of slots) {
          await page.locator("#editorZoomReset").click();
          await page.locator("#nodePaletteSearch").fill(type);
          const source = page.locator(`[data-node-type="${type}"]`);
          const target = page.locator(`#deviceEditorPreviewHost [data-editor-node-id="${connectorId}"] .editor-slot-shape`).first();
          await source.dragTo(target);
          const result = await page.evaluate(id => ({
            connector: currentEditorTemplate()?.connectors?.find(connector => connector.id === id),
            count: currentEditorTemplate().connectors.length,
            selected: [...editorSelectedNodeIds],
            adapter: Boolean(currentEditorTemplate().isAdapter),
            events: window.__avDesignerDeviceDropDebug?.events || []
          }), connectorId);
          assert.deepEqual(errors, [], `${mode}/${direction}/${type}: browser errors`);
          assert.equal(result.connector?.type, type, `${mode}/${direction}/${type}: stable connector filled`);
          assert.equal(result.connector?.empty, false);
          assert.equal(result.connector?.direction, direction);
          assert.equal(result.count, 2);
          assert.ok(result.connector.label && result.connector.nameText);
          assert.ok(result.selected.includes(connectorId));
          assert.equal(result.adapter, false);
          assert.equal(result.connector?.anchors?.find(anchor => anchor.id === result.connector.primaryAnchorId)?.y, result.connector.y);
          assert.ok(result.events.some(event => event.event === "dragover" && event.candidateId === connectorId && event.prevented), "host must accept dragover");
          assert.equal(result.events.filter(event => event.event === "drop" && event.candidateId === connectorId && event.committed).length, 1, "host commits once");
          totals.nativeDrops++;
        }
        const preview = await inventory(page, mode, { preview: true });
        console.log(`${mode}/${type}: native drops passed; checking artwork`);
        await assertRendered(page, mode, preview, true);
        const id = await page.evaluate(() => {
          const draft = structuredClone(currentEditorTemplate());
          closeDeviceEditor();
          window.__powerImageDraws = [];
          const bridge = activeEngineBridge();
          const instance = bridge
            ? prepareDeviceInstanceFromTemplate(draft, 0, 0, { templateOverride: draft })
            : addDeviceInstanceFromTemplate(draft, 0, 0, { templateOverride: draft });
          if (bridge && (!instance || !bridge.createDeviceFromLibraryDrop(instance))) throw new Error("Engine insertion failed");
          zoomToFit();
          return instance?.instanceId;
        });
        assert.ok(id, "device inserted");
        const canvas = await inventory(page, mode, { id });
        assert.deepEqual(canvas.entries, preview.entries);
        await assertRendered(page, mode, canvas, false);
        assert.deepEqual(errors, [], `${mode}/${type}: no failed assets or browser errors`);
        totals.insertedDevices++;
        console.log(`${mode}/${type}: both native drops, preview, canvas insertion passed`);
      } finally {
        await page.close();
      }
    }
    const { page, errors } = await newPage(mode);
    try {
      // These are production file/insertion APIs, not claims of native drag coverage.
      await loadProject(page, powerCatalogProject());
      const before = await inventory(page, mode, { id: "power-catalog-instance" });
      await assertRendered(page, mode, before, false);
      totals.decodedMappings += before.entries.length;
      totals.aliasMappings += before.connectors.filter(c => POWER_ALIASES[c.type]).length;
      await page.evaluate(() => { window.__powerImageDraws = []; });
      await page.evaluate(() => openDeviceEditorForInstance("power-catalog-instance"));
      await page.locator('[data-editor-tab="connectors"]').click();
      const catalogPreview = await inventory(page, mode, { preview: true });
      await assertRendered(page, mode, catalogPreview, true);
      assert.deepEqual(catalogPreview.entries, before.entries);
      totals.previewMappings += catalogPreview.entries.length;
      await page.evaluate(() => closeDeviceEditor());
      const saved = await page.evaluate(() => JSON.parse(projectJsonPayload()));
      await loadProject(page, saved);
      const reloaded = await inventory(page, mode, { id: "power-catalog-instance" });
      assert.deepEqual(reloaded, before);
      totals.savedMappings += reloaded.entries.length;
      const duplicateId = await page.evaluate(() => {
        createProjectCustomDeviceFromCanvasInstance("power-catalog-instance"); zoomToFit();
        return state.devices.find(d => d.instanceId !== "power-catalog-instance")?.instanceId;
      });
      assert.ok(duplicateId);
      const duplicate = await inventory(page, mode, { id: duplicateId });
      assert.deepEqual(duplicate, before);
      totals.duplicatedMappings += duplicate.entries.length;
      const exported = await page.evaluate(async () => {
        const data = structuredClone(projectSnapshotData());
        data.devices = data.devices.filter(d => d.instanceId === "power-catalog-instance");
        data.powerPlugAssets = await powerPlugAssetPayload();
        data.logoSrc = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
        return { html: buildStandaloneHtml(data), assets: data.powerPlugAssets };
      });
      for (const entry of before.entries) assert.match(exported.assets[entry.href], /^data:image\//);
      const offline = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      const offlineErrors = [], network = [];
      offline.on("pageerror", error => offlineErrors.push(error.message));
      await offline.route(/https?:\/\//, route => { network.push(route.request().url()); return route.abort(); });
      try {
        await offline.setContent(exported.html);
        const entries = await offline.evaluate(() => {
          const t = templateForInstance(data.devices[0]);
          return powerPlugLayout(t).map(p => ({ id: p.c.id, href: p.href, x: p.x, y: p.y, width: p.width, height: p.height }));
        });
        assert.equal(entries.length, 42);
        for (const entry of entries) {
          const original = before.entries.find(p => p.id === entry.id);
          assert.deepEqual(entry, { ...original, href: exported.assets[original.href] });
        }
        const images = await offline.locator("image.power-plug-image").evaluateAll(async elements => {
          for (const element of elements) {
            const image = new Image(); image.src = element.getAttribute("href"); await image.decode();
          }
          return elements.map(e => e.getAttribute("href"));
        });
        assert.equal(images.length, 42);
        for (const entry of entries) assert.ok(images.includes(entry.href));
        assert.deepEqual(offlineErrors, []);
        assert.deepEqual(network, [], "export must be self-contained");
        totals.offlineExportMappings += entries.length;
      } finally { await offline.close(); }
      assert.deepEqual(errors, [], `${mode}: full catalog browser errors`);
      console.log(`${mode}: all 42 mappings loaded, saved, duplicated, exported offline`);
    } finally { await page.close(); }
  }
} finally {
  await browser.close();
}
assert.equal(totals.nativeDrops, 68);
console.log(JSON.stringify({ status: "passed", visiblePalette: VISIBLE_POWER_TYPES, ...totals }, null, 2));
