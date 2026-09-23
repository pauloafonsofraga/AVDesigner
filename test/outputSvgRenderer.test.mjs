import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { outputParityFixture } from "../fixtures/output-parity.mjs";
import { outputPrintFixture } from "../fixtures/output-print.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";
import { outputAssetSources } from "../src/engine/outputViewerAssets.js";
import { renderEngineOutputSvg, prepareEnginePrintImages, collectEnginePrintTextMetrics } from "../src/engine/outputSvgRenderer.js";
import { OutputSvgContext, printPaint, svgEscape } from "../src/engine/outputSvgContext.js";

const fixture = outputParityFixture(), contract = buildEngineOutputScene(fixture);
const images = Object.fromEntries(outputAssetSources(contract).map(src=>[src, {
  href:fixture.ledSurfaces[0].image,width:20,height:10
}]));
const render = (scene=contract,options={}) => renderEngineOutputSvg(scene,{ images,...options });
const count = (svg,attr) => [...svg.matchAll(new RegExp(` ${attr}="`,"g"))].length;

test("print contract uses exact Engine bounds, IDs and counts without mutating its inputs",()=> {
  const before = JSON.stringify({ contract,images });
  const { svg,diagnostics } = render();
  assert.equal(diagnostics.drawingDependency,"engine-svg");
  assert.equal(diagnostics.signature,contract.signature);
  assert.deepEqual(diagnostics.bounds,contract.bounds);
  assert.deepEqual(diagnostics.counts,contract.diagnostics.counts);
  assert.deepEqual(diagnostics.viewBox,{ x:-124,y:-224,width:3822,height:3588 });
  assert.equal(count(svg,"data-object-id")+count(svg,"data-jump-id"),17);
  assert.equal(count(svg,"data-wire-id"),20);
  assert.equal(count(svg,"data-rack-id"),1);
  assert.equal(count(svg,"data-jump-link-id"),1);
  for (const device of contract.devices) assert.ok(svg.includes(`="${device.id}"`));
  assert.equal(JSON.stringify({ contract,images }),before);
  assert.deepEqual(render(),render());
  assert.deepEqual(render({ engineScene:JSON.parse(JSON.stringify(contract)) }),render());
  assert.doesNotMatch(svg,/<(?:canvas|script|foreignObject)|selection|hover|debug|route-handle/);
});

test("all visible connector anchors and wire meshes are exactly the Engine primitives",()=> {
  const { scene } = createOutputViewerModel(contract);
  const primitives = engineOutputPrimitives(scene,contract), { svg } = render();
  assert.equal(count(svg,"data-connector-id"),primitives.connectors.length);
  for (const item of primitives.connectors) {
    assert.ok(svg.includes(`data-connector-id="${item.connectorId}" data-device-id="${item.deviceId}" data-anchor-id="${item.anchorId}" data-x="${item.point.x}" data-y="${item.point.y}"`));
  }
  for (const wire of contract.wires) {
    const p = primitives.wires.find(p=>p.id===wire.id), ctx = new OutputSvgContext();
    ctx.mesh(p.vertices);
    assert.ok(svg.includes(`<g data-wire-id="${wire.id}">${ctx.elements.join("")}</g>`));
    assert.deepEqual(wire.polyline[0],{ x:wire.endpoints.from.x,y:wire.endpoints.from.y });
    assert.deepEqual(wire.polyline.at(-1),{ x:wire.endpoints.to.x,y:wire.endpoints.to.y });
  }
});

test("cable hops and LED endpoint ordering use the resolved canonical wire paths",()=> {
  const { scene } = createOutputViewerModel(contract);
  const withHops = engineOutputPrimitives(scene,contract);
  const unHopped = { ...contract,wires:contract.wires.map(w=>({ ...w,renderPolyline:w.polyline })) };
  const withoutHops = engineOutputPrimitives(scene,unHopped);
  let hops = 0;
  for (const wire of contract.wires.filter(w=>w.cableHops.length)) {
    assert.notDeepEqual(withHops.wires.find(w=>w.id===wire.id),withoutHops.wires.find(w=>w.id===wire.id)); hops++;
  }
  assert.ok(hops>0);
  for (const surface of contract.ledSurfaces) assert.deepEqual(surface.wireIds,scene.orderedLedSurfaceWires(surface.id).map(w=>w.id));
});

test("shared trunks, branches and stems serialize canonical segments, including card buses",()=> {
  const { svg } = render();
  assert.equal(count(svg,"data-shared-bus-id"),contract.sharedBuses.length);
  for (const bus of contract.sharedBuses) {
    for (const s of [bus.segments.trunk,bus.segments.stem,...bus.segments.branches])
      assert.ok(svg.includes(`d="M${s.x1} ${s.y1} L${s.x2} ${s.y2}"`));
  }
  assert.ok(contract.cards.length===4);
  const installed = buildEngineOutputScene(outputPrintFixture());
  assert.ok(installed.sharedBuses.some(b=>b.cardSlotId));
  const installedImages = Object.fromEntries(outputAssetSources(installed).map(src=>[src,Object.values(images)[0]]));
  const printed = renderEngineOutputSvg(installed,{images:installedImages});
  assert.equal(count(printed.svg,"data-shared-bus-id"),installed.sharedBuses.length);
});

test("card bands, PD artwork, matrix and rack internals, comments, title blocks and images are present",()=> {
  const { svg,diagnostics } = render();
  const { scene } = createOutputViewerModel(contract), primitives = engineOutputPrimitives(scene,contract);
  assert.ok(primitives.matrix[0].vertices.length>0);
  assert.ok(contract.wires.some(w=>w.rackId));
  assert.ok(svg.includes('data-matrix-id="matrix"'));
  assert.ok(svg.includes('data-kind="comment"'));
  assert.ok(svg.includes('data-kind="title-block"'));
  assert.ok(svg.includes('data-kind="image-object"'));
  assert.ok(svg.includes("Engine Output Scene"));
  assert.ok(svg.includes("Output parity"));
  assert.ok(diagnostics.embeddedImages>=6,"includes LED/image and original Power Distro artwork");
  for (const card of contract.cards) {
    assert.ok(svg.includes(svgEscape(card.name)));
    // Engine artwork clamps the band to the device's 12-unit face margin.
    assert.ok(svg.includes(`d="M${Math.max(12,card.x)+6} ${card.y} L`));
  }
  for (const plug of contract.devices.find(d=>d.id==="power").visual.powerDistro.plugEntries) {
    // The 2:1 image fixture is fitted inside each already-resolved plug rect.
    assert.ok(svg.includes(`x="${plug.x}" y="${plug.y+plug.height/4}" width="${plug.width}" height="${plug.height/2}" preserveAspectRatio="none"`));
  }
  assert.doesNotMatch(svg,/<image[^>]+href="(?:https?:|\.\/|Devices\/)/);
});

test("image acquisition validates inline originals and does not permit missing assets",async()=> {
  const result = await prepareEnginePrintImages(contract,async src=>images[src]);
  assert.deepEqual(result,images);
  assert.throws(()=>render(contract,{ images:{} }),/Missing print image/);
  await assert.rejects(prepareEnginePrintImages(contract,async()=>({href:"https://example.test/a.png",width:4,height:4})),/Cannot embed/);
  await assert.rejects(prepareEnginePrintImages(contract,async()=>({href:fixture.ledSurfaces[0].image,width:0,height:4})),/Cannot embed/);
});

test("print-light shapes/text retain vector paths and selectable escaped text",()=> {
  const data = structuredClone(contract);
  data.devices.find(d=>d.id==="ordinary-a").visual.displayName = '<script>& "name"';
  data.devices.find(d=>d.id==="ordinary-a").label = '<script>& "name"';
  const { svg } = render(data);
  assert.ok(svg.includes("&lt;script&gt;&amp; &quot;name&quot;"));
  assert.doesNotMatch(svg,/<script>/);
  assert.ok(svg.includes('<text'));
  assert.ok(svg.includes('fill="#17212b"'));
  assert.ok(svg.includes('rgba(241,245,248,1)'));
  assert.equal(printPaint("rgba(0,0,0,.84)","text-stroke"),"#ffffff");
  assert.equal(render(contract,{ background:null,padding:0 }).diagnostics.viewBox.width,contract.bounds.width);
});

test("scalar text metrics produce deterministic artwork without DOM, font or Image dependencies",()=> {
  const metrics = collectEnginePrintTextMetrics(contract,images,(font,text)=>text.length*Number(font.match(/([.\d]+)px/)[1])*.5);
  assert.ok(Object.keys(metrics).length>50);
  assert.deepEqual(render(contract,{textMetrics:metrics}),render(contract,{textMetrics:metrics}));
  assert.throws(()=>collectEnginePrintTextMetrics(contract,images,()=>NaN),/Invalid print font metric/);
});

test("outward adapter labels are contained without changing canonical bounds",()=> {
  const project = outputParityFixture();
  const adapter = project.devices.find(d=>d.instanceId==="breakout");
  adapter.name = "Long adapter label at the outside edge of a small print drawing";
  adapter.x = -300; adapter.y = -100;
  const scene = buildEngineOutputScene({devices:[adapter]});
  const {diagnostics} = renderEngineOutputSvg(scene);
  assert.deepEqual(diagnostics.bounds,scene.bounds);
  assert.ok(diagnostics.viewBox.x < scene.bounds.x-24);
  assert.ok(diagnostics.viewBox.y < scene.bounds.y-24);
  assert.equal(diagnostics.signature,scene.signature);
});

test("SVG backend retains transforms, clipping, curves, gradients and original image bounds",()=> {
  const ctx = new OutputSvgContext({images});
  ctx.save();ctx.translate(10,-20);ctx.scale(2,3);ctx.beginPath();ctx.rect(0,0,5,7);ctx.clip();
  ctx.beginPath();ctx.moveTo(1,2);ctx.bezierCurveTo(2,3,4,5,6,7);ctx.quadraticCurveTo(8,9,10,11);
  const g=ctx.createLinearGradient(1,2,6,7);g.addColorStop(0,"#ff0000");g.addColorStop(1,"#0000ff");ctx.strokeStyle=g;ctx.stroke();ctx.restore();
  assert.ok(ctx.elements[0].includes('matrix(2 0 0 3 10 -20)'));
  assert.ok(ctx.elements[0].includes('C2 3 4 5 6 7 Q8 9 10 11'));
  assert.equal(ctx.defs.length,2);
  assert.throws(()=>ctx.moveTo(Infinity,0),/Non-finite/);
  assert.throws(()=>render(contract,{padding:-1}),/Invalid print padding/);
  assert.ok(render(buildEngineOutputScene({})).svg.includes('data-avdesigner-output="engine-svg"'));
});

test("real PDF entry point uses only the Engine drawing and retains report sections",async()=> {
  const html = readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const extract = name => html.match(new RegExp(`^    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`,"m"))[0];
  const writes=[],calls=[],report={sentinel:true};
  const popup={document:{open(){},write(html){writes.push(html);},close(){},body:{}}};
  const context=vm.createContext({window:{open:()=>popup},outputNow:()=>0,ensureEngineOutputSceneModule:async()=>{},
    buildCanonicalOutputSnapshot:options=>{calls.push(options);return{reportData:report,engineScene:contract};},
    logoSourceForReport:async()=>"logo",buildEnginePrintDrawing:async s=>{assert.equal(s.reportData,report);return{svg:"ENGINE"};},
    buildPrintableReportHtml:(r,svg,logo)=>{assert.equal(r,report);assert.equal(svg,"ENGINE");assert.equal(logo,"logo");return"REPORT";},recordOutputTiming(){},
    canvas:{cloneNode(){throw new Error("Legacy clone called");}},wirechartSvgMarkup(){throw new Error("Legacy renderer called");}});
  vm.runInContext(extract("exportPdfReport"),context);await context.exportPdfReport();
  assert.equal(calls[0].drawingDependency,"engine-svg");assert.equal(writes.at(-1),"REPORT");
  for(const section of ["Devices","Adapters","Racks","LED Screens","Cable Schedule"]) assert.ok(extract("buildPrintableReportHtml").includes(section));
  assert.ok(extract("buildPrintableReportHtml").includes("matrixReportHtml"));
  assert.doesNotMatch(extract("exportPdfReport"),/wirechartSvgMarkup|cloneNode|legacy-svg-clone/);
});
