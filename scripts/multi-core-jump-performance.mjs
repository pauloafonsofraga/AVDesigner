import assert from "node:assert/strict";
import { largeMultiCoreProject } from "../fixtures/multi-core.mjs";
import { connectedMultiCoreProject, multiCorePort } from "../fixtures/multi-core-connectivity.mjs";
import { attachMultiCoreJump } from "../src/engine/multiCoreJumpRouting.js";
import { validateMultiCoreEdit } from "../src/engine/multiCoreEditValidation.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { DragSession } from "../src/engine/dragSession.js";
import { jumpNodeConnectionInfo } from "../src/engine/jumpNodeModel.js";
import { createMultiCoreConnectivity, traceMultiCoreSignalPath } from "../src/engine/multiCoreConnectivity.js";

const measurements = [];
for (const channels of [8, 16, 32, 64]) {
  const project = largeMultiCoreProject(channels);
  const connected = connectedMultiCoreProject();
  project.devices = connected.devices; project.connections = connected.connections;
  project.connections[0].to = multiCorePort(project, "A");
  project.connections[1].from = multiCorePort(project, "B");
  project.jumpNodes = [{ id: "gateway-a", x: 500, y: 800 }, { id: "gateway-b", x: 1500, y: 800 }];
  project.jumpLinks = [{ id: "pair", outputJumpId: "gateway-a", inputJumpId: "gateway-b", deviceIndependent: true }];
  const after = structuredClone(project); after.multiCores[0] = attachMultiCoreJump(after.multiCores[0], "gateway-a");
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(after));
  const wires = scene.wires.filter(w => w.multiCoreIdentity), graph = createMultiCoreConnectivity(after);
  const path = traceMultiCoreSignalPath(graph, "patch-3m");
  assert(path.valid); assert.deepEqual(path.externalCableIds, ["patch-3m", "patch-2m"]);
  assert.equal(path.segments.filter(s => s.kind === "multi-core-passive-channel").length, 1);
  const operations = {
    association: () => assert(validateMultiCoreEdit(project, after).valid),
    regeneration: () => { const s = new SceneGraph(); s.setData(normalizeAvDesignerProject(after)); },
    hover: () => jumpNodeConnectionInfo(scene, "gateway-a"),
    signalLookup: () => traceMultiCoreSignalPath(graph, "patch-3m")
  };
  for (const [label, ids] of [["section", [wires[0].fromDeviceId, wires[0].toDeviceId]], ["gateway", ["gateway-a"]],
    ["endA", [wires[0].fromDeviceId]], ["endB", [wires[1].toDeviceId]]]) {
    const drag = new DragSession({ scene, selectedIds: ids, startWorld: { x: 0, y: 0 } });
    operations[label] = () => { drag.update({ x: 60, y: 40 }, { snappingEnabled: false });
      for (const id of drag.affectedWireIds) scene.wireRenderPolyline(scene.getWire(id), drag.offsetMap()); };
  }
  wires[0].routePoints = [{ id: "route-perf", x: 400, y: 700 }];
  let i = 0;
  operations.routePoint = () => { scene.moveRoutePoint(wires[0].id, 0, 400 + ++i, 700); scene.wireRenderPolyline(wires[0]); };
  for (const [operation, run] of Object.entries(operations)) {
    const samples = [];
    for (let sample = 0; sample < 35; sample++) { const start = performance.now(); run(); if (sample >= 5) samples.push(performance.now() - start); }
    samples.sort((a, b) => a - b);
    measurements.push({ channels, operation, medianMs: +samples[15].toFixed(3), p95Ms: +samples[28].toFixed(3) });
  }
}
console.log(JSON.stringify({ runtime: process.version, measurements }, null, 2));
