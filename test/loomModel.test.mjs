import test from "node:test";
import assert from "node:assert/strict";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { managedLoomMixedFixture } from "../fixtures/managed-looms.mjs";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";
import { allocateLoomIdentity, dissolveLoom, loomComposition, migrateLegacyLooms, normalizeLoom,
  DEFAULT_LOOM_LABEL_BACKGROUND_COLOR, DEFAULT_LOOM_LABEL_TEXT_COLOR, loomLabelBackgroundRgba,
  normalizeLoomLabelColor, renameLoom, selectedLoomCableGroups, setLogicalCableLoom } from "../src/engine/loomModel.js";
import { initialLoomHeads, loomGeometry, loomTrunkPoints, orientCableEndpoints,
  prepareLoomGeometryContext } from "../src/engine/loomGeometry.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { hitTestWire } from "../src/engine/hitTest.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { createCableScheduleXlsx } from "../src/engine/cableScheduleXlsx.js";

function jumpProject(first = "output", second = "input") {
  const project = bidirectionalJumpFixture(first, second);
  project.jumpLinks = [{ id: "link", outputJumpId: "a", inputJumpId: "b" }];
  project.connections = project.connections.slice(0, 2);
  return project;
}

test("legacy free-text loom migrates every Jump leg into one managed logical membership", () => {
  const project = jumpProject();
  project.connections[0].loom = "FOH";
  const warnings = migrateLegacyLooms(project);
  assert.deepEqual(warnings, []);
  assert.equal(project.looms.length, 1);
  assert.equal(project.looms[0].name, "FOH");
  assert.deepEqual(project.connections.map(wire => wire.loomId), [project.looms[0].id, project.looms[0].id]);
  assert.ok(project.connections.every(wire => !Object.hasOwn(wire, "loom")));
  assert.deepEqual(buildCableSchedule(project, { assignNumbers: "readOnly" }).map(row => row.loom), ["FOH"]);
  assert.equal(loomComposition(project, project.looms[0].id).circuits, 1);
  const again = structuredClone(project);
  assert.deepEqual(migrateLegacyLooms(again), []);
  assert.deepEqual(again, project);
});

test("membership uses logical cables for strict and bidirectional Jump pairs", () => {
  for (const roles of [["output", "input"], ["bidirectional", "bidirectional"]]) {
    const project = jumpProject(...roles);
    const groups = selectedLoomCableGroups(project, ["wire-b"]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].wires.map(wire => wire.id), ["wire-a", "wire-b"]);
    setLogicalCableLoom(groups, "loom-1");
    assert.deepEqual(project.connections.map(wire => wire.loomId), ["loom-1", "loom-1"]);
    setLogicalCableLoom(groups, "");
    assert.ok(project.connections.every(wire => !Object.hasOwn(wire, "loomId")));
  }
});

test("mixed Video, Network, Fibre, Audio and Jump legs count as five logical circuits", () => {
  const project = managedLoomMixedFixture();
  const selected = project.connections.map(wire => wire.id);
  const groups = selectedLoomCableGroups(project, selected);
  assert.equal(groups.length, 5);
  assert.ok(groups.some(group => group.wires.length === 2));
  project.looms = [{ id: "loom-1", name: "L01", sideA: { x: 350, y: 400 },
    sideB: { x: 700, y: 400 } }];
  setLogicalCableLoom(groups, "loom-1");
  assert.equal(project.connections.filter(wire => wire.loomId === "loom-1").length, 6);
  assert.deepEqual(loomComposition(project, "loom-1").families,
    [{ name: "Audio", count: 1 }, { name: "Fibre", count: 1 },
      { name: "Network", count: 1 }, { name: "Video", count: 2 }]);
});

test("stable names never reuse deleted high-water identifiers and reject case-insensitive duplicates", () => {
  const project = { looms: [{ id: "loom-2", name: "L02" }], loomNumberCounter: 3, connections: [] };
  assert.deepEqual(allocateLoomIdentity(project), { id: "loom-4", name: "LM-004" });
  project.looms.push({ id: "loom-4", name: "FOH" });
  assert.equal(renameLoom(project, "loom-2", "foh"), false);
  assert.equal(renameLoom(project, "loom-2", "Stage"), true);
  assert.equal(dissolveLoom(project, "loom-2"), true);
  assert.deepEqual(allocateLoomIdentity(project), { id: "loom-5", name: "LM-005" });
  project.looms.push({ id: "loom-7", name: "LM-009" });
  assert.deepEqual(allocateLoomIdentity(project), { id: "loom-10", name: "LM-010" });
  assert.equal(normalizeLoom({ id: "loom-2", name: "L02" }).name, "L02", "existing Loom names stay unchanged");
  assert.equal(normalizeLoom({ id: "loom-1" }).name, "LM-001");
  assert.deepEqual([normalizeLoom({ id: "loom-3", origin: "FOH", destination: "Stage", trunkLength: "75 m" }).origin,
    normalizeLoom({ id: "loom-3", origin: "FOH", destination: "Stage", trunkLength: "75 m" }).destination,
    normalizeLoom({ id: "loom-3", origin: "FOH", destination: "Stage", trunkLength: "75 m" }).trunkLength],
  ["FOH", "Stage", "75 m"]);
  assert.deepEqual([normalizeLoom({ id: "old" }).origin, normalizeLoom({ id: "old" }).destination,
    normalizeLoom({ id: "old" }).trunkLength], ["", "", ""]);
});

test("Loom label colors normalize to safe canonical hex values with legacy defaults", () => {
  const legacy = { id: "loom-legacy", name: "LM-OLD", origin: "FOH", destination: "Stage",
    sideA: { label: "A", x: 10, y: 20 }, sideB: { label: "B", x: 30, y: 40 },
    routeStyle: "orthogonal", routePoints: [{ x: 2, y: 3 }], trunkLength: "75 m", notes: "legacy" };
  const normalized = normalizeLoom(legacy);
  assert.deepEqual([normalized.labelTextColor, normalized.labelBackgroundColor], ["#ffffff", "#000000"]);
  const { labelTextColor, labelBackgroundColor, ...legacyProperties } = normalized;
  assert.deepEqual(legacyProperties, { ...legacy, kind: "loom" });
  assert.deepEqual([DEFAULT_LOOM_LABEL_TEXT_COLOR, DEFAULT_LOOM_LABEL_BACKGROUND_COLOR], ["#ffffff", "#000000"]);
  assert.deepEqual([normalizeLoomLabelColor("#F0A"), normalizeLoomLabelColor("#ABCDEF"),
    normalizeLoomLabelColor("invalid", "#123456")], ["#ff00aa", "#abcdef", "#123456"]);
  assert.equal(normalizeLoomLabelColor("url(javascript:alert(1))"), "#ffffff");
  assert.equal(loomLabelBackgroundRgba("#ff0000"), "rgba(255,0,0,0.82)");
  assert.equal(loomLabelBackgroundRgba("invalid"), "rgba(0,0,0,0.82)");
});

test("head placement and A/B assignment are independent of electrical direction", () => {
  const pairs = [
    [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
    [{ x: 1020, y: 60 }, { x: 20, y: 60 }],
    [{ x: 10, y: 120 }, { x: 1010, y: 120 }]
  ];
  const first = initialLoomHeads(pairs);
  assert.deepEqual(first, initialLoomHeads(pairs));
  assert.ok(first.sideA.x < first.sideB.x);
  assert.ok(first.sideA.x > 0 && first.sideB.x < 1020);
  assert.deepEqual(orientCableEndpoints(pairs[1], first.sideA, first.sideB), [pairs[1][1], pairs[1][0]]);
});

test("Loom Bezier and corner routes use the established Engine spline geometry", () => {
  const loom = { sideA: { x: 0, y: 0 }, sideB: { x: 600, y: 200 },
    routeStyle: "bezier", routePoints: [] };
  const automatic = loomTrunkPoints(loom);
  assert.ok(automatic.length > 2);
  assert.deepEqual(automatic[0], { x: 0, y: 0 });
  assert.deepEqual(automatic.at(-1), { x: 600, y: 200 });
  loom.routePoints = [{ x: 250, y: 300 }];
  const manual = loomTrunkPoints(loom);
  assert.ok(manual.some(point => point.x === 250 && point.y === 300));
  assert.notDeepEqual(manual, automatic);
});

test("collapsed geometry has two physical breakouts per logical cable and hides both Jump legs", () => {
  const project = jumpProject();
  project.connections.forEach(wire => { wire.loomId = "loom-1"; });
  const points = { "wire-a": [{ x: 0, y: 0 }, { x: 200, y: 0 }],
    "wire-b": [{ x: 1000, y: 0 }, { x: 800, y: 0 }] };
  const scene = {
    getWire(id) { return { id }; },
    endpointForWire(wire, end) { return points[wire.id][end === "from" ? 0 : 1]; }
  };
  const before = structuredClone(project.connections);
  const geometry = loomGeometry(project, scene, {
    id: "loom-1", sideA: { x: 150, y: 20 }, sideB: { x: 850, y: 20 },
    routeStyle: "orthogonal", routePoints: []
  });
  assert.equal(geometry.circuitCount, 1);
  assert.deepEqual(geometry.hiddenWireIds, ["wire-a", "wire-b"]);
  assert.equal(geometry.breakouts.length, 2);
  assert.deepEqual(geometry.breakouts.map(item => item.end), ["A", "B"]);
  assert.ok(geometry.trunk.length >= 2);
  assert.deepEqual(project.connections, before, "geometry never mutates source routes or membership");
});

test("prepared Loom geometry context reuses external endpoints and family summary for transient previews", () => {
  const project = cableTypeSelectionFixture();
  project.connections.forEach(wire => { wire.loomId = "loom-1"; });
  project.looms = [{ id: "loom-1", name: "LM-001", sideA: { x: 300, y: 100 },
    sideB: { x: 800, y: 100 }, routeStyle: "orthogonal", routePoints: [] }];
  const normalized = normalizeAvDesignerProject(project);
  const scene = new SceneGraph();
  scene.setData(normalized);
  const context = prepareLoomGeometryContext(project, scene, "loom-1");
  assert.equal(context.members.length, 4);
  assert.ok(context.members.every(member => member.pair?.length === 2
    && member.sourceRef?.wireId && member.destinationRef?.wireId));
  const moved = { ...scene.looms[0], sideA: { ...scene.looms[0].sideA, x: 250 } };
  const preview = loomGeometry(project, scene, moved, [], [], context);
  assert.equal(preview.circuitCount, scene.loomPlans[0].circuitCount);
  assert.deepEqual(preview.families, scene.loomPlans[0].families);
  assert.equal(preview.breakouts.length, scene.loomPlans[0].breakouts.length);
  assert.equal(scene.loomPlans[0].headA.x, 300, "preview does not mutate canonical scene geometry");
  assert.equal(project.looms[0].sideA.x, 300, "preview does not mutate persisted project geometry");
});

test("dissolving a Loom preserves complete connection records except Loom membership and tail routing", () => {
  const project = managedLoomMixedFixture();
  project.looms = [{ id: "loom-1", name: "LM-001", sideA: { x: 300, y: 100 }, sideB: { x: 800, y: 100 } }];
  project.connections.forEach((wire, index) => Object.assign(wire, {
    loomId: "loom-1", cableNumber: `C-${index + 1}`, cableType: `Type ${index}`,
    length: `${index + 1} m`, notes: `notes ${index}`, customColor: `#12345${index}`,
    jumpWireMetadataSource: `jump metadata ${index}`,
    patchPanelEndpointPresentation: { rackId: `rack-${index}`, panelId: `panel-${index}`, portId: `port-${index}` },
    loomEntrySide: "sideA", loomEntryRoutePoints: [{ x: index, y: 1 }],
    loomExitRoutePoints: [{ x: index, y: 2 }], loom: "Legacy label"
  }));
  const withoutLoomFields = wire => {
    const copy = structuredClone(wire);
    for (const field of ["loomId", "loom", "loomEntrySide", "loomEntryRoutePoints", "loomExitRoutePoints"]) delete copy[field];
    return copy;
  };
  const before = project.connections.map(withoutLoomFields);
  const membership = selectedLoomCableGroups(project, project.connections.map(wire => wire.id));
  assert.equal(membership.length, 5);
  assert.equal(membership.find(group => group.wires.length === 2)?.wires.length, 2,
    "paired Jump legs are part of the same logical cable group");
  assert.equal(dissolveLoom(project, "loom-1"), true);
  assert.deepEqual(project.connections.map(withoutLoomFields), before);
  assert.equal(project.connections.length, before.length);
  assert.ok(project.connections.every(wire => !["loomId", "loom", "loomEntrySide",
    "loomEntryRoutePoints", "loomExitRoutePoints"].some(field => Object.hasOwn(wire, field))));
});

test("Engine scene indexes breakout legs but not invisible complete cable routes", () => {
  const project = jumpProject();
  project.connections.forEach(wire => { wire.loomId = "loom-1"; });
  project.looms = [{ id: "loom-1", name: "L01", sideA: { x: 180, y: 100 },
    sideB: { x: 760, y: 100 }, routeStyle: "orthogonal", routePoints: [] }];
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  assert.equal(scene.loomPlans.length, 1);
  assert.equal(scene.loomPlans[0].circuitCount, 1);
  assert.equal(scene.loomPlans[0].hiddenWireIds.length, 2);
  for (const breakout of scene.loomPlans[0].breakouts) {
    const middle = { x: (breakout.points[0].x + breakout.points[1].x) / 2,
      y: (breakout.points[0].y + breakout.points[1].y) / 2 };
    assert.equal(hitTestWire(scene, middle, 5).wire?.wire.id, breakout.wireId);
  }
  assert.equal(scene.routePointIndex.items.size, 0);
});

test("Engine output scene and vector PDF share Loom geometry without printing hidden members", () => {
  const project = jumpProject();
  project.connections.forEach(wire => { wire.loomId = "loom-1"; });
  project.looms = [{ id: "loom-1", name: "L01", sideA: { label: "FOH", x: 180, y: 100 },
    sideB: { label: "Stage", x: 760, y: 100 }, routeStyle: "orthogonal", routePoints: [], trunkLength: "75 m",
    labelTextColor: "#ff00ff", labelBackgroundColor: "#00ff00" }];
  const contract = buildEngineOutputScene(project);
  assert.equal(contract.looms.length, 1);
  assert.deepEqual([contract.looms[0].labelTextColor, contract.looms[0].labelBackgroundColor], ["#ff00ff", "#00ff00"]);
  assert.equal(contract.loomPlans[0].hiddenWireIds.length, 2);
  assert.ok(Object.isFrozen(contract.loomPlans));
  assert.deepEqual(buildEngineOutputScene(project), contract);
  const { svg } = renderEngineOutputSvg(contract);
  assert.match(svg, /data-loom-id="loom-1"/);
  assert.doesNotMatch(svg, /data-wire-id="wire-a"|data-wire-id="wire-b"/);
  assert.match(svg, /L01/);
  assert.match(svg, /fill="#ff00ff"/, "Loom text color remains exact in vector output");
  assert.match(svg, /stroke="rgba\(0,255,0,0\.82\)"/, "Loom halo uses its selected color at the legacy opacity");
  assert.match(svg, /FOH[\s\S]*fill="#ff00ff"[\s\S]*Stage[\s\S]*fill="#ff00ff"/);
  const wrapped = buildEngineOutputScene({ state: project });
  assert.deepEqual(wrapped.loomPlans, contract.loomPlans);
  assert.deepEqual(wrapped.looms, contract.looms);
});

test("XLSX keeps logical cable rows and summarizes each Loom on a separate sheet", async () => {
  const project = jumpProject();
  project.connections.forEach(wire => { wire.loomId = "loom-1"; });
  project.looms = [{ id: "loom-1", name: "LM-001", origin: "FOH", destination: "Stage Rack",
    sideA: { label: "Gateway A", x: 0, y: 0 }, sideB: { label: "Gateway B", x: 100, y: 0 },
    trunkLength: "75 m", notes: "Signal bundle" }];
  const rows = buildCableSchedule(project, { assignNumbers: "readOnly" });
  const bytes = await createCableScheduleXlsx(rows, { looms: project.looms,
    graphics: { ids: {}, cables: {}, nodes: {} } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.getWorksheet("Cable Schedule").rowCount, 2);
  const summary = workbook.getWorksheet("Loom Schedule");
  assert.equal(summary.getCell("A2").value, "LM-001");
  assert.equal(summary.getCell("B2").value, "FOH");
  assert.equal(summary.getCell("C2").value, "Stage Rack");
  assert.equal(summary.getCell("D2").value, "75 m");
  assert.equal(summary.getCell("E2").value, 1);
  assert.match(summary.getCell("F2").value, /1 Video/);
});

test("empty planned Loom remains in the Engine scene and output bounds", () => {
  const project = { devices: [], connections: [], looms: [{ id: "loom-7", name: "L07",
    sideA: { label: "FOH", x: 250, y: 320 }, sideB: { label: "Stage", x: 850, y: 320 },
    routeStyle: "orthogonal", routePoints: [], trunkLength: "75 m" }] };
  const output = buildEngineOutputScene(project);
  assert.equal(output.looms.length, 1);
  assert.equal(output.loomPlans[0].circuitCount, 0);
  assert.deepEqual(output.sceneBounds, { x: 250, y: 320, width: 600, height: 1 });
  assert.match(renderEngineOutputSvg(output).svg, /L07/);
});

test("8, 16, 32 and 64 circuit Looms remain collapsed to one trunk and two breakout groups", () => {
  for (const count of [8, 16, 32, 64]) {
    const project = cableTypeSelectionFixture();
    project.devices.forEach((device, side) => {
      device.templateOverride.height = count * 25 + 150;
      device.templateOverride.connectors = Array.from({ length: count }, (_, index) => ({
        id: `port-${index}`, type: index % 4 ? "hdmi" : "ethercon",
        label: "Port", direction: side ? "input" : "output",
        signalDirection: side ? "input" : "output", displaySide: side ? "left" : "right",
        x: side ? 0 : 260, y: 80 + index * 25
      }));
    });
    project.connections = Array.from({ length: count }, (_, index) => ({ id: `cable-${index}`,
      cableType: index % 4 ? "hdmi" : "ethercon", loomId: "loom-1",
      from: { deviceId: "source", connectorId: `port-${index}` },
      to: { deviceId: "sink", connectorId: `port-${index}` } }));
    project.looms = [{ id: "loom-1", name: "L01", sideA: { label: "FOH", x: 340, y: 200 },
      sideB: { label: "Stage", x: 700, y: 200 }, routeStyle: "orthogonal", routePoints: [] }];
    const output = buildEngineOutputScene(project), plan = output.loomPlans[0];
    assert.equal(plan.circuitCount, count);
    assert.equal(plan.hiddenWireIds.length, count);
    assert.equal(plan.breakouts.length, count * 2);
    assert.equal(plan.trunk.length, 2);
    assert.equal(plan.families.reduce((sum, family) => sum + family.count, 0), count);
    assert.equal(output.diagnostics.counts.looms, 1);
  }
});
