import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";
import { buildCableSchedule, cableFamily, cableScheduleCsv, cableScheduleFilterOptions,
  cableScheduleVisibleRowIndexes, ensureCableNumbers, signalChainForWire,
  signalChainsForConnector } from "../src/engine/cableSchedule.js";
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
  assert.equal(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes,
    "One, two\nThree\nLoom: LM-001 — FOH → Stage Rack\nLoom length: 75 m — Derived from LM-001");
  loom.trunkLength = "80 m";
  assert.match(buildCableSchedule(data, { assignNumbers: "readOnly" })[0].notes, /Loom length: 80 m — Derived from LM-001/);
  assert.equal(data.connections[0].length, "12 m", "loom edits do not change cable length");
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
