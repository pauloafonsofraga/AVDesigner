import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {MULTIBAND_SIGNALS,multibandColors,groupedCoaxMetadata} from "../src/engine/multibandSignals.js";
import {multibandWirePolygons,multibandNodePolygons} from "../src/engine/multibandGeometry.js";
import {engineConnectorColorSegments,engineWireColorSegmentsForCable,engineWireColorSegmentsForWire,areEngineConnectorTypesCompatible} from "../src/engine/connectorCompatibility.js";
import {buildEngineOutputScene} from "../src/engine/outputSceneSnapshot.js";
import {createOutputViewerModel} from "../src/engine/outputViewerModel.js";
import {engineOutputPrimitives} from "../src/engine/renderer.js";
import {renderEngineOutputSvg} from "../src/engine/outputSvgRenderer.js";
import {buildCableSchedule} from "../src/engine/cableSchedule.js";
import {hitTestWire} from "../src/engine/hitTest.js";
import {multibandFixture} from "../fixtures/multiband-signals.mjs";
import * as clipboard from "../src/engine/canvasClipboard.js";
import {createCableScheduleXlsx} from "../src/engine/cableScheduleXlsx.js";
import ExcelJS from "exceljs/dist/exceljs.min.js";

test("Powerlock keeps exact historical identity, ordering, colours and stale custom-colour recovery",()=>{
  const expected=["#03E300","#2A7FFF","#A05A2C","#4A4A4A","#999999"];
  assert.deepEqual(multibandColors("powerlock"),expected);
  assert.deepEqual(engineConnectorColorSegments({type:"powerlock",customColor:"#ff0000"}),expected);
  assert.deepEqual(engineWireColorSegmentsForCable("powerlock"),expected);
  assert.equal(groupedCoaxMetadata("powerlock"),null);
  assert.equal(areEngineConnectorTypesCompatible({type:"powerlock"},{type:"iec"}),false);
});
test("factory additions match Engine profiles and create no conductor-specific node types",()=>{
  const c=JSON.parse(readFileSync(new URL("../data/factory-catalogue.json",import.meta.url)));
  for(const type of ["component-video","rgbhv"]) {
    assert.equal(c.nodes.filter(n=>n.id===type).length,1);
    assert.deepEqual(c.nodeTypes[type].bands,MULTIBAND_SIGNALS[type].bands);
    assert.deepEqual(c.nodeTypes[type].colors,multibandColors(type));
  }
});
for(const type of ["component-video","rgbhv"])test(`${type} only matches its signal, not physical coax, VGA, SDI or another grouped format`,()=>{
  for(const other of ["component-video","rgbhv","vga","sdi","bnc","rca","rgbs","rgb","composite"]) {
    assert.equal(areEngineConnectorTypesCompatible({type,coaxConnectorFamily:"bnc"},{type:other,coaxConnectorFamily:"rca"}),other===type);
  }
});
for(const type of Object.keys(MULTIBAND_SIGNALS)) {
  test(`${type}: equal adjacent node bands are clipped inside one circle`,()=>{
    const colors=multibandColors(type),polygons=multibandNodePolygons({x:50,y:20},10,colors);
    assert.deepEqual(polygons.map(p=>p.color),colors);
    polygons.forEach((polygon,i)=>polygon.points.forEach(p=>{
      assert.ok(Math.hypot(p.x-50,p.y-20)<=10+1e-8);
      assert.ok(p.x>=40+20*i/colors.length-1e-8&&p.x<=40+20*(i+1)/colors.length+1e-8);
    }));
  });
  for(const [name,points] of Object.entries({straight:[{x:0,y:0},{x:400,y:0}],corners:[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:200,y:80},{x:200,y:10}],sharp:[{x:0,y:0},{x:100,y:0},{x:1,y:1}],duplicates:[{x:0,y:0},{x:0,y:0},{x:100,y:100}]})) {
    test(`${type}: ${name} bands cover every routed segment with shared boundaries`,()=>{
      const colors=multibandColors(type),polygons=multibandWirePolygons(points,5,colors);
      const n=polygons.length/colors.length;assert.ok(n>=1);
      for(let i=0;i<colors.length;i++)for(let j=0;j<n;j++) {
        const p=polygons[i*n+j];assert.equal(p.color,colors[i]);
        assert.ok(p.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
        if(j+1<n)assert.deepEqual([p.points[1],p.points[2]],[polygons[i*n+j+1].points[0],polygons[i*n+j+1].points[3]]);
        if(i+1<colors.length)assert.deepEqual([p.points[3],p.points[2]],polygons[(i+1)*n+j].points.slice(0,2));
      }
    });
  }
}
test("six straight/routed logical wires survive reopen; live and print primitives share their complete band colours",()=>{
  const fixture=multibandFixture(),before=structuredClone(fixture),snapshot=buildEngineOutputScene(fixture);
  assert.equal(snapshot.wires.length,6);assert.equal(snapshot.devices.flatMap(d=>d.connectors).length,12);
  assert.deepEqual(buildEngineOutputScene(JSON.parse(JSON.stringify(fixture))),snapshot);
  const {scene,contract}=createOutputViewerModel(snapshot),primitives=engineOutputPrimitives(scene,contract);
  assert.equal(primitives.wires.length,6);
  for(const wire of scene.wires) {
    assert.deepEqual(wire.colorSegments,multibandColors(wire.cableType));
    const mesh=primitives.wires.find(p=>p.id===wire.id).vertices;
    for(const color of wire.colorSegments) {
      const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
      assert.ok(mesh.some((_,i)=>i%6===2&&rgb.every((v,j)=>Math.abs(mesh[i+j]-v)<1e-6)),`${wire.id} ${color}`);
    }
    const point=scene.wireRenderPolyline(wire)[2] || scene.wireRenderPolyline(wire)[0];
    assert.equal(hitTestWire(scene,point,5).wire?.wire.id,wire.id);
  }
  const {svg}=renderEngineOutputSvg(snapshot);
  assert.equal([...svg.matchAll(/data-wire-id=/g)].length,6);
  assert.deepEqual(fixture,before);
});
test("one schedule row retains 3/5 independent coax circuits and selected connector families",()=>{
  const fixture=multibandFixture(),before=structuredClone(fixture),rows=buildCableSchedule(fixture,{assignNumbers:"readOnly"});
  assert.equal(rows.length,6);
  for(const row of rows) {
    if(row.cableTypeId==="powerlock") {assert.equal(row.physicalCircuits,undefined);assert.ok(!/coax/.test(row.notes));continue;}
    const count=row.cableTypeId==="rgbhv"?5:3;
    assert.equal(row.physicalCircuits.count,count);assert.equal(row.physicalCircuits.impedanceOhms,75);
    assert.equal(row.physicalCircuits.circuits.length,count);assert.equal(row.wireIds.length,1);
    assert.match(row.connector,new RegExp(`${count} x BNC`));assert.match(row.notes,/separate 75 ohm coaxial circuits/);
    if(count===3){assert.match(row.connector,/3 x RCA/);assert.equal(row.physicalCircuits.destinationConnectorFamily,"rca");}
  }
  assert.deepEqual(fixture,before);
});

test("installed card connectors retain multiband colours and RCA physical circuits",()=>{
  const fixture=multibandFixture(),t=fixture.deviceLibrary.find(d=>d.id==="component-video-from");
  t.hasSwappableCards=true;t.cardTypes=[{id:"card",kind:"output",name:"Component card",connectors:[{...t.connectors[0],coaxConnectorFamily:"rca"}]}];
  t.cardSlots=[{id:"slot",installedCardTypeId:"card",y:80}];t.connectors=[];
  fixture.devices.find(d=>d.templateId===t.id).templateOverride=structuredClone(t);
  fixture.connections=fixture.connections.filter(w=>w.id==="component-video-straight");
  fixture.connections[0].from.connectorId="slot__straight";
  const {scene}=createOutputViewerModel(buildEngineOutputScene(fixture));
  const c=scene.getConnector(t.id,"slot__straight");assert.equal(c.coaxConnectorFamily,"rca");
  assert.deepEqual(c.colorSegments,multibandColors("component-video"));
  const [row]=buildCableSchedule(fixture,{getConnector:(d,c)=>scene.getConnector(d,c),assignNumbers:"readOnly"});
  assert.equal(row.physicalCircuits.sourceConnectorFamily,"rca");assert.equal(row.physicalCircuits.count,3);
});

test("copy/duplicate preserves grouped signals as one remapped cable per connection",()=>{
  const fixture=multibandFixture();
  fixture.nodeLibrary=Object.entries(MULTIBAND_SIGNALS).map(([id,p])=>({id,label:p.label || "Powerlock",colors:p.bands.map(b=>b.color),color:p.bands[0].color}));
  const before=structuredClone(fixture),selection=fixture.devices.map(d=>({type:"device",id:d.instanceId}));
  const payload=clipboard.createCanvasClipboardPayload(fixture,selection,{x:0,y:0,width:1080,height:1410});
  const text=clipboard.serializeCanvasClipboard(payload),parsed=clipboard.parseCanvasClipboard(text);
  const plan=clipboard.prepareCanvasClipboardPaste(parsed,fixture,{x:1600,y:0});
  assert.equal(plan.additions.devices.length,6);assert.equal(plan.additions.connections.length,6);
  const pasted=clipboard.applyCanvasClipboardPlan(fixture,plan),snapshot=buildEngineOutputScene(pasted);
  assert.equal(snapshot.wires.length,12);
  for(const type of Object.keys(MULTIBAND_SIGNALS))assert.equal(snapshot.wires.filter(w=>w.cableType===type && w.colorSegments.length===MULTIBAND_SIGNALS[type].bands.length).length,4);
  assert.deepEqual(fixture,before);
});

test("XLSX keeps one row per logical cable and searchable physical circuit requirements",async()=>{
  const rows=buildCableSchedule(multibandFixture(),{assignNumbers:"readOnly"});
  const bytes=await createCableScheduleXlsx(rows),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  const sheet=book.getWorksheet("Cable Schedule");assert.equal(sheet.rowCount,7);
  const all=JSON.stringify(sheet.getSheetValues());
  assert.match(all,/3 separate 75 ohm coaxial circuits: Y, Pb, Pr/);
  assert.match(all,/5 separate 75 ohm coaxial circuits: R, G, B, H, V/);
  assert.match(all,/3 x BNC.*3 x RCA/);
});

test("scoped grouped-signal aliases retain bands and physical circuits after import/refresh",()=>{
  const fixture=multibandFixture(),alias="component-video-project-a1b2";
  fixture.nodeLibrary=[{id:alias,label:"Component Video (YPbPr)",compatibilityType:"component-video",colors:multibandColors("component-video")}];
  fixture.connections=fixture.connections.filter(w=>w.cableType==="component-video");
  fixture.connections.forEach(w=>{w.cableType=alias;});
  for(const t of fixture.deviceLibrary.filter(t=>t.id.startsWith("component-video")))t.connectors.forEach(c=>{c.type=c.physicalType=c.connectorType=alias;});
  fixture.devices.forEach(d=>{d.templateOverride=structuredClone(fixture.deviceLibrary.find(t=>t.id===d.templateId));});
  const {scene}=createOutputViewerModel(buildEngineOutputScene(fixture));
  for(const wire of scene.wires){assert.deepEqual(wire.colorSegments,multibandColors("component-video"));assert.deepEqual(engineWireColorSegmentsForWire(wire,scene),wire.colorSegments);}
  const rows=buildCableSchedule(fixture,{getConnector:(d,c)=>scene.getConnector(d,c),nodeDefinitions:fixture.nodeLibrary,assignNumbers:"readOnly"});
  assert.ok(rows.every(r=>r.physicalCircuits.count===3));
});
