import assert from "node:assert/strict";

import {
  areEngineConnectorTypesCompatible,
  ENGINE_FIBER_MODE_OPTIONS,
  effectiveConnectorTypeForEngine,
  engineAllowedFiberModesForCompatibility,
  engineCompatibilitySummary,
  engineConnectionError,
  engineFiberModeColor,
  engineWireColorForCable,
  installedModuleDetailsForEngine,
  isEngineDeadCageConnector
} from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import {
  ORTHOGONAL_EXIT_OFFSET,
  ORTHOGONAL_WIRE_SNAP_STEPS,
  ORTHOGONAL_WIRE_SPACING,
  compactExcessOrthogonalRouteRuns,
  createOrthogonalRouteModel,
  moveOrthogonalRoutePoint,
  orthogonalRouteDiagnostics,
  routePointsForMovedEndpoints,
  snapOrthogonalSegmentFixed
} from "../src/engine/orthogonalRouting.js";
import {
  addWireRoutePoint,
  removeWireRoutePoint,
  resetWireRoute,
  wireRouteStatesEqual
} from "../src/engine/wireRouteEditing.js";
import { DragSession } from "../src/engine/dragSession.js";

const cases = [];

function hit(deviceId, connector) {
  return {
    device: { id: deviceId, label: deviceId },
    connector: {
      id: connector.id || `${connector.type}-${connector.direction || "io"}`,
      label: connector.label || connector.id || connector.type,
      direction: connector.direction || "io",
      ...connector
    }
  };
}

function expectValid(label, source, target, rule = null) {
  const summary = engineCompatibilitySummary(source, target);
  cases.push({ label, valid: summary.valid, rule: summary.rule, reason: summary.reason });
  assert.equal(summary.valid, true, `${label}: expected valid, got ${summary.reason}`);
  if (rule) assert.equal(summary.rule, rule, `${label}: expected rule ${rule}`);
  assert.equal(engineConnectionError(source, target), "", `${label}: expected empty error`);
}

function expectInvalid(label, source, target, rule) {
  const summary = engineCompatibilitySummary(source, target);
  cases.push({ label, valid: summary.valid, rule: summary.rule, reason: summary.reason });
  assert.equal(summary.valid, false, `${label}: expected invalid`);
  assert.equal(summary.rule, rule, `${label}: expected rule ${rule}`);
  assert.ok(engineConnectionError(source, target), `${label}: expected error message`);
}

const hdmiOut = hit("A", { id: "out-1", type: "hdmi", direction: "output", label: "OUT 1" });
const hdmiIn = hit("B", { id: "in-1", type: "hdmi", direction: "input", label: "IN 1" });
const hdmiOut2 = hit("B", { id: "out-2", type: "hdmi", direction: "output", label: "OUT 2" });
const hdmiIn2 = hit("B", { id: "in-2", type: "hdmi", direction: "input", label: "IN 2" });

expectValid("same type output to input", hdmiOut, hdmiIn, "directional");
expectInvalid("same physical connector", hdmiOut, hdmiOut, "same-connector");
expectInvalid("same type output to output", hdmiOut, hdmiOut2, "output-output");
expectInvalid("same type input to input", hdmiIn, hdmiIn2, "input-input");
expectInvalid(
  "signal type mismatch",
  hdmiOut,
  hit("C", { id: "sdi-in", type: "sdi", direction: "input", label: "SDI IN" }),
  "type-mismatch"
);
expectInvalid(
  "power to signal mismatch",
  hit("PDU", { id: "iec-out", type: "iec", direction: "output", label: "IEC" }),
  hdmiIn,
  "type-mismatch"
);

expectValid(
  "CAT family cross-connect",
  hit("Switch A", { id: "cat6-out", type: "cat6", direction: "output", label: "CAT6" }),
  hit("Switch B", { id: "ethercon-out", type: "ethercon", direction: "output", label: "etherCON" }),
  "paired-network"
);
expectValid(
  "USB family cross-connect",
  hit("Computer", { id: "usb-c", type: "usb-c", direction: "output", label: "USB-C" }),
  hit("Adapter", { id: "usb-a", type: "usb-a", direction: "input", label: "USB-A" }),
  "two-way"
);
expectValid(
  "two-way fiber ignores same direction",
  hit("Fiber A", { id: "lc-a", type: "fiber-lc", direction: "input", label: "Fiber LC" }),
  hit("Fiber B", { id: "lc-b", type: "fiber-lc", direction: "input", label: "Fiber LC" }),
  "two-way"
);

const emptyCage = hit("Cage A", { id: "sfp-a", type: "sfp-plus-cage", direction: "input", installedModuleType: "" });
const lcCage = hit("Cage B", { id: "sfp-b", type: "sfp-plus-cage", direction: "output", installedModuleType: "lc-multimode" });
const rj45Cage = hit("Cage C", { id: "sfp-c", type: "sfp-cage", direction: "output", installedModuleType: "rj45-ethernet" });
const labelLcCage = hit("Cage D", { id: "sfp-d", type: "sfp-plus-cage", direction: "input", installedModuleType: "SFP+ LC Multimode" });
const objectLcCage = hit("Cage E", {
  id: "sfp-e",
  type: "sfp-plus-cage",
  direction: "output",
  installedModule: { id: "module-lc-mm", label: "LC Multimode", activeType: "fiber-lc" }
});
const qsfpMpoCage = hit("Cage F", { id: "qsfp-f", type: "qsfp-cage", direction: "output", installedModuleType: "QSFP MPO Fiber" });
const lcSingleCageA = hit("Single Cage A", { id: "sfp-single-a", type: "sfp-plus-cage", direction: "output", installedModuleType: "lc-singlemode" });
const lcSingleCageB = hit("Single Cage B", { id: "sfp-single-b", type: "sfp-plus-cage", direction: "input", installedModuleType: "LC Singlemode OS2" });
const lcMultiCageA = hit("Multi Cage A", { id: "sfp-multi-a", type: "sfp-plus-cage", direction: "output", installedModuleType: "lc-multimode" });
const lcMultiCageB = hit("Multi Cage B", { id: "sfp-multi-b", type: "sfp-plus-cage", direction: "input", installedModuleType: "LC Multimode OM3" });

assert.equal(isEngineDeadCageConnector(emptyCage.connector), true, "empty cage should be dead");
assert.equal(effectiveConnectorTypeForEngine(emptyCage.connector), "", "empty cage has no effective type");
assert.equal(effectiveConnectorTypeForEngine(lcCage.connector), "fiber-lc", "LC module maps to Fiber LC");
assert.equal(effectiveConnectorTypeForEngine(rj45Cage.connector), "cat6a", "RJ45 module maps to CAT6A");
assert.equal(effectiveConnectorTypeForEngine(labelLcCage.connector), "fiber-lc", "label-style LC module maps to Fiber LC");
assert.equal(effectiveConnectorTypeForEngine(objectLcCage.connector), "fiber-lc", "object-style LC module maps to Fiber LC");
assert.equal(effectiveConnectorTypeForEngine(qsfpMpoCage.connector), "fiber-mpo", "QSFP MPO module maps to Fiber MPO");
assert.equal(installedModuleDetailsForEngine(objectLcCage.connector).id, "module-lc-mm", "module details report id");
assert.equal(installedModuleDetailsForEngine(objectLcCage.connector).name, "LC Multimode", "module details report name");
assert.equal(installedModuleDetailsForEngine(objectLcCage.connector).effectiveType, "fiber-lc", "module details report effective type");
assert.equal(installedModuleDetailsForEngine(objectLcCage.connector).fiberMode, "om4", "module details report fiber mode");
{
  const summary = engineCompatibilitySummary(labelLcCage, objectLcCage);
  assert.equal(summary.sourceEffectiveType, "fiber-lc", "summary reports source effective type");
  assert.equal(summary.targetEffectiveType, "fiber-lc", "summary reports target effective type");
  assert.equal(summary.sourceCageType, "sfp-plus-cage", "summary reports source cage type");
  assert.equal(summary.targetCageType, "sfp-plus-cage", "summary reports target cage type");
  assert.equal(summary.targetInstalledModuleId, "module-lc-mm", "summary reports target installed module id");
  assert.equal(summary.targetInstalledModuleName, "LC Multimode", "summary reports target installed module name");
}
expectInvalid("dead cage cannot connect", emptyCage, lcCage, "dead-cage");
expectInvalid("empty cage to installed LC cage cannot connect", emptyCage, labelLcCage, "dead-cage");
expectValid(
  "active LC cage connects as Fiber LC",
  lcCage,
  hit("Fiber Device", { id: "lc-in", type: "fiber-lc", direction: "input", label: "Fiber LC", fiberMode: "om4" }),
  "two-way"
);
expectValid(
  "installed LC cage connects to installed LC cage",
  labelLcCage,
  objectLcCage,
  "two-way"
);
expectValid("singlemode LC cage connects to singlemode LC cage", lcSingleCageA, lcSingleCageB, "two-way");
expectValid("multimode LC cage connects to multimode LC cage", lcMultiCageA, lcMultiCageB, "two-way");
expectInvalid("singlemode LC cage rejects multimode LC cage", lcSingleCageA, lcMultiCageA, "fiber-mode-mismatch");
expectInvalid(
  "installed LC cage rejects incompatible installed RJ45 cage",
  labelLcCage,
  rj45Cage,
  "type-mismatch"
);
expectValid(
  "installed QSFP MPO cage connects as Fiber MPO",
  qsfpMpoCage,
  hit("Fiber MPO Device", { id: "mpo-in", type: "fiber-mpo", direction: "input", label: "Fiber MPO" }),
  "two-way"
);
expectValid(
  "active RJ45 cage joins CAT family",
  rj45Cage,
  hit("Switch", { id: "cat5e-in", type: "cat5e", direction: "input", label: "CAT5E" }),
  "paired-network"
);
expectInvalid(
  "RJ45 cage rejects fiber",
  rj45Cage,
  hit("Fiber Device", { id: "lc-rj45-reject", type: "fiber-lc", direction: "input", label: "Fiber LC", fiberMode: "single-mode" }),
  "type-mismatch"
);
expectInvalid(
  "QSFP MPO cage rejects LC fiber",
  qsfpMpoCage,
  hit("Fiber LC Device", { id: "lc-qsfp-reject", type: "fiber-lc", direction: "input", label: "Fiber LC", fiberMode: "single-mode" }),
  "type-mismatch"
);

assert.deepEqual(
  engineAllowedFiberModesForCompatibility(lcSingleCageA.connector, lcSingleCageB.connector),
  ["single-mode"],
  "singlemode LC cages should only allow single-mode fiber options"
);
assert.deepEqual(
  engineAllowedFiberModesForCompatibility(lcMultiCageA.connector, lcMultiCageB.connector),
  ["om1-om2", "om3", "om4", "om5"],
  "multimode LC cages should allow multimode fiber options"
);
assert.equal(engineFiberModeColor("single-mode"), "#FFFF00", "single-mode color matches Legacy");
assert.equal(engineFiberModeColor("om1-om2"), "#F47C20", "OM1/OM2 color matches Legacy");
assert.equal(engineFiberModeColor("om3"), "#14DDE0", "OM3 color matches Legacy");
assert.equal(engineFiberModeColor("om4"), "#EC2CB9", "OM4 color matches Legacy");
assert.equal(engineFiberModeColor("om5"), "#66FF33", "OM5 color matches Legacy");
assert.equal(engineWireColorForCable("fiber-lc", "om4"), "#EC2CB9", "fiber wire color follows selected mode");
assert.equal(ENGINE_FIBER_MODE_OPTIONS.length, 5, "Legacy fiber mode list is complete");

assert.equal(areEngineConnectorTypesCompatible(hdmiOut.connector, hdmiIn.connector), true, "same type compatibility");
assert.equal(areEngineConnectorTypesCompatible(hdmiOut.connector, lcCage.connector), false, "different families incompatible");

const normalizedCageProject = normalizeAvDesignerProject({
  projectName: "SFP scene preservation test",
  deviceLibrary: [{
    id: "sfp-template",
    name: "SFP Test Device",
    width: 180,
    height: 96,
    connectors: [{
      id: "sfp-port",
      label: "SFP+ Cage",
      type: "sfp-plus-cage",
      direction: "output",
      x: 180,
      y: 48,
      installedModuleType: ""
    }]
  }],
  devices: [{
    instanceId: "sfp-device",
    templateId: "sfp-template",
    name: "SFP Device",
    x: 0,
    y: 0,
    connectorOverrides: {
      "sfp-port": {
        installedModuleType: "lc-multimode",
        fiberMode: "om4"
      }
    }
  }],
  connections: []
}, { dataSource: "compatibility test", sourceName: "SFP scene preservation" });
const scene = new SceneGraph();
scene.setData(normalizedCageProject);
const sceneConnector = scene.getConnector("sfp-device", "sfp-port");
assert.equal(sceneConnector.installedModuleType, "lc-multimode", "SceneGraph preserves installed SFP module type");
assert.equal(sceneConnector.fiberMode, "om4", "SceneGraph preserves installed SFP fiber mode");
assert.equal(effectiveConnectorTypeForEngine(sceneConnector), "fiber-lc", "SceneGraph connector resolves installed SFP module");
assert.equal(isEngineDeadCageConnector(sceneConnector), false, "SceneGraph installed SFP cage is not dead");

assert.equal(ORTHOGONAL_WIRE_SPACING, 15, "Legacy orthogonal default spacing is 15px");
assert.deepEqual(ORTHOGONAL_WIRE_SNAP_STEPS, [10, 15, 20, 25, 30], "Legacy segment snap steps are preserved");
{
  const from = { x: 100, y: 50 };
  const to = { x: 500, y: 250 };
  const routePoints = [
    { x: 150, y: 50 },
    { x: 150, y: 120 },
    { x: 300, y: 120 },
    { x: 300, y: 200 },
    { x: 450, y: 200 },
    { x: 450, y: 250 },
  ];
  const model = createOrthogonalRouteModel({ from, to, routePoints });
  assert.equal(model.segments[0].protected, true, "source endpoint stub is protected");
  assert.equal(model.segments.at(-1).protected, true, "target endpoint stub is protected");
  assert.equal(model.segments[3].orientation, "v", "middle dogleg orientation is explicit");
  assert.equal(model.segments[3].draggable, true, "middle dogleg is directly draggable");
  const dogleg = model.moveSegment(3, 360);
  assert.equal(dogleg.routePoints.length, routePoints.length, "dogleg drag preserves route point identity/count");
  assert.deepEqual(dogleg.routePoints.slice(2, 4), [
    { x: 360, y: 120 },
    { x: 360, y: 200 },
  ], "vertical dogleg drag moves both adjacent corners together");
  const corner = moveOrthogonalRoutePoint({
    from,
    to,
    routePoints,
    pointIndex: 2,
    nextPoint: { x: 340, y: 160 },
  });
  const cornerDiagnostics = orthogonalRouteDiagnostics({ from, to, routePoints: corner.routePoints });
  assert.equal(cornerDiagnostics.allOrthogonal, true, "corner drag cannot create diagonal route spans");
  assert.equal(corner.routePoints[0].y, from.y, "corner drag preserves source connector stub Y");
  assert.equal(corner.routePoints.at(-1).y, to.y, "corner drag preserves target connector stub Y");
}
{
  const snap = snapOrthogonalSegmentFixed({
    segment: { orientation: "v", fixed: 114.2, min: 0, max: 200 },
    fixedValue: 114.2,
    wireId: "moving",
    segmentIndex: 2,
    targets: [{ wireId: "target", segmentIndex: 1, orientation: "v", fixed: 100, min: -20, max: 220 }],
    zoom: 1,
    enabled: true
  });
  assert.equal(snap.snapped, true, "vertical dogleg snaps to parallel spacing lane");
  assert.equal(snap.value, 115, "vertical dogleg snaps to target + 15px");
  assert.equal(snap.spacing, 15, "snap reports 15px spacing");
  assert.equal(snap.source, "spacing", "snap source reports spacing");
}
{
  const snap = snapOrthogonalSegmentFixed({
    segment: { orientation: "h", fixed: 297, min: 0, max: 200 },
    fixedValue: 297,
    targets: [],
    endpointTargets: [300],
    zoom: 1,
    enabled: true
  });
  assert.equal(snap.value, 300, "horizontal segment snaps to endpoint Y");
  assert.equal(snap.source, "endpoint", "endpoint snap source is reported");
}
{
  const snap = snapOrthogonalSegmentFixed({
    segment: { orientation: "v", fixed: 114.2, min: 0, max: 200 },
    fixedValue: 114.2,
    targets: [{ wireId: "target", segmentIndex: 1, orientation: "v", fixed: 100, min: -20, max: 220 }],
    zoom: 1,
    enabled: false
  });
  assert.equal(snap.snapped, false, "disabled object snapping leaves fixed value alone");
  assert.equal(snap.value, 114, "disabled snap still stores routed integer coordinates");
}
{
  const objectSnapScene = new SceneGraph();
  objectSnapScene.setData({
    devices: [
      {
        id: "snap-moving",
        label: "Moving Device",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        connectors: []
      },
      {
        id: "snap-target",
        label: "Target Device",
        x: 250,
        y: 170,
        width: 100,
        height: 100,
        connectors: []
      }
    ],
    wires: []
  });
  const drag = new DragSession({
    scene: objectSnapScene,
    selectedIds: ["snap-moving"],
    startWorld: { x: 0, y: 0 },
    enableSnapping: true
  });
  drag.update({ x: 144, y: 0 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(drag.dx, 150, "engine object drag snaps moving right edge to target left edge");
  assert.equal(drag.snapGuides.x, 250, "engine object drag exposes the vertical snap guide");
  assert.deepEqual(
    drag.snapGuides.edgeX,
    { side: "right", x: 250, y1: 0, y2: 100 },
    "engine object drag exposes the aligned moving edge instead of requiring a full crosshair"
  );
  assert.equal(drag.snapCandidateCount, 1, "engine object drag reports the target candidate");
  assert.equal(drag.snapDiagnostics?.lastSnapped, true, "engine object drag diagnostics report snapped state");
  drag.snapSession.targetIndex.clear();
  drag.update({ x: 147, y: 2 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(drag.dx, 150, "engine object drag keeps the snapped X edge locked");
  assert.equal(drag.dy, 2, "engine object drag keeps the free Y axis live");
  assert.equal(
    drag.snapDiagnostics?.candidateSource,
    "array",
    "engine object drag recalculates active snaps instead of reusing a sticky snapped delta"
  );
  assert.deepEqual(
    drag.snapGuides.edgeX,
    { side: "right", x: 250, y1: 2, y2: 102 },
    "engine object drag cached edge guide follows the free drag axis"
  );
  drag.update({ x: 152, y: 0 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(drag.dx, 150, "engine object drag still snaps when the target spatial index is cold");
  assert.equal(drag.snapDiagnostics?.candidateSource, "array", "engine object drag can use frozen drag-start candidates without the index");

  drag.update({ x: 180, y: 44 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(drag.dx, 180, "engine object drag releases X snap when the pointer leaves snap range");
  assert.equal(drag.dy, 44, "engine object drag follows raw Y after snap release");
  assert.equal(drag.snapGuides, null, "engine object drag clears edge guides after snap release");

  drag.update({ x: 25, y: 66 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(drag.dx, 25, "engine object drag keeps X live when only Y can snap");
  assert.equal(drag.dy, 70, "engine object drag snaps the moving bottom edge to target top edge");
  assert.deepEqual(
    drag.snapGuides.edgeY,
    { side: "bottom", y: 170, x1: 25, x2: 125 },
    "engine object drag exposes the aligned moving horizontal edge"
  );
}
{
  const lowZoomScene = new SceneGraph();
  lowZoomScene.setData({
    devices: [
      {
        id: "low-zoom-moving",
        label: "Moving Device",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        connectors: []
      },
      {
        id: "low-zoom-target",
        label: "Distant Target",
        x: 2000,
        y: 0,
        width: 100,
        height: 100,
        connectors: []
      }
    ],
    wires: []
  });
  const drag = new DragSession({
    scene: lowZoomScene,
    selectedIds: ["low-zoom-moving"],
    startWorld: { x: 0, y: 0 },
    enableSnapping: true
  });
  drag.update({ x: 0, y: 0 }, { camera: { zoom: 0.1 }, snappingEnabled: true });
  drag.update({ x: 20, y: 12 }, { camera: { zoom: 0.1 }, snappingEnabled: true });
  assert.equal(drag.dx, 20, "low-zoom object drag follows mouse without a stale unsnapped cache");
  assert.equal(drag.dy, 12, "low-zoom object drag follows mouse Y without a stale unsnapped cache");
  assert.equal(drag.snapGuides, null, "low-zoom free drag does not invent stale snap guides");
}
{
  const objectSpacingScene = new SceneGraph();
  objectSpacingScene.setData({
    devices: [
      {
        id: "spacing-moving",
        label: "Moving Device",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        connectors: []
      },
      {
        id: "spacing-target",
        label: "Target Device",
        x: 0,
        y: 200,
        width: 100,
        height: 100,
        connectors: []
      }
    ],
    wires: []
  });
  const drag = new DragSession({
    scene: objectSpacingScene,
    selectedIds: ["spacing-moving"],
    startWorld: { x: 0, y: 0 },
    enableSnapping: true
  });
  drag.update({ x: 0, y: 349 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(drag.dy, 350, "engine object drag snaps to the 50px vertical spacing lane");
  assert.equal(drag.snapGuides.measure?.axis, "y", "engine spacing snap exposes a measurement guide");
  assert.equal(drag.snapGuides.measure?.distance, 50, "engine spacing snap reports the snapped spacing distance");

  const outerZoomDrag = new DragSession({
    scene: objectSpacingScene,
    selectedIds: ["spacing-moving"],
    startWorld: { x: 0, y: 0 },
    enableSnapping: true
  });
  outerZoomDrag.update({ x: 0, y: 349 }, { camera: { zoom: 0.2 }, snappingEnabled: true });
  assert.equal(outerZoomDrag.dy, 350, "engine spacing guide remains active at the wider outer zoom range");
  assert.equal(outerZoomDrag.snapGuides.measure?.distance, 50, "outer zoom spacing snap still reports its pixel distance");
}
{
  const dragScene = new SceneGraph();
  dragScene.setData({
    devices: [
      {
        id: "tx",
        label: "TX",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        connectors: [{ id: "out", label: "OUT", side: "right", direction: "output", x: 100, y: 50 }]
      },
      {
        id: "rx",
        label: "RX",
        x: 400,
        y: 100,
        width: 100,
        height: 100,
        connectors: [{ id: "in", label: "IN", side: "left", direction: "input", x: 0, y: 50 }]
      }
    ],
    wires: [{
      id: "orthogonal-wire",
      fromDeviceId: "tx",
      fromConnectorId: "out",
      toDeviceId: "rx",
      toConnectorId: "in",
      routeStyle: "orthogonal",
      routePoints: [{ x: 200, y: 50 }, { x: 200, y: 150 }],
      color: "#ff0",
      cableType: "HDMI"
    }]
  });
  const wire = dragScene.getWire("orthogonal-wire");
  const originalRoutePoints = wire.routePoints.map(point => ({ ...point }));
  const outputX = dragScene.endpointForWire(wire, "from").x;
  const collapsed = dragScene.moveOrthogonalSegment("orthogonal-wire", 1, outputX, {
    sourceRoutePoints: originalRoutePoints,
    refreshIndexes: false
  });
  assert.equal(collapsed.moved, true, "orthogonal segment can be dragged onto endpoint lane");
  assert.equal(collapsed.fixed, outputX + ORTHOGONAL_EXIT_OFFSET, "endpoint-adjacent dogleg keeps Legacy exit clearance");
  assert.equal(collapsed.endpointClearance.adjusted, true, "endpoint clearance reports the prevented collapse");
  assert.equal(dragScene.orthogonalSegmentInfo("orthogonal-wire", 1).draggable, true, "dogleg remains editable after touching endpoint clearance");
  const recovered = dragScene.moveOrthogonalSegment("orthogonal-wire", 1, 260, {
    sourceRoutePoints: originalRoutePoints,
    refreshIndexes: false
  });
  assert.equal(recovered.moved, true, "stable drag-start route keeps segment movable after endpoint contact");
  assert.equal(recovered.fixed, 260, "segment recovers from endpoint contact to requested fixed coordinate");
  assert.equal(dragScene.getWire("orthogonal-wire").routePoints.some(point => point.x === 260), true, "recovered route stores moved dogleg coordinate");
  const diagnostics = orthogonalRouteDiagnostics({
    routePoints: dragScene.getWire("orthogonal-wire").routePoints,
    from: dragScene.endpointForWire(dragScene.getWire("orthogonal-wire"), "from"),
    to: dragScene.endpointForWire(dragScene.getWire("orthogonal-wire"), "to")
  });
  assert.equal(diagnostics.allOrthogonal, true, "diagnostics confirms recovered route is orthogonal");
  assert.equal(diagnostics.remainsEditable, true, "diagnostics confirms recovered route remains editable");

  const crossed = dragScene.moveOrthogonalSegment("orthogonal-wire", 1, outputX - 10, {
    sourceRoutePoints: originalRoutePoints,
    refreshIndexes: false
  });
  assert.equal(crossed.moved, true, "endpoint-adjacent dogleg can be pulled past the connector instead of getting stuck");
  assert.equal(crossed.fixed, outputX - ORTHOGONAL_EXIT_OFFSET, "opposite-side pull keeps clearance on the opposite side");
  assert.equal(crossed.endpointClearance.adjusted, true, "opposite-side endpoint clearance is reported");
}
{
  const shortOverlap = compactExcessOrthogonalRouteRuns([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 150, y: 0 }
  ]);
  assert.deepEqual(shortOverlap, [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 150, y: 0 }
  ], "short overlapping/collinear route runs keep meaningful editable points");
  const longRun = compactExcessOrthogonalRouteRuns([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 150, y: 0 },
    { x: 200, y: 0 }
  ]);
  assert.deepEqual(longRun, [
    { x: 0, y: 0 },
    { x: 200, y: 0 }
  ], "only excessive straight route runs are compacted like Legacy");
}
{
  const snapCleanupScene = new SceneGraph();
  snapCleanupScene.setData({
    devices: [
      {
        id: "snap-tx",
        label: "TX",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        connectors: [{ id: "out", label: "OUT", side: "right", direction: "output", x: 100, y: 50 }]
      },
      {
        id: "snap-rx",
        label: "RX",
        x: 400,
        y: 100,
        width: 100,
        height: 100,
        connectors: [{ id: "in", label: "IN", side: "left", direction: "input", x: 0, y: 50 }]
      }
    ],
    wires: [{
      id: "snapped-corner-wire",
      fromDeviceId: "snap-tx",
      fromConnectorId: "out",
      toDeviceId: "snap-rx",
      toConnectorId: "in",
      routeStyle: "orthogonal",
      routePoints: [
        { x: 180, y: 50 },
        { x: 180, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 150 }
      ],
      color: "#ff0",
      cableType: "HDMI"
    }]
  });
  const snappedWire = snapCleanupScene.getWire("snapped-corner-wire");
  const dragStartPoints = snappedWire.routePoints.map(point => ({ ...point }));
  const moved = snapCleanupScene.moveOrthogonalSegment("snapped-corner-wire", 2, 50, {
    refreshIndexes: false,
    sourceRoutePoints: dragStartPoints
  });
  assert.equal(moved.moved, true, "orthogonal custom segment reaches its straight-line snap coordinate");
  const beforeCleanupCount = snappedWire.routePoints.length;
  const cleanup = snapCleanupScene.finalizeSnappedOrthogonalSegment("snapped-corner-wire", { refreshIndexes: false });
  assert.equal(cleanup.changed, true, "snapped straight orthogonal segment triggers release cleanup");
  assert.ok(cleanup.removed > 0, "snapped straight orthogonal segment removes its redundant custom corner");
  assert.ok(snappedWire.routePoints.length < beforeCleanupCount, "snapped wire stores fewer route points after release cleanup");
  assert.deepEqual(
    dragStartPoints,
    [
      { x: 180, y: 50 },
      { x: 180, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 150 }
    ],
    "snapped segment cleanup preserves the immutable undo route"
  );
}
{
  const verticalSnapCleanupScene = new SceneGraph();
  verticalSnapCleanupScene.setData({
    devices: [
      {
        id: "vertical-snap-tx",
        label: "TX",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        connectors: [{ id: "out", label: "OUT", side: "right", direction: "output", x: 100, y: 50 }]
      },
      {
        id: "vertical-snap-rx",
        label: "RX",
        x: 400,
        y: 0,
        width: 100,
        height: 100,
        connectors: [{ id: "in", label: "IN", side: "left", direction: "input", x: 0, y: 50 }]
      }
    ],
    wires: [{
      id: "vertical-snapped-corner-wire",
      fromDeviceId: "vertical-snap-tx",
      fromConnectorId: "out",
      toDeviceId: "vertical-snap-rx",
      toConnectorId: "in",
      routeStyle: "orthogonal",
      routePoints: [
        { x: 180, y: 50 },
        { x: 180, y: 100 },
        { x: 240, y: 100 },
        { x: 240, y: 50 }
      ],
      color: "#ff0",
      cableType: "HDMI"
    }]
  });
  const verticalWire = verticalSnapCleanupScene.getWire("vertical-snapped-corner-wire");
  const dragStartPoints = verticalWire.routePoints.map(point => ({ ...point }));
  const segmentInfo = verticalSnapCleanupScene.orthogonalSegmentInfo(verticalWire.id, 3);
  assert.equal(segmentInfo.orientation, "v", "vertical cleanup regression targets a vertical segment");
  const snap = verticalSnapCleanupScene.snapOrthogonalSegment(verticalWire.id, 3, 181, {
    segmentInfo,
    snapTargets: verticalSnapCleanupScene.orthogonalSegmentSnapTargetsForDrag(verticalWire.id),
    zoom: 1,
    enabled: true
  });
  assert.equal(snap.snapped, true, "vertical dogleg snaps to its parallel same-wire segment");
  assert.equal(snap.value, 180, "vertical dogleg snaps to the exact straight-line X coordinate");
  assert.equal(snap.targetWireId, verticalWire.id, "vertical straightening identifies its same-wire target");
  assert.equal(snap.spacing, 0, "same-wire vertical straightening does not apply a spacing lane");
  const moved = verticalSnapCleanupScene.moveOrthogonalSegment(verticalWire.id, 3, snap.value, {
    refreshIndexes: false,
    sourceRoutePoints: dragStartPoints
  });
  assert.equal(moved.moved, true, "vertical custom segment reaches its straight-line snap coordinate");
  const beforeCleanupCount = verticalWire.routePoints.length;
  const cleanup = verticalSnapCleanupScene.finalizeSnappedOrthogonalSegment(verticalWire.id, { refreshIndexes: false });
  assert.equal(cleanup.changed, true, "snapped straight vertical segment triggers release cleanup");
  assert.ok(cleanup.removed > 0, "snapped straight vertical segment removes its redundant custom corner");
  assert.ok(verticalWire.routePoints.length < beforeCleanupCount, "vertical snapped wire stores fewer route points after release cleanup");
  assert.deepEqual(
    dragStartPoints,
    [
      { x: 180, y: 50 },
      { x: 180, y: 100 },
      { x: 240, y: 100 },
      { x: 240, y: 50 }
    ],
    "vertical snapped segment cleanup preserves the immutable undo route"
  );
}
{
  const repaired = routePointsForMovedEndpoints({
    routePoints: [
      { x: 200, y: 50 },
      { x: 200, y: 180 },
      { x: 320, y: 180 },
      { x: 320, y: 150 }
    ],
    from: { x: 150, y: 80 },
    to: { x: 400, y: 150 },
    fromMoved: true,
    toMoved: false
  });
  assert.equal(repaired.some(point => point.x === 320 && point.y === 180), true, "one-endpoint repair preserves middle dogleg user shape");
  const repairedDiagnostics = orthogonalRouteDiagnostics({
    routePoints: repaired,
    from: { x: 150, y: 80 },
    to: { x: 400, y: 150 }
  });
  assert.equal(repairedDiagnostics.allOrthogonal, true, "one-endpoint repair remains orthogonal");
  assert.equal(repairedDiagnostics.remainsEditable, true, "one-endpoint repair remains editable");
}

{
  const wire = { id: "bezier-route-edit", routeStyle: "bezier", routePoints: [] };
  const added = addWireRoutePoint({
    wire,
    from: { x: 0, y: 0 },
    to: { x: 300, y: 100 },
    renderedPoints: [{ x: 0, y: 0 }, { x: 150, y: 50 }, { x: 300, y: 100 }],
    nearestPoint: { x: 149.6, y: 50.4 },
    segmentIndex: 0
  });
  assert.equal(added.routeStyle, "custom", "Bezier Create Corner changes wire to custom route");
  assert.deepEqual(added.routePoints, [{ x: 150, y: 50 }], "Bezier Create Corner stores projected rounded point");
  const removed = removeWireRoutePoint({
    wire: added,
    from: { x: 0, y: 0 },
    to: { x: 300, y: 100 },
    pointIndex: 0
  });
  assert.equal(removed.routeStyle, "bezier", "deleting last Bezier corner restores automatic Bezier route");
  assert.deepEqual(removed.routePoints, [], "deleting last Bezier corner clears stored points");
  assert.equal(wireRouteStatesEqual(removed, resetWireRoute(added, { from: { x: 0, y: 0 }, to: { x: 300, y: 100 } })), true, "Bezier delete-last and reset produce same automatic route state");

  const ordered = addWireRoutePoint({
    wire: {
      id: "bezier-route-order",
      routeStyle: "custom",
      routePoints: [{ x: 100, y: 20 }, { x: 200, y: 80 }]
    },
    from: { x: 0, y: 0 },
    to: { x: 300, y: 100 },
    renderedPoints: [
      { x: 0, y: 0 },
      { x: 100, y: 20 },
      { x: 150, y: 50 },
      { x: 200, y: 80 },
      { x: 300, y: 100 }
    ],
    nearestPoint: { x: 150, y: 50 },
    segmentIndex: 2
  });
  assert.deepEqual(ordered.routePoints, [
    { x: 100, y: 20 },
    { x: 150, y: 50 },
    { x: 200, y: 80 }
  ], "Bezier Create Corner inserts between existing points in rendered-path order");
}

{
  const dragScene = new SceneGraph();
  dragScene.setData({
    devices: [
      {
        id: "bezier-tx",
        label: "TX",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        connectors: [{ id: "out", label: "OUT", side: "right", direction: "output", x: 100, y: 50 }]
      },
      {
        id: "bezier-rx",
        label: "RX",
        x: 400,
        y: 100,
        width: 100,
        height: 100,
        connectors: [{ id: "in", label: "IN", side: "left", direction: "input", x: 0, y: 50 }]
      }
    ],
    wires: [{
      id: "bezier-route-drag",
      fromDeviceId: "bezier-tx",
      fromConnectorId: "out",
      toDeviceId: "bezier-rx",
      toConnectorId: "in",
      routeStyle: "custom",
      routePoints: [{ x: 100, y: 20 }, { x: 200, y: 80 }],
      color: "#ff0",
      cableType: "HDMI"
    }]
  });
  const beforePoints = dragScene.getWire("bezier-route-drag").routePoints.map(point => ({ ...point }));
  const moved = dragScene.moveRoutePoint("bezier-route-drag", 0, 140, 65, {
    refreshIndexes: false,
    sourceRoutePoints: beforePoints,
    sourcePointIndex: 0
  });
  assert.equal(moved.moved, true, "Bezier custom corner drag reports a live move");
  assert.deepEqual(
    dragScene.getWire("bezier-route-drag").routePoints,
    [{ x: 140, y: 65 }, { x: 200, y: 80 }],
    "Bezier custom corner drag updates the live wire route"
  );
  assert.deepEqual(
    beforePoints,
    [{ x: 100, y: 20 }, { x: 200, y: 80 }],
    "Bezier custom corner drag preserves the immutable undo snapshot"
  );
}

{
  const from = { x: 100, y: 100 };
  const to = { x: 500, y: 300 };
  const wire = { id: "orthogonal-route-edit", routeStyle: "orthogonal", routePoints: [] };
  const added = addWireRoutePoint({
    wire,
    from,
    to,
    renderedPoints: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 500, y: 300 }],
    nearestPoint: { x: 300, y: 180 },
    segmentIndex: 1
  });
  assert.equal(added.routeStyle, "orthogonal", "orthogonal Create Corner preserves routing mode");
  assert.equal(added.routePoints.some(point => point.x === 300 && point.y === 180), true, "orthogonal Create Corner inserts projected point on selected segment");
  const addedDiagnostics = orthogonalRouteDiagnostics({ routePoints: added.routePoints, from, to });
  assert.equal(addedDiagnostics.allOrthogonal, true, "orthogonal Create Corner remains strictly horizontal/vertical");
  const insertedIndex = added.routePoints.findIndex(point => point.x === 300 && point.y === 180);
  const removed = removeWireRoutePoint({ wire: added, from, to, pointIndex: insertedIndex });
  const removedDiagnostics = orthogonalRouteDiagnostics({ routePoints: removed.routePoints, from, to });
  assert.equal(removedDiagnostics.allOrthogonal, true, "orthogonal Delete Corner reconnects with valid 90-degree geometry");
  const reset = resetWireRoute(added, { from, to });
  assert.equal(reset.routeStyle, "orthogonal", "orthogonal reset preserves 90-degree mode");
  assert.equal(reset.routePoints.length > 0, true, "orthogonal reset materializes the automatic editable dogleg like Legacy");
  const resetDiagnostics = orthogonalRouteDiagnostics({ routePoints: reset.routePoints, from, to });
  assert.equal(resetDiagnostics.allOrthogonal, true, "orthogonal reset dogleg remains strictly horizontal/vertical");

  const horizontalAdded = addWireRoutePoint({
    wire,
    from,
    to,
    renderedPoints: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 500, y: 300 }],
    nearestPoint: { x: 180, y: 100 },
    segmentIndex: 0
  });
  assert.equal(horizontalAdded.routePoints.some(point => point.x === 180 && point.y === 100), true, "orthogonal Create Corner supports a horizontal segment");
  assert.equal(orthogonalRouteDiagnostics({ routePoints: horizontalAdded.routePoints, from, to }).allOrthogonal, true, "horizontal orthogonal insertion remains strictly horizontal/vertical");
}

{
  const normalizedLedProject = normalizeAvDesignerProject({
    ledSurfaces: [{
      id: "led-grid",
      name: "LED Grid",
      x: 1000,
      y: 200,
      width: 500,
      height: 250,
      signalSlots: 20,
      image: "data:image/png;base64,test"
    }]
  });
  const normalizedSurface = normalizedLedProject.devices.find(device => device.id === "led-grid");
  assert.equal(normalizedSurface.kind, "led-surface", "LED PNG import normalizes as a LED surface");
  assert.equal(normalizedSurface.connectors.length, 0, "LED PNG import exposes no visible connectors");
  assert.equal(normalizedSurface.portCount, 0, "LED PNG import does not advertise fallback ports");
  assert.equal(normalizedSurface.visual.signalSlots, 20, "LED PNG import preserves signal slot metadata");

  const ledScene = new SceneGraph();
  ledScene.setData({
    devices: [
      {
        id: "source",
        kind: "device",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        connectors: [{ id: "out", type: "led-signal", label: "OUT", side: "right", direction: "output", x: 100, y: 30 }]
      },
      normalizedSurface
    ],
    wires: [
      {
        id: "led-wire-a",
        fromDeviceId: "source",
        fromConnectorId: "out",
        toSurfaceId: "led-grid",
        toSide: "left",
        toPortIndex: 0,
        cableType: "led-signal",
        signalIndex: 1
      },
      {
        id: "led-wire-b",
        fromDeviceId: "source",
        fromConnectorId: "out",
        toSurfaceId: "led-grid",
        toSide: "left",
        toPortIndex: 1,
        cableType: "led-signal",
        signalIndex: 2
      }
    ]
  });
  const ledWireA = ledScene.getWire("led-wire-a");
  const ledWireB = ledScene.getWire("led-wire-b");
  assert.equal(ledWireA.toSurfaceId, "led-grid", "LED PNG wire A uses canonical surface endpoint");
  assert.equal(ledWireA.toConnectorId, "", "LED PNG wire A has no fake surface connector");
  assert.equal(ledWireB.toSurfaceId, "led-grid", "LED PNG wire B uses canonical surface endpoint");
  assert.equal(ledWireB.toConnectorId, "", "LED PNG wire B has no fake surface connector");
  assert.deepEqual(
    ledScene.endpointForWire(ledWireA, "to"),
    { x: 1000, y: 262.5 },
    "LED PNG wire A lands on the Legacy left-edge virtual point"
  );
  assert.deepEqual(
    ledScene.endpointForWire(ledWireB, "to"),
    { x: 1000, y: 387.5 },
    "LED PNG wire B lands on the Legacy left-edge virtual point"
  );
  const ledWireC = ledScene.addWire({
    fromDeviceId: "source",
    fromConnectorId: "out",
    toSurfaceId: "led-grid",
    cableType: "led-signal",
    signalIndex: 16
  });
  assert.deepEqual(
    ledScene.orderedLedSurfaceWires("led-grid").map(wire => wire.signalIndex),
    [1, 2, 16],
    "LED PNG virtual endpoints keep signal-index ordering when a later signal is added"
  );
  assert.deepEqual(
    new Set(ledScene.expandLedSurfaceDependentWireIds([ledWireC.id])),
    new Set(["led-wire-a", "led-wire-b", ledWireC.id]),
    "Dirtying one LED PNG wire expands to all sibling wires on that surface"
  );

  const repairedLedProject = normalizeAvDesignerProject({
    ledSurfaces: normalizedLedProject.projectData?.ledSurfaces || [{
      id: "led-grid",
      name: "LED Grid",
      x: 1000,
      y: 200,
      width: 500,
      height: 250,
      signalSlots: 20,
      image: "data:image/png;base64,test"
    }],
    devices: [{
      instanceId: "source",
      name: "LED Processor",
      x: 0,
      y: 0,
      connectors: [{ id: "out", type: "led-signal", label: "OUT", side: "right", direction: "output", x: 100, y: 30 }]
    }],
    connections: [{
      id: "legacy-repair-wire",
      from: { deviceId: "source", connectorId: "out" },
      to: { deviceId: "led-grid", connectorId: "surface-port-3" },
      cableType: "led-signal"
    }]
  });
  const repairedWire = repairedLedProject.wires.find(wire => wire.id === "legacy-repair-wire");
  assert.equal(repairedWire.toSurfaceId, "led-grid", "Engine repairs old fake LED surface connector endpoints");
  assert.equal(repairedWire.toConnectorId, "", "Engine strips fake surface-port connector during repair");
}

console.log(JSON.stringify({
  ok: true,
  cases,
  count: cases.length
}, null, 2));
