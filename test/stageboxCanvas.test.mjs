import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStageboxSnake, assignStageboxConnector, setStageboxChannel, stageboxEndDraft, commitStageboxEndDraft } from "../src/engine/stageboxSnake.js";
import { collectDevicePackage, decodeDevicePackage, encodeDevicePackage } from "../src/devicePackage.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";
import { buildCableSchedule, signalChainForWire } from "../src/engine/cableSchedule.js";
import { captureTopologyState, createTopologyCommand, createTopologyReplayState, replayTopologyCommand } from "../src/engine/topologyCommandProtocol.js";
import { stageboxNodeOnlyFixture } from "../fixtures/stagebox-node-only.mjs";
import { createOutputViewerModel, outputCableTrace } from "../src/engine/outputViewerModel.js";
import { continuousStageboxPoints, stageboxSignalPath } from "../src/engine/stageboxSignalPath.js";
import { STAGEBOX_NODE_RIM, STAGEBOX_RECTANGLE_MIN_SIZE, stageboxFanoutBranchPoints, stageboxNodeDetailScale, stageboxNodeFillRadius, stageboxNodeHitRadius, stageboxPreviewBounds, stageboxTrunkArc } from "../src/engine/stageboxNodeGeometry.js";
import { legacyCanvasDetailScale, legacyConnectorRadius, legacyConnectorStrokeWidth } from "../src/engine/legacyZoomDetail.js";
import { hitTestConnector, hitTestStageboxFanoutBranch } from "../src/engine/hitTest.js";
import { generatePdf } from "../src/engine/outputPdf.js";
import { createPreviewDeviceFromDraft, EnginePreviewSurface, fitCameraToBounds } from "../src/engine/enginePreview.js";

const port = (id, direction, x) => ({ id, nameText: id, type: "hdmi", direction, x, y: 75 });
const device = (id, x, connectors) => ({ instanceId: id, name: id, x, y: 0,
  templateOverride: { id: id + "-type", name: id, width: 120, height: 140, connectors } });
const connection = (id, from, fromPort, to, toPort, length) => ({
  id, cableType: "hdmi", length, from: { deviceId: from, connectorId: fromPort }, to: { deviceId: to, connectorId: toPort }
});
function fixture() {
  const snake = device("snake", 220, [port("multipin", "input", 0), port("tail", "output", 120)]);
  const t = snake.templateOverride;
  Object.assign(t, normalizeStageboxSnake({ ...t, isStageboxSnake: true }));
  const assigned = assignStageboxConnector(assignStageboxConnector(t, "multipin", "end-a"), "tail", "end-b");
  assigned.stageboxSnake.ends[1].representation = "fanout";
  snake.templateOverride = setStageboxChannel(assigned, { id: "ch1", name: "Video 1",
    a: { connectorId: "multipin", contact: "1" }, b: { connectorId: "tail" } });
  return { wireMode: "orthogonal", devices: [device("source", 0, [port("out", "output", 120)]),
    snake, device("sink", 960, [port("in", "input", 0)])],
  connections: [connection("entry", "source", "out", "snake", "multipin", "3m"),
    connection("exit", "snake", "tail", "sink", "in", "5m")] };
}

test("unassigned physical types on authored slots do not prevent Stagebox projection", () => {
  const project = fixture();
  const template = project.devices[1].templateOverride;
  template.connectors.push({ id: "spare", direction: "output", type: "", empty: true });
  template.stageboxSnake.ends[1].connectorIds.push("spare");
  project.deviceLibrary = [template];
  project.devices[1].templateId = template.id;
  delete project.devices[1].templateOverride;
  const data = normalizeAvDesignerProject(project);
  const end = data.devices.find(d => d.stageboxIdentity?.endId === "end-b");
  assert.deepEqual(end.connectors.map(c => c.id), ["tail"]);
  assert.equal(data.wires.find(w => w.id === "exit").fromDeviceId, end.id);
  const fallback = JSON.parse(new ProjectMutationAdapter({ ...data, projectData: null }).exportJson());
  assert.ok(fallback.devices.find(d => d.instanceId === "snake").templateOverride.connectors.some(c => c.id === "spare" && c.empty));
  assert.equal(normalizeAvDesignerProject(fallback).devices.filter(d => d.stageboxIdentity).length, 2);
});

test("both ends move independently and reload with their original cable endpoints", () => {
  const data = normalizeAvDesignerProject(fixture());
  const scene = new SceneGraph();
  scene.setData(data);
  const trunk = scene.wires.find(w => w.stageboxAssemblyId);
  const a = scene.getDevice(trunk.fromDeviceId), b = scene.getDevice(trunk.toDeviceId);
  assert.equal(trunk.routeStyle, "orthogonal");
  assert.equal(scene.getWire("exit").fromDeviceId, b.id);
  assert.equal(b.visual.stageboxRepresentation, "fanout");
  const oldX = b.x;
  b.x += 80;
  b.y += 90;
  const mutation = new ProjectMutationAdapter(data);
  mutation.commitDevicePositions(scene, [b.id]);
  const reopened = normalizeAvDesignerProject(JSON.parse(mutation.exportJson()));
  assert.equal(reopened.devices.find(d => d.id === a.id).x, a.x);
  assert.deepEqual(reopened.devices.find(d => d.id === b.id).x, oldX + 80);
  assert.equal(reopened.devices.find(d => d.id === b.id).y, b.y);
  assert.deepEqual(mutation.root.connections, fixture().connections);
  a.x += 35;
  a.y -= 30;
  mutation.commitDevicePositions(scene, [a.id]);
  const final = new SceneGraph();
  final.setData(normalizeAvDesignerProject(JSON.parse(mutation.exportJson())));
  for (const [end, wireId, side, connectorId] of [[a, "entry", "to", "multipin"], [b, "exit", "from", "tail"]]) {
    const device = final.getDevice(end.id);
    assert.deepEqual([device.x, device.y], [end.x, end.y]);
    assert.deepEqual(final.endpointForWire(final.getWire(wireId), side), final.connectorWorldPoint(device, final.getConnector(device.id, connectorId)));
  }
});

test("passive channel is traced, but only the two real patch cables contribute length", () => {
  const rows = buildCableSchedule(fixture(), { assignNumbers: "readOnly" });
  assert.equal(rows.length, 2);
  assert.match(rows.find(r => r.wireIds.includes("exit")).sourceDevice, /End B/);
  assert.match(rows.find(r => r.wireIds.includes("entry")).notes, /Video 1 \/ contact 1/);
  const { path, presentation } = signalChainForWire(rows, "entry");
  assert.deepEqual(path.externalCableIds, ["entry", "exit"]);
  assert.equal(path.lengthSources.length, 2);
  assert.match(presentation.segments[1].title, /Video 1/);
  assert.match(presentation.segments[1].detail, /A contact 1/);
});

test("collaboration replays an end position as one canonical device mutation", async () => {
  const before = fixture(), after = structuredClone(before);
  after.devices[1].stageboxEndOffsets = { "end-b": { x: 430, y: 170 } };
  const state = createTopologyReplayState("stagebox-test");
  const command = await createTopologyCommand(before, after, { state });
  assert.deepEqual(command.affected.map(e => [e.collection, e.id]), [["devices", "snake"]]);
  const result = await replayTopologyCommand(before, command, state);
  assert.deepEqual(captureTopologyState(result.project), captureTopologyState(after));
});

test("output trunk is light blue and exactly three normal cable widths", () => {
  const project = fixture(), contract = buildEngineOutputScene(project);
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  const trunk = contract.wires.find(w => w.stageboxAssemblyId);
  assert.equal(trunk.color, "#80d4ff");
  const { svg } = renderEngineOutputSvg(contract);
  for (const id of [trunk.fromDeviceId, trunk.toDeviceId]) assert.ok(svg.includes(`data-object-id="${id}"`));
  assert.ok(svg.includes(`data-wire-id="${trunk.id}"`));
  const widths = Object.fromEntries(engineOutputPrimitives(scene, contract).wires.map(({ id, vertices }) =>
    [id, Math.hypot(vertices[0] - vertices[30], vertices[1] - vertices[31])]));
  assert.ok(Math.abs(widths[trunk.id] - widths.entry * 3) < 1e-6);
});

test("Stagebox labels and fanout colors persist as device definitions without changing signal topology", async () => {
  const project = stageboxNodeOnlyFixture(4, ["rectangle", "fanout"]);
  const before = normalizeAvDesignerProject(project);
  const scene = new SceneGraph();
  scene.setData(before);
  const end = scene.devices.find(d => d.stageboxIdentity?.endId === "end-b");
  const connector = scene.getConnector(end.id, "b-1");
  const points = stageboxFanoutBranchPoints(end, connector);
  assert.equal(hitTestStageboxFanoutBranch(scene, points[17], 4)?.connector.id, connector.id);
  assert.equal(hitTestStageboxFanoutBranch(scene, points[0], 4), null);
  end.layerLocked = true;
  assert.equal(hitTestStageboxFanoutBranch(scene, points[17], 4), null);
  end.layerLocked = false;
  const authored = structuredClone(project), instance = authored.devices[1];
  const draft = stageboxEndDraft(instance.templateOverride, "end-b");
  Object.assign(draft.connectors[0], { stageboxNodeLabel: "MIC\nA1", stageboxFanoutColor: "#E84729" });
  draft.connectors[1].stageboxFanoutColor = "url(unsafe)";
  instance.templateOverride = commitStageboxEndDraft(instance.templateOverride, "end-b", draft);
  const preview = createPreviewDeviceFromDraft({ template: draft });
  assert.equal(preview.connectors[0].stageboxNodeLabel, "MIC\nA1");
  assert.equal(preview.connectors[0].color, connector.color);
  assert.deepEqual(preview.visual.stageboxNodeOnly.branchColors, { "b-1": "#e84729" });
  const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(authored)).exportJson());
  assert.deepEqual(saved.devices[1].templateOverride.stageboxSnake.channels, normalizeStageboxSnake(project.devices[1].templateOverride).stageboxSnake.channels);
  assert.deepEqual(saved.connections, project.connections);
  const reopened = normalizeAvDesignerProject(saved);
  const reopenedEnd = reopened.devices.find(d => d.id === end.id);
  assert.deepEqual(reopenedEnd.visual.stageboxNodeOnly.branchColors, { "b-1": "#e84729" });
  assert.deepEqual(reopenedEnd.connectors.map(({ stageboxNodeLabel, ...c }) => c), before.devices.find(d => d.id === end.id).connectors);
  assert.deepEqual(reopened.wires, before.wires);
  const contract = buildEngineOutputScene(saved);
  const { svg } = renderEngineOutputSvg(contract);
  assert.match(svg, /<linearGradient[^>]*>\s*<stop[^>]*#80d4ff[^>]*>\s*<stop[^>]*#e84729/);
  assert.equal((svg.match(/#e84729/g) || []).length, 1);
  assert.match(svg, />MIC<\/text>/);
  assert.match(svg, />A1<\/text>/);
  const nodes = [...new Set(draft.connectors.map(c => c.type))].map(type => ({ id: type, label: type }));
  const packaged = await decodeDevicePackage(await encodeDevicePackage(await collectDevicePackage(instance.templateOverride, { nodes })));
  assert.equal(stageboxEndDraft(packaged.devices[0], "end-b").connectors[0].stageboxNodeLabel, "MIC\nA1");
  assert.equal(stageboxEndDraft(packaged.devices[0], "end-b").connectors[0].stageboxFanoutColor, "#E84729");
  const replayState = createTopologyReplayState("fanout-color");
  const command = await createTopologyCommand(project, saved, { state: replayState });
  const replayed = await replayTopologyCommand(project, command, replayState);
  assert.deepEqual(captureTopologyState(replayed.project), captureTopologyState(saved));
});

test("older instance fanout overrides are still rendered until the connector is customized or reset in the editor", () => {
  const project = stageboxNodeOnlyFixture(4, ["circular", "fanout"]);
  const instance = project.devices[1];
  instance.stageboxFanoutColors = { "b-1": "#ffffff" };
  const end = () => normalizeAvDesignerProject(project).devices.find(d => d.stageboxIdentity?.endId === "end-b");
  assert.deepEqual(end().visual.stageboxNodeOnly.branchColors, { "b-1": "#ffffff" });
  const port = instance.templateOverride.connectors.find(c => c.id === "b-1");
  port.stageboxFanoutColor = "#654321";
  assert.deepEqual(end().visual.stageboxNodeOnly.branchColors, { "b-1": "#654321" });
  port.stageboxFanoutColor = "";
  assert.equal(end().visual.stageboxNodeOnly.branchColors, undefined);
  const a = instance.templateOverride.connectors.find(c => c.id === "a-1");
  a.stageboxNodeLabel = "Custom A";
  const circular = normalizeAvDesignerProject(project).devices.find(d => d.stageboxIdentity?.endId === "end-a");
  assert.equal(circular.connectors[0].stageboxNodeLabel, "Custom A");
});

test("automatic rectangular and circular ends use compact live anchors without changing canonical definitions", () => {
  for (const count of [4, 9, 16, 32, 100]) {
    const project = stageboxNodeOnlyFixture(count);
    const scene = new SceneGraph();
    const normalized = normalizeAvDesignerProject(project);
    scene.setData(normalized);
    const ends = scene.devices.filter(d => d.stageboxIdentity);
    const dimensions = ends.map(d => [d.width, d.height]);
    if (count === 4) {
      assert.ok(dimensions[0].every(n => n <= 96));
      assert.ok(dimensions[1].every(n => n < 115));
    }
    for (const end of ends) {
      assert.equal(end.connectors.length, count);
      const points = end.connectors.map(c => scene.connectorWorldPoint(end, c));
      points.forEach((p, i) => {
        assert.equal(hitTestConnector(scene, p).connector.connector.id, end.connectors[i].id);
        assert.ok(points.slice(i + 1).every(q => Math.hypot(p.x - q.x, p.y - q.y) >= 20.999));
        assert.ok(end.connectors[i].stageboxNumber > 0);
      });
    }
    const save = JSON.parse(new ProjectMutationAdapter(normalized).exportJson());
    assert.deepEqual(save.devices[1].templateOverride.stageboxSnake, project.devices[1].templateOverride.stageboxSnake);
    assert.ok(save.devices[1].templateOverride.connectors.every(c => !c.stageboxNumber));
    assert.equal(scene.getDevice("ordinary").visual.stageboxNodeOnly, undefined);
    assert.ok(scene.getDevice("ordinary").connectors.every(c => !c.stageboxNumber));
  }
});

test("rectangular ends reflow within the adjusted axis while retaining connector identities and clearance", () => {
  const min = STAGEBOX_RECTANGLE_MIN_SIZE;
  const project = stageboxNodeOnlyFixture(9, ["rectangle", "circular"]);
  const instance = project.devices[1];
  const original = normalizeAvDesignerProject(project);
  const originalEnd = original.devices.find(d => d.id === "snake");
  const draft = stageboxEndDraft(instance.templateOverride, "end-a");
  const size = (device, axis) => 2 * device.visual.stageboxNodeOnly[axis === "width" ? "halfWidth" : "halfHeight"];
  for (const axis of ["width", "height"]) {
    draft.stageboxRectangleSize = { width: size(originalEnd, "width"), height: size(originalEnd, "height"), [axis]: min + 2, axis };
    const preview = createPreviewDeviceFromDraft({ template: draft });
    assert.equal(size(preview, axis), min + 2);
    assert.equal(new Set(preview.connectors.map(c => axis === "width" ? c.x : c.y)).size, 1);
    const other = axis === "width" ? "height" : "width";
    assert.ok(size(preview, other) > size(originalEnd, other));
    const points = preview.connectors.map(c => c.anchors[0]);
    const radius = stageboxNodeHitRadius(preview, .05);
    points.forEach((p, i) => assert.ok(points.slice(i + 1).every(q => Math.hypot(p.x - q.x, p.y - q.y) > 2 * radius)));
    const edited = commitStageboxEndDraft(instance.templateOverride, "end-a", draft);
    const saved = JSON.parse(JSON.stringify({ ...project, devices: project.devices.map(item =>
      item === instance ? { ...item, templateOverride: edited } : item) }));
    assert.deepEqual(stageboxEndDraft(saved.devices[1].templateOverride, "end-a").stageboxRectangleSize, draft.stageboxRectangleSize);
    const reopened = normalizeAvDesignerProject(saved);
    const end = reopened.devices.find(d => d.id === "snake");
    assert.deepEqual(end.connectors.map(c => c.id), originalEnd.connectors.map(c => c.id));
    assert.deepEqual(reopened.wires, original.wires);
    assert.equal(size(end, axis), min + 2);
    const relative = device => device.connectors.map(c => [c.x - device.visual.stageboxNodeOnly.cx, c.y - device.visual.stageboxNodeOnly.cy]);
    assert.deepEqual(relative(end), relative(preview));
    assert.deepEqual(reopened.devices.find(d => d.stageboxIdentity?.endId === "end-b"), original.devices.find(d => d.stageboxIdentity?.endId === "end-b"));
  }
  draft.connectors[1].empty = true;
  const withSlot = createPreviewDeviceFromDraft({ template: draft });
  const slot = withSlot.visual.stageboxNodeOnly.emptySlots[0];
  draft.connectors[1].empty = false;
  const filled = createPreviewDeviceFromDraft({ template: draft });
  assert.deepEqual(filled.connectors.find(c => c.id === slot.id).anchors, slot.anchors);
});

test("editor-only empty slots share every Stagebox layout and stay put when filled", () => {
  for (const [shape, side] of [["rectangle", "end-a"], ["circular", "end-a"], ["fanout", "end-b"]]) {
    const project = stageboxNodeOnlyFixture(4, [shape, shape]);
    const template = project.devices[1].templateOverride;
    const end = template.stageboxSnake.ends.find(e => e.id === side);
    const id = end.connectorIds[1];
    const connector = template.connectors.find(c => c.id === id);
    connector.empty = true;
    template.stageboxSnake.channels = template.stageboxSnake.channels.filter(c => c.a.connectorId !== id && c.b.connectorId !== id);
    const draft = stageboxEndDraft(template, side);
    const preview = createPreviewDeviceFromDraft({ template: draft });
    const slot = preview.visual.stageboxNodeOnly.emptySlots[0];
    assert.equal(slot.id, id);
    assert.ok(!preview.connectors.some(c => c.id === id));
    assert.ok(slot.anchors[0].x > 0 && slot.anchors[0].x < preview.width);
    draft.connectors.find(c => c.id === id).empty = false;
    const filled = createPreviewDeviceFromDraft({ template: draft });
    assert.deepEqual(filled.connectors.find(c => c.id === id).anchors[0], slot.anchors[0]);
    assert.deepEqual(filled.connectors.filter(c => c.id !== id).map(c => c.anchors), preview.connectors.map(c => c.anchors));
    const main = normalizeAvDesignerProject(project).devices.find(d => d.stageboxIdentity?.endId === side);
    assert.equal(main.visual.stageboxNodeOnly.emptySlots, undefined);
    assert.ok(!main.connectors.some(c => c.id === id));
  }
});

test("all Stagebox layouts grow past 100 and fit 1,000 live nodes and empty slots", () => {
  const fixture = stageboxNodeOnlyFixture(1000).devices[1].templateOverride;
  const connectors = fixture.connectors.filter(c => c.id.startsWith("a-")).map((c, i) => ({ ...c, empty: i % 2 !== 0 }));
  for (const shape of ["rectangle", "circular", "fanout"]) {
    const template = { ...stageboxEndDraft(fixture, "end-a"), stageboxRepresentation: shape };
    const preview = count => createPreviewDeviceFromDraft({ template: { ...template, connectors: connectors.slice(0, count) } });
    const dense = preview(1000), small = preview(102);
    const layout = dense.visual.stageboxNodeOnly;
    assert.equal(small.visual.stageboxNodeOnly.shape, shape);
    assert.equal(layout.shape, shape);
    assert.equal(dense.connectors.length, 500);
    assert.equal(layout.emptySlots.length, 500);
    assert.ok(layout.halfHeight > small.visual.stageboxNodeOnly.halfHeight);
    const points = [...dense.connectors, ...layout.emptySlots].map(c => c.anchors[0]);
    if (shape === "fanout") {
      assert.equal(new Set(points.map(p => p.x)).size, 1);
      assert.equal(layout.nodeSpacing, 21);
      const scene = new SceneGraph();
      scene.setData({ devices: [dense] });
      const surface = Object.assign(Object.create(EnginePreviewSurface.prototype), {
        scene, renderer: { resolution: { width: 500, height: 400 }, resize() {} }
      });
      assert.ok(surface.fitToContent({ padding: 34 }).zoom * layout.halfHeight * 2 <= 332 + 1e-8);
    } else {
      assert.equal(stageboxNodeFillRadius(dense) + STAGEBOX_NODE_RIM * 2, legacyConnectorRadius(1) + legacyConnectorStrokeWidth(1));
      assert.equal(stageboxNodeDetailScale(dense, .05), legacyCanvasDetailScale(.05));
      const extent = stageboxNodeHitRadius(dense, .05), required = (2 * extent + 1) ** 2;
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
        assert.ok(dx * dx + dy * dy >= required - 1e-6, `${shape}: nodes ${i} and ${j} overlap`);
      }
    }
  }
});

test("Enclosed Stagebox nodes match device zoom compensation without overlap, while fanout is unchanged", () => {
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(stageboxNodeOnlyFixture(4, ["rectangle", "fanout"])));
  const ends = scene.devices.filter(d => d.stageboxIdentity);
  const [box, tails] = ends;
  for (const end of ends) assert.equal(stageboxNodeDetailScale(end, 1), 1);
  for (const zoom of [2, 1, .85, .5, .3]) {
    assert.equal(stageboxNodeDetailScale(tails, zoom), legacyCanvasDetailScale(zoom));
    const boxRadius = (stageboxNodeFillRadius(box) + STAGEBOX_NODE_RIM * 2) * stageboxNodeDetailScale(box, zoom);
    assert.ok(Math.abs(boxRadius - (legacyConnectorRadius(zoom) + legacyConnectorStrokeWidth(zoom))) < 1e-9);
  }
  const dense = new SceneGraph();
  dense.setData(normalizeAvDesignerProject(stageboxNodeOnlyFixture(100, ["rectangle", "circular"])));
  const grid = dense.devices.find(d => d.stageboxIdentity?.endId === "end-a");
  assert.equal(stageboxNodeDetailScale(grid, .2), legacyCanvasDetailScale(.2));
  const gridPoints = grid.connectors.map(c => dense.connectorWorldPoint(grid, c));
  const gridExtent = stageboxNodeHitRadius(grid, .2);
  assert.ok(gridPoints.every((p, i) =>
    gridPoints.slice(i + 1).every(q => Math.hypot(p.x - q.x, p.y - q.y) > 2 * gridExtent)));
  const gap = Math.hypot(gridPoints[0].x - gridPoints[1].x, gridPoints[0].y - gridPoints[1].y) - 2 * gridExtent;
  assert.ok(gap >= 1 && gap < 2, "Grid should only reserve the required marker clearance");
  const ring = dense.devices.find(d => d.stageboxIdentity?.endId === "end-b");
  const points = ring.connectors.map(c => dense.connectorWorldPoint(ring, c));
  const scale = stageboxNodeDetailScale(ring, .2);
  assert.equal(scale, legacyCanvasDetailScale(.2));
  assert.equal(stageboxNodeFillRadius(ring), stageboxNodeFillRadius(box));
  const minDistance = Math.min(...points.flatMap((p, i) => points.slice(i + 1).map(q => Math.hypot(p.x - q.x, p.y - q.y))));
  const ringGap = minDistance - 2 * stageboxNodeHitRadius(ring, .2);
  assert.ok(ringGap >= 1 && ringGap < 2, "Circular layout should only reserve the required marker clearance");
  const node = scene.connectorWorldPoint(tails, tails.connectors[0]);
  const edge = { x: node.x + stageboxNodeHitRadius(tails, .5) - 1, y: node.y };
  assert.equal(hitTestConnector(scene, edge, 30, 1).connector, null);
  assert.equal(hitTestConnector(scene, edge, 30, .5).connector?.connector.id, tails.connectors[0].id);
});

test("Stagebox editor fits visible content and preserves camera zoom on authored frame shifts", () => {
  const snake = stageboxNodeOnlyFixture(4).devices[1].templateOverride;
  const draft = stageboxEndDraft(snake, "end-b");
  const device = createPreviewDeviceFromDraft({ template: draft });
  const scene = new SceneGraph();
  scene.setData({ devices: [device] });
  const viewport = { width: 500, height: 400 };
  const surface = Object.assign(Object.create(EnginePreviewSurface.prototype), {
    owner: "device-editor", scene, renderer: { resolution: viewport, resize() {}, updateDirty() {} },
    camera: { x: 0, y: 0, zoom: 1 }
  });
  const fit = d => fitCameraToBounds(stageboxPreviewBounds(d), viewport.width, viewport.height, 34, { maxZoom: 3 });
  surface.fitToContent({ padding: 34, bounds: { x: 0, y: 0, width: 900, height: 1000 } });
  assert.deepEqual(surface.camera, fit(device));
  surface.camera = { x: -25, y: 43, zoom: 1.5 };
  const before = surface.worldToScreen(scene.connectorWorldPoint(scene.devices[0], scene.devices[0].connectors[0]));
  const shifted = createPreviewDeviceFromDraft({ template: { ...draft, height: draft.height + 200 } });
  surface.replaceDevice(shifted, { render: false });
  assert.deepEqual(surface.worldToScreen(scene.connectorWorldPoint(scene.devices[0], scene.devices[0].connectors[0])), before);
  assert.equal(surface.camera.zoom, 1.5);
  const grown = createPreviewDeviceFromDraft({ template: { ...draft, connectors: [...draft.connectors,
    { id: "extra-slot", empty: true, direction: "input" }] } });
  surface.replaceDevice(grown, { render: false });
  assert.deepEqual(surface.camera, fit(grown));
});

test("both signal directions use only their mapped channel and preserve every join through movement and export", async () => {
  const project = stageboxNodeOnlyFixture(4, ["rectangle", "fanout"]);
  project.devices[1].stageboxEndOffsets["end-b"].y += 110;
  const output = buildEngineOutputScene(project);
  const model = createOutputViewerModel(output);
  for (const [wireId, first, last, channelId] of [
    ["right-1", "left-1", "right-1", "ch-1"], ["left-2", "right-2", "left-2", "ch-2"]
  ]) {
    const steps = stageboxSignalPath(model.scene, { wire: model.scene.getWire(wireId) });
    assert.deepEqual(steps.map(s => s.wireId || s.part), [first, "mapping", "trunk", "mapping", last]);
    assert.deepEqual(steps.slice(1, 4).map(s => s.channelId), [channelId, channelId, channelId]);
    steps.slice(1).forEach((s, i) => assert.deepEqual(s.points[0], steps[i].points.at(-1)));
    const line = continuousStageboxPoints(steps);
    assert.deepEqual(line[0], model.scene.endpointForWire(model.scene.getWire(first), "from"));
    assert.deepEqual(line.at(-1), model.scene.endpointForWire(model.scene.getWire(last), "to"));
    assert.deepEqual(outputCableTrace(model, { type: "wire", id: wireId }).map(s => s.wireId || s.part),
      [first, "mapping", "trunk", "mapping", last]);
  }
  assert.equal(buildCableSchedule(project, { assignNumbers: "readOnly" }).length, 8);
  const drawing = renderEngineOutputSvg(output);
  assert.match(drawing.svg, />IN<\/text>/);
  assert.match(drawing.svg, />OUT<\/text>/);
  const pdf = await generatePdf({ ...drawing, engineScene: output, reportData: { projectName: "Passive snake" } });
  assert.equal(new TextDecoder().decode(pdf.bytes.subarray(0, 4)), "%PDF");
  assert.deepEqual(pdf.warnings, []);
});

test("arcs mirror vertically; inferred mirrored channels never override custom contacts or guess ambiguous pins", () => {
  const trunk = { x: 90, y: 0 };
  const up = stageboxTrunkArc({ x: 0, y: -20 }, trunk);
  const down = stageboxTrunkArc({ x: 0, y: 20 }, trunk);
  up.forEach((p, i) => {
    assert.equal(p.x, down[i].x);
    assert.ok(Math.abs(p.y + down[i].y) < 1e-8);
  });
  assert.deepEqual(stageboxTrunkArc({ x: 0, y: 0 }, trunk), [{ x: 0, y: 0 }, trunk]);
  const project = stageboxNodeOnlyFixture();
  const channels = project.devices[1].templateOverride.stageboxSnake.channels;
  channels.pop();
  channels.push({ id: "multipin-extra", a: { connectorId: "a-1", contact: "2" }, b: { connectorId: "b-3" } });
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  assert.equal(stageboxSignalPath(scene, { wire: scene.getWire("left-1") }).length, 0);
  const inferred = stageboxSignalPath(scene, { wire: scene.getWire("left-4") });
  assert.deepEqual(inferred.map(s => s.wireId || s.part), ["right-4", "mapping", "trunk", "mapping", "left-4"]);
  assert.match(inferred[1].channelId, /^mirrored:/);
});
