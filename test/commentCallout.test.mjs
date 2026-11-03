import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../src/engine/productionBridge.js',import.meta.url),'utf8');
function shell(name){const start=html.indexOf(`    function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n    }',start)+6);}
function method(name){const start=bridge.indexOf(`\n  ${name}(`),tail=bridge.slice(start+1);assert.ok(start>=0);return tail.slice(0,tail.slice(1).search(/\n  (?:async )?\w+\(/)+1);}
const comment=()=>({id:'comment-1',x:120,y:180,width:320,height:190,anchor:{x:30,y:40},title:'Note',text:'Original',textSize:17,textColor:'#fff',backgroundColor:'#18202a',leaderColor:'#0cf'});

test('inline text/title commits preserve the original callout identity, dimensions, arrow and style',()=>{
  for(const [field,value] of [['text','Edited\nsecond line'],['title','New title']]){
    const before=comment(),commits=[],control={value,remove(){this.removed=true;}};
    const context=vm.createContext({structuredClone,state:{comments:[before]},commentEditor:{commentId:before.id,field,control,before:structuredClone(before)},
      activeEngineBridge:()=>({commitCanvasObjectSnapshot:(kind,a,b,options)=>commits.push({kind,a,b,options})})});
    vm.runInContext(shell('closeCommentEditor'),context);vm.runInContext('closeCommentEditor(true);closeCommentEditor(true)',context);
    assert.equal(commits.length,1);assert.equal(commits[0].kind,'comment');assert.deepEqual(commits[0].a,before);
    assert.deepEqual(commits[0].b,{...before,[field]:value});assert.equal(context.commentEditor,null);assert.equal(control.removed,true);
  }
});
test('Escape removes the active control without changing or committing the comment',()=>{
  const original=comment(),control={value:'Canceled',remove(){this.removed=true;}};
  const context=vm.createContext({structuredClone,state:{comments:[original]},commentEditor:{commentId:original.id,field:'text',control,before:structuredClone(original)},activeEngineBridge:()=>({commitCanvasObjectSnapshot(){assert.fail('Canceled edit committed');}})});
  vm.runInContext(shell('closeCommentEditor'),context);vm.runInContext('closeCommentEditor(false)',context);
  assert.deepEqual(original,comment());assert.equal(context.commentEditor,null);assert.equal(control.removed,true);
});
test('a queued outside click cannot commit or close a newer inline editor',()=>{
  const callbacks=[],first={},second={},closed=[];
  const context=vm.createContext({commentEditor:first,areaEditor:null,setTimeout:fn=>callbacks.push(fn),closeCommentEditor:()=>closed.push('comment'),closeAreaEditor:()=>closed.push('area')});
  vm.runInContext(shell('scheduleInlineEditorClose'),context);
  context.scheduleInlineEditorClose({target:{closest:()=>false}});context.commentEditor=second;callbacks[0]();assert.ok(!closed.includes('comment'));
});
test('arrow and box previews are independent and preserve both modern and historical anchor fields',()=>{
  for(const legacy of [false,true])for(const moveAnchor of [false,true]){
    const raw=comment();if(legacy){raw.anchorX=raw.anchor.x;raw.anchorY=raw.anchor.y;delete raw.anchor;}
    const b=vm.runInNewContext(`({${method('updateCommentBoxDrag')}})`,{deepClone:structuredClone,
      commentRawAnchor:c=>c.anchor||{x:c.anchorX,y:c.anchorY},preserveCommentRawAnchor:(next,source)=>{if(source.anchor)next.anchor=structuredClone(source.anchor);},rawCanvasObjectsDiffer:(a,b)=>JSON.stringify(a)!==JSON.stringify(b)});
    Object.assign(b,{commentBoxDrag:{beforeRaw:raw,currentRaw:structuredClone(raw),moveAnchor,offsetX:0,offsetY:0},replaceCanvasObjectSceneFromRaw(){},scheduleRender(){}});
    assert.equal(b.updateCommentBoxDrag({x:210,y:240}),true);const after=b.commentBoxDrag.currentRaw;
    if(moveAnchor){assert.equal(after.x,raw.x);assert.equal(after.y,raw.y);assert.deepEqual(legacy?[after.anchorX,after.anchorY]:[after.anchor.x,after.anchor.y],[210,240]);assert.equal(Boolean(after.anchor),!legacy);}
    else{assert.equal(after.x,210);assert.equal(after.y,240);assert.deepEqual(after.anchor,raw.anchor);assert.equal(after.anchorX,raw.anchorX);}
    assert.equal(after.width,raw.width);assert.equal(after.height,raw.height);assert.equal(after.id,raw.id);
    assert.equal(b.updateCommentBoxDrag({x:210,y:240}),false);
  }
});
