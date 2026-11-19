import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transceiverBandwidthChoices, transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";
import { transceiverDraft, transceiverDraftPatch } from "../src/engine/transceiverDraft.js";
import { nodeDefinitionConnectorPatch } from "../src/engine/transceiverModules.js";
import { isDuplexFiberWire, duplexFiberPaths } from "../src/engine/duplexFiberGeometry.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { transceiverBandwidthFixture } from "../fixtures/transceiver-bandwidth.mjs";

test("bandwidth choices have a nonempty cage default, no optical presets and respect declared host rates", () => {
  for (const [type, minimum] of [["sfp-cage","1G"],["sfp-plus-cage","1G"],["sfp28-cage","1G"],["qsfp-cage","40G"]]) {
    const c = { type }, before = structuredClone(c), rates = transceiverBandwidthChoices(c);
    assert.equal(rates[0], minimum);
    assert.ok(rates.every(rate => /^\d+(\.\d+)?[MG]$/.test(rate)));
    assert.deepEqual(c,before);
  }
  assert.deepEqual(transceiverBandwidthChoices({ type:"qsfp-cage", cageCapabilities:{ supportedFormFactors:["qsfp28"],supportedRates:["100 Gb/s"] } }),["100G"]);
  assert.deepEqual(transceiverBandwidthChoices({ type:"sfp-plus-cage", cageCapabilities:{ supportedRates:["1G","10G"] }, supportedRates:["10G"] }),["10G"]);
  assert.deepEqual(transceiverBandwidthChoices({ type:"sfp-cage", supportedRates:["100G"] }),[]);
  assert.deepEqual(transceiverBandwidthChoices({ type:"sfp-plus-cage",cageCapabilities:{supportedModuleTypes:["10gbase-sr"]} }),["10G"]);
});

test("RJ45 transceiver bandwidth is persisted without changing its physical cage or generic identity", () => {
  const c={id:"c",type:"sfp-plus-cage",cageCapabilities:{supportedRates:["1G","10G"]}};
  const draft={...transceiverDraft(c),interface:"rj45",supportedRates:["10G"]};
  const patch=transceiverDraftPatch(c,draft);
  assert.equal(patch.installedModuleType,"rj45-ethernet");
  assert.deepEqual(patch.moduleCapabilities.supportedRates,["10G"]);
  assert.deepEqual(transceiverDraft(JSON.parse(JSON.stringify({...c,...patch}))).supportedRates,["10G"]);
  assert.throws(()=>transceiverConfigurationPatch(c,{method:"custom",interface:"rj45",supportedRates:["25G"]}),/rate/i);
  assert.equal(c.installedModuleType,undefined);
});

test("QSFP28 palette entry places a canonical cage with exact form metadata and no invented host rates", () => {
  const source = readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const statement = source.match(/if \(engineRendererRequested\(\)\) cableTypes\["qsfp28-cage"\] = \{[\s\S]*?\n    \};/)[0];
  const types = { "qsfp-cage": { label:"QSFP Cage",color:"#77818a",palette:false } };
  vm.runInNewContext(statement,{engineRendererRequested:()=>true,cableTypes:types,structuredClone});
  const node = types["qsfp28-cage"];
  assert.equal(node.label,"QSFP28 Cage"); assert.equal(node.editorPalette,true);
  assert.equal(node.color,types["qsfp-cage"].color);
  assert.deepEqual(nodeDefinitionConnectorPatch(node),{ type:"qsfp-cage",physicalType:"qsfp-cage",connectorType:"qsfp-cage",cageCapabilities:{supportedFormFactors:["qsfp28"]} });
  assert.equal(node.cageCapabilities.supportedRates,undefined);
  const legacy = { "qsfp-cage":types["qsfp-cage"] };
  vm.runInNewContext(statement,{engineRendererRequested:()=>false,cableTypes:legacy,structuredClone});
  assert.equal(legacy["qsfp28-cage"],undefined);
});

for (const points of [ [{x:0,y:0},{x:400,y:0}], [{x:0,y:0},{x:120,y:0},{x:120,y:100},{x:400,y:100}],
  [{x:400,y:100},{x:120,y:100},{x:120,y:0},{x:0,y:0}], [{x:0,y:0},{x:0,y:0},{x:1,y:1}] ]) {
  test("duplex strands follow the route, cross near the end, and terminate at unchanged anchors " + JSON.stringify(points), () => {
    for (const width of [2.2,3.4,4.6]) {
      const before = structuredClone(points), [a,b] = duplexFiberPaths(points,width);
      assert.ok(a.length >= 17); assert.equal(a.length,b.length);
      assert.deepEqual(a[0],points[0]); assert.deepEqual(b[0],points[0]);
      assert.deepEqual(a.at(-1),points.at(-1)); assert.deepEqual(b.at(-1),points.at(-1));
      assert.ok(a.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
      assert.ok(a.some((p,i) => Math.hypot(p.x-b[i].x,p.y-b[i].y)>0));
      assert.deepEqual(points,before);
    }
  });
}

test("duplex crossover changes strand sides once, not the underlying cable route", () => {
  const [a,b] = duplexFiberPaths([{x:0,y:0},{x:400,y:0}],4.6);
  assert.ok(a.find(p=>p.x>0).y<0); assert.ok(b.find(p=>p.x>0).y>0);
  assert.ok(a.at(-2).y>0); assert.ok(b.at(-2).y<0);
  assert.deepEqual(duplexFiberPaths([{x:0,y:0}],4.6),[]);
});

test("editor/output scene, offline Viewer and SVG/PDF share duplex primitives; simplex and assembly graphics remain single", () => {
  const fixture = transceiverBandwidthFixture(), before=structuredClone(fixture);
  const snapshot=buildEngineOutputScene(fixture), {scene,contract}=createOutputViewerModel(snapshot);
  assert.equal(isDuplexFiberWire(scene,scene.getWire("cable-0")),true);
  assert.equal(isDuplexFiberWire(scene,scene.getWire("cable-3")),false);
  assert.equal(isDuplexFiberWire(scene,{...scene.getWire("cable-0"),cableAssembly:{version:1}}),false);
  assert.equal(isDuplexFiberWire(scene,{...scene.getWire("cable-0"),cableType:"aoc-qsfp28"}),false);
  const primitives=engineOutputPrimitives(scene,contract);
  assert.ok(primitives.wires.find(w=>w.id==="cable-0").vertices.length > primitives.wires.find(w=>w.id==="cable-3").vertices.length);
  const {svg}=renderEngineOutputSvg(snapshot);
  assert.equal([...svg.matchAll(/data-wire-id=/g)].length,2);
  assert.deepEqual(buildEngineOutputScene(JSON.parse(JSON.stringify(fixture))),snapshot);
  assert.deepEqual(fixture,before);
});
