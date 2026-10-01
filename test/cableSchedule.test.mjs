import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";
import { buildCableSchedule, cableFamily, cableScheduleCsv, ensureCableNumbers } from "../src/engine/cableSchedule.js";
import { createCableScheduleXlsx } from "../src/engine/cableScheduleXlsx.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";

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
  data.devices.forEach(device => {
    Object.assign(device.templateOverride.connectors[0], { type: "sfp-cage", installedModuleId: "lc" });
  });
  const [optical] = buildCableSchedule(data);
  assert.equal(optical.cableNumber, "F-001");
  assert.match(optical.connector, /fiber-lc/);
  data.devices.forEach(device => { device.templateOverride.connectors[0].installedModuleId = ""; });
  const [empty] = buildCableSchedule(data);
  assert.equal(empty.cableNumber, "X-001");
  assert.doesNotMatch(empty.connector, /fiber-lc/);
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
  const bytes = await createCableScheduleXlsx(rows, { graphics: { nodes: { sdi: png }, cables: { "#32b6ff": png } } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("Cable Schedule");
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell("A1").value, "Cable ID");
  assert.equal(sheet.getCell("A2").value, "V-001");
  assert.equal(sheet.getCell("J2").value, "FOH-01");
  assert.equal(sheet.getCell("L2").value, "One, two\nThree");
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.getImages().length, 6);
  assert.ok(sheet.getImages().every(image => image.range.tl.nativeColOff >= 180 * 9525),
    "graphics stay to the right of port and cable text");
  assert.equal(workbook.model.media.length, 2);
});
