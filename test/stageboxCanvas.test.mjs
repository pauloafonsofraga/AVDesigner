import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStageboxSnake, assignStageboxConnector, setStageboxChannel } from "../src/engine/stageboxSnake.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";
import { buildCableSchedule, signalChainForWire } from "../src/engine/cableSchedule.js";
import { captureTopologyState, createTopologyCommand, createTopologyReplayState, replayTopologyCommand } from "../src/engine/topologyCommandProtocol.js";

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

test("End B moves independently and reloads with its original cable endpoint", () => {
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
