import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectorTemplate, insertProjectorLens, resolveProjectorLens } from "../src/engine/projectorModel.js";
import { projectorLensFixture } from "../fixtures/projector-lenses.mjs";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { deviceVisualCacheKey, drawDeviceVisual } from "../src/engine/deviceVisualBuilder.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { buildEngineViewerHtml } from "../src/engine/outputViewerHtml.js";
import * as clipboard from "../src/engine/canvasClipboard.js";
import { readFileSync } from "node:fs";
import { drawObjectHoverTooltip } from "../src/engine/renderer.js";

test("projector defaults and normalization are pure, deterministic and retain distinct records", () => {
  assert.deepEqual(normalizeProjectorTemplate({}), { isProjector: false, projectorLenses: [] });
  const input = { isProjector: true, projectorLenses: [{ id: "a", name: "  Wide  Lens  " }, { id: "b", name: "Wide  Lens" },
    { id: "a", name: "Duplicate ID" }, { name: "" }, { id: "lens-1", name: "Reserved" }] };
  const before = structuredClone(input), result = normalizeProjectorTemplate(input);
  assert.deepEqual(input, before); assert.equal(new Set(result.projectorLenses.map(l => l.id)).size, 5);
  assert.equal(result.projectorLenses[0].name, "Wide  Lens"); assert.equal(result.projectorLenses[1].id, "b");
  assert.deepEqual(normalizeProjectorTemplate(result), result); assert.deepEqual(normalizeProjectorTemplate(input), result);
});

test("inserting a lens preserves all IDs and inserts immediately after the chosen row", () => {
  const template = projectorLensFixture().deviceLibrary[0], before = structuredClone(template);
  const next = insertProjectorLens(template, "standard");
  assert.deepEqual(next.projectorLenses.map(l => l.id), ["wide", "standard", next.addedLensId, "long", "blank"]);
  assert.deepEqual(template, before);
  next.projectorLenses[2].name = "Renamed";
  assert.equal(normalizeProjectorTemplate(next).projectorLenses[2].id, next.addedLensId);
});

test("instance selection defaults, renames, removal, empty lenses and toggle changes resolve deterministically", () => {
  const template = projectorLensFixture().deviceLibrary[0];
  assert.equal(resolveProjectorLens(template).selectedProjectorLensId, "wide");
  const instance = { selectedProjectorLensId: "long" };
  assert.equal(resolveProjectorLens(template, instance).projectorLensName, "Long Throw 2.5:1");
  template.projectorLenses[2].name = "Renamed";
  assert.equal(resolveProjectorLens(template, instance).selectedProjectorLensId, "long");
  assert.equal(resolveProjectorLens(template, instance).projectorLensName, "Renamed");
  template.isProjector = false;
  assert.equal(resolveProjectorLens(template, instance).projectorLensName, "");
  template.isProjector = true;
  assert.equal(resolveProjectorLens(template, instance).projectorLensName, "Renamed");
  template.projectorLenses[2].name = " ";
  assert.equal(resolveProjectorLens(template, instance).selectedProjectorLensId, "wide");
  template.projectorLenses.splice(2, 1);
  assert.equal(resolveProjectorLens(template, instance).selectedProjectorLensId, "wide");
  template.projectorLenses = [];
  assert.equal(resolveProjectorLens(template, instance).selectedProjectorLensId, "");
  assert.equal(resolveProjectorLens(template, instance).projectorLensName, "");
});

test("Engine and canonical output carry independent resolved lens metadata without moving geometry", () => {
  const project = projectorLensFixture(), before = structuredClone(project), scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  assert.deepEqual(project, before);
  assert.deepEqual(scene.devices.map(d => d.selectedProjectorLensId), ["wide", "long"]);
  assert.deepEqual(scene.devices.map(d => d.visual.projectorLensName), ["Wide 0.8:1", "Long Throw 2.5:1"]);
  const output = buildEngineOutputScene(project);
  assert.deepEqual(output.devices.map(d => d.visual.projectorLensName), scene.devices.map(d => d.visual.projectorLensName));
  project.devices[0].selectedProjectorLensId = "standard";
  const changed = buildEngineOutputScene(project);
  assert.deepEqual(changed.connectors, output.connectors); assert.deepEqual(changed.bounds, output.bounds);
  assert.notEqual(deviceVisualCacheKey(changed.devices[0]), deviceVisualCacheKey(output.devices[0]));
  assert.equal(deviceVisualCacheKey(changed.devices[1]), deviceVisualCacheKey(output.devices[1]));
});

const artwork = device => {
  const ctx = new OutputSvgContext();
  drawDeviceVisual(ctx, device, device.width, device.height);
  return ctx.elements.join("");
};

function hoverArtwork(device, point = { x: 100, y: 100 }) {
  const ctx = new OutputSvgContext(), lines = [], boxes = [];
  ctx.fillText = (...args) => lines.push(args);
  ctx.rect = (...args) => boxes.push(args);
  drawObjectHoverTooltip(ctx, device, { x: 0, y: 0, zoom: .4 }, null, point, { width: 640, height: 480 });
  return { lines, box: boxes[0] };
}

test("projector hover includes the current instance lens below its name without changing the model", () => {
  const project = projectorLensFixture(), before = structuredClone(project);
  let scene = buildEngineOutputScene(project);
  const a = hoverArtwork(scene.devices[0]), b = hoverArtwork(scene.devices[1]);
  assert.deepEqual(a.lines.map(line => line[0]), ["Projector A", "Lens: Wide 0.8:1"]);
  assert.deepEqual(b.lines.map(line => line[0]), ["Projector B", "Lens: Long Throw 2.5:1"]);
  assert.equal(a.lines[1][2] - a.lines[0][2], 16);
  assert.equal(a.box[3], 38);
  assert.deepEqual(project, before);
  project.devices[0].selectedProjectorLensId = "standard";
  scene = buildEngineOutputScene(project);
  assert.deepEqual(hoverArtwork(scene.devices[0]).lines.map(line => line[0]), ["Projector A", "Lens: Standard 1.2:1"]);
});

test("ordinary and empty projectors retain the original one-line hover; long lens labels stay in the viewport", () => {
  const device = buildEngineOutputScene(projectorLensFixture()).devices[0];
  for (const visual of [{}, { isProjector: false, projectorLensName: "Stale lens" }, { isProjector: true, projectorLensName: "" }]) {
    const hover = hoverArtwork({ ...device, visual });
    assert.deepEqual(hover.lines.map(line => line[0]), ["Projector A"]);
    assert.equal(hover.box[3], 22);
    assert.equal(hover.lines[0][2], hover.box[1] + 11);
  }
  const hover = hoverArtwork({ ...device, visual: { ...device.visual, projectorLensName: "Long lens ".repeat(50) } }, { x: 639, y: 479 });
  assert.equal(hover.box[2], 280);
  assert.ok(hover.box[0] + hover.box[2] <= 632);
  assert.ok(hover.box[1] + hover.box[3] <= 472);
  assert.ok(hover.lines.every(line => line[3] === 264));
});

test("one subtitle uses the existing header gap; non-projectors and empty projectors add no artwork", () => {
  const project = projectorLensFixture(), device = buildEngineOutputScene(project).devices[0];
  const svg = artwork(device);
  assert.equal(svg.match(/>Lens: Wide 0.8:1</g)?.length, 1);
  assert.match(svg, /<text x="20" y="34"[^>]*font-size="10.5"[^>]*>Lens: Wide 0.8:1</);
  const plain = structuredClone(device);
  for (const key of ["isProjector", "projectorLenses", "projectorLensName", "selectedProjectorLensId"]) delete plain.visual[key];
  const disabled = structuredClone(device); disabled.visual.isProjector = false;
  assert.equal(artwork(disabled), artwork(plain));
  const empty = structuredClone(device); empty.visual.projectorLensName = "";
  assert.equal(artwork(empty), artwork(plain));
  assert.deepEqual(project, projectorLensFixture(), "rendering never mutates project definitions");
});

test("HTML, Publish and vector PDF use the same resolved scene and shared lens artwork", () => {
  const project = projectorLensFixture(), scene = buildEngineOutputScene(project);
  const bundle = JSON.parse(readFileSync(new URL("../src/engine/generated/outputViewerBundle.json", import.meta.url)));
  const snapshot = { engineScene: scene };
  const payload = html => JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
  const downloaded = payload(buildEngineViewerHtml(snapshot, { bundle, title: "Download" }));
  const hosted = payload(buildEngineViewerHtml(snapshot, { bundle, title: "Hosted" }));
  assert.deepEqual(downloaded.engineScene, hosted.engineScene);
  const viewer = createOutputViewerModel(scene);
  assert.deepEqual(viewer.scene.devices.map(d => d.visual.projectorLensName), ["Wide 0.8:1", "Long Throw 2.5:1"]);
  const result = renderEngineOutputSvg(scene);
  for (const name of ["Wide 0.8:1", "Long Throw 2.5:1"]) assert.equal(result.svg.split(`>Lens: ${name}<`).length - 1, 1);
  assert.equal(renderEngineOutputSvg(scene).svg, result.svg);
});

test("compact JSON metadata survives multi-object clipboard and invalid selections fall back without assets", () => {
  const project = projectorLensFixture();
  project.devices[0].selectedProjectorLensId = "standard";
  const items = project.devices.map(d => ({ type: "device", id: d.instanceId }));
  const payload = clipboard.createCanvasClipboardPayload(project, items, { x: 0, y: 0, width: 1080, height: 244 });
  const loaded = clipboard.parseCanvasClipboard(clipboard.serializeCanvasClipboard(payload));
  const plan = clipboard.prepareCanvasClipboardPaste(loaded, project, { x: 200, y: 400 });
  assert.deepEqual(plan.additions.devices.map(d => d.selectedProjectorLensId), ["standard", "long"]);
  assert.equal(plan.definitions.length, 0, "identical custom definition reused");
  loaded.devices[0].selectedProjectorLensId = "removed";
  const fallback = clipboard.prepareCanvasClipboardPaste(loaded, {}, { x: 0, y: 0 });
  assert.equal(fallback.additions.devices[0].selectedProjectorLensId, "wide");
  const saved = JSON.parse(JSON.stringify(clipboard.applyCanvasClipboardPlan({}, fallback)));
  assert.deepEqual(saved.deviceLibrary[0].projectorLenses, project.deviceLibrary[0].projectorLenses);
  assert.equal(saved.devices[1].selectedProjectorLensId, "long");
});
