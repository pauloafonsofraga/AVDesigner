import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { POWER_CATALOG, POWER_ALIASES, VISIBLE_POWER_TYPES, powerTemplate, powerCatalogProject } from "../fixtures/power-distro-catalog.mjs";
import { POWER_PLUG_TYPES, powerPlugImageForConnector, powerPlugDisplaySize, normalizePowerDistroForEngine } from "../src/engine/powerDistroModel.js";
import { normalizeAvDesignerDevice } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const registry = vm.runInNewContext(`(${html.match(/const POWER_PLUG_TYPES = (\{[\s\S]*?\n    \});/)[1]})`);
function legacyFunction(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf("\n    function ", start + 1));
}
const legacy = vm.createContext({
  POWER_PLUG_TYPES: registry, POWER_PLUG_ASSET_BASE: "Nodes/PowerPlugs/",
  DEVICE_WIDTH: 380, FACE_MARGIN: 12, FACE_TOP_Y: 38, FACE_HEIGHT: 78, POWER_PLUG_EDGE_GAP_Y: 10,
  clamp: (n, min, max) => Math.max(min, Math.min(max, n))
});
for (const name of ["powerPlugMeta", "powerPlugImageForConnector", "isPowerPlugConnector", "powerPlugDisplaySize", "powerPlugStackHeight", "powerDistroManualPlugHeight", "powerDistroAutoFaceHeight", "powerDistroFaceHeight", "powerDistroFaceY", "powerDistroFaceRect", "powerPlugSortValue", "sortedPowerPlugConnectors", "powerPlugLayout", "clampPowerPlugCenter"]) {
  vm.runInContext(legacyFunction(name), legacy);
}
const viewer = vm.createContext({ powerPlugTypes: registry, powerPlugAssets: {}, POWER_PLUG_ASSET_BASE: "Nodes/PowerPlugs/", DEVICE_WIDTH: 380, FACE_MARGIN: 12, FACE_TOP_Y: 38, FACE_HEIGHT: 78 });
const viewerStart = html.indexOf("\nfunction powerPlugImage(c)");
vm.runInContext(html.slice(viewerStart, html.indexOf("\nfunction drawPowerPlugImage", viewerStart)), viewer);

function model(template) {
  return normalizePowerDistroForEngine({ template, width: template.width, connectors: template.connectors });
}
function geometry(entries) {
  return clone(entries.map(p => ({ id: p.connectorId || p.connector?.id || p.c?.id, href: p.href, x: p.x, y: p.y, width: p.width, height: p.height, powerlock: p.powerlock })));
}
function assertBounds(m) {
  const r = m.faceRect;
  for (const p of m.plugEntries) {
    for (const key of ["x", "y", "width", "height"]) assert.ok(Number.isFinite(p[key]), `${p.connectorId}/${key}`);
    assert.ok(p.width > 0 && p.height > 0);
    assert.ok(p.x >= r.x && p.y >= r.y && p.x + p.width <= r.x + r.width && p.y + p.height <= r.y + r.height, `${p.connectorId} outside face`);
  }
  for (let a = 0; a < m.plugEntries.length; a++) for (let b = a + 1; b < m.plugEntries.length; b++) {
    const p = m.plugEntries[a], q = m.plugEntries[b];
    assert.ok(p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y, `${p.connectorId} overlaps ${q.connectorId}`);
  }
}
function sceneDevice(project) {
  const d = normalizeAvDesignerDevice(project, project.devices[0], 0);
  const scene = new SceneGraph();
  scene.setData({ devices: [d], wires: [], meta: {} });
  return scene.getDevice(d.id);
}

test("Power Distro registry copies match the complete independent catalog exactly", () => {
  assert.deepEqual(clone(registry), POWER_PLUG_TYPES);
  assert.deepEqual(Object.keys(POWER_PLUG_TYPES), Object.keys(POWER_CATALOG));
  for (const [id, [input, output, order, width, height]] of Object.entries(POWER_CATALOG)) {
    assert.deepEqual(POWER_PLUG_TYPES[id], {
      input, output, order, ...(width === height ? { size: width } : { width, height }),
      ...(id === "powerlock" ? { powerlock: true } : {})
    });
  }
  assert.match(html, /const powerPlugPayload = JSON.stringify\(POWER_PLUG_TYPES\)/);
  assert.match(html, /const powerPlugTypes=\$\{powerPlugPayload\}/);
});

test("palette contains 17 canonical choices, four hidden aliases, stable catalog order", () => {
  const cableSource = html.match(/(?:const|let) cableTypes = (\{[\s\S]*?\n    \});/)[1];
  const cables = vm.runInNewContext(`(${cableSource})`);
  assert.equal(VISIBLE_POWER_TYPES.length, 17);
  assert.equal(new Set(VISIBLE_POWER_TYPES).size, 17);
  assert.deepEqual(Object.keys(POWER_CATALOG).filter(id => cables[id].palette !== false), VISIBLE_POWER_TYPES);
  assert.deepEqual([...VISIBLE_POWER_TYPES].sort((a, b) => registry[a].order - registry[b].order), VISIBLE_POWER_TYPES);
  for (const [alias, canonical] of Object.entries(POWER_ALIASES)) {
    assert.equal(cables[alias].palette, false);
    assert.deepEqual(registry[alias], registry[canonical]);
  }
});

test("embedded standalone artwork is byte-identical to the existing repository artwork", () => {
  const start = html.indexOf("const POWER_PLUG_INLINE_ASSETS = ");
  const assets = vm.runInNewContext(`${html.slice(start, html.indexOf("};", start) + 2)}; POWER_PLUG_INLINE_ASSETS`);
  assert.equal(Object.keys(assets).length, 29);
  for (const [href, data] of Object.entries(assets)) {
    const comma = data.indexOf(",");
    const bytes = data.slice(0, comma).includes("base64")
      ? Buffer.from(data.slice(comma + 1), "base64") : Buffer.from(decodeURIComponent(data.slice(comma + 1)));
    assert.deepEqual(bytes, fs.readFileSync(path.resolve(root, href)), href);
  }
});

for (const [type, expected] of Object.entries(POWER_CATALOG)) for (const direction of ["input", "output"]) {
  test(`${type}/${direction}: exact asset, dimensions, Legacy/Engine/viewer/scene/persistence parity`, () => {
    const project = powerCatalogProject([type]);
    const template = project.deviceLibrary[0];
    template.connectors = template.connectors.filter(c => c.direction === direction);
    const source = clone(template);
    const connector = template.connectors[0];
    const href = `Nodes/PowerPlugs/${expected[direction === "input" ? 0 : 1]}`;
    assert.equal(powerPlugImageForConnector(connector), href);
    assert.deepEqual(powerPlugDisplaySize(connector), { width: expected[3], height: expected[4] });
    const absolute = path.resolve(root, href);
    assert.ok(fs.readdirSync(path.dirname(absolute)).includes(path.basename(absolute)), `exact filename case ${href}`);
    assert.ok(fs.statSync(absolute).size > 0);
    const m = model(template);
    assertBounds(m);
    assert.equal(m.plugEntries.length, 1);
    assert.equal(m.faceRect.height, Math.max(78, 36 + expected[4]), "minimal automatic face height");
    assert.equal(m.plugEntries[0].cx, m.faceRect.x + m.faceRect.width * (type === "powerlock" ? 0.5 : direction === "input" ? 0.25 : 0.75));
    assert.equal(m.plugEntries[0].y, m.faceRect.y + 18);
    assert.deepEqual(geometry(legacy.powerPlugLayout(template)), geometry(m.plugEntries));
    assert.deepEqual(geometry(viewer.powerPlugLayout(template)), geometry(m.plugEntries));
    const d = sceneDevice(project);
    assert.equal(d.connectors.length, 1);
    assert.equal(d.visual.powerDistro.plugEntries.length, 1);
    const live = d.connectors[0];
    assert.equal(live.id, connector.id);
    assert.equal(live.type, type);
    assert.equal(live.direction, direction);
    assert.equal(live.powerPlugAsset, href);
    assert.deepEqual(live.powerPlugSize, powerPlugDisplaySize(connector));
    assert.deepEqual(geometry(d.visual.powerDistro.plugEntries), geometry(m.plugEntries));
    for (let i = 0; i < 5; i++) assert.deepEqual(sceneDevice(clone(project)), d);
    assert.deepEqual(template, source, "render and normalization must not mutate source");
  });
}

test("full catalog and mixed small/large/Harting/PowerLock fixtures contain all art without overlaps or height drift", () => {
  for (const types of [Object.keys(POWER_CATALOG), ["iec", "16a-1ph", "125a-3ph", "schuko", "harting", "powerlock"]]) {
    const template = powerTemplate(types);
    template.connectors.push({ id: "ordinary", type: "sdi", direction: "output", x: 380, y: 3700 });
    const source = clone(template), m = model(template);
    assertBounds(m);
    assert.deepEqual(geometry(legacy.powerPlugLayout(template)), geometry(m.plugEntries));
    assert.deepEqual(geometry(viewer.powerPlugLayout(template)), geometry(m.plugEntries));
    for (let i = 0; i < 10; i++) assert.deepEqual(model(clone(template)), m);
    assert.deepEqual(template, source);
    assert.ok(template.connectors.at(-1).y > m.faceRect.y + m.faceRect.height + 36);
  }
});

test("manual override uses actual face Y and does not consume an automatic stack row", () => {
  const template = powerTemplate(["nema", "125a-3ph", "powerlock"]);
  template.powerDistroFaceY = 70;
  template.connectors = template.connectors.filter(c => c.direction === "input");
  template.connectors[0].powerPlug = { manual: true, x: 310, y: 170 };
  const m = model(template);
  assertBounds(m);
  assert.equal(m.faceRect.height, 36 + 120 + 18 + 44);
  assert.equal(m.plugEntries.find(p => p.connectorType === "125a-3ph").y, 88);
  assert.deepEqual(geometry(legacy.powerPlugLayout(template)), geometry(m.plugEntries));
  assert.deepEqual(geometry(viewer.powerPlugLayout(template)), geometry(m.plugEntries));
  const manualOnly = powerTemplate(["harting"]);
  manualOnly.connectors = manualOnly.connectors.slice(0, 1);
  manualOnly.powerDistroFaceY = 90;
  manualOnly.connectors[0].powerPlug = { manual: true, x: 190, y: 250 };
  assert.equal(model(manualOnly).faceRect.height, 250 + 27 / 2 - 90 + 10);
  assert.deepEqual(clone(legacy.powerDistroFaceRect(manualOnly)), model(manualOnly).faceRect);
  assert.deepEqual(clone(viewer.powerFaceRect(manualOnly)), model(manualOnly).faceRect);
});

test("a manual PowerLock does not reserve an invisible automatic PowerLock row", () => {
  const template = powerTemplate(["powerlock"]);
  template.connectors[0].powerPlug = { manual: true, x: 190, y: 450 };
  const m = model(template);
  assertBounds(m);
  assert.equal(m.plugEntries[1].y, 38 + 18);
  assert.equal(m.faceRect.height, 450 + 22 - 38 + 10);
  assert.deepEqual(geometry(legacy.powerPlugLayout(template)), geometry(m.plugEntries));
  assert.deepEqual(geometry(viewer.powerPlugLayout(template)), geometry(m.plugEntries));
});
