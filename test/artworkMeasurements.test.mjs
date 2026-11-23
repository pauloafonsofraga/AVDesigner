import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const source=html.match(/^    function drawEditorArtworkMeasurements\([^\n]*\) \{[\s\S]*?^    \}/m)[0];
function fixture({side="faceplate",kind="custom-face-image",handle="se",zoom=1}={}){
  const node=(tag,attributes={})=>({tag,attributes,children:[],appendChild(child){this.children.push(child);}});
  const parent=node("svg");parent.getScreenCTM=()=>({a:zoom,b:0,c:0,d:zoom});
  const c=vm.createContext({editorActiveTab:"faceplate",editorArtworkSide:side,editorResizeSession:{kind,handle,backplate:side==="backplate"},createSvg:node});
  vm.runInContext(source,c);return{c,parent,draw:face=>c.drawEditorArtworkMeasurements(parent,face)};
}
const face={x:16,y:38,width:351.25,height:92.75};
test("front and back artwork show two live dimension lines without mutating geometry",()=>{
  for(const side of ["faceplate","backplate"]){
    const f=fixture({side}),before=structuredClone(face);f.draw(face);
    assert.deepEqual(face,before);assert.equal(f.parent.children.length,1);
    const g=f.parent.children[0];assert.equal(g.attributes["pointer-events"],"none");assert.equal(g.attributes["aria-hidden"],"true");
    assert.equal(g.attributes["data-editor-artwork-measurements"],side);
    assert.deepEqual(g.children.filter(n=>n.tag==="path").map(n=>[n.attributes["data-measure-axis"],n.attributes["data-pixels"]]),[["width",face.width],["height",face.height]]);
    assert.deepEqual(g.children.filter(n=>n.tag==="g").map(n=>n.children[1].textContent),["351.3 px","92.8 px"]);
  }
});
test("pixel measurements are zoom independent while labels and ticks retain screen size",()=>{
  for(const zoom of [.25,1,3]){
    const f=fixture({zoom});f.draw(face);const g=f.parent.children[0],label=g.children.find(n=>n.tag==="g");
    assert.equal(g.children[0].attributes["data-pixels"],face.width);
    assert.equal(label.children[1].attributes["font-size"]*zoom,11);
    assert.equal(label.children[0].attributes.height*zoom,18);
    assert.equal(g.children[0].attributes["vector-effect"],"non-scaling-stroke");
  }
});
test("guides are transient and hidden during moves, idle, other tabs and unrelated resizes",()=>{
  for(const kind of ["device-height","card-area"]){const f=fixture({kind});f.draw(face);assert.equal(f.parent.children.length,0);}
  for(const state of ["idle","move","tab","side"]){
    const f=fixture();
    if(state==="idle")f.c.editorResizeSession=null;
    if(state==="move")f.c.editorResizeSession.handle="move";
    if(state==="tab")f.c.editorActiveTab="connectors";
    if(state==="side")f.c.editorArtworkSide="backplate";
    f.draw(face);assert.equal(f.parent.children.length,0,state);
  }
});
test("invalid bounds do not emit broken SVG; generated faceplates share the same pixel guides",()=>{
  for(const invalid of [null,{...face,width:0},{...face,height:NaN},{...face,x:Infinity}]){
    const f=fixture();f.draw(invalid);assert.equal(f.parent.children.length,0);
  }
  const f=fixture({kind:"generated-faceplate"});f.draw(face);assert.equal(f.parent.children.length,1);
});
test("measurement rendering is confined to existing editor artwork resize overlays",()=>{
  assert.match(html.match(/^    function drawEditorFaceImageResizeTool\([^\n]*\) \{[\s\S]*?^    \}/m)[0],/drawEditorArtworkMeasurements\(parent, face\)/);
  assert.match(html.match(/^    function drawEditorFaceplateResizeHandles\([^\n]*\) \{[\s\S]*?^    \}/m)[0],/drawEditorArtworkMeasurements\(parent, rect\)/);
});
