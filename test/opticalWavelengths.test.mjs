import test from "node:test";
import assert from "node:assert/strict";
import { transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";
import { draftFromPreset, editTransceiverDraft, transceiverDraft, transceiverDraftPatch } from "../src/engine/transceiverDraft.js";
import { opticalWavelengthMode } from "../src/engine/customTransceiverOptics.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputCableTrace } from "../src/engine/outputViewerModel.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";
import { isWdmCable, WDM_CABLE_DASH, wdmInkRuns } from "../src/engine/wdmCableStyle.js";

const port = (type = "sfp-plus-cage", direction = "bidirectional") => ({
  id: "optic", type, physicalType: type, label: "Optical", direction, signalDirection: direction,
  x: 0, y: 100, cageCapabilities: type === "qsfp-cage"
    ? { supportedFormFactors: ["qsfp28"], supportedRates: ["100G"] } : { supportedRates: ["10G"] }
});
const install = (cage, cfg) => ({ ...cage, ...transceiverConfigurationPatch(cage, cfg) });
const standard = (cage, profile) => install(cage, { method: "standard", profile });
const custom = (cage, opts) => install(cage, { method: "custom", interface: "lc", lineRate: "10G", ...opts });
const status = (left, right) => engineCompatibilitySummary({ device: { id: "one" }, connector: left },
  { device: { id: "two" }, connector: right });
function project(left, right, connection = {}) {
  const definitions = [left, right].map((connector, i) => ({ id: "host-" + i, name: "Optical host",
    width: 220, height: 240, connectors: [{ ...connector, x: i ? 0 : 220, displaySide: i ? "left" : "right" }] }));
  return { deviceLibrary: definitions, cableHops: false,
    devices: definitions.map((definition, i) => ({ instanceId: "device-" + i, templateId: definition.id, x: i * 700, y: i * 140 })),
    connections: [{ id: "optical-cable", cableType: "fiber-lc", cableNumber: "IT-001", length: "19m",
      fiberMode: "single-mode", from: { deviceId: "device-0", connectorId: left.id }, to: { deviceId: "device-1", connectorId: right.id }, ...connection }] };
}

test("LR, LR4, BX and SR4 presets declare independent optical properties without altering cage identities", () => {
  const lr = draftFromPreset(port(), "10gbase-lr");
  assert.deepEqual([lr.arrangement, lr.wavelengthMode, lr.signalDirection, lr.txNm, lr.rxNm],
    ["duplex", "single-wavelength", "bidirectional", "1310", "1310"]);
  const qsfp = port("qsfp-cage");
  const lr4 = draftFromPreset(qsfp, "100gbase-lr4");
  assert.deepEqual([lr4.arrangement, lr4.wavelengthMode, lr4.txNm], ["duplex", "wdm", "1295, 1300, 1304, 1309"]);
  const patch = transceiverDraftPatch(qsfp, editTransceiverDraft(lr4, "fiberGrade", "os2"));
  assert.equal(patch.installedModuleType, "lc-singlemode");
  assert.equal(patch.moduleCapabilities.optical.wavelengthMode, "wdm");
  assert.equal(patch.moduleCapabilities.optical.signalDirection, "bidirectional");
  const up = standard(port(), "10g-bx-u"), down = standard(port(), "10g-bx-d");
  assert.equal(up.moduleCapabilities.optical.arrangement, "simplex");
  assert.ok(status(up, down).valid);
  assert.equal(status(up, up).rule, "module-optical-wavelength");
  const sr4 = draftFromPreset(qsfp, "100gbase-sr4");
  assert.deepEqual([sr4.arrangement, sr4.wavelengthMode, sr4.laneTxNm, sr4.laneRxNm],
    ["parallel", "single-wavelength", "850; 850; 850; 850", "850; 850; 850; 850"]);
  const edited = transceiverDraftPatch(qsfp, editTransceiverDraft(sr4, "fiberGrade", "om4"));
  assert.equal(edited.moduleCapabilities.optical.laneWavelengths.length, 4);
  assert.deepEqual(edited.moduleCapabilities.optical.laneWavelengths[3], { lane: 4, txNm: [850], rxNm: [850] });
});

test("simplex BiDi and WDM coexist; inherited TX/RX roles remain independent", () => {
  const opt = { arrangement: "simplex", signalDirection: "bidirectional", wavelengthMode: "wdm" };
  const txNm = [1270, 1290], rxNm = [1310, 1330];
  const a = custom(port(), { ...opt, txNm, rxNm }), b = custom(port(), { ...opt, txNm: rxNm, rxNm: txNm });
  assert.ok(status(a, b).valid);
  assert.equal(status(a, a).rule, "module-optical-wavelength");
  assert.throws(() => custom(port(), { ...opt, txNm, rxNm: [1270, 1310] }), /shared fibre/);
  const from = custom(port(undefined, "output"), { signalDirection: "inherited", wavelengthMode: "wdm", txNm });
  const to = custom(port(undefined, "input"), { signalDirection: "unidirectional", wavelengthMode: "wdm", rxNm: txNm });
  assert.equal(from.moduleCapabilities.direction, "output");
  assert.equal(to.moduleCapabilities.direction, "input");
  assert.ok(status(from, to).valid && status(to, from).valid);
  assert.equal(status(from, from).rule, "module-direction");
  assert.throws(() => custom(port(), { signalDirection: "unidirectional", txNm }), /connector role/);
  assert.throws(() => custom(port(undefined, "input"), { signalDirection: "inherited", txNm }), /receive role/);
});

test("legacy optical values are read without authoring defaults or dropping wavelength evidence", () => {
  for (const [technology, mode] of [["wdm", "wdm"], ["single-wavelength", "single-wavelength"], ["bidi", ""], ["parallel", ""], ["", ""]]) {
    assert.equal(opticalWavelengthMode({ technology }), mode);
  }
  const base = custom(port(), { arrangement: "simplex", technology: "bidi", txNm: [1270], rxNm: [1330] });
  const legacy = JSON.parse(JSON.stringify(base));
  delete legacy.moduleCapabilities.optical.wavelengthMode;
  delete legacy.moduleCapabilities.optical.signalDirection;
  const before = structuredClone(legacy), draft = transceiverDraft(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(draft.wavelengthMode, "single-wavelength");
  const updated = transceiverDraftPatch(legacy, editTransceiverDraft(draft, "fiberGrade", "os2"));
  assert.deepEqual(updated.moduleCapabilities.optical.txNm, [1270]);
  assert.deepEqual(updated.moduleCapabilities.optical.rxNm, [1330]);
});

test("WDM ink uses 18/6/5/6 along one route with phase preserved through bends and samples", () => {
  assert.deepEqual(WDM_CABLE_DASH, [18, 6, 5, 6]);
  const straight = [{ x: 0, y: 0 }, { x: 43, y: 0 }];
  assert.deepEqual(wdmInkRuns(straight).map(run => run.map(point => point.x)), [[0, 18], [24, 29], [35, 43]]);
  const corner = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 33 }];
  assert.deepEqual(wdmInkRuns(corner)[0], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }]);
  assert.deepEqual(wdmInkRuns(corner).slice(1).map(run => run.map(p => p.y)), [[14, 19], [25, 33]]);
  const curve = Array.from({ length: 26 }, (_, i) => ({ x: i * 4, y: Math.sin(i / 10) * 50 }));
  const before = structuredClone(curve);
  assert.ok(wdmInkRuns(curve).length > 4);
  assert.deepEqual(curve, before);
  assert.ok(wdmInkRuns([{x:0,y:0},{x:1e10,y:0}]).length <= 8193);
});

test("LR4 styles a single physical cable across Viewer and SVG/PDF, never a conflicting saved link", () => {
  const lr4 = standard(port("qsfp-cage"), "100gbase-lr4");
  const raw = project(lr4, lr4, { routePoints: [{ x: 320, y: 150 }, { x: 480, y: 210 }] });
  const snapshot = buildEngineOutputScene(raw), model = createOutputViewerModel(snapshot), wire = model.scene.getWire("optical-cable");
  assert.equal(isWdmCable(model.scene, wire), true);
  assert.equal(snapshot.wires.length, 1);
  assert.equal(snapshot.wires[0].length, "19m");
  const [primitive] = engineOutputPrimitives(model.scene, model.contract).wires;
  const route = snapshot.wires[0].renderPolyline, strands = primitive.opticalStrokes;
  assert.equal(strands.length, 2);
  assert.notDeepEqual(strands[0].points, strands[1].points);
  for (const strand of strands) {
    assert.equal(strand.dashed, true);
    assert.deepEqual(strand.points[0], route[0]);
    assert.deepEqual(strand.points.at(-1), route.at(-1));
  }
  assert.equal(primitive.color, wire.color);
  const trace = outputCableTrace(model, { type: "wire", id: wire.id });
  assert.equal(trace.length, 1);
  assert.equal(trace[0].points.length, route.length);
  const svg = renderEngineOutputSvg(snapshot).svg;
  const markup = svg.match(/<g data-wire-id="optical-cable">([\s\S]*?)<\/g><\/g>/)[1];
  assert.equal([...markup.matchAll(/<path /g)].length, 2);
  assert.equal([...markup.matchAll(/stroke-dasharray="18 6 5 6"/g)].length, 2);
  assert.deepEqual(buildEngineOutputScene(JSON.parse(JSON.stringify(raw))), snapshot);

  const wrong = structuredClone(lr4); wrong.moduleCapabilities.optical.rxNm = [1400, 1450, 1500, 1550];
  const bad = createOutputViewerModel(buildEngineOutputScene(project(lr4, wrong)));
  assert.equal(bad.scene.savedWireStatuses.get(wire.id).status, "incompatible");
  assert.equal(isWdmCable(bad.scene, bad.scene.getWire(wire.id)), false);
  assert.deepEqual(outputCableTrace(bad, { type: "wire", id: wire.id }), []);
  assert.equal(bad.contract.wires.length, 1, "invalid attachments remain documented");

  const single = standard(port(), "10gbase-lr");
  const solid = createOutputViewerModel(buildEngineOutputScene(project(single, single)));
  assert.equal(isWdmCable(solid.scene, solid.scene.getWire(wire.id)), false);
  assert.deepEqual(engineOutputPrimitives(solid.scene, solid.contract).wires[0].opticalStrokes.map(stroke => stroke.dashed), [false, false]);

  const simplex = custom(port(), {arrangement:"simplex", wavelengthMode:"wdm"});
  const one = createOutputViewerModel(buildEngineOutputScene(project(simplex, simplex)));
  assert.deepEqual(engineOutputPrimitives(one.scene, one.contract).wires[0].opticalStrokes.map(stroke => stroke.dashed), [true]);

  const unknown = custom(port("qsfp-cage"), {lineRate:"100G", txNm:[1295,1300], rxNm:[1295,1300]});
  const unspecified = createOutputViewerModel(buildEngineOutputScene(project(unknown, unknown)));
  assert.equal(unspecified.scene.savedWireStatuses.get(wire.id).status,"unverified");
  assert.equal(isWdmCable(unspecified.scene, unspecified.scene.getWire(wire.id)),false,
    "multiple recorded numbers are not an explicit WDM declaration");
  const badGrade = createOutputViewerModel(buildEngineOutputScene(project(lr4, lr4, {fiberMode:"om4"})));
  assert.equal(isWdmCable(badGrade.scene,badGrade.scene.getWire(wire.id)),false);
});
