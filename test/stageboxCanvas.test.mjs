import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStageboxSnake, assignStageboxConnector, setStageboxChannel, stageboxEndDraft } from "../src/engine/stageboxSnake.js";
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
import { stageboxTrunkArc } from "../src/engine/stageboxNodeGeometry.js";
import { hitTestConnector } from "../src/engine/hitTest.js";
import { generatePdf } from "../src/engine/outputPdf.js";
import { createPreviewDeviceFromDraft } from "../src/engine/enginePreview.js";

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

test("automatic rectangular and circular ends use compact live anchors without changing canonical definitions", () => {
  for (const count of [4, 9, 16, 32, 100]) {
    const project = stageboxNodeOnlyFixture(count);
    const scene = new SceneGraph();
    const normalized = normalizeAvDesignerProject(project);
    scene.setData(normalized);
    const ends = scene.devices.filter(d => d.stageboxIdentity);
    const dimensions = ends.map(d => [d.width, d.height]);
    if (count === 4) {
      assert.ok(dimensions[0].every(n => n <= 53));
      assert.ok(dimensions[1].every(n => n < 60));
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
