import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import * as geometry from "../src/engine/faceplateGeometry.js";
import {buildEngineOutputScene} from "../src/engine/outputSceneSnapshot.js";

const bounds={x:37/1920,y:477/1080,width:1847/1920,height:166/1080,sourceWidth:1920,sourceHeight:1080};
const source=()=>({id:"xpresscue",name:"xPressCue",width:380,height:190,faceImage:"data:image/png;base64,original",
  faceImageNaturalWidth:1920,faceImageNaturalHeight:1080,connectors:[],cardSlots:[]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const fn=html.match(/^    function connectorStartYForTemplate\([^\n]*\) \{[\s\S]*?^    \}/m)[0];
const context=vm.createContext({isAdapterTemplate:()=>false,editorFaceImageLayout:geometry.faceImageLayout,
  faceImagePlacement:geometry.legacyFaceImagePlacement,DEVICE_WIDTH:380});
vm.runInContext(fn,context);

test("xPressCue padding does not center new artwork or reserve a 1080px faceplate",()=>{
  const old=source(),before=structuredClone(old),next=geometry.fitFaceImageToTop(old,380,bounds);
  const visible=geometry.faceImageVisiblePlacement(next,380);
  near(visible.y,46);near(visible.x,20);near(visible.width,340);near(visible.height,340*166/1847);
  assert.equal(context.connectorStartYForTemplate(next),113);
  assert.ok(geometry.legacyFaceImagePlacement(next,380).y<0,"transparent source padding remains intact outside the visible frame");
  assert.deepEqual(old,before);assert.equal(next.faceImage,old.faceImage);
  for(const key of ["width","height","connectors","cardSlots"])assert.deepEqual(next[key],old[key]);
});

for(const size of [[1920,1080],[2000,150],[100,500]])test(`${size.join("x")} full-image and empty-alpha fallback aligns at top`,()=>{
  const t={...source(),faceImageNaturalWidth:size[0],faceImageNaturalHeight:size[1]};
  for(const content of [null,{x:0,y:0,width:1,height:1,sourceWidth:size[0],sourceHeight:size[1]}]) {
    const next=geometry.fitFaceImageToTop(t,380,content),visible=geometry.faceImageVisiblePlacement(next,380);
    near(visible.y,46);near(visible.x,20);near(visible.width,340);
    near(visible.width/visible.height,size[0]/size[1]);
    assert.ok(Object.values(visible).every(Number.isFinite));
  }
});

test("top-aligned artwork cannot move and resizing retains the connector reservation",()=>{
  const t=geometry.fitFaceImageToTop(source(),380,bounds);
  const moved=geometry.resizeFaceImage(t,380,"move",{x:0,y:12});
  near(geometry.faceImageVisiblePlacement(moved,380).y,46);
  assert.deepEqual(moved,t);
  const smaller=geometry.resizeFaceImage(moved,380,"se",{x:-20,y:-3});
  for(const next of [moved,smaller]) {
    assert.deepEqual(next.faceImageLayout.connectorBounds,t.faceImageLayout.connectorBounds);
    assert.equal(context.connectorStartYForTemplate(next),113);
    assert.deepEqual(next.connectors,t.connectors);assert.deepEqual(next.cardSlots,t.cardSlots);
  }
});

for(const handle of ['n','s','e','w','ne','nw','se','sw'])test(`top-aligned ${handle} resizing ignores transparent padding and stays at the top`,()=>{
  const t=geometry.fitFaceImageToTop(source(),380,bounds),before=structuredClone(t);
  const smaller=geometry.resizeFaceImage(t,380,handle,{x:handle.includes('w')?30:-30,y:handle.includes('n')?10:-10});
  const visible=geometry.faceImageVisiblePlacement(smaller,380);
  near(visible.y,46);assert.ok(visible.width<340);near(visible.width/visible.height,1847/166);
  const larger=geometry.resizeFaceImage(smaller,380,handle,{x:handle.includes('w')?-10000:10000,y:handle.includes('n')?-10000:10000});
  near(geometry.faceImageVisiblePlacement(larger,380).width,340);
  near(geometry.faceImageVisiblePlacement(larger,380).y,46);
  assert.deepEqual(smaller.connectors,t.connectors);assert.deepEqual(smaller.cardSlots,t.cardSlots);
  assert.deepEqual(smaller.faceImageLayout.connectorBounds,t.faceImageLayout.connectorBounds);
  assert.equal(smaller.faceImage,t.faceImage);assert.deepEqual(t,before);
  assert.deepEqual(geometry.faceImageVisiblePlacement(JSON.parse(JSON.stringify(smaller)),380),visible);
});

test("explicit fit repairs old padding reservation without mutating source definitions",()=>{
  const t=geometry.resizeFaceImage(source(),380,"move",{x:0,y:0},bounds),before=structuredClone(t);
  t.connectors=[{id:"iec",type:"iec",direction:"input",x:0,y:266}];
  const next=geometry.fitFaceImageToTop(t,380,bounds);
  assert.equal(context.connectorStartYForTemplate(next),113);
  assert.deepEqual(next.connectors,t.connectors);assert.deepEqual(t.faceImageLayout,before.faceImageLayout);
  near(geometry.faceImageVisiblePlacement(next,380).y,46);
});

test("resizing historical padded artwork can fill the width without retaining a tall artwork area",()=>{
  const t=source();t.connectors=[{id:'iec',y:266}];const before=structuredClone(t);
  const next=geometry.resizeTopAlignedFaceImage(t,380,'se',{x:10000,y:10000},bounds);
  const visible=geometry.faceImageVisiblePlacement(next,380);
  near(visible.x,20);near(visible.y,46);near(visible.width,340);
  near(visible.height,340*166/1847);assert.equal(next.faceImageLayout.height,78);
  assert.deepEqual(next.connectors,t.connectors);assert.deepEqual(t,before);
});

test("new visible placement survives JSON reopen and canonical output",()=>{
  const t=geometry.fitFaceImageToTop(source(),380,bounds);
  t.connectors=[{id:"iec",type:"iec",direction:"input",x:0,y:113}];
  const p={deviceLibrary:[t],devices:[{instanceId:"d",templateId:t.id,x:0,y:0}],connections:[]};
  const saved=JSON.parse(JSON.stringify(p)),output=buildEngineOutputScene(saved).devices[0];
  assert.deepEqual(output.visual.faceImageLayout,t.faceImageLayout);
  assert.equal(output.connectors[0].y,113);
  const visible=geometry.faceImageVisiblePlacement(output.visual,output.width);
  near(visible.y,46);near(visible.height,340*166/1847);
  assert.deepEqual(p,saved);
});
