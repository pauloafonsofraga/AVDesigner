import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { adapterThumbnailFixtures } from "../fixtures/adapter-thumbnails.mjs";
import { buildAdapterThumbnail, adapterThumbnailSvg, createAdapterThumbnailCache } from "../src/engine/adapterThumbnail.js";
import { engineConnectorColor, engineConnectorColorSegments } from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";

for (const [name, template] of Object.entries(adapterThumbnailFixtures())) {
  test(`${name}: deterministic, pure, complete anchor geometry with orthogonal routes`, () => {
    const before = structuredClone(template), model = buildAdapterThumbnail(template), svg = adapterThumbnailSvg(model);
    assert.deepEqual(template, before); assert.deepEqual(buildAdapterThumbnail(template), model);
    assert.equal(adapterThumbnailSvg(buildAdapterThumbnail(template)), svg);
    assert.ok(Object.isFrozen(model)); assert.ok(Object.isFrozen(model.nodes));
    assert.equal(model.nodes.length, template.connectors.reduce((n, c) => n + c.anchors.length, 0));
    assert.equal((svg.match(/data-connector-id=/g) || []).length, model.nodes.length);
    for (const c of template.connectors) {
      const nodes = model.nodes.filter(n => n.connectorId === c.id);
      assert.deepEqual(nodes.map(n => n.side).sort(), c.anchors.map(a => a.side).sort());
      nodes.forEach(n => { assert.equal(n.color, engineConnectorColor(c).toLowerCase()); assert.deepEqual(n.colorSegments, (engineConnectorColorSegments(c) || []).map(s => s.toLowerCase())); });
    }
    for (const n of model.nodes) {
      assert.ok(n.x - n.radius > 0 && n.x + n.radius < 54 && n.y - n.radius > 0 && n.y + n.radius < 38);
      assert.ok(n.y >= model.body.y && n.y <= model.body.y + model.body.height);
      for (const other of model.nodes.filter(o => o !== n && o.side === n.side)) assert.ok(Math.abs(n.y - other.y) > n.radius + other.radius);
    }
    for (const route of model.routes) for (const s of route.segments) {
      assert.ok(s.x1 === s.x2 || s.y1 === s.y2);
      assert.ok([s.x1, s.x2].every(x => x >= 7 && x <= 47));
      assert.ok([s.y1, s.y2].every(y => y >= 0 && y <= 38));
    }
    assert.doesNotMatch(svg, /<text|<image|<script|foreignObject|href=|onload=|User |Alias |Same name/);
  });
}

test("fan-out, fan-in, converter and throughput use one clean trunk with exactly the declared endpoints", () => {
  const f = adapterThumbnailFixtures();
  for (const key of ["fanOut", "fanIn", "converter", "through", "large"]) {
    const m = buildAdapterThumbnail(f[key]); assert.equal(m.routes.length, 1);
    assert.deepEqual([...m.routes[0].members].sort(), f[key].connectors.map(c => c.id).sort());
    assert.equal(m.routes[0].segments.filter(s => s.x1 === s.x2 && s.y1 !== s.y2).length, key === "converter" || key === "through" ? 0 : 1);
  }
});

test("shared buses reuse Engine grouping and have one trunk, not pairwise diagonals", () => {
  const f = adapterThumbnailFixtures();
  for (const key of ["twoBus", "fourBus"]) {
    const model = buildAdapterThumbnail(f[key]);
    assert.equal(model.routes.length, 1); assert.equal(model.routes[0].kind, "shared-bus");
    assert.equal(model.routes[0].segments.length, model.nodes.length + 1);
    assert.equal(model.routes[0].segments.filter(s => s.x1 === s.x2).length, 1);
  }
});

test("unmapped, identical-name and bidirectional nodes acquire no invented relationships", () => {
  const f = adapterThumbnailFixtures();
  for (const key of ["mixed", "identicalNames", "both", "empty"]) assert.equal(buildAdapterThumbnail(f[key]).routes.length, 0);
  const t = f.fanOut; t.connectorRelationships = [];
  assert.equal(buildAdapterThumbnail(t).routes.length, 0, "never use count-based canvas inference");
  t.visual = { adapterMapping: { branches: [{ inputId: "in", outputId: "out-2" }] } };
  assert.deepEqual(buildAdapterThumbnail(t).routes.map(r => r.members), [["in", "out-2"]]);
  t.connectors.reverse();
  assert.deepEqual(buildAdapterThumbnail(t).routes.map(r => r.members), [["in", "out-2"]]);
});

test("effective module, fiber, custom library and PowerLock colours match canonical Engine colours", () => {
  const f = adapterThumbnailFixtures();
  assert.equal(buildAdapterThumbnail(f.cage).nodes[0].color, "#ec2cb9");
  assert.equal(buildAdapterThumbnail(f.segmented).nodes[0].colorSegments.length, 5);
  assert.match(adapterThumbnailSvg(buildAdapterThumbnail(f.disabled)), /stroke="#ff0000"/);
  const nodeColorByType = new Map([["hdmi", "#123456"]]);
  assert.equal(buildAdapterThumbnail(f.oneToOne, { nodeColorByType }).nodes[0].color, "#123456");
  const project = { deviceLibrary: [f.converter], devices: [{ instanceId: "a", templateId: f.converter.id, x: 0, y: 0 }] };
  const normalized = normalizeAvDesignerProject(project).devices[0];
  const m = buildAdapterThumbnail(normalized);
  for (const n of m.nodes) assert.equal(n.color, normalized.connectors.find(c => c.id === n.connectorId).color.toLowerCase());
});

test("bounded LRU cache ignores identity text but invalidates every relevant topology edit", () => {
  const t = adapterThumbnailFixtures().fanOut, cache = createAdapterThumbnailCache({ maxEntries: 3 });
  const original = cache.get(t), renamed = structuredClone(t);
  renamed.name = "Different device"; renamed.connectors.forEach(c => { c.nameText = "New name"; c.label = "New label"; });
  assert.equal(cache.get(renamed), original); assert.equal(cache.stats().builds, 1);
  const edits = [
    t => t.connectors.pop(), t => t.connectors.push({ ...structuredClone(t.connectors[1]), id: "extra" }),
    t => { t.connectors[0].anchors[0].side = "right"; }, t => { t.connectors[0].displaySide = "right"; }, t => { t.connectors[0].type = "sdi"; },
    t => { t.connectors[0].color = "#123456"; }, t => { t.connectors[0].installedModuleType = "rj45"; },
    t => t.connectorRelationships.pop(), t => { t.connectorRelationships[0].targetConnectorId = "out-3"; },
    t => { t.connectorRelationships = [{ id: "bus", type: "exclusive", members: ["out-0", "out-1"] }]; },
    t => { t.connectors[0].operationalStatus = "not-working"; }
  ];
  for (const edit of edits) {
    const changed = structuredClone(t); edit(changed);
    assert.notEqual(cache.get(changed).model.signature, original.model.signature);
    assert.ok(cache.stats().size <= 3);
  }
  assert.equal(cache.get({ ...t, objectType: "device", isAdapterBreakout: false }), null);
  assert.notEqual(cache.get(t), original, "old version was evicted");
  const bus = adapterThumbnailFixtures().fourBus, initial = cache.get(bus);
  bus.connectorRelationships[0].members.pop();
  assert.notEqual(cache.get(bus).model.signature, initial.model.signature);
});

test("derived artwork leaves saved definitions and canonical Engine output entirely unchanged", () => {
  const template = adapterThumbnailFixtures().fanOut;
  const project = { deviceLibrary: [template], devices: [{ instanceId: "a", templateId: template.id, x: 10, y: 20 }] };
  const before = JSON.stringify(project), output = buildEngineOutputScene(project), cache = createAdapterThumbnailCache();
  cache.get(template); cache.get({ ...template, name: "Renamed" });
  assert.equal(JSON.stringify(project), before);
  assert.deepEqual(buildEngineOutputScene(project), output);
  assert.doesNotMatch(JSON.stringify(project), /<svg|data-adapter-thumbnail|adapter-topology-v1/);
});

test("hostile IDs, labels, colours and module names cannot inject executable SVG", () => {
  const t = adapterThumbnailFixtures().oneToOne;
  t.name = '<script>alert(1)</script>';
  t.connectors[0].id = '\"><script>alert(1)</script><g onload="alert(1)';
  t.connectors[0].nameText = '<image href="https://evil.test/">';
  t.connectors[0].color = 'url(https://evil.test/)';
  t.connectors[0].installedModuleName = '<script>module</script>';
  const svg = adapterThumbnailSvg(buildAdapterThumbnail(t));
  assert.doesNotMatch(svg, /<script|<image|https:|url\(|<g onload=/);
  assert.match(svg, /&quot;&gt;&lt;script&gt;/);
});

test("real UI helpers share adapter cache precedence and leave ordinary thumbnails untouched", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ctx = vm.createContext({ adapterThumbnailCache: createAdapterThumbnailCache(), cableTypes: {},
    isAdapterTemplate: t => t?.isAdapterBreakout, escapeAttr: s => String(s).replaceAll('"', '&quot;') });
  for (const name of ["adapterDeviceThumbnailMarkup", "deviceThumbnailMarkup", "editorDeviceThumbHtml"]) {
    vm.runInContext(html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0], ctx);
  }
  const adapter = { ...adapterThumbnailFixtures().fanOut, thumbnailImage: "existing.png", faceplateDeleted: true };
  for (const fn of [ctx.deviceThumbnailMarkup, ctx.editorDeviceThumbHtml]) {
    const svg = fn(adapter); assert.match(svg, /data-adapter-thumbnail=/); assert.doesNotMatch(svg, /existing.png/);
    assert.equal((svg.match(/data-connector-id=/g) || []).length, 5);
    assert.match(fn({ thumbnailImage: "ordinary.png" }), /src="ordinary.png"/);
  }
  assert.equal(ctx.deviceThumbnailMarkup({ faceplateDeleted: true }), "");
});
