import assert from "node:assert/strict";
import test from "node:test";

import {
  createRackPatchPanel,
  nextRackPatchPanelSlot,
  normalizeRackPatchPanels,
  rackPatchPanelCapacity,
  rackPatchPanelPortForSource,
  rackPatchPanelPortWorldPoint,
  rackPatchPanelVisualHeight,
  removeRackPatchPanelSource,
  resolveRackPatchPanelPort
} from "../src/engine/rackPatchPanels.js";
import { createRackPreviewScene } from "../src/engine/rackPreview.js";
import { enginePreviewFixtureDefinitions } from "../src/engine/enginePreviewFixtures.js";

test("legacy rack definitions normalize to no patch panels", () => {
  assert.deepEqual(normalizeRackPatchPanels(undefined), []);
  assert.deepEqual(normalizeRackPatchPanels(null), []);
});

test("patch panel persists identity, label, face, side, position and stable proxy ports", () => {
  const panel = createRackPatchPanel({
    id: "pp-main", label: "VIDEO PATCH", x: 780, y: 120,
    rackFace: "front", placementSide: "left"
  });
  panel.ports.push({
    id: "port-hdmi-a", slot: 3,
    sourceRackDeviceId: "processor-1", sourceConnectorId: "hdmi-out-1"
  });
  const [restored] = normalizeRackPatchPanels([panel]);
  assert.deepEqual(restored, panel);
  assert.equal(restored.id, "pp-main");
  assert.equal(restored.label, "VIDEO PATCH");
  assert.equal(restored.rackFace, "front");
  assert.equal(restored.placementSide, "left");
  assert.equal(restored.ports[0].id, "port-hdmi-a");
  assert.equal(restored.ports[0].slot, 3);
});

test("capacity starts at eight, grows without truncation, and visual height follows the slots", () => {
  const panel = createRackPatchPanel({ id: "pp-capacity" });
  assert.equal(rackPatchPanelCapacity(panel), 8);
  for (let slot = 1; slot <= 8; slot += 1) panel.ports.push({ id: `p${slot}`, slot });
  assert.equal(rackPatchPanelCapacity(panel), 8);
  panel.ports.push({ id: "p9", slot: 9 });
  assert.equal(rackPatchPanelCapacity(panel), 9);
  panel.ports.push({ id: "p12", slot: 12 });
  assert.equal(rackPatchPanelCapacity(panel), 12);
  assert.ok(rackPatchPanelVisualHeight(panel) > rackPatchPanelVisualHeight({ ...panel, ports: panel.ports.slice(0, 8) }));
});

test("slot allocation preserves existing slot numbers and reuses the first available hole", () => {
  const panel = { ports: [1, 2, 3, 5, 6, 7, 8].map(slot => ({ id: `p${slot}`, slot })) };
  const before = panel.ports.map(port => [port.id, port.slot]);
  assert.equal(nextRackPatchPanelSlot(panel), 4);
  assert.deepEqual(panel.ports.map(port => [port.id, port.slot]), before);
  panel.ports.push({ id: "p4b", slot: nextRackPatchPanelSlot(panel) });
  assert.equal(nextRackPatchPanelSlot(panel), 9);
});

test("port semantics always resolve live from the referenced connector", () => {
  const panel = { id: "pp", ports: [] };
  const port = { id: "port", slot: 1, sourceRackDeviceId: "device", sourceConnectorId: "connector" };
  const current = { type: "hdmi", compatibilityType: "video", physicalType: "HDMI", color: "#f0c000", fiberMode: "single-mode" };
  const resolve = () => current;
  assert.equal(resolveRackPatchPanelPort(panel, port, resolve).connector.type, "hdmi");
  current.type = "sdi";
  current.compatibilityType = "sdi-video";
  const changed = resolveRackPatchPanelPort(panel, port, resolve);
  assert.equal(changed.connector.type, "sdi");
  assert.equal(changed.connector.compatibilityType, "sdi-video");
  assert.equal(resolveRackPatchPanelPort(panel, port, () => null).resolved, false);
  assert.equal(resolveRackPatchPanelPort(panel, port, () => null).sourceConnectorId, "connector");
});

test("source connectors are uniquely discoverable across panels", () => {
  const panels = [{ id: "a", ports: [{ id: "pa", sourceRackDeviceId: "d1", sourceConnectorId: "c1" }] }];
  assert.equal(rackPatchPanelPortForSource(panels, "d1", "c1").panel.id, "a");
  assert.equal(rackPatchPanelPortForSource(panels, "d2", "c1"), null);
});

test("transferring a proxy to direct exposure removes only that port", () => {
  const panels = [{ id: "a", ports: [
    { id: "pa", sourceRackDeviceId: "d1", sourceConnectorId: "c1", slot: 1 },
    { id: "pb", sourceRackDeviceId: "d1", sourceConnectorId: "c2", slot: 2 }
  ] }];
  const result = removeRackPatchPanelSource(panels, "d1", "c1");
  assert.equal(result.removed, true);
  assert.deepEqual(result.panels[0].ports.map(port => [port.id, port.slot]), [["pb", 2]]);
  assert.deepEqual(panels[0].ports.map(port => port.id), ["pa", "pb"]);
});

test("patch panel preview metadata is retained without creating ordinary Engine wires", () => {
  const fixture = enginePreviewFixtureDefinitions()[0];
  const panel = {
    id: "pp-preview", label: "HDMI PATCH", x: 1000, y: 200,
    rackFace: "rear", placementSide: "right", baseCapacity: 8,
    ports: [{ id: "pp-port-1", slot: 1, sourceRackDeviceId: "child-1", sourceConnectorId: "connector-1" }]
  };
  const device = { instanceId: "child-1", templateId: fixture.template.id,
    templateOverride: fixture.template, name: fixture.template.name, x: 80, y: 120 };
  panel.ports[0].sourceConnectorId = fixture.template.connectors[0].id;
  const rack = { id: "rack-with-patch", name: "Rack", devices: [device], internalConnections: [], exposedPorts: [], patchPanels: [panel] };
  const scene = createRackPreviewScene({ rack, deviceLibrary: [fixture.template], nodeLibrary: [] });
  assert.equal(scene.devices.length, 1);
  assert.equal(scene.wires.length, 0);
  assert.deepEqual(scene.meta.rackPreview.patchPanels, [panel]);
  assert.equal(scene.meta.rackPreview.patchPanelPortCount, 1);
});

test("an empty rack can render its first patch panel as Engine rack geometry", () => {
  const scene = createRackPreviewScene({ rack: {
    id: "empty-panel-rack", name: "Empty", devices: [], internalConnections: [], exposedPorts: [],
    patchPanels: [{ id: "pp-first", label: "FIRST", x: 400, y: 80, baseCapacity: 8, ports: [] }]
  } });
  assert.equal(scene.devices.length, 0);
  assert.equal(scene.racks.length, 1);
  assert.equal(scene.racks[0].boundsFinite, true);
  assert.ok(scene.racks[0].bounds.x <= 400);
});

test("patch panel ports remain a single-row physical proxy point", () => {
  const panel = { x: 400, y: 50, placementSide: "right", baseCapacity: 8, ports: [] };
  assert.deepEqual(rackPatchPanelPortWorldPoint(panel, { slot: 2 }), { x: 460, y: 112, capacity: 8 });
  assert.deepEqual(rackPatchPanelPortWorldPoint({ ...panel, placementSide: "left" }, { slot: 2 }), { x: 460, y: 112, capacity: 8 });
});
