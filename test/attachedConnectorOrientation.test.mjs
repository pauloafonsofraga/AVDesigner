import test from "node:test";
import assert from "node:assert/strict";
import { adapterThumbnailFixtures } from "../fixtures/adapter-thumbnails.mjs";
import { adapterWorldPoint, snapAdapterRotation } from "../src/engine/adapterRotation.js";
import { attachedConnectorLabelPosition } from "../src/engine/attachedConnectorOrientation.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { engineOutputPrimitives, drawEngineOutputLabels } from "../src/engine/renderer.js";
import { hitTestConnector } from "../src/engine/hitTest.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { legacyConnectorLabelMetrics } from "../src/engine/legacyZoomDetail.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const artwork = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function project(rotation = 0, ordinary = false) {
  const f = adapterThumbnailFixtures();
  const defs = [f.oneToOne, f.fanOut, f.twoBus, f.segmented];
  for (const def of defs) {
    if (ordinary) { def.objectType = "device"; def.category = "Other"; def.isAdapterBreakout = false; }
    def.connectors[0].operationalStatus = "not-working";
    def.connectors[0].thumbnail = artwork;
  }
  return { deviceLibrary: defs, nodeLibrary: [{ id: "custom", label: "Custom", thumbnail: artwork }],
    devices: defs.map((def, i) => ({ instanceId: `d${i}`, templateId: def.id, x: 200 + i * 500, y: 300, rotation })),
    connections: [{ id: "physical", cableType: "hdmi", length: "5m", label: "Keep me",
      from: { deviceId: "d0", connectorId: "out" }, to: { deviceId: "d1", connectorId: "in" } }] };
}
const model = p => createOutputViewerModel({ engineScene: buildEngineOutputScene(p) });
const markers = m => engineOutputPrimitives(m.scene, m.contract).connectors;

for (let angle = 0; angle < 360; angle += 15) {
  test(`attached adapter/breakout markers, anchors and hit targets at existing ${angle}-degree step`, () => {
    assert.equal(snapAdapterRotation(angle), angle);
    const source = project(angle), before = structuredClone(source);
    const base = model(project()), rotated = model(source);
    const baseline = markers(base), actual = markers(rotated);
    assert.ok(rotated.scene.getConnector("d3", "lock").colorSegments.length > 1, "real Powerlock segmented marker");
    assert.equal(actual.length, baseline.length);
    actual.forEach((marker, i) => {
      const initial = baseline[i];
      const device = rotated.scene.getDevice(marker.deviceId);
      const connector = rotated.scene.getConnector(marker.deviceId, marker.connectorId);
      const anchor = rotated.contract.connectors.find(c => c.deviceId === marker.deviceId && c.connectorId === marker.connectorId)
        .anchors.find(a => a.id === marker.anchorId);
      assert.deepEqual(marker.point, anchor.worldPoint);
      const unrotatedDevice = base.scene.getDevice(marker.deviceId);
      const expected = adapterWorldPoint(device, { x: initial.point.x - unrotatedDevice.x, y: initial.point.y - unrotatedDevice.y });
      near(marker.point.x, expected.x); near(marker.point.y, expected.y);
      assert.deepEqual(connector.anchors, base.scene.getConnector(marker.deviceId, marker.connectorId).anchors);
      assert.equal(marker.vertices.length, initial.vertices.length);
      const cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
      for (let j = 0; j < marker.vertices.length; j += 6) {
        const x = initial.vertices[j] - initial.point.x, y = initial.vertices[j + 1] - initial.point.y;
        near(marker.vertices[j], marker.point.x + x * cos - y * sin);
        near(marker.vertices[j + 1], marker.point.y + x * sin + y * cos);
        assert.deepEqual(marker.vertices.slice(j + 2, j + 6), initial.vertices.slice(j + 2, j + 6));
      }
      const hit = hitTestConnector(rotated.scene, marker.point, 10).connector;
      assert.equal(hit?.connector.id, connector.id);
      assert.equal(hit?.device.id, device.id);
      assert.equal(hitTestConnector(rotated.scene, { x: marker.point.x + 6, y: marker.point.y }, 10).connector?.connector.id, connector.id);
    });
    const wire = rotated.scene.getWire("physical");
    for (const [end, deviceId, connectorId] of [["from", "d0", "out"], ["to", "d1", "in"]]) {
      assert.deepEqual(rotated.scene.rawEndpointForWire(wire, end), rotated.scene.connectorWorldPoint(
        rotated.scene.getDevice(deviceId), rotated.scene.getConnector(deviceId, connectorId)));
    }
    assert.deepEqual(source, before);
    assert.deepEqual(markers(model(JSON.parse(JSON.stringify(source)))), actual);
  });
}

test("labels follow rotated connector offsets but remain upright, including shared buses", () => {
  for (let angle = 0; angle < 360; angle += 15) {
    const m = model(project(angle)), labels = [];
    const ctx = new OutputSvgContext();
    ctx.strokeText = () => {};
    ctx.fillText = function(text, x, y) { labels.push({ text, x, y, align: this.textAlign }); };
    drawEngineOutputLabels(ctx, m.scene, m.contract.bounds);
    const device = m.scene.getDevice("d0"), connector = m.scene.getConnector("d0", "out");
    const point = m.scene.connectorWorldPoint(device, connector);
    const metrics = legacyConnectorLabelMetrics(1);
    const pos = attachedConnectorLabelPosition(device, point, "right", metrics.offsetX, metrics.offsetY);
    assert.ok(labels.some(label => label.text === "HDMI" && Math.abs(label.x - (pos.x - m.contract.bounds.x)) < 1e-7
      && Math.abs(label.y - (pos.y - m.contract.bounds.y)) < 1e-7 && label.align === pos.textAlign));
    const bus = labels.find(label => label.text === "SDI");
    assert.ok(bus);
    const base = model(project()), baseLabels = [];
    const baseCtx = new OutputSvgContext();
    baseCtx.strokeText = () => {};
    baseCtx.fillText = (text, x, y) => baseLabels.push({ text, x, y });
    drawEngineOutputLabels(baseCtx, base.scene, base.contract.bounds);
    const original = baseLabels.find(label => label.text === "SDI");
    const busDevice = m.scene.getDevice("d2");
    const rotated = adapterWorldPoint(busDevice, { x: original.x + base.contract.bounds.x - busDevice.x,
      y: original.y + base.contract.bounds.y - busDevice.y });
    near(bus.x + m.contract.bounds.x, rotated.x); near(bus.y + m.contract.bounds.y, rotated.y);
    const svg = renderEngineOutputSvg({ engineScene: m.contract }).svg;
    assert.match(svg, /data-connector-id="out"/);
    assert.match(svg, />HDMI<\/text>/);
  }
});

test("ordinary device marker geometry and label offsets are byte-identical regardless of rotation field", () => {
  const base = model(project(0, true)), rotated = model(project(45, true));
  assert.deepEqual(markers(rotated), markers(base));
  const point = { x: 10, y: 20 };
  assert.deepEqual(attachedConnectorLabelPosition({ kind: "device", rotation: 45 }, point, "right", 14, 22),
    { x: -4, y: 42, textAlign: "right" });
});
