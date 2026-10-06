import assert from "node:assert/strict";
import test from "node:test";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { outputAssetSources } from "../src/engine/outputViewerAssets.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { prepareEnginePrintImages, rackShellImageKey, renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { outputParityFixture } from "../fixtures/output-parity.mjs";
import { createRackCompactLayout } from "../src/engine/rackCompactLayout.js";
import { normalizeRackShell, rackShellBounds, rackShellSlices, rackShellStyle,
  DEFAULT_RACK_SHELL_COLOR } from "../src/engine/rackShell.js";

test("rack shell slices preserve fixed corners and stretch only the center rails", () => {
  const small = rackShellSlices("standard", { x: 10, y: 20, width: 180, height: 140 });
  const large = rackShellSlices("standard", { x: 10, y: 20, width: 520, height: 380 });
  assert.deepEqual(small.map(item => item.role), ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"]);
  for (const role of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    const a = small.find(item => item.role === role).destinationRect;
    const b = large.find(item => item.role === role).destinationRect;
    assert.equal(a.width, b.width);
    assert.equal(a.height, b.height);
  }
  assert.equal(small.find(item => item.role === "top").destinationRect.width, 132);
  assert.equal(large.find(item => item.role === "top").destinationRect.width, 472);
  assert.equal(small.find(item => item.role === "left").destinationRect.height, 92);
  assert.equal(large.find(item => item.role === "left").destinationRect.height, 332);
  assert.equal(large.find(item => item.role === "center").destinationRect.width, 472);
  assert.equal(large.find(item => item.role === "center").destinationRect.height, 332);
});

test("rack shell geometry clamps minimum size and never returns negative slices", () => {
  const style = rackShellStyle();
  const shell = rackShellBounds({ x: 10, y: 20, width: 1, height: 1 }, { styleId: "standard" });
  assert.equal(shell.width, style.insets.left + style.insets.right);
  assert.equal(shell.height, style.insets.top + style.insets.bottom);
  assert.ok(rackShellSlices("standard", { ...shell, width: 1, height: 1 })
    .every(slice => slice.sourceRect.width >= 0 && slice.sourceRect.height >= 0
      && slice.destinationRect.width >= 0 && slice.destinationRect.height >= 0));
});

test("rack appearance normalizes old, valid and invalid values without changing geometry", () => {
  assert.deepEqual(normalizeRackShell(), { styleId: "standard", color: DEFAULT_RACK_SHELL_COLOR });
  assert.deepEqual(normalizeRackShell({ styleId: "unknown", color: "invalid" }),
    { styleId: "standard", color: DEFAULT_RACK_SHELL_COLOR });
  assert.deepEqual(normalizeRackShell({ styleId: "standard", color: "#a14b32" }),
    { styleId: "standard", color: "#A14B32" });
  const project = outputParityFixture();
  const before = buildEngineOutputScene(project);
  project.racks[0].rackShell = { styleId: "standard", color: "#A14B32" };
  const after = buildEngineOutputScene(project);
  assert.deepEqual(after.racks[0].rackShell, { styleId: "standard", color: "#A14B32" });
  assert.deepEqual(after.racks[0].bounds, before.racks[0].bounds);
  assert.equal(after.signature, buildEngineOutputScene(project).signature);
});

test("placed rack instances resolve color from the source rack on save/reload", () => {
  const project = outputParityFixture();
  const placed = project.racks[0];
  placed.sourceRackId = "rack-definition";
  placed.rackShell = { styleId: "standard", color: "#FF0000" };
  project.racks.unshift({ id: "rack-definition", name: "Source Rack",
    rackShell: { styleId: "standard", color: "#A14B32" }, devices: [] });
  const first = buildEngineOutputScene(project);
  assert.deepEqual(first.racks.find(rack => rack.id === placed.id).rackShell,
    { styleId: "standard", color: "#A14B32" });
  const reloaded = buildEngineOutputScene(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(reloaded.racks.find(rack => rack.id === placed.id).rackShell,
    { styleId: "standard", color: "#A14B32" });
  assert.deepEqual(reloaded.racks.find(rack => rack.id === placed.id).bounds,
    first.racks.find(rack => rack.id === placed.id).bounds);
});

test("compact content bounds remain layout-owned while shell tracks reflow", () => {
  const child = { id: "device-1", rackId: "rack", x: 40, y: 20, width: 400, height: 180,
    visual: { hasFaceImage: true, faceImageNaturalWidth: 1200, faceImageNaturalHeight: 300 }, connectors: [] };
  const rack = { id: "rack", patchPanels: [], exposedPorts: [] };
  const first = createRackCompactLayout({ rack, devices: [child] });
  rack.patchPanels.push({ id: "panel", placementSide: "left", y: 0, ports: Array.from({ length: 9 }, (_, index) => ({ id: `p${index}`, slot: index + 1 })) });
  const reflow = createRackCompactLayout({ rack, devices: [child] });
  assert.deepEqual(first.devices, reflow.devices, "panel reflow does not rewrite the compact device source geometry");
  assert.ok(reflow.compactContentBounds.width > first.compactContentBounds.width);
  assert.ok(reflow.shellBounds.x <= reflow.compactContentBounds.x);
  assert.ok(reflow.shellBounds.y <= reflow.compactContentBounds.y);
  assert.ok(reflow.shellBounds.width > reflow.compactContentBounds.width);
  assert.ok(reflow.shellBounds.height > reflow.compactContentBounds.height);
  assert.deepEqual(reflow.bounds, reflow.shellBounds);
});

test("output viewer embeds one replaceable neutral shell asset and resolves it per rack", () => {
  const project = outputParityFixture();
  project.racks[0].rackShell = { styleId: "standard", color: "#23658A" };
  const scene = buildEngineOutputScene(project);
  const shellSource = rackShellStyle().src;
  assert.equal(outputAssetSources(scene).filter(source => source === shellSource).length, 1);
  const model = createOutputViewerModel(scene, { assets: { [shellSource]: "data:image/png;base64,AAAA" } });
  assert.equal(model.scene.getRack("rack").rackShellImage, "data:image/png;base64,AAAA");
});

test("print resources tint once per distinct rack color and SVG uses the shared nine slices", async () => {
  const project = outputParityFixture();
  project.racks[0].rackShell = { styleId: "standard", color: "#23658A" };
  const second = structuredClone(project.racks[0]);
  second.id = "rack-second";
  second.rackShell = { styleId: "standard", color: "#A14B32" };
  project.racks.push(second);
  const scene = buildEngineOutputScene(project);
  const tinted = [];
  const images = await prepareEnginePrintImages(scene,
    async source => ({ href: source.endsWith("standard-neutral.png") ? "data:image/png;base64,AAAA" : "data:image/png;base64,BBBB", width: 96, height: 96 }),
    async (image, color) => {
      tinted.push(color);
      return { href: `data:image/png;base64,${color.slice(1)}`, width: image.width, height: image.height };
    });
  assert.deepEqual(tinted.sort(), ["#23658A", "#A14B32"]);
  assert.ok(images[rackShellImageKey(rackShellStyle().src, "#23658A")]);
  const output = renderEngineOutputSvg(scene, { images });
  assert.equal(output.diagnostics.rackShellImages, 2);
  assert.equal(output.diagnostics.rackShellFallbacks, 0);
  assert.equal((output.svg.match(/data-rack-shell-style="standard"/g) || []).length, 2);
  assert.equal((output.svg.match(/<clipPath id="print-image-slice-/g) || []).length, 18);
});
