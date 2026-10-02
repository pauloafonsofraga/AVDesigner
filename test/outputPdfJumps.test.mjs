import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outputPdfJumpFixture } from "../fixtures/output-pdf-jumps.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { buildOutputJumpNavigation, pdfJumpDestinationId } from "../src/engine/outputNavigation.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { createOutputViewerModel, outputJumpLinkOverlays, outputCableTrace } from "../src/engine/outputViewerModel.js";
import { buildEngineViewerHtml } from "../src/engine/outputViewerHtml.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";

const contract = buildEngineOutputScene(outputPdfJumpFixture());
const count = (svg,attribute) => [...svg.matchAll(new RegExp(` ${attribute}="`,"g"))].length;

test("Engine print SVG has unchanged rings/physical wires and no Chromium anchors or portal ink",()=>{
  const before=JSON.stringify(contract), model=createOutputViewerModel(contract);
  const {svg,diagnostics}=renderEngineOutputSvg(contract), primitives=engineOutputPrimitives(model.scene,contract);
  assert.equal(count(svg,"data-jump-id"),5);
  assert.equal(count(svg,"data-wire-id"),4);
  assert.equal(count(svg,"data-jump-link-id"),0);
  assert.equal(count(svg,"data-pdf-jump-source"),0);
  assert.equal(count(svg,"data-pdf-jump-target"),0);
  for(const item of [...primitives.jumps,...primitives.wires]) {
    const ctx=new OutputSvgContext();ctx.mesh(item.vertices);
    assert.ok(svg.includes(ctx.elements.join("")),item.id);
  }
  for(const item of primitives.jumpLinks) {
    const ctx=new OutputSvgContext();ctx.mesh(item.vertices);
    assert.ok(!svg.includes(ctx.elements.join("")),"no portal triangles");
  }
  assert.ok(!svg.includes(pdfJumpDestinationId("unpaired")));
  assert.equal(diagnostics.jumpNodes,5);assert.equal(diagnostics.jumpLinks,2);
  assert.equal(diagnostics.jumpNavigationCandidates,4);
  assert.equal(diagnostics.jumpDestinations,0);assert.equal(diagnostics.jumpAnnotations,0);
  assert.equal(diagnostics.visibleJumpLinkPaths,0);
  assert.equal(diagnostics.signature,contract.signature);
  assert.equal(JSON.stringify(contract),before);
  assert.deepEqual(renderEngineOutputSvg(contract),renderEngineOutputSvg(JSON.parse(before)));
  assert.equal(model.scene.jumpNodeRole("bidi-a").baseRole,"bidirectional");
  assert.equal(model.scene.jumpNodeRole("bidi-b").baseRole,"bidirectional");
});

test("pure Jump manifest rejects missing/self endpoints; IDs are collision-free and stable",()=>{
  const project=outputPdfJumpFixture();
  project.jumpLinks.push({id:"missing",outputJumpId:"unpaired",inputJumpId:"missing"},
    {id:"self",outputJumpId:"unpaired",inputJumpId:"unpaired"});
  assert.equal(buildOutputJumpNavigation(buildEngineOutputScene(project)).jumpNodes.length,4);
  const ids=['x/y','x_y','x y','x"<&','x\u2603','x\ud83d\ude00'];
  assert.equal(new Set(ids.map(pdfJumpDestinationId)).size,ids.length);
  ids.forEach(id=>assert.match(pdfJumpDestinationId(id),/^pdf-jump-destination-[a-f0-9-]+$/));
  const old=project.jumpNodes[0].id, hostile=ids[3];project.jumpNodes[0].id=hostile;
  project.jumpLinks[0].outputJumpId=hostile;project.connections[0].to.jumpNodeId=hostile;
  const original=JSON.stringify(project);
  const manifest=buildOutputJumpNavigation(buildEngineOutputScene(project));
  assert.ok(manifest.jumpNodes.some(node=>node.sourceId===hostile && node.destinationId===pdfJumpDestinationId(hostile)));
  assert.ok(!manifest.jumpNodes.some(node=>node.sourceId===old));
  assert.equal(JSON.stringify(project),original);
  assert.equal(Object.isFrozen(manifest.jumpNodes),true);
  assert.equal(Object.isFrozen(manifest.jumpNodes[0].bounds),true);
  assert.deepEqual(manifest,buildOutputJumpNavigation(buildEngineOutputScene(project)));
});

test("PDF navigation leaves canonical HTML/Publish scenes and transient portal behavior untouched",()=>{
  const bundle=JSON.parse(readFileSync(new URL("../src/engine/generated/outputViewerBundle.json",import.meta.url)));
  const snapshot={engineScene:contract,reportData:{projectName:"Jumps"},metadata:{}};
  const before=JSON.stringify(snapshot);
  renderEngineOutputSvg(snapshot);
  for(const title of ["Downloaded","Published"]) {
    const html=buildEngineViewerHtml(snapshot,{bundle,title});
    const payload=JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(payload.engineScene,contract);
    assert.ok(!html.includes("pdf-jump-navigation"));
    const model=createOutputViewerModel(payload);
    assert.deepEqual(outputJumpLinkOverlays(model,null),[]);
    for(const pair of contract.jumpLinks) {
      for(const id of [pair.outputJumpId,pair.inputJumpId]) {
        assert.equal(outputJumpLinkOverlays(model,null,id)[0].id,pair.id);
        assert.equal(outputCableTrace(model,{type:"device",id})[0].id,pair.id);
      }
      assert.equal(outputJumpLinkOverlays(model,{type:"jump-link",id:pair.id})[0].mode,"link-selected");
    }
  }
  assert.equal(JSON.stringify(snapshot),before);
});
