import assert from "node:assert/strict";
import test from "node:test";
import * as routing from "../src/engine/orthogonalRouting.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { createTopologyCommand, createTopologyReplayState, replayTopologyCommand } from "../src/engine/topologyCommandProtocol.js";
import { addWireRoutePoint, removeWireRoutePoint } from "../src/engine/wireRouteEditing.js";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const p = (x, y, id) => ({ x, y, ...(id ? { id } : {}) });
const xy = ({ x, y }) => ({ x, y });
const assertOrthogonal = points => points.slice(1).forEach((point, i) =>
  assert.ok(point.x === points[i].x || point.y === points[i].y));
function sceneFor(project) {
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  return scene;
}

function fixture() {
  const project = cableTypeSelectionFixture();
  project.wireMode = "orthogonal";
  project.devices[1].y = 160;
  project.connections = project.connections.slice(0, 1);
  Object.assign(project.connections[0], {
    routeStyle: "orthogonal", manualRoute: true, manualRouteStyle: "orthogonal",
    routePoints: [p(425, 170, "a"), p(425, 230, "b"), p(640, 230, "c"), p(640, 330, "d")]
  });
  return project;
}

test("ordinary replug shares its anchored path across preview, persistence and collaboration replay", async () => {
  const project = fixture();
  const spare = { ...structuredClone(project.devices[1]), instanceId: "spare", x: 650, y: -180 };
  project.devices.push(spare);
  const scene = sceneFor(project);
  const original = scene.getWire("cable-0");
  const before = structuredClone(original.routePoints);
  const preview = scene.previewOrthogonalRewire(original, "to", spare.instanceId, "port-0", "left");
  assert.deepEqual(original.routePoints, before);
  const updated = scene.rewireWireEndpoint(original.id, "to", spare.instanceId, "port-0", "left");
  assert.deepEqual(scene.wirePoints(updated).map(xy), [preview.from, ...preview.routePoints, preview.to].map(xy));
  assert.deepEqual(updated.routePoints.filter(point => point.id).map(point => point.id), ["a", "b", "c", "d"]);
  assert.deepEqual(updated.routePoints.slice(0, 3), before.slice(0, 3));
  assert.equal(updated.toAnchorId, "left");
  const points = scene.wirePoints(updated);
  assertOrthogonal(points);
  assert.ok(points.at(-1).x - points.at(-2).x >= routing.ORTHOGONAL_EXIT_OFFSET);
  const mutations = new ProjectMutationAdapter({ projectData: project }, { cloneProjectData: false });
  const beforeProject = structuredClone(project);
  mutations.commitRewiredWire(scene, updated.id, null, { routeChanged: true });
  const reopened = sceneFor(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(reopened.getWire(updated.id).routePoints, updated.routePoints);
  assert.deepEqual(reopened.wirePoints(reopened.getWire(updated.id)), points);
  const state = createTopologyReplayState("orthogonal-rewire");
  const command = await createTopologyCommand(beforeProject, project, { state, intent: "rewire endpoint" });
  assert.deepEqual(command.changes.map(({ collection, id }) => [collection, id]), [["connections", updated.id]]);
  const replayed = await replayTopologyCommand(beforeProject, command, state);
  const remote = sceneFor(replayed.project);
  assert.deepEqual(remote.getWire(updated.id).routePoints, updated.routePoints);
  assert.deepEqual(remote.wirePoints(remote.getWire(updated.id)), points);
});

test("crossing the opposite endpoint keeps the dock outward and far bends intact", () => {
  const scene = sceneFor(fixture());
  const wire = scene.getWire("cable-0"), before = wire.routePoints.slice(0, 2);
  const offsets = new Map([["sink", { dx: -650, dy: 385 }]]);
  const preview = scene.wirePoints(wire, offsets);
  scene.moveDevicesBy(["sink"], -650, 385);
  const points = scene.wirePoints(wire);
  assert.deepEqual(points, preview);
  assert.deepEqual(wire.routePoints.slice(0, 2), before);
  assert.ok(points.at(-1).x - points.at(-2).x >= routing.ORTHOGONAL_EXIT_OFFSET);
  assertOrthogonal(points);
});

for (const side of ["top", "bottom"]) test(`a declared ${side} anchor retains its identity and exits vertically`, () => {
  const project = fixture();
  const port = project.devices[1].templateOverride.connectors[0];
  const y = side === "top" ? 0 : project.devices[1].templateOverride.height;
  port.anchors = [{ id: side, side, x: 120, y }];
  port.primaryAnchorId = side;
  project.connections[0].to.anchorId = side;
  const scene = sceneFor(project);
  const wire = scene.getWire("cable-0");
  assert.equal(wire.toAnchorId, side);
  assert.deepEqual(scene.orthogonalSocketDirection(wire, "to"), { x: 0, y: side === "top" ? -1 : 1 });
  scene.moveDevicesBy(["sink"], 80, 200);
  const points = scene.wirePoints(wire), end = points.at(-1), dock = points.at(-2);
  assertOrthogonal(points);
  assert.equal(end.x, dock.x);
  assert.ok((dock.y - end.y) * (side === "top" ? -1 : 1) >= routing.ORTHOGONAL_EXIT_OFFSET);
});

test("segment and corner edits retain identities and remote subpixel points", () => {
  const routePoints = [p(30.2, 0, "a"), p(30.2, 20.4, "b"), p(65, 20.4, "c"), p(65, 50, "d")];
  const model = routing.createOrthogonalRouteModel({ from: p(0, 0), to: p(120, 50), routePoints, preserveRoutePoints: true });
  for (const edit of [model.moveSegment(3, 72), model.moveCorner(2, p(72, 22))]) {
    assert.deepEqual(edit.routePoints.map(point => point.id), ["a", "b", "c", "d"]);
    assert.deepEqual(edit.routePoints[0], routePoints[0]);
  }
});

test("existing corner commands don't compact a distant authored reversal", () => {
  const points = [p(35, 0, "a"), p(72, 0, "b"), p(55, 0, "c"), p(90, 0, "d"), p(97, 0, "e"),
    p(97, 50, "f")];
  const options = { wire: { id: "routed", routeStyle: "orthogonal", routePoints: points }, from: p(0, 0), to: p(150, 50),
    preserveRoutePoints: true };
  const inserted = addWireRoutePoint({ ...options, segmentIndex: 6, nearestPoint: p(120, 50) });
  const removed = removeWireRoutePoint({ ...options, pointIndex: 5 });
  assert.deepEqual(inserted.routePoints.slice(0, 5), points.slice(0, 5));
  assert.deepEqual(removed.routePoints.slice(0, 5), points.slice(0, 5));
});

test("route cleanup cannot alter remote backtracking or erase identified bends", () => {
  const points = [p(550, 170, "remote"), p(400, 170), p(400, 230), p(635, 230), p(635, 330),
    p(710, 330), p(714, 330, "kept")];
  const cleaned = routing.cleanEditedOrthogonalSegment(points, p(266, 170), p(774, 330), 4);
  assert.deepEqual(cleaned.slice(0, 3), points.slice(0, 3));
  assert.ok(cleaned.some(point => point.id === "kept"));
  assert.equal(cleaned.length, points.length - 1);
  assert.equal(routing.sameOrthogonalRouteGeometry([p(0, 0), p(10, 0), p(4, 0)], [p(0, 0), p(4, 0)]), false);
});

test("effective no-op comparison ignores redundancy but distinguishes a moved leg", () => {
  const before = [p(0, 0), p(30, 0), p(30, 10), p(60, 10)];
  assert.equal(routing.sameOrthogonalRouteGeometry(before, [p(0, 0), p(20, 0), ...before.slice(1)]), true);
  assert.equal(routing.sameOrthogonalRouteGeometry(before, [p(0, 0), p(31, 0), p(31, 10), p(60, 10)]), false);
});
