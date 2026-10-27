import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const handler=html.match(/^    async function handleProjectSaveShortcut\(event\) \{[\s\S]*?^    \}/m)[0];
const setup=saveProject=>{
  const context=vm.createContext({saveProject});
  vm.runInContext('let projectShortcutSavePending=false;\n'+handler,context);
  return context.handleProjectSaveShortcut;
};
const key=(fields={})=>({key:'s',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,
  prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...fields});

for(const modifier of ['metaKey','ctrlKey'])test(`${modifier}+S saves the project and prevents browser save, including text-field focus`,async()=>{
  let calls=0;const run=setup(async()=>{calls++;});
  const event=key({[modifier]:true,key:'S',target:{tagName:'INPUT'}});
  await run(event);assert.equal(calls,1);assert.ok(event.prevented);assert.ok(event.stopped);
});
test('ordinary typing and other shortcuts remain untouched',async()=>{
  let calls=0;const run=setup(()=>{calls++;});
  for(const fields of [{},{ctrlKey:true,altKey:true},{metaKey:true,shiftKey:true},{ctrlKey:true,key:'z'}]){
    const event=key(fields);await run(event);assert.equal(event.prevented,false);assert.equal(event.stopped,false);
  }
  assert.equal(calls,0);
});
test('key repeat and simultaneous presses do not open multiple saves; cancellation allows retry',async()=>{
  let calls=0,finish;const run=setup(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  const pending=run(key({ctrlKey:true}));
  const repeated=key({ctrlKey:true,repeat:true}),second=key({metaKey:true});
  await run(repeated);await run(second);assert.equal(calls,1);assert.ok(repeated.prevented && second.prevented);
  finish();await pending;
  const retry=run(key({ctrlKey:true}));assert.equal(calls,2);finish();await retry;
});
test('failed saves release the shortcut guard',async()=>{
  let calls=0;const run=setup(async()=>{calls++;throw new Error('write failed');});
  await assert.rejects(run(key({metaKey:true})),/write failed/);
  await assert.rejects(run(key({metaKey:true})),/write failed/);assert.equal(calls,2);
});
test('shortcut uses window capture to own browser save before focused controls',()=>{
  assert.match(html,/window\.addEventListener\("keydown", handleProjectSaveShortcut, true\)/);
});
