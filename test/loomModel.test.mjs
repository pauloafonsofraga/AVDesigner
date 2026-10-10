import test from "node:test";
import assert from "node:assert/strict";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { managedLoomMixedFixture } from "../fixtures/managed-looms.mjs";
import { buildCableSchedule, signalChainForWire } from "../src/engine/cableSchedule.js";
import { addLoomRoutePoint, allocateLoomIdentity, allocateLoomRoutePointId, dissolveLoom,
  allocateLoomPortalIdentity, isCanonicalLoomRoutePointId, normalizeLoomCollection, parseLoomRoutePointId,
  loomComposition, migrateLegacyLooms, normalizeLoom,
  DEFAULT_LOOM_LABEL_BACKGROUND_COLOR, DEFAULT_LOOM_LABEL_TEXT_COLOR, loomLabelBackgroundRgba,
  normalizeLoomLabelColor, renameLoom, selectedLoomCableGroups, setLogicalCableLoom } from "../src/engine/loomModel.js";
import { initialLoomHeads, locatePointOnLoomRoute, loomGeometry, loomRouteControlNodes,
  loomRouteSpanPolyline, loomRouteSpans, loomTrunkPoints, orientCableEndpoints, resolveLoomRouteAttachment,
  rebaseLoomPortalAttachments, splitLoomRouteAtAttachment,
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
  assert.deepEqual(legacyProperties, { ...legacy, kind: "loom", routePoints: [{ id: "lrp-1", x: 2, y: 3 }],
    routePointCounter: 1, portalPairs: [] });
  assert.deepEqual([DEFAULT_LOOM_LABEL_TEXT_COLOR, DEFAULT_LOOM_LABEL_BACKGROUND_COLOR], ["#ffffff", "#000000"]);
  assert.deepEqual([normalizeLoomLabelColor("#F0A"), normalizeLoomLabelColor("#ABCDEF"),
    normalizeLoomLabelColor("invalid", "#123456")], ["#ff00aa", "#abcdef", "#123456"]);
  assert.equal(normalizeLoomLabelColor("url(javascript:alert(1))"), "#ffffff");
  assert.equal(loomLabelBackgroundRgba("#ff0000"), "rgba(255,0,0,0.82)");
  assert.equal(loomLabelBackgroundRgba("invalid"), "rgba(0,0,0,0.82)");
});

test("Loom route points migrate stable IDs, preserve valid IDs, and allocate above the high-water mark", () => {
  const legacy = normalizeLoom({ id: "loom-legacy", sideA: { x: 0, y: 0 }, sideB: { x: 400, y: 0 },
    routePoints: [{ x: 100, y: 30 }, { x: 250, y: 50 }] });
  assert.deepEqual(legacy.routePoints, [
    { id: "lrp-1", x: 100, y: 30 }, { id: "lrp-2", x: 250, y: 50 }
  ]);
  assert.equal(legacy.routePointCounter, 2);
  const existing = normalizeLoom({ id: "loom-stable", routePointCounter: 8,
    routePoints: [{ id: "lrp-3", x: 1, y: 2 }, { id: "lrp-8", x: 3, y: 4 }] });
  assert.deepEqual(existing.routePoints.map(point => point.id), ["lrp-3", "lrp-8"]);
  assert.equal(allocateLoomRoutePointId(existing), "lrp-9");
  existing.routePoints.splice(1, 1);
  assert.equal(addLoomRoutePoint(existing, { x: 5, y: 6 }).id, "lrp-10", "deleted high IDs are not reused");
  assert.deepEqual(normalizeLoom(JSON.parse(JSON.stringify(existing))), existing,
    "normalization is stable across JSON save/reload");
});

test("Loom normalization repairs duplicate route point IDs idempotently without changing geometry", () => {
  const raw = { id: "loom-duplicate", routePointCounter: 4,
    routePoints: [{ id: "lrp-2", x: 10, y: 20 }, { id: "lrp-2", x: 30, y: 40 }, { x: 50, y: 60 }] };
  const normalized = normalizeLoom(raw);
  assert.deepEqual(normalized.routePoints.map(({ x, y }) => ({ x, y })), raw.routePoints.map(({ x, y }) => ({ x, y })));
  assert.deepEqual(normalized.routePoints.map(point => point.id), ["lrp-2", "lrp-5", "lrp-6"]);
  assert.deepEqual(normalizeLoom(normalized), normalized);
});

test("route-point IDs accept only canonical positive lrp integers", () => {
  for (const [id, expected] of [["lrp-1", 1], ["lrp-17", 17], ["lrp-204", 204]]) {
    assert.equal(parseLoomRoutePointId(id), expected);
    assert.equal(isCanonicalLoomRoutePointId(id), true);
  }
  for (const id of ["sideA", "sideB", "foo", "route-1", "LRP-1", "lrp-", "lrp-0", "lrp--1",
    "lrp-01", "lrp-1.5", "", null, 1, "lrp-9007199254740992"]) {
    assert.equal(parseLoomRoutePointId(id), null, `${String(id)} is rejected`);
    assert.equal(isCanonicalLoomRoutePointId(id), false);
  }
});

test("reserved, malformed and duplicate route IDs repair deterministically above the high-water mark", () => {
  const raw = { id: "loom-repair", routePointCounter: 7,
    sideA: { x: 1, y: 2 }, sideB: { x: 500, y: 300 }, routeStyle: "orthogonal",
    routePoints: [
      { id: "sideA", x: 10, y: 10 }, { id: "lrp-3", x: 20, y: 20 },
      { id: "lrp-3", x: 30, y: 30 }, { id: "foo", x: 40, y: 40 },
      { id: "sideB", x: 50, y: 50 }, { id: "lrp-0", x: 60, y: 60 },
      { id: "lrp--3", x: 70, y: 70 }, { x: 80, y: 80 }
    ] };
  const beforeGeometry = loomTrunkPoints(raw);
  const normalized = normalizeLoom(raw);
  assert.deepEqual(normalized.routePoints.map(point => point.id),
    ["lrp-8", "lrp-3", "lrp-9", "lrp-10", "lrp-11", "lrp-12", "lrp-13", "lrp-14"]);
  assert.equal(normalized.routePointCounter, 14);
  assert.deepEqual(normalized.routePoints.map(({ x, y }) => ({ x, y })), raw.routePoints.map(({ x, y }) => ({ x, y })));
  assert.deepEqual(loomTrunkPoints(normalized), beforeGeometry, "identity repair leaves canonical trunk geometry unchanged");
  assert.deepEqual(normalizeLoom(normalized), normalized, "repair is idempotent");

  const example = normalizeLoom({ routePointCounter: 7, routePoints: [
    { id: "sideA", x: 10, y: 10 }, { id: "lrp-3", x: 20, y: 20 },
    { id: "lrp-3", x: 30, y: 30 }, { id: "foo", x: 40, y: 40 }
  ] });
  assert.deepEqual(example.routePoints.map(point => point.id), ["lrp-8", "lrp-3", "lrp-9", "lrp-10"]);
  assert.equal(example.routePointCounter, 10);
});

test("logical nodes, spans and locators stay unambiguous after malformed ID repair", () => {
  const malformed = { id: "loom-malformed", sideA: { x: 0, y: 0 }, sideB: { x: 400, y: 0 },
    routeStyle: "bezier", routePoints: [{ id: "sideA", x: 80, y: 100 }, { id: "sideB", x: 180, y: 80 },
      { id: "lrp-2", x: 280, y: 100 }, { id: "lrp-2", x: 330, y: 50 }] };
  const beforeGeometry = loomTrunkPoints(malformed);
  const loom = normalizeLoom(malformed);
  const nodes = loomRouteControlNodes(loom), spans = loomRouteSpans(loom);
  assert.equal(nodes.filter(node => node.id === "sideA").length, 1);
  assert.equal(nodes.filter(node => node.id === "sideB").length, 1);
  const routeIds = nodes.filter(node => node.kind === "route-point").map(node => node.id);
  assert.ok(routeIds.every(isCanonicalLoomRoutePointId));
  assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length);
  assert.equal(new Set(spans.map(span => span.id)).size, spans.length);
  assert.ok(spans.every(span => span.fromAnchorId !== span.toAnchorId));
  assert.deepEqual(loomTrunkPoints(loom), beforeGeometry);
  const target = { x: 210, y: 60 };
  const locator = locatePointOnLoomRoute(loom, target);
  const resolved = resolveLoomRouteAttachment(loom, locator);
  assert.equal(resolved.valid, true);
  assert.deepEqual([resolved.fromAnchorId, resolved.toAnchorId], [locator.fromAnchorId, locator.toAnchorId]);
  assert.ok(Math.hypot(resolved.point.x - locator.point.x, resolved.point.y - locator.point.y) < 0.01);
});

test("route-point allocation ignores malformed IDs and preserves non-contiguous canonical IDs", () => {
  const loom = { routePointCounter: 0, routePoints: [
    { id: "sideA", x: 0, y: 0 }, { id: "lrp-0", x: 1, y: 1 },
    { id: "foo-1000", x: 2, y: 2 }, { id: "lrp-2", x: 3, y: 3 }
  ] };
  assert.equal(allocateLoomRoutePointId(loom), "lrp-3");
  const saved = normalizeLoom({ routePointCounter: 9,
    routePoints: [{ id: "lrp-4", x: 4, y: 4 }, { id: "lrp-9", x: 9, y: 9 }] });
  assert.deepEqual(normalizeLoom(JSON.parse(JSON.stringify(saved))), saved);
  assert.deepEqual(saved.routePoints.map(point => point.id), ["lrp-4", "lrp-9"]);
});

test("Portal pairs normalize defensively against stable adjacent route anchors", () => {
  const loom = normalizeLoom({ id: "loom-portals", sideA: { x: 0, y: 0 }, sideB: { x: 200, y: 0 },
    routePoints: [{ id: "lrp-1", x: 80, y: 0 }], portalPairs: [{ id: "loom-portal-4", name: "LP-004",
      attachment: { fromAnchorId: "sideA", toAnchorId: "lrp-1", fraction: 1.5 }, portalB: { x: 500, y: 300 } }] });
  assert.deepEqual(loom.portalPairs, [{ id: "loom-portal-4", name: "LP-004",
    attachment: { fromAnchorId: "sideA", toAnchorId: "lrp-1", fraction: 1 }, portalB: { x: 500, y: 300 } }]);
  for (const portalPairs of [
    [{ id: "missing", attachment: { fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: 1, y: 2 } }],
    [{ id: "loom-portal-1", attachment: { fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: 1, y: 2 } }],
    [{ id: "loom-portal-1", name: "LP-002", attachment: { fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: 1, y: 2 } }],
    [{ id: "loom-portal-1", attachment: { fromAnchorId: "sideA", toAnchorId: "sideB", fraction: NaN }, portalB: { x: 1, y: 2 } }],
    [{ id: "loom-portal-1", attachment: { fromAnchorId: "sideA", toAnchorId: "lrp-1", fraction: 0.5 }, portalB: { x: Infinity, y: 2 } }],
    [{ id: "loom-portal-1", attachment: { fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: 1, y: 2 } }],
    [{ id: "loom-portal-1", attachment: { fromAnchorId: "sideA", toAnchorId: "lrp-1", fraction: 0.5 }, portalB: { x: 1, y: 2 } },
      { id: "loom-portal-1", attachment: { fromAnchorId: "lrp-1", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: 3, y: 4 } }]
  ]) assert.doesNotThrow(() => normalizeLoom({ sideA: { x: 0, y: 0 }, sideB: { x: 2, y: 0 },
    routePoints: [{ id: "lrp-1", x: 1, y: 0 }], portalPairs }));
  assert.deepEqual(normalizeLoom({ sideA: { x: 0, y: 0 }, sideB: { x: 2, y: 0 },
    routePoints: [{ id: "lrp-1", x: 1, y: 0 }],
    portalPairs: [{ id: "loom-portal-1", name: "LP-001", attachment: { fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 },
      portalB: { x: 1, y: 1 } }] }).portalPairs, [], "locator anchors must be adjacent in the normalized Loom");
  const excess = normalizeLoomCollection([{ id: "excess", sideA: { x: 0, y: 0 }, sideB: { x: 2, y: 0 },
    portalPairs: [1, 2].map(number => ({ id: `loom-portal-${number}`, name: `LP-${String(number).padStart(3, "0")}`, attachment: {
      fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: number, y: 1 } })) }]);
  assert.equal(excess.looms[0].portalPairs.length, 1);
  assert.equal(excess.looms[0].portalPairs[0].name, "LP-001");
  assert.equal(excess.warnings.length, 1);
});

test("Portal collection repairs duplicate identities and allocates above persistent high water", () => {
  const initial = { looms: [
    { id: "one", portalPairs: [{ id: "loom-portal-2", name: "LP-002", attachment: {
      fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: 10, y: 20 } }] },
    { id: "two", portalPairs: [{ id: "loom-portal-2", name: "LP-002", attachment: {
      fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: 30, y: 40 } }] }
  ], loomPortalNumberCounter: 3 };
  const normalized = normalizeLoomCollection(initial.looms, initial.loomPortalNumberCounter);
  assert.deepEqual(normalized.looms.map(loom => loom.portalPairs[0].id), ["loom-portal-2", "loom-portal-4"]);
  assert.deepEqual(normalized.looms.map(loom => loom.portalPairs[0].name), ["LP-002", "LP-004"]);
  assert.equal(normalized.loomPortalNumberCounter, 4);
  const project = { ...initial, looms: normalized.looms };
  assert.deepEqual(allocateLoomPortalIdentity(project), { id: "loom-portal-5", name: "LP-005" });
  assert.equal(project.loomPortalNumberCounter, 5);
});

test("Portal route split retains canonical trunk and never bridges the Portal gap", () => {
  for (const routeStyle of ["orthogonal", "bezier"]) {
    const loom = normalizeLoom({ id: "split", routeStyle, sideA: { x: 0, y: 0 }, sideB: { x: 240, y: 100 },
      routePoints: [{ id: "lrp-1", x: 100, y: 0 }, { id: "lrp-2", x: 100, y: 100 }],
      portalPairs: [{ id: "loom-portal-1", name: "LP-001", attachment: {
        fromAnchorId: "lrp-1", toAnchorId: "lrp-2", fraction: 0.5 }, portalB: { x: 400, y: 300 } }] });
    const canonical = loomTrunkPoints(loom);
    const split = splitLoomRouteAtAttachment(loom, loom.portalPairs[0].attachment, loom.portalPairs[0].portalB);
    const resolved = resolveLoomRouteAttachment(loom, loom.portalPairs[0].attachment);
    assert.equal(split.valid, true);
    assert.deepEqual(split.portalA, resolved.point);
    assert.deepEqual(split.sectionA.at(-1), resolved.point);
    assert.deepEqual(split.sectionB[0], loom.portalPairs[0].portalB);
    assert.deepEqual(loomTrunkPoints(loom), canonical, "derived split does not rewrite canonical route");
    assert.ok(split.sectionB.length > 2);
    if (routeStyle === "orthogonal") {
      assert.ok(split.sectionB.slice(0, 3).every((point, index, points) => !index
        || points[index - 1].x === point.x || points[index - 1].y === point.y), "Portal B tail is orthogonal");
    }
    const spans = loomRouteSpans(loom);
    const owner = spans.findIndex(span => span.fromAnchorId === "lrp-1" && span.toAnchorId === "lrp-2");
    const downstreamSpan = spans[owner + 1];
    const downstream = loomRouteSpanPolyline(loom, downstreamSpan.fromAnchorId, downstreamSpan.toAnchorId);
    assert.deepEqual(split.sectionB.slice(-downstream.length), downstream, "downstream canonical spans are reused");
    assert.equal(locatePointOnLoomRoute(loom, split.portalA).valid, true);
  }
});

test("route topology edits rebase an invalid Portal locator and preserve Portal B", () => {
  const before = normalizeLoom({ id: "rebase", routeStyle: "orthogonal", sideA: { x: 0, y: 0 },
    sideB: { x: 200, y: 0 }, portalPairs: [{ id: "loom-portal-1", name: "LP-001", attachment: {
      fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.5 }, portalB: { x: 400, y: 300 } }] });
  const after = structuredClone(before);
  after.routePoints = [{ id: "lrp-1", x: 100, y: 100 }];
  assert.equal(resolveLoomRouteAttachment(after, before.portalPairs[0].attachment).valid, false);
  assert.equal(rebaseLoomPortalAttachments([before], [after]), true);
  const rebased = after.portalPairs[0].attachment;
  assert.equal(resolveLoomRouteAttachment(after, rebased).valid, true);
  assert.deepEqual(after.portalPairs[0].portalB, before.portalPairs[0].portalB);
  assert.ok(rebased.fromAnchorId !== "sideA" || rebased.toAnchorId !== "sideB");
  assert.equal(rebaseLoomPortalAttachments([before], [{ ...after, routePoints: [], portalPairs: [
    { ...after.portalPairs[0], attachment: { fromAnchorId: "missing", toAnchorId: "sideB", fraction: 0.5 } }
  ] }]), true, "rebased routes stay well formed on subsequent edits");
});

test("legacy Loom migration materializes route IDs without changing canonical trunk geometry", () => {
  const legacy = { looms: [{ id: "loom-legacy", name: "LM-OLD", sideA: { x: 10, y: 20 },
    sideB: { x: 410, y: 220 }, routeStyle: "orthogonal",
    routePoints: [{ x: 120, y: 80 }, { x: 300, y: 160 }] }], connections: [] };
  const before = loomTrunkPoints(legacy.looms[0]);
  assert.deepEqual(migrateLegacyLooms(legacy), []);
  assert.deepEqual(legacy.looms[0].routePoints.map(({ id }) => id), ["lrp-1", "lrp-2"]);
  assert.deepEqual(loomTrunkPoints(legacy.looms[0]), before);
  const reloaded = JSON.parse(JSON.stringify(legacy));
  assert.deepEqual(migrateLegacyLooms(reloaded), []);
  assert.deepEqual(reloaded.looms[0].routePoints, legacy.looms[0].routePoints);
});

test("logical Loom nodes and spans use stable anchor identifiers", () => {
  const loom = normalizeLoom({ id: "loom-span", sideA: { x: 0, y: 0 }, sideB: { x: 300, y: 0 },
    routePoints: [{ id: "lrp-4", x: 100, y: 20 }, { id: "lrp-9", x: 200, y: 40 }] });
  assert.deepEqual(loomRouteControlNodes(loom).map(node => [node.id, node.kind]), [
    ["sideA", "side"], ["lrp-4", "route-point"], ["lrp-9", "route-point"], ["sideB", "side"]
  ]);
  assert.deepEqual(loomRouteSpans(loom).map(span => span.id), [
    "sideA=>lrp-4", "lrp-4=>lrp-9", "lrp-9=>sideB"
  ]);
});

test("Loom route locators round-trip across orthogonal elbows and canonical Bezier spans", () => {
  const cases = [
    { routeStyle: "orthogonal", routePoints: [], sideB: { x: 300, y: 0 } },
    { routeStyle: "orthogonal", routePoints: [{ id: "lrp-1", x: 100, y: 100 }], sideB: { x: 300, y: 0 } },
    { routeStyle: "orthogonal", routePoints: [{ id: "lrp-1", x: 100, y: 100 },
      { id: "lrp-2", x: 250, y: -20 }], sideB: { x: 400, y: 80 } },
    { routeStyle: "bezier", routePoints: [], sideB: { x: 300, y: 120 } },
    { routeStyle: "bezier", routePoints: [{ id: "lrp-1", x: 100, y: 120 },
      { id: "lrp-2", x: 240, y: -50 }], sideB: { x: 400, y: 100 } }
  ];
  for (const [caseIndex, source] of cases.entries()) {
    const loom = normalizeLoom({ id: `geometry-${caseIndex}`, sideA: { x: 0, y: 0 }, ...source });
    const span = loomRouteSpans(loom)[Math.floor(loomRouteSpans(loom).length / 2)];
    const points = loomRouteSpanPolyline(loom, span.fromAnchorId, span.toAnchorId);
    const target = pointOnPolyline(points, 0.37);
    const locator = locatePointOnLoomRoute(loom, target);
    assert.equal(locator.valid, true, `case ${caseIndex} captures a valid locator`);
    assert.equal(locator.fromAnchorId, span.fromAnchorId);
    assert.equal(locator.toAnchorId, span.toAnchorId);
    const resolved = resolveLoomRouteAttachment(loom, locator);
    assert.equal(resolved.valid, true);
    assert.ok(Math.hypot(resolved.point.x - locator.point.x, resolved.point.y - locator.point.y) < 0.01);
    assert.ok(Math.hypot(resolved.point.x - target.x, resolved.point.y - target.y) < 3,
      `case ${caseIndex} round trips to the projected path point`);
  }
});

test("Loom locators survive edits elsewhere, route-style changes, and invalidate when an owner anchor is deleted", () => {
  const loom = normalizeLoom({ id: "stable-locator", sideA: { x: 0, y: 0 }, sideB: { x: 400, y: 0 },
    routeStyle: "orthogonal", routePoints: [{ id: "lrp-1", x: 100, y: 80 }, { id: "lrp-2", x: 250, y: 120 }] });
  const locator = { fromAnchorId: "lrp-1", toAnchorId: "lrp-2", fraction: 0.42 };
  assert.equal(resolveLoomRouteAttachment(loom, locator).valid, true);
  loom.routePoints[0].x += 20;
  assert.equal(resolveLoomRouteAttachment(loom, locator).valid, true);
  loom.routeStyle = "bezier";
  assert.equal(resolveLoomRouteAttachment(loom, locator).valid, true);
  loom.routePoints.unshift({ id: "lrp-7", x: 40, y: 10 });
  assert.equal(resolveLoomRouteAttachment(loom, { fromAnchorId: "lrp-2", toAnchorId: "sideB", fraction: 0.6 }).valid, true);
  loom.routePoints = loom.routePoints.filter(point => point.id !== "lrp-2");
  assert.equal(resolveLoomRouteAttachment(loom, locator).valid, false);
  assert.equal(resolveLoomRouteAttachment(loom, { fromAnchorId: "sideA", toAnchorId: "lrp-7", fraction: 1.5 }).fraction, 1,
    "finite locator fractions clamp to the span endpoints");
  assert.equal(resolveLoomRouteAttachment(loom, { fromAnchorId: "lrp-7", toAnchorId: "sideB", fraction: 0.5 }).valid, false,
    "non-adjacent anchor pairs are invalid");
});

function pointOnPolyline(points, fraction) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let target = total * fraction;
  for (let index = 0; index < lengths.length; index += 1) {
    if (target <= lengths[index] || index === lengths.length - 1) {
      const t = lengths[index] ? target / lengths[index] : 0;
      return { x: points[index].x + (points[index + 1].x - points[index].x) * t,
        y: points[index].y + (points[index + 1].y - points[index].y) * t };
    }
    target -= lengths[index];
  }
  return points.at(-1);
}

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

test("Loom Portal presentation does not change logical cables, Cable Schedule, or Signal Chain", () => {
  const project = jumpProject();
  project.connections.forEach(wire => { wire.loomId = "loom-1"; });
  project.looms = [{ id: "loom-1", name: "LM-001", sideA: { x: 180, y: 100 }, sideB: { x: 760, y: 100 },
    routeStyle: "orthogonal", routePoints: [], trunkLength: "75 m" }];
  const signature = () => JSON.stringify(project.connections.map(({ id, from, to, cableType, cableNumber,
    length, notes, loomId }) => ({ id, from, to, cableType, cableNumber, length, notes, loomId })));
  const cablesBefore = signature();
  const scheduleBefore = buildCableSchedule(project, { assignNumbers: "readOnly" });
  const chainBefore = scheduleBefore.map(row => signalChainForWire(scheduleBefore, row.wireIds[0]));
  project.looms[0].portalPairs = [{ id: "loom-portal-1", name: "LP-001", attachment: {
    fromAnchorId: "sideA", toAnchorId: "sideB", fraction: 0.45 }, portalB: { x: 1000, y: 320 } }];
  assert.equal(signature(), cablesBefore);
  const scheduleAfter = buildCableSchedule(project, { assignNumbers: "readOnly" });
  assert.deepEqual(scheduleAfter, scheduleBefore);
  assert.deepEqual(scheduleAfter.map(row => signalChainForWire(scheduleAfter, row.wireIds[0])), chainBefore);
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
