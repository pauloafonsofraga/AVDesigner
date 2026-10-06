import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";
import { buildCableSchedule, cableFamily, cableScheduleCsv, cableScheduleFilterOptions,
  cableScheduleVisibleRowIndexes, ensureCableNumbers, signalChainForWire,
  signalChainsForConnector, signalChainsForPatchPort, groupedCables } from "../src/engine/cableSchedule.js";
import { createCableScheduleXlsx } from "../src/engine/cableScheduleXlsx.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { loomCableLengthWarnings, validateEngineScene } from "../src/engine/sceneValidation.js";

function project() {
  const names = ["Source", "Destination"];
  return {
    devices: names.map((name, index) => ({
      instanceId: `device-${index}`, name, templateOverride: {
        id: `template-${index}`, name, connectors: [{
          id: "port", type: "sdi", nameText: index ? "SDI In" : "SDI Out", direction: index ? "input" : "output"
        }]
      }
    })),
    connections: [{ id: "wire-1", cableType: "sdi", length: "12 m", loom: "FOH-01",
      notes: "One, two\nThree", from: { deviceId: "device-0", connectorId: "port" },
      to: { deviceId: "device-1", connectorId: "port" } }],
    racks: [], cableNumberCounters: {}
  };
}

function addPatchPresentation(data, { rackId, rackName, panelId, panelLabel, portId, slot, deviceId, sourceRackDeviceId }) {
  data.racks ||= [];
  const sourceRackId = `${rackId}-definition`;
  data.racks.push(
    { id: sourceRackId, name: rackName, patchPanels: [{ id: panelId, label: panelLabel, rackFace: "rear",
      placementSide: "right", ports: [{ id: portId, slot, sourceRackDeviceId, sourceConnectorId: "port" }] }] },
    { id: rackId, name: rackName, sourceRackId, canvasInstance: true,
      sourceDeviceMap: { [sourceRackDeviceId]: deviceId }, patchPanels: [] }
  );
  const device = data.devices.find(item => item.instanceId === deviceId);
  device.rackId = rackId;
  device.sourceRackDeviceId = sourceRackDeviceId;
  return { rackId, patchPanelId: panelId, patchPortId: portId };
}

function addSourcePatch(data) {
  return addPatchPresentation(data, { rackId: "foh", rackName: "FOH Rack", panelId: "panel-foh",
    panelLabel: "VIDEO PATCH", portId: "port-foh-3", slot: 3, deviceId: "device-0", sourceRackDeviceId: "source-0" });
}

function addDestinationPatch(data) {
  return addPatchPresentation(data, { rackId: "stage", rackName: "Stage Rack", panelId: "panel-stage",
    panelLabel: "VIDEO PATCH", portId: "port-stage-5", slot: 5, deviceId: "device-1", sourceRackDeviceId: "source-1" });
}

test("direct cable derives current endpoint labels and persisted metadata", () => {
  const data = project(), [row] = buildCableSchedule(data);
  assert.deepEqual([row.cableNumber, row.sourceDevice, row.sourcePort, row.destinationDevice,
    row.destinationPort, row.signal, row.length, row.loom, row.notes, row.wireIds],
  ["V-001", "Source", "SDI Out", "Destination", "SDI In", "Video", "12 m", "FOH-01", "One, two\nThree", ["wire-1"]]);
  assert.equal(data.connections[0].cableNumber, "V-001");
  data.devices[0].name = 'Device "A", Main';
  data.devices[0].templateOverride.connectors[0].nameText = "Program Out";
  data.connections[0].to = { deviceId: "device-0", connectorId: "port" };
  const [changed] = buildCableSchedule(data);
  assert.equal(changed.cableNumber, "V-001");
  assert.equal(changed.sourceDevice, 'Device "A", Main');
  assert.equal(changed.sourcePort, "Program Out");
  assert.equal(changed.destinationDevice, 'Device "A", Main');
  assert.match(cableScheduleCsv([changed]), /"Device ""A"", Main"/);
  assert.match(cableScheduleCsv([changed]), /"One, two\nThree"/);
});

test("loom schedule Notes are derived dynamically without mutating cable notes", () => {
  const data = project();
  const loom = { id: "loom-1", name: "LM-001", origin: "FOH", destination: "Stage Rack", trunkLength: "75 m" };
  data.looms = [loom];
  data.connections[0].loomId = loom.id;
  const before = data.connections[0].notes;
  assert.equal(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes,
    "One, two\nThree\nLoom: LM-001 — FOH → Stage Rack\nLoom length: 75 m — Derived from LM-001");
  assert.equal(data.connections[0].notes, before);
  data.connections[0].length = "";
  const derivedLength = buildCableSchedule(data, { assignNumbers: "readOnly" })[0];
  assert.equal(derivedLength.length, "75 m — Derived from LM-001");
  assert.equal(data.connections[0].length, "", "derived loom length never persists into the cable field");
  data.connections[0].length = "90 m";
  assert.equal(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes,
    "One, two\nThree\nLoom: LM-001 — FOH → Stage Rack\nLoom length: 75 m — Derived from LM-001");
  loom.trunkLength = "80 m";
  assert.match(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes, /Loom length: 80 m — Derived from LM-001/);
  assert.equal(data.connections[0].length, "90 m", "loom edits do not change cable length");
  loom.name = "LM-009";
  assert.match(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes, /Derived from LM-009/);
  loom.origin = "";
  assert.match(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes, /Loom: LM-009\n/);
  loom.origin = "FOH";
  loom.destination = "";
  assert.match(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes, /Loom: LM-009\n/);
  loom.destination = "Stage Rack";
  loom.trunkLength = "";
  assert.doesNotMatch(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes, /Loom length:/);
  data.connections[0].length = "";
  assert.equal(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].length, "");
  data.connections[0].length = "12 m";
  for (const [partial, expected] of [
    [{ name: "LM-partial" }, "Loom: LM-partial"],
    [{ name: "LM-partial", trunkLength: "12 m" }, "Loom: LM-partial\nLoom length: 12 m — Derived from LM-partial"],
    [{ name: "LM-partial", origin: "FOH", destination: "Stage" }, "Loom: LM-partial — FOH → Stage"]
  ]) {
    data.looms[0] = { id: "loom-1", ...partial };
    assert.equal(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes, `${before}\n${expected}`);
  }
  data.connections[0].loomId = "";
  assert.equal(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes, before,
    "removing membership removes all derived text");
});

test("loom cable-length validation warns only for known comparable values and never blocks", () => {
  const data = project();
  data.looms = [{ id: "loom-1", name: "LM-001", trunkLength: "75 m" }];
  data.connections[0].loomId = "loom-1";
  data.connections[0].cableNumber = "V-014";
  data.connections[0].length = "50 m";
  assert.deepEqual(loomCableLengthWarnings(data),
    ["Cable V-014 is 50 m but Loom LM-001 has a 75 m common run."]);
  const validation = validateEngineScene({ devices: [], wires: [], selectedIds: new Set(),
    selectedWireIds: new Set(), selectedConnectorKeys: new Set(), selectedRoutePointKeys: new Set() },
  { ...data, devices: [], connections: structuredClone(data.connections) });
  assert.equal(validation.ok, true, "short-cable finding is a warning, not a blocking validation error");
  assert.ok(validation.warnings.some(message => message.includes("Cable V-014 is 50 m")));
  data.connections[0].length = "90 m";
  assert.deepEqual(loomCableLengthWarnings(data), []);
  data.connections[0].length = "as installed";
  assert.deepEqual(loomCableLengthWarnings(data), []);
  data.connections[0].length = "50 m";
  data.looms[0].trunkLength = "75 bananas";
  assert.deepEqual(loomCableLengthWarnings(data), []);
});

test("origin and destination survive project normalization without changing gateway identities", () => {
  const data = project();
  data.looms = [{ id: "loom-1", name: "LM-001", origin: "FOH", destination: "Stage Rack",
    sideA: { label: "Gateway A", x: 3, y: 4 }, sideB: { label: "Gateway B", x: 5, y: 6 }, trunkLength: "75 m" }];
  const normalized = normalizeAvDesignerProject(data);
  assert.deepEqual([normalized.looms[0].origin, normalized.looms[0].destination, normalized.looms[0].trunkLength,
    normalized.looms[0].sideA.label, normalized.looms[0].sideB.label],
  ["FOH", "Stage Rack", "75 m", "Gateway A", "Gateway B"]);
});

test("families, stable numbering, high-water marks and family changes", () => {
  const data = project();
  data.connections = ["sdi", "hdmi", "cat6", "xlr-3pin", "fiber-lc", "powercon", "other"].map((cableType, index) => ({
    ...structuredClone(data.connections[0]), id: `wire-${index}`, cableType
  }));
  ensureCableNumbers(data);
  assert.deepEqual(data.connections.map(wire => wire.cableNumber),
    ["V-001", "V-002", "N-001", "A-001", "F-001", "P-001", "X-001"]);
  data.connections.splice(0, 1);
  data.connections.push({ ...structuredClone(data.connections[0]), id: "new-video", cableNumber: "" });
  ensureCableNumbers(data);
  assert.equal(data.connections.at(-1).cableNumber, "V-003");
  data.connections[0].cableType = "cat6";
  ensureCableNumbers(data);
  assert.equal(data.connections[0].cableNumber, "N-002");
  assert.equal(data.connections[1].cableNumber, "N-001");
  const reloaded = JSON.parse(JSON.stringify(data));
  ensureCableNumbers(reloaded);
  assert.deepEqual(reloaded.connections.map(wire => wire.cableNumber), data.connections.map(wire => wire.cableNumber));
  assert.equal(reloaded.connections[0].loom, "FOH-01");
  assert.equal(reloaded.cableNumberCounters.V, 3);
  assert.equal(cableFamily("unknown"), "X");
});

test("lighting cables use L numbers without treating every XLR or loom member as lighting", () => {
  const data = project();
  data.devices.forEach(device => { device.templateOverride.connectors[0].type = "dmx-5pin"; });
  data.connections[0].cableType = "xlr-5pin";
  const [first] = buildCableSchedule(data);
  assert.equal(first.cableNumber, "L-001");
  assert.equal(first.signal, "Lighting");
  assert.equal(first.loom, "FOH-01");
  data.connections[0].cableNumber = "L-009";
  data.connections.push({ ...structuredClone(data.connections[0]), id: "wire-2", cableNumber: "", loomId: "loom-1" });
  data.looms = [{ id: "loom-1", name: "LM-001" }];
  assert.deepEqual(buildCableSchedule(data).map(row => row.cableNumber), ["L-009", "L-010"]);
  assert.equal(data.cableNumberCounters.L, 10);
  assert.equal(buildCableSchedule(data)[1].loom, "LM-001");
  data.devices.forEach(device => { device.templateOverride.connectors[0].type = "xlr-5pin"; });
  data.connections[1].cableType = "xlr-5pin";
  assert.equal(buildCableSchedule(data)[0].signal, "Audio");
  assert.equal(cableFamily("dmx-3pin"), "L");
  assert.equal(cableFamily("custom-lx", [{ id: "custom-lx", compatibilityType: "xlr-5pin", tags: ["lighting"] }]), "L");
});

test("old project numbering is deterministic without changing connection data", () => {
  const data = project();
  data.connections.push({ ...structuredClone(data.connections[0]), id: "wire-2", cableNumber: "V-009" });
  const first = structuredClone(data), second = structuredClone(data);
  ensureCableNumbers(first); ensureCableNumbers(second);
  assert.deepEqual(first, second);
  assert.deepEqual(first.connections.map(wire => wire.cableNumber), ["V-010", "V-009"]);
});

test("rack locations use explicit memberships only", () => {
  const data = project();
  data.racks = [{ id: "r1", name: "FOH Rack" }, { id: "r2", name: "Stage Rack" }];
  data.devices[0].rackId = "r1";
  assert.equal(buildCableSchedule(data)[0].rackLocation, "FOH Rack →");
  data.devices[1].rackId = "r2";
  assert.equal(buildCableSchedule(data)[0].rackLocation, "FOH Rack → Stage Rack");
  data.devices[0].rackId = "r2";
  assert.equal(buildCableSchedule(data)[0].rackLocation, "Stage Rack");
});

test("one patched endpoint reports physical termination and keeps real semantic connector data", () => {
  const data = project();
  data.connections[0].from = { deviceId: "device-0", connectorId: "port", ...addSourcePatch(data) };
  const [row] = buildCableSchedule(data, { assignNumbers: "readOnly" });
  assert.equal(row.sourceDevice, "FOH Rack / VIDEO PATCH");
  assert.equal(row.sourcePort, "Port 3");
  assert.equal(row.destinationDevice, "Destination");
  assert.equal(row.destinationPort, "SDI In");
  assert.deepEqual([row.sourceDeviceId, row.sourceConnectorId, row.sourceRealDevice, row.sourceRealPort],
    ["device-0", "port", "Source", "SDI Out"]);
  assert.deepEqual(row.sourcePatch, { resolved: true, rackId: "foh", rackName: "FOH Rack", panelId: "panel-foh",
    panelLabel: "VIDEO PATCH", rackFace: "rear", placementSide: "right", portId: "port-foh-3", slot: 3,
    sourceRackDeviceId: "source-0", sourceConnectorId: "port" });
  assert.equal(row.signal, "Video");
  assert.equal(row.cableNumber, "V-001");
  assert.equal(row.notes, "One, two\nThree\nSource patch: FOH Rack / VIDEO PATCH / Port 3 ↔ Source / SDI Out");
  assert.equal(data.connections[0].notes, "One, two\nThree", "derived patch notes are not persisted");
  assert.equal(row.rackLocation, "FOH Rack →");
  const chain = signalChainForWire([row], "wire-1");
  assert.equal(chain.from.device, "Source");
  assert.equal(chain.from.port, "SDI Out");
  assert.equal(chain.from.patch.slot, 3);
  data.devices[1].rackId = "foh";
  assert.equal(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].rackLocation, "FOH Rack",
    "a direct endpoint in the same physical rack collapses the location to one rack name");
});

test("both patched endpoints remain one external cable with live physical locations and notes", () => {
  const data = project();
  data.connections[0].from = { deviceId: "device-0", connectorId: "port", ...addSourcePatch(data) };
  data.connections[0].to = { deviceId: "device-1", connectorId: "port", ...addDestinationPatch(data) };
  const [row] = buildCableSchedule(data, { assignNumbers: "readOnly" });
  assert.equal(groupedCables(data).length, 1);
  assert.equal(row.sourceDevice, "FOH Rack / VIDEO PATCH");
  assert.equal(row.sourcePort, "Port 3");
  assert.equal(row.destinationDevice, "Stage Rack / VIDEO PATCH");
  assert.equal(row.destinationPort, "Port 5");
  assert.equal(row.rackLocation, "FOH Rack → Stage Rack");
  assert.match(row.notes, /Source patch: FOH Rack \/ VIDEO PATCH \/ Port 3 ↔ Source \/ SDI Out/);
  assert.match(row.notes, /Destination patch: Stage Rack \/ VIDEO PATCH \/ Port 5 ↔ Destination \/ SDI In/);
  const chain = signalChainForWire([row], "wire-1");
  assert.deepEqual([chain.from.device, chain.from.patch.slot, chain.to.device, chain.to.patch.slot],
    ["Source", 3, "Destination", 5]);
  [data.connections[0].from, data.connections[0].to] = [data.connections[0].to, data.connections[0].from];
  const reversed = signalChainForWire(buildCableSchedule(data, { assignNumbers: "readOnly" }), "wire-1");
  assert.deepEqual([reversed.from.device, reversed.from.patch.slot, reversed.to.device, reversed.to.patch.slot],
    ["Source", 3, "Destination", 5], "direction normalization keeps each live patch attached to its semantic endpoint");
});

test("stale patch presentations fall back without losing or mutating the cable", () => {
  const data = project();
  data.connections[0].from = { deviceId: "device-0", connectorId: "port", ...addSourcePatch(data) };
  const before = structuredClone(data);
  data.racks.find(item => item.id === "foh-definition").patchPanels[0].ports = [];
  const staleBefore = structuredClone(data);
  const [row] = buildCableSchedule(data, { assignNumbers: "readOnly" });
  assert.equal(row.sourcePatch, null);
  assert.deepEqual([row.sourceDevice, row.sourcePort], ["Source", "SDI Out"]);
  assert.equal(row.wireIds.length, 1);
  assert.equal(signalChainForWire([row], "wire-1").from.device, "Source");
  assert.deepEqual(data, staleBefore, "reporting does not repair stale presentation IDs");
  assert.deepEqual(before.connections[0].from, {
    deviceId: "device-0", connectorId: "port", rackId: "foh", patchPanelId: "panel-foh", patchPortId: "port-foh-3"
  });

  const invalidations = [
    data => { data.connections[0].from.rackId = "missing-rack"; },
    data => { data.connections[0].from.patchPanelId = "missing-panel"; },
    data => { data.racks.find(item => item.id === "foh-definition").patchPanels[0].ports[0].sourceConnectorId = "different-connector"; },
    data => { data.racks.find(item => item.id === "foh").sourceDeviceMap["source-0"] = "device-1"; }
  ];
  for (const invalidate of invalidations) {
    const candidate = project();
    candidate.connections[0].from = { deviceId: "device-0", connectorId: "port", ...addSourcePatch(candidate) };
    invalidate(candidate);
    const unchanged = structuredClone(candidate);
    const [fallback] = buildCableSchedule(candidate, { assignNumbers: "readOnly" });
    assert.equal(fallback.sourcePatch, null);
    assert.deepEqual([fallback.sourceDevice, fallback.sourcePort], ["Source", "SDI Out"]);
    assert.deepEqual(candidate, unchanged, "invalid presentation IDs are ignored without repair mutations");
  }
});

test("patch labels and stable slots resolve live from rack ownership and presentation-specific lookup", () => {
  const data = project();
  const presentation = addSourcePatch(data);
  data.connections[0].from = { deviceId: "device-0", connectorId: "port", ...presentation };
  data.connections.push({ ...structuredClone(data.connections[0]), id: "wire-direct", from: { deviceId: "device-0", connectorId: "port" } });
  const sourceRack = data.racks.find(item => item.id === "foh-definition");
  sourceRack.patchPanels[0].ports.push({ id: "other-port", slot: 4, sourceRackDeviceId: "source-0", sourceConnectorId: "other" });
  sourceRack.patchPanels[0].ports.find(item => item.id === "port-foh-3").slot = 5;
  sourceRack.patchPanels[0].label = "PATCH A";
  data.racks.find(item => item.id === "foh").name = "Renamed FOH Rack";
  let rows = buildCableSchedule(data, { assignNumbers: "readOnly" });
  assert.equal(rows.find(row => row.wireIds.includes("wire-1")).sourceDevice, "Renamed FOH Rack / PATCH A");
  assert.equal(rows.find(row => row.wireIds.includes("wire-1")).sourcePort, "Port 5");
  sourceRack.patchPanels[0].label = "VIDEO PATCH";
  rows = buildCableSchedule(data, { assignNumbers: "readOnly" });
  const patched = signalChainsForPatchPort(rows, "foh", "panel-foh", "port-foh-3");
  assert.equal(patched.length, 1);
  assert.deepEqual(patched[0].wireIds, ["wire-1"]);
  assert.equal(patched[0].from.patch.slot, 5);
  assert.equal(signalChainsForConnector(rows, "device-0", "port").length, 2);
  assert.deepEqual(signalChainsForPatchPort(rows, "foh", "panel-foh", "missing"), []);
});

test("direct, source-patched, and both-ends-patched CSV/XLSX exports remain one row per external cable", async () => {
  const data = project();
  const direct = structuredClone(data.connections[0]);
  const sourcePresentation = addSourcePatch(data), destinationPresentation = addDestinationPatch(data);
  const sourcePatched = { ...structuredClone(direct), id: "wire-source-patched",
    from: { deviceId: "device-0", connectorId: "port", ...sourcePresentation } };
  const bothPatched = { ...structuredClone(direct), id: "wire-both-patched",
    from: { deviceId: "device-0", connectorId: "port", ...sourcePresentation },
    to: { deviceId: "device-1", connectorId: "port", ...destinationPresentation } };
  data.connections = [direct, sourcePatched, bothPatched];
  const rows = buildCableSchedule(data, { assignNumbers: "readOnly" });
  assert.equal(rows.length, 3);
  const csv = cableScheduleCsv(rows);
  assert.match(csv, /"FOH Rack \/ VIDEO PATCH","Port 3"/);
  assert.match(csv, /Source patch: FOH Rack \/ VIDEO PATCH \/ Port 3 ↔ Source \/ SDI Out/);
  assert.equal((csv.match(/"V-00[1-3]"/g) || []).length, 3);

  const bytes = await createCableScheduleXlsx(rows);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("Cable Schedule");
  assert.equal(sheet.rowCount, 4);
  assert.equal(sheet.getCell("B3").value, "FOH Rack / VIDEO PATCH");
  assert.equal(sheet.getCell("C3").value, "Port 3");
  assert.match(sheet.getCell("L3").value, /Source patch: FOH Rack \/ VIDEO PATCH \/ Port 3 ↔ Source \/ SDI Out/);
  assert.equal(sheet.getCell("B4").value, "FOH Rack / VIDEO PATCH");
  assert.equal(sheet.getCell("D4").value, "Stage Rack / VIDEO PATCH");
});

test("patched outer Jump cable keeps one logical chain and hides the paired Jump nodes", () => {
  const data = bidirectionalJumpFixture("output", "input");
  data.jumpLinks = [{ id: "link", outputJumpId: "a", inputJumpId: "b" }];
  data.connections = data.connections.slice(0, 2);
  const patch = addPatchPresentation(data, { rackId: "stage", rackName: "Stage Rack", panelId: "panel-stage",
    panelLabel: "VIDEO PATCH", portId: "port-stage-5", slot: 5, deviceId: "destination", sourceRackDeviceId: "source-1" });
  data.connections[1].from = { deviceId: "destination", connectorId: "port", ...patch };
  const rows = buildCableSchedule(data, { assignNumbers: "readOnly" });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].wireIds, ["wire-a", "wire-b"]);
  assert.equal(rows[0].destinationDevice, "Stage Rack / VIDEO PATCH");
  assert.equal(rows[0].destinationPort, "Port 5");
  const firstLeg = signalChainForWire(rows, "wire-a"), secondLeg = signalChainForWire(rows, "wire-b");
  assert.deepEqual(firstLeg, secondLeg);
  assert.deepEqual([firstLeg.from.device, firstLeg.to.device, firstLeg.to.patch.slot], ["source", "destination", 5]);
  assert.deepEqual(signalChainsForPatchPort(rows, "stage", "panel-stage", "port-stage-5")[0].wireIds,
    ["wire-a", "wire-b"]);
});

test("endpoint graphics retain individual connector colors", () => {
  const data = project();
  data.connections[0].cableType = "led-signal";
  data.devices[0].templateOverride.connectors[0] = { id: "port", type: "led-signal", customColor: "#AA1122" };
  data.devices[1].templateOverride.connectors[0] = { id: "port", type: "led-signal", customColor: "#22AA11" };
  const [row] = buildCableSchedule(data);
  assert.equal(row.sourceNodeColor, "#AA1122");
  assert.equal(row.destinationNodeColor, "#22AA11");
});

test("installed optical modules take fibre precedence; empty cages are not reported as LC", () => {
  const data = project();
  data.connections[0].cableType = "other";
  data.connections[0].fiberMode = "singlemode";
  data.devices.forEach(device => {
    Object.assign(device.templateOverride.connectors[0], { type: "sfp-cage", installedModuleId: "lc" });
  });
  const [optical] = buildCableSchedule(data);
  assert.equal(optical.cableNumber, "F-001");
  assert.match(optical.connector, /Fiber LC/);
  assert.equal(signalChainForWire([optical], "wire-1").from.typeId, "sfp-cage");
  assert.equal(signalChainForWire([optical], "wire-1").fiberMode, "singlemode");
  data.devices.forEach(device => { device.templateOverride.connectors[0].installedModuleId = ""; });
  const [empty] = buildCableSchedule(data);
  assert.equal(empty.cableNumber, "X-001");
  assert.doesNotMatch(empty.connector, /fiber-lc/);
  assert.equal(signalChainForWire([empty], "wire-1").from.typeId, "sfp-cage");
});

test("paired Jump Node legs form one logical cable with real endpoints", () => {
  const data = bidirectionalJumpFixture("output", "input");
  data.jumpLinks = [{ id: "link", outputJumpId: "a", inputJumpId: "b" }];
  data.connections = data.connections.slice(0, 2);
  data.connections[1].loom = "Jump Loom";
  const rows = buildCableSchedule(data);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceDevice, "source");
  assert.equal(rows[0].destinationDevice, "destination");
  assert.deepEqual(rows[0].wireIds, ["wire-a", "wire-b"]);
  assert.equal(rows[0].loom, "Jump Loom");
  assert.equal(data.connections[0].cableNumber, data.connections[1].cableNumber);
  const firstLeg = signalChainForWire(rows, "wire-a");
  const secondLeg = signalChainForWire(rows, "wire-b");
  assert.deepEqual(firstLeg, secondLeg);
  assert.deepEqual(firstLeg.wireIds, ["wire-a", "wire-b"]);
  assert.equal(firstLeg.from.device, "source");
  assert.equal(firstLeg.to.device, "destination");
  assert.equal(firstLeg.cableNumber, rows[0].cableNumber);
  assert.equal(signalChainsForConnector(rows, "source", "port")[0].cableNumber, rows[0].cableNumber);
  assert.equal(signalChainsForConnector(rows, "destination", "port")[0].cableNumber, rows[0].cableNumber);
});

test("Signal Chain resolves direct endpoints, names and metadata without mutating the project", () => {
  const data = project(), before = structuredClone(data);
  const rows = buildCableSchedule(data, { assignNumbers: "readOnly" });
  const chain = signalChainForWire(rows, "wire-1");
  assert.equal(chain.cableNumber, "V-001");
  assert.deepEqual([chain.from.device, chain.from.port, chain.to.device, chain.to.port],
    ["Source", "SDI Out", "Destination", "SDI In"]);
  assert.deepEqual([chain.length, chain.loom], ["12 m", "FOH-01"]);
  assert.equal(chain.flow, "forward");
  assert.equal(signalChainsForConnector(rows, "device-0", "port")[0].cableNumber, chain.cableNumber);
  assert.equal(signalChainsForConnector(rows, "device-1", "port")[0].cableNumber, chain.cableNumber);
  assert.deepEqual(signalChainsForConnector(rows, "device-0", "missing"), []);
  assert.equal(signalChainForWire(rows, "missing"), null);
  assert.deepEqual(data, before, "opening a chain must not assign Cable IDs or create history");

  data.devices[0].name = "Renamed Source";
  data.devices[0].templateOverride.connectors[0].nameText = "Program Out";
  const renamed = signalChainForWire(buildCableSchedule(data, { assignNumbers: "readOnly" }), "wire-1");
  assert.equal(renamed.cableNumber, chain.cableNumber);
  assert.equal(renamed.from.device, "Renamed Source");
  assert.equal(renamed.from.port, "Program Out");
  data.connections[0].customColor = "#E12345";
  assert.equal(signalChainForWire(buildCableSchedule(data, { assignNumbers: "readOnly" }), "wire-1").cableCustomColor, "#E12345");
});

test("Signal Chain uses direction only when the endpoints establish it", () => {
  const data = project();
  data.connections[0].from = { deviceId: "device-1", connectorId: "port" };
  data.connections[0].to = { deviceId: "device-0", connectorId: "port" };
  const reversed = signalChainForWire(buildCableSchedule(data, { assignNumbers: "readOnly" }), "wire-1");
  assert.equal(reversed.from.device, "Source");
  assert.equal(reversed.to.device, "Destination");
  assert.equal(reversed.flow, "forward");
  data.devices.forEach(device => { device.templateOverride.connectors[0].signalDirection = "bidirectional"; });
  const neutral = signalChainForWire(buildCableSchedule(data, { assignNumbers: "readOnly" }), "wire-1");
  assert.equal(neutral.flow, "bidirectional");
});

test("Signal Chain returns every logical cable on a multi-connected connector", () => {
  const data = project();
  data.connections.push({ ...structuredClone(data.connections[0]), id: "wire-2", cableType: "hdmi" });
  const rows = buildCableSchedule(data, { assignNumbers: "readOnly" });
  const chains = signalChainsForConnector(rows, "device-0", "port");
  assert.equal(chains.length, 2);
  assert.deepEqual(chains.map(chain => chain.wireIds[0]).sort(), ["wire-1", "wire-2"]);
});

test("source, destination, and cable dropdowns combine without changing schedule rows", () => {
  const rows = [
    { sourceDevice: "Alpha", destinationDevice: "Screen", cable: "HDMI" },
    { sourceDevice: "Alpha", destinationDevice: "Rack", cable: "SDI" },
    { sourceDevice: "Bravo", destinationDevice: "Screen", cable: "SDI" }
  ];
  const original = structuredClone(rows);
  assert.deepEqual(cableScheduleFilterOptions(rows, "sourceDevice"), ["Alpha", "Bravo"]);
  assert.deepEqual(cableScheduleFilterOptions(rows, "destinationDevice"), ["Rack", "Screen"]);
  assert.deepEqual(cableScheduleFilterOptions(rows, "cable"), ["HDMI", "SDI"]);
  assert.deepEqual(cableScheduleFilterOptions(rows, "notes"), []);
  assert.deepEqual(cableScheduleVisibleRowIndexes(rows), [0, 1, 2]);
  assert.deepEqual(cableScheduleVisibleRowIndexes(rows, { sourceDevice: "Alpha", destinationDevice: "Rack", cable: "SDI" }), [1]);
  assert.deepEqual(cableScheduleVisibleRowIndexes(rows, { sourceDevice: "Bravo", cable: "HDMI" }), []);
  assert.deepEqual(rows, original);
});

test("Engine normalization and mutation retain schedule metadata", () => {
  const data = project();
  ensureCableNumbers(data);
  const normalized = normalizeAvDesignerProject(data);
  const wire = normalized.wires.find(item => item.sourceId === "wire-1");
  assert.equal(wire.cableNumber, "V-001");
  assert.equal(wire.loom, "FOH-01");
  assert.equal(wire.notes, "One, two\nThree");
  const mutations = new ProjectMutationAdapter(normalized, { cloneProjectData: false });
  mutations.updateWireFields("wire-1", { cableNumber: "V-001", loom: "Loom A", length: "20 m",
    notes: "Changed", cableType: "sdi", fiberMode: "" });
  assert.deepEqual(Object.fromEntries(["cableNumber", "loom", "length", "notes", "cableType", "fiberMode"]
    .map(key => [key, mutations.root.connections[0][key]])), {
    cableNumber: "V-001", loom: "Loom A", length: "20 m", notes: "Changed", cableType: "sdi", fiberMode: ""
  });
});

test("XLSX contains text values, formatting, and reused endpoint/cable artwork", async () => {
  const data = project();
  data.connections.push({ ...structuredClone(data.connections[0]), id: "wire-2", cableNumber: "" });
  const rows = buildCableSchedule(data);
  const png = `data:image/png;base64,${readFileSync(new URL("../Nodes/Thumbnails/bnc.png", import.meta.url)).toString("base64")}`;
  const bytes = await createCableScheduleXlsx(rows, { graphics: {
    nodes: { sdi: png }, cables: { "#32b6ff": png }, ids: { "V-001": png, "V-002": png }
  } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("Cable Schedule");
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell("A1").value, "Cable ID");
  assert.equal(sheet.getCell("A2").value, "V-001");
  assert.equal(sheet.getCell("A2").font.size, 17);
  assert.equal(sheet.getCell("A2").font.bold, true);
  assert.equal(sheet.getCell("A2").font.color.argb, "FF32B6FF");
  assert.equal(sheet.getCell("J2").value, "FOH-01");
  assert.equal(sheet.getCell("L2").value, "One, two\nThree");
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.autoFilter, "A1:L3",
    "Excel includes native filter dropdowns on Source Device, Destination Device, and Cable");
  assert.equal(sheet.getImages().length, 8);
  assert.ok(sheet.getImages().every(image => image.range.editAs === "twoCell" && image.range.br),
    "artwork remains attached to filtered rows");
  assert.equal(sheet.getImages().filter(image => image.range.tl.nativeCol === 0).length, 2,
    "outlined ID artwork covers the searchable cell value");
  assert.ok(sheet.getImages().filter(image => image.range.tl.nativeCol === 0)
    .every(image => image.range.tl.nativeColOff === 0), "ID artwork covers the full text origin");
  assert.ok(sheet.getImages().filter(image => image.range.tl.nativeCol !== 0)
    .every(image => image.range.tl.nativeColOff >= 180 * 9525),
    "plug and cable graphics stay to the right of their text");
  assert.equal(workbook.model.media.length, 4);
});
