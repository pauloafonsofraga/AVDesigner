import test from "node:test";
import assert from "node:assert/strict";
import { deviceBrandForDisplay, deviceHeaderLabel } from "../src/engine/deviceDisplayName.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { drawDeviceVisual, deviceVisualCacheKey } from "../src/engine/deviceVisualBuilder.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputSelectionDetails } from "../src/engine/outputViewerModel.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { deviceBrandHeadersFixture } from "../fixtures/device-brand-headers.mjs";

for (const [name, device, expected] of [
  ["brand", { brand: "Barco", label: "E2 Gen 2" }, "Barco E2 Gen 2"],
  ["missing", { label: "E2 Gen 2" }, "E2 Gen 2"],
  ["manufacturer", { manufacturer: "Roland", label: "V-160HD" }, "Roland V-160HD"],
  ["duplicate", { brand: "Barco", label: "Barco E2 Gen 2" }, "Barco E2 Gen 2"],
  ["case", { brand: "Barco", label: "BARCO E2 Gen 2" }, "BARCO E2 Gen 2"],
  ["middle", { brand: "Barco", label: "Main Barco E2" }, "Barco Main Barco E2"],
  ["whole word", { brand: "Bar", label: "Barco E2" }, "Bar Barco E2"],
  ["unicode boundary", { brand: "Bar", label: "Bar\u00e7o E2" }, "Bar Bar\u00e7o E2"],
  ["punctuation boundary", { brand: "Barco", label: "Barco/E2" }, "Barco/E2"],
  ["regex literal", { brand: "A+B", label: "a+b Main" }, "a+b Main"],
  ["spacing", { brand: " Analog\tWay ", label: "  Aquilon   C+ " }, "Analog Way Aquilon C+"],
  ["authored generic", { brand: "Generic", label: "Switch" }, "Generic Switch"],
  ["null", { brand: null, label: "Switch" }, "Switch"],
  ["blank name", { brand: "Barco", label: "  " }, "Barco"],
  ["explicit instance", { brand: "Barco", label: "Main Screen", visual: { templateName: "E2" } }, "Barco Main Screen"]
]) test(`header display: ${name}`, () => {
  const before = structuredClone(device);
  assert.equal(deviceHeaderLabel(device), expected);
  assert.deepEqual(device, before);
});

test("brand aliases follow the existing UI field precedence", () => {
  assert.equal(deviceBrandForDisplay({ brand: " Brand ", manufacturer: "Maker", vendor: "Vendor", make: "Make" }), "Brand");
  assert.equal(deviceBrandForDisplay({ brand: " ", manufacturer: "Maker", vendor: "Vendor" }), "Maker");
  assert.equal(deviceBrandForDisplay({ vendor: "Vendor", make: "Make" }), "Vendor");
  assert.equal(deviceBrandForDisplay({ make: "Make" }), "Make");
});

test("special objects and Multi-Core schematic ends keep their labels", () => {
  for (const special of [
    ...["jump", "loom", "adapter", "rack", "led-surface", "image-object", "area", "comment", "title-block"].map(kind => ({ kind })),
    { kind: "device", sourceKind: "multi-core-end", multiCoreIdentity: { multiCoreId: "mc", endId: "a" } },
    { kind: "device", visual: { isRackCompact: true } },
    { kind: "wire", multiCoreIdentity: { kind: "multi-core-trunk" } }
  ]) assert.equal(deviceHeaderLabel({ ...special, brand: "Do Not Prefix", label: "End A" }), "End A");
});

test("instance metadata wins, while unnamed definitions retain the existing model fallback", () => {
  const project = deviceBrandHeadersFixture();
  project.devices[0].brand = "Instance Brand";
  project.devices[0].name = "Custom Label";
  project.devices[1].templateOverride.name = "";
  project.devices[1].templateOverride.model = "Fallback Model";
  project.devices[1].templateOverride.make = "Maker";
  const devices = normalizeAvDesignerProject(project).devices;
  assert.equal(deviceHeaderLabel(devices.find(d => d.id === "barco")), "Instance Brand Custom Label");
  assert.equal(deviceHeaderLabel(devices.find(d => d.id === "missing")), "Maker Fallback Model");
});

test("projection, save/reload, modular chassis, custom names and output agree without canonical mutation", () => {
  const project = deviceBrandHeadersFixture(), before = structuredClone(project);
  const normalized = normalizeAvDesignerProject(project), scene = new SceneGraph(); scene.setData(normalized);
  const expected = { barco: "Barco E2 Gen 2", manufacturer: "Roland V-160HD", missing: "Unbranded Monitor",
    duplicate: "bArCo E2 Gen 2", custom: "Analog Way Main Screen Processor", modular: "Analog Way Aquilon C+",
    long: "Blackmagic Design ATEM Constellation 8K Advanced Production Switcher with Extended Control", spacing: "Analog Way Multi Format Switcher" };
  const saved = JSON.parse(new ProjectMutationAdapter(normalized).exportJson());
  assert.deepEqual(saved.devices, before.devices);
  assert.deepEqual(saved.connections, before.connections);
  const snapshot = buildEngineOutputScene(saved), viewer = createOutputViewerModel(snapshot);
  const svg = renderEngineOutputSvg(snapshot).svg;
  for (const [id, label] of Object.entries(expected)) {
    const device = scene.getDevice(id), out = viewer.scene.getDevice(id);
    assert.equal(deviceHeaderLabel(device), label);
    assert.equal(deviceHeaderLabel(out), label);
    assert.equal(outputSelectionDetails(viewer.scene, { type: "device", id }).title, label);
    assert.ok(svg.includes(`>${label}</text>`));
    assert.deepEqual(out.connectors, device.connectors);
    assert.equal(out.width, device.width); assert.equal(out.height, device.height);
    assert.equal(out.label, device.label, "canonical label never gains a brand prefix");
  }
  assert.deepEqual(project, before);
  const noBrands = structuredClone(project);
  for (const d of noBrands.devices) for (const field of ["brand", "manufacturer", "vendor", "make"]) delete d.templateOverride[field];
  const plain = new SceneGraph(); plain.setData(normalizeAvDesignerProject(noBrands));
  for (const d of scene.devices) {
    const other = plain.getDevice(d.id);
    assert.deepEqual(d.connectors, other.connectors);
    assert.deepEqual([d.x, d.y, d.width, d.height], [other.x, other.y, other.width, other.height]);
  }
  assert.deepEqual(scene.wires, plain.wires, "wire paths and endpoint IDs do not depend on header text");
});

test("long ordinary headers fit existing bounds and update texture identity without resizing devices", () => {
  const device = { id: "long", kind: "device", label: "Model".repeat(250), brand: "Manufacturer", width: 160, height: 280, connectors: [] };
  const before = structuredClone(device), ctx = new OutputSvgContext();
  const headers = [], fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (text, x, y) => { if (x === 20 && y === 22) headers.push({ text, width: ctx.measureText(text).width }); fillText(text, x, y); };
  drawDeviceVisual(ctx, device, device.width, device.height);
  assert.equal(headers.length, 1);
  assert.ok(headers[0].text.endsWith("\u2026"));
  assert.ok(headers[0].width <= device.width - 40);
  assert.deepEqual(device, before);
  assert.notEqual(deviceVisualCacheKey(device), deviceVisualCacheKey({ ...device, brand: "Changed" }));
});
