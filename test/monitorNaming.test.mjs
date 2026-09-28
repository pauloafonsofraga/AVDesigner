import test from "node:test";
import assert from "node:assert/strict";
import { monitorNameUpdates } from "../src/engine/monitorNaming.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

function fixture() {
  const project = cableTypeSelectionFixture();
  project.devices[0].name = "Playback";
  const monitor = project.devices[1];
  monitor.name = monitor.templateOverride.name = "Monitor";
  monitor.templateOverride.category = "Monitors";
  const resolve = () => {
    const scene = normalizeAvDesignerProject(project);
    return monitorNameUpdates(scene.devices, scene.wires, project.devices);
  };
  const apply = () => {
    const patches = resolve();
    for (const { id, ...fields } of patches) Object.assign(project.devices.find(d => d.instanceId === id), fields);
    return patches;
  };
  return { project, monitor, resolve, apply };
}

test("monitors derive a persisted editable name from their video source without mutating inputs", () => {
  const { project, monitor, resolve, apply } = fixture();
  const before = structuredClone(project);
  assert.deepEqual(resolve(), [{ id: "sink", name: "Playback Monitor", autoMonitorName: "Playback Monitor" }]);
  assert.deepEqual(project, before);
  apply(); assert.equal(monitor.name, "Playback Monitor"); assert.deepEqual(resolve(), []);
  project.devices[0].name = "Backup"; apply(); assert.equal(monitor.name, "Backup Monitor");
  monitor.name = "Stage Left"; project.devices[0].name = "Camera";
  assert.deepEqual(resolve(), []); assert.equal(monitor.name, "Stage Left");
  monitor.name = monitor.autoMonitorName; apply(); assert.equal(monitor.name, "Camera Monitor", "undoing the manual rename restores automatic naming");
});

test("disconnect/undo, rewire, reload and custom instance names retain the naming policy", () => {
  const { project, monitor, apply } = fixture();
  apply(); const wires = project.connections; project.connections = [];
  apply(); assert.equal(monitor.name, "Monitor");
  project.connections = wires; apply(); assert.equal(monitor.name, "Playback Monitor");
  const reloaded = JSON.parse(JSON.stringify(project)), scene = normalizeAvDesignerProject(reloaded);
  assert.deepEqual(monitorNameUpdates(scene.devices, scene.wires, reloaded.devices), []);
  monitor.name = "Director"; project.connections = []; apply(); assert.equal(monitor.name, "Director");
  delete monitor.autoMonitorName; project.connections = wires; apply(); assert.equal(monitor.name, "Director");
});

test("power/control connections and outputs cannot rename monitors; cable storage direction does not matter", () => {
  for (const type of ["iec", "rs-232", "cat6", "barrel-jack"]) {
    const { project, monitor, apply } = fixture();
    monitor.templateOverride.connectors.forEach(c => { c.type = type; });
    apply(); assert.equal(monitor.name, "Monitor", type);
  }
  const { project, monitor, apply } = fixture();
  project.connections.forEach(w => { [w.from, w.to] = [w.to, w.from]; });
  apply(); assert.equal(monitor.name, "Playback Monitor");
  monitor.templateOverride.connectors.forEach(c => { c.signalDirection = "output"; });
  apply(); assert.equal(monitor.name, "Monitor");
});

test("multiple sources are deterministic; monitor chains resolve and cycles do not grow names", () => {
  const { project, monitor, apply, resolve } = fixture();
  const other = structuredClone(project.devices[0]); other.instanceId = "other"; other.name = "Second";
  project.devices.push(other); project.connections[1].from.deviceId = "other";
  assert.deepEqual(resolve(), resolve());
  project.connections.reverse(); apply(); assert.equal(monitor.name, "Playback Monitor");
  const next = structuredClone(monitor); next.instanceId = "next"; next.name = "Monitor"; delete next.autoMonitorName;
  project.devices.push(next);
  project.connections.push({ id: "next-wire", cableType: "hdmi", from: { deviceId: "sink", connectorId: "port-0" }, to: { deviceId: "next", connectorId: "port-0" } });
  apply(); assert.equal(next.name, "Playback Monitor Monitor");
  project.connections = project.connections.filter(w => w.id === "next-wire");
  project.connections.push({ id: "cycle", cableType: "hdmi", from: { deviceId: "next", connectorId: "port-1" }, to: { deviceId: "sink", connectorId: "port-1" } });
  assert.deepEqual(resolve(), []);
});
