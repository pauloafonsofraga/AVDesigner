import assert from "node:assert/strict";
import test from "node:test";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { inlineOutputAssets, outputAssetSources } from "../src/engine/outputViewerAssets.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { prepareEnginePrintImages, rackShellImageKey, renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { outputParityFixture } from "../fixtures/output-parity.mjs";
import { createRackCompactLayout } from "../src/engine/rackCompactLayout.js";
import { normalizeRackShell, rackShellBounds, rackShellSlices, rackShellStyle,
  DEFAULT_RACK_SHELL_COLOR, RACK_SHELL_STYLES } from "../src/engine/rackShell.js";

test("production rack shell registry retains Standard and exposes the supplied high-resolution styles", () => {
  assert.deepEqual(Object.values(RACK_SHELL_STYLES).map(style => [style.id, style.label]), [
    ["standard", "Standard"],
    ["professional", "Professional AV Rack"],
    ["touring", "Touring Flight Case"]
  ]);
  assert.equal(new Set(Object.values(RACK_SHELL_STYLES).map(style => style.id)).size, 3);
  assert.equal(RACK_SHELL_STYLES.professional.src, "./assets/rack-shells/professional-neutral.png");
  assert.equal(RACK_SHELL_STYLES.touring.src, "./assets/rack-shells/touring-neutral.png");
  for (const id of ["professional", "touring"]) {
    assert.equal(RACK_SHELL_STYLES[id].sourceWidth, 1254);
    assert.equal(RACK_SHELL_STYLES[id].sourceHeight, 1254);
  }
});

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

test("rack shell slices accept style IDs and authored shell configs with unchanged standard geometry", () => {
  const rect = { x: 35, y: 42, width: 240, height: 180 };
  const byId = rackShellSlices("standard", rect);
  const byConfig = rackShellSlices({ styleId: "standard", color: "#3A7FA5" }, rect);
  assert.deepEqual(byConfig, byId);
  assert.deepEqual(byId[0].sourceRect, { x: 0, y: 0, width: 24, height: 24 });
  assert.deepEqual(byId[0].destinationRect, { x: 35, y: 42, width: 24, height: 24 });
});

test("rack shell slices preserve geometry from an already-resolved non-default style", () => {
  const testWide = {
    id: "test-wide",
    src: "./test-wide.png",
    sourceWidth: 160,
    sourceHeight: 120,
    insets: { left: 18, top: 12, right: 26, bottom: 20 },
    padding: { left: 10, top: 10, right: 10, bottom: 10 }
  };
  const rect = { x: 30, y: 40, width: 300, height: 220 };
  const slices = rackShellSlices(testWide, rect);
  const slice = role => slices.find(item => item.role === role);

  assert.deepEqual(slice("top-left").sourceRect, { x: 0, y: 0, width: 18, height: 12 });
  assert.equal(slice("top-right").sourceRect.x, 160 - 26);
  assert.equal(slice("bottom").sourceRect.y, 120 - 20);
  assert.equal(slice("center").sourceRect.width, 160 - 18 - 26);
  assert.equal(slice("center").sourceRect.height, 120 - 12 - 20);
  assert.deepEqual(slice("top-left").destinationRect, { x: 30, y: 40, width: 18, height: 12 });
  assert.deepEqual(slice("top-right").destinationRect, { x: 304, y: 40, width: 26, height: 12 });
  assert.deepEqual(slice("bottom-left").destinationRect, { x: 30, y: 240, width: 18, height: 20 });
});

test("high-resolution source slices are independent from world-space destination borders", () => {
  const style = RACK_SHELL_STYLES.professional;
  const topLeft = rackShellSlices(style, { x: 12, y: 24, width: 360, height: 720 })[0];
  assert.equal(topLeft.sourceRect.width, 165);
  assert.equal(topLeft.sourceRect.height, 155);
  assert.equal(topLeft.destinationRect.width, 27);
  assert.equal(topLeft.destinationRect.height, 27);

  const legacyCustom = {
    id: "legacy-test", src: "./legacy.png", sourceWidth: 96, sourceHeight: 96,
    insets: { left: 24, top: 24, right: 24, bottom: 24 }
  };
  const legacySlice = rackShellSlices(legacyCustom, { x: 0, y: 0, width: 160, height: 160 })[0];
  assert.equal(legacySlice.sourceRect.width, 24);
  assert.equal(legacySlice.destinationRect.width, 24);
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

test("rack style changes leave compact content, connector points, and Patch Panel geometry unchanged", () => {
  const child = { id: "device-1", rackId: "rack", x: 40, y: 20, width: 400, height: 180,
    visual: { hasFaceImage: true, faceImageNaturalWidth: 1200, faceImageNaturalHeight: 300 },
    connectors: [{ id: "out", direction: "output", displaySide: "right", x: 400, y: 90 }] };
  const rack = { id: "rack", exposedPorts: [{ id: "exposed", deviceId: "device-1", connectorId: "out" }],
    patchPanels: [{ id: "panel", placementSide: "left", y: 20, ports: [{ id: "port", slot: 2 }] }] };
  const layoutFor = styleId => createRackCompactLayout({ rack: { ...rack, rackShell: { styleId, color: "#A14B32" } }, devices: [child] });
  const standard = layoutFor("standard"), professional = layoutFor("professional"), touring = layoutFor("touring");
  for (const next of [professional, touring]) {
    assert.deepEqual(next.devices, standard.devices);
    assert.deepEqual(next.patchPanels, standard.patchPanels);
    assert.deepEqual(next.compactContentBounds, standard.compactContentBounds);
  }
  assert.equal(normalizeRackShell({ styleId: "professional", color: "#A14B32" }).color, "#A14B32");
  assert.equal(normalizeRackShell({ styleId: "touring", color: "#A14B32" }).styleId, "touring");
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
    rackShell: { styleId: "professional", color: "#A14B32" }, devices: [] });
  const first = buildEngineOutputScene(project);
  assert.deepEqual(first.racks.find(rack => rack.id === placed.id).rackShell,
    { styleId: "professional", color: "#A14B32" });
  const reloaded = buildEngineOutputScene(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(reloaded.racks.find(rack => rack.id === placed.id).rackShell,
    { styleId: "professional", color: "#A14B32" });
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

test("output asset collection includes only distinct production shell sources used by compact racks", () => {
  const project = outputParityFixture();
  project.racks[0].rackShell = { styleId: "professional", color: "#23658A" };
  const second = structuredClone(project.racks[0]);
  second.id = "rack-tour";
  second.rackShell = { styleId: "touring", color: "#A14B32" };
  project.racks.push(second);
  const scene = buildEngineOutputScene(project);
  assert.deepEqual(outputAssetSources(scene).filter(source => source.includes("rack-shells/")), [
    "./assets/rack-shells/professional-neutral.png",
    "./assets/rack-shells/touring-neutral.png"
  ]);
});

test("offline HTML asset inlining resolves each selected shell source once", async () => {
  const project = outputParityFixture();
  project.racks[0].rackShell = { styleId: "professional", color: "#23658A" };
  const second = structuredClone(project.racks[0]);
  second.id = "rack-tour";
  second.rackShell = { styleId: "touring", color: "#A14B32" };
  project.racks.push(second);
  const scene = buildEngineOutputScene(project), requested = [];
  const assets = await inlineOutputAssets(scene, async source => {
    requested.push(source);
    return "data:image/png;base64,c2hlbGw=";
  });
  const shellSources = requested.filter(source => source.includes("/rack-shells/")).sort();
  assert.deepEqual(shellSources, [
    "./assets/rack-shells/professional-neutral.png",
    "./assets/rack-shells/touring-neutral.png"
  ]);
  assert.equal(assets["./assets/rack-shells/professional-neutral.png"], "data:image/png;base64,c2hlbGw=");
  assert.equal(assets["./assets/rack-shells/touring-neutral.png"], "data:image/png;base64,c2hlbGw=");
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

test("SVG/PDF shell drawing uses each selected production style's source image and slice geometry", async () => {
  const project = outputParityFixture();
  project.racks[0].rackShell = { styleId: "professional", color: "#23658A" };
  const second = structuredClone(project.racks[0]);
  second.id = "rack-professional-red";
  second.rackShell = { styleId: "professional", color: "#A14B32" };
  const third = structuredClone(project.racks[0]);
  third.id = "rack-tour";
  third.rackShell = { styleId: "touring", color: "#23658A" };
  project.racks.push(second, third);
  const scene = buildEngineOutputScene(project);
  const acquired = [], tinted = [];
  const images = await prepareEnginePrintImages(scene, async source => {
    acquired.push(source);
    return { href: "data:image/png;base64,AAAA", width: 1254, height: 1254 };
  }, async (image, color) => {
    tinted.push(color);
    return { ...image, href: `data:image/png;base64,${color.slice(1)}` };
  });
  assert.deepEqual(acquired.filter(source => source.includes("/rack-shells/")).sort(), [
    "./assets/rack-shells/professional-neutral.png",
    "./assets/rack-shells/touring-neutral.png"
  ]);
  assert.deepEqual(tinted.sort(), ["#23658A", "#23658A", "#A14B32"]);
  const output = renderEngineOutputSvg(scene, { images });
  assert.equal((output.svg.match(/data-rack-shell-style="professional"/g) || []).length, 2);
  assert.match(output.svg, /data-rack-shell-style="touring"/);
  assert.equal((output.svg.match(/<clipPath id="print-image-slice-/g) || []).length, 27);
});
