import test from "node:test";
import assert from "node:assert/strict";
import {backplateArtworkView,backplateArtworkFromView} from "../src/engine/backplateArtwork.js";
import {legacyFaceHeight,resizeFaceImage} from "../src/engine/faceplateGeometry.js";
import {inlineProjectArtwork} from "../src/imageAssets.js";
import {normalizeAvDesignerDevice} from "../src/engine/projectAdapter.js";
import {resolveEffectiveBuiltInTemplate} from "../src/engine/localUserSettings.js";

test("optional Backplate preserves front geometry and independent transforms through save/reopen", () => {
  const front={faceImage:"data:image/png;base64,FRONT",faceImageNaturalWidth:1000,faceImageNaturalHeight:500,
    connectors:[{id:"in",x:0,y:300}],cardSlots:[{id:"slot",y:350}],width:380,height:700};
  assert.equal(backplateArtworkView(front,380),front);
  const source={...front,backplate:{faceImage:"data:image/png;base64,BACK",faceImageNaturalWidth:1000,faceImageNaturalHeight:300}};
  const before=structuredClone(source),view=backplateArtworkView(source,380);
  assert.equal(legacyFaceHeight(view,380),legacyFaceHeight(source,380));
  const edited=resizeFaceImage(view,380,"e",{x:-60,y:0});
  source.backplate=backplateArtworkFromView(edited);
  assert.equal(source.faceImage,before.faceImage);
  assert.deepEqual(source.connectors,before.connectors);assert.deepEqual(source.cardSlots,before.cardSlots);
  const reopened=JSON.parse(JSON.stringify(source));
  assert.deepEqual(backplateArtworkView(reopened,380),backplateArtworkView(source,380));
  assert.notEqual(source.backplate.faceImageScaleX,1);
});

test("Backplate image is discovered by the existing portable asset path", async () => {
  const project={deviceLibrary:[{id:"device",faceImage:"data:image/png;base64,FRONT",backplate:{faceImage:"data:image/png;base64,BACK"}}]};
  const seen=[];
  const portable=await inlineProjectArtwork(structuredClone(project), source=>{seen.push(source);return source;});
  assert.ok(seen.includes(project.deviceLibrary[0].backplate.faceImage));
  assert.equal(portable.deviceLibrary[0].backplate.faceImage,project.deviceLibrary[0].backplate.faceImage);
});

test("Backplate remains editable on a device whose front faceplate was deleted", () => {
  const source={id:"deleted-front",width:380,height:700,faceplateDeleted:true,
    connectors:[{id:"p",type:"hdmi",direction:"input",x:0,y:80}],
    backplate:{faceImage:"data:image/png;base64,BACK",faceImageNaturalWidth:800,faceImageNaturalHeight:200}};
  const view=backplateArtworkView(source,380);
  const resized=resizeFaceImage(view,380,"e",{x:-40,y:0});
  assert.ok(resized.faceImageScaleX<1);
  const normalize=template=>normalizeAvDesignerDevice({}, {instanceId:"device",templateOverride:template});
  assert.deepEqual(normalize(view).connectors,normalize(source).connectors);
  assert.equal(normalize(view).height,normalize(source).height);
});

test("image-free configuration overrides preserve owned Backplate bytes", () => {
  const factory={id:"backplate-device",width:380,connectors:[],backplate:{faceImage:"data:image/png;base64,BACK",faceImageOffsetX:0}};
  const settings={builtInDeviceDefaults:{[factory.id]:{templateId:factory.id,configuration:{connectors:[],backplate:{faceImageOffsetX:12}}}}};
  const result=resolveEffectiveBuiltInTemplate(factory,settings);
  assert.equal(result.backplate.faceImage,factory.backplate.faceImage);
  assert.equal(result.backplate.faceImageOffsetX,12);
  assert.equal(factory.backplate.faceImageOffsetX,0);
});
