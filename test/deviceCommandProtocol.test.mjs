import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceCommandJournal, replayDeviceCommand, createDeviceReplayState, commandJson} from '../src/engine/deviceCommandProtocol.js';

const fixture = () => ({devices:[{instanceId:'a',x:0,y:0,name:'A'},{instanceId:'b',x:500,y:0}],
  connections:[{id:'wire',from:{deviceId:'a',connectorId:'out'},to:{deviceId:'b',connectorId:'in'},routePoints:[{x:200,y:80}]}],
  jumpNodes:[],jumpLinks:[],deviceLibrary:[],customHistoricalData:{retained:true}});
function setup(project=fixture()) {
  let sequence=0;
  const journal=new DeviceCommandJournal({sessionId:'test-session',nextId:()=>`command-${++sequence}`});
  const record=(ids,mutate,origin='edit')=>{
    const before=journal.capture(project,ids);mutate(project);
    return journal.record(before,journal.capture(project,ids),origin);
  };
  return {project,journal,record};
}

test('create, move, properties and deletion replay deterministically without mutating their inputs',()=>{
  const initial=fixture(),c=setup(),original=structuredClone(initial);
  const commands=[
    c.record(['new'],p=>p.devices.push({instanceId:'new',name:'New',x:200,y:400})),
    c.record(['a'],p=>{p.devices[0].x=50;p.devices[0].y=70;}),
    c.record(['a'],p=>{p.devices[0].name='Renamed';p.devices[0].notes='Updated';}),
    c.record(['a'],p=>{p.devices.splice(0,1);p.connections=[];})
  ];
  assert.deepEqual(commands.map(c=>c.type),['device.create','device.move','device.properties','device.delete']);
  const run=()=>commands.reduce((r,c)=>replayDeviceCommand(r.project,JSON.parse(JSON.stringify(c)),r.state),{project:initial,state:createDeviceReplayState('test-session')});
  assert.deepEqual(run(),run());assert.deepEqual(run().project,c.project);assert.deepEqual(initial,original);
  assert.deepEqual(commands[3].affected.map(e=>e.collection).sort(),['connections','devices']);
  assert.equal(commands[2].changes[0].expectedRevision,1);
});

test('duplicates are idempotent but command identity reuse is rejected',()=>{
  const c=setup(),initial=fixture(),command=c.record(['a'],p=>p.devices[0].x=5);
  const first=replayDeviceCommand(initial,command,createDeviceReplayState('test-session'));
  const duplicate=replayDeviceCommand(first.project,command,first.state);
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.project,first.project);assert.equal(duplicate.state,first.state);
  const forged=structuredClone(command);forged.changes[0].after.x=100;
  assert.throws(()=>replayDeviceCommand(first.project,forged,first.state),{code:'COMMAND_ID_REUSED'});
});

test('stale entity revisions, unexpected contents and another load session reject atomically',()=>{
  const c=setup(),command=c.record(['a'],p=>p.devices[0].x=50),initial=fixture(),state=createDeviceReplayState('test-session');
  const stale=structuredClone(state);stale.revisions[JSON.stringify(['devices','a'])]=3;
  assert.throws(()=>replayDeviceCommand(initial,command,stale),{code:'STALE_REVISION'});
  const edited=fixture();edited.devices[0].name='Other edit';
  assert.throws(()=>replayDeviceCommand(edited,command,state),{code:'STALE_REVISION'});
  assert.throws(()=>replayDeviceCommand(initial,command,createDeviceReplayState('different')),{code:'STALE_SESSION'});
  assert.deepEqual(initial,fixture());assert.deepEqual(state,createDeviceReplayState('test-session'));
});

test('deleting a device cannot leave dangling cables or attached Jumps',()=>{
  const c=setup(),command=c.record(['a'],p=>p.devices.splice(0,1));
  assert.throws(()=>replayDeviceCommand(fixture(),command,createDeviceReplayState('test-session')),{code:'INVALID_TOPOLOGY'});
  const root=fixture();root.connections=[];root.jumpNodes=[{id:'j',attachedDeviceId:'a',x:100,y:100}];
  const d=setup(structuredClone(root)),bad=d.record(['a'],p=>p.devices.splice(0,1));
  assert.throws(()=>replayDeviceCommand(root,bad,createDeviceReplayState('test-session')),{code:'INVALID_TOPOLOGY'});
});

test('device deletion, undo and redo retain cable routes, Jump links, attachment state and collection ordering',()=>{
  const initial=fixture();initial.jumpNodes=[{id:'j1',attachedDeviceId:'a',x:100,y:0},{id:'j2',x:900,y:0}];
  initial.jumpLinks=[{id:'pair',outputJumpId:'j1',inputJumpId:'j2'}];
  initial.connections[0].to={jumpNodeId:'j1'};
  const c=setup(structuredClone(initial));
  const remove=p=>{p.devices.splice(0,1);p.connections=[];p.jumpLinks=[];delete p.jumpNodes[0].attachedDeviceId;};
  const commands=[c.record(['a'],remove),c.record(['a'],p=>Object.assign(p,structuredClone(initial)),'undo'),c.record(['a'],remove,'redo')];
  let result={project:initial,state:createDeviceReplayState('test-session')};
  result=replayDeviceCommand(result.project,commands[0],result.state);
  result=replayDeviceCommand(result.project,commands[1],result.state);assert.deepEqual(result.project,initial);
  result=replayDeviceCommand(result.project,commands[2],result.state);assert.deepEqual(result.project,c.project);
  assert.equal(commands[1].changes.find(e=>e.id==='a').expectedRevision,1);
});

test('empty and cancelled gestures create no command and exported commands are detached from the journal',()=>{
  const c=setup(),empty=c.record(['a'],()=>{});assert.equal(empty,null);
  c.record(['a'],p=>p.devices[0].x=10);const copy=c.journal.export();copy.commands[0].changes[0].after.x=1234;
  assert.equal(c.journal.export().commands[0].changes[0].after.x,10);
});

test('reject invalid operations, identities, affected sets, revisions and geometry',()=>{
  const c=setup(),command=c.record(['a'],p=>p.devices[0].x=10);
  for(const mutate of [c=>c.version=2,c=>c.type='eval',c=>c.affected=[],c=>c.changes.push(c.changes[0]),
    c=>c.changes[0].after.instanceId='different',c=>c.changes[0].after.width=-1,
    c=>c.changes[0].after.templateId='other',c=>c.changes[0].expectedRevision=-1]) {
    const invalid=structuredClone(command);mutate(invalid);
    assert.throws(()=>replayDeviceCommand(fixture(),invalid,createDeviceReplayState('test-session')),{code:'INVALID_COMMAND'});
  }
});

test('reject cyclic, executable, nonfinite and prototype-bearing values without weakening JSON validation',()=>{
  const cycle={};cycle.self=cycle;
  for(const invalid of [cycle,{f:()=>{}},{x:NaN},{x:Infinity},new Date(),Array(2),JSON.parse('{"__proto__":{}}')])assert.throws(()=>commandJson(invalid),{code:'INVALID_COMMAND'});
  for(const invalid of [null,[],42,{version:1,changes:[null]}])assert.throws(()=>replayDeviceCommand(fixture(),invalid,createDeviceReplayState('test-session')),{code:'INVALID_COMMAND'});
  const shared={value:1};assert.deepEqual(commandJson({a:shared,b:shared,optional:undefined}),{a:shared,b:shared});
});

test('save/reopen preserves historical project data without adding command or revision metadata',()=>{
  const c=setup(),command=c.record(['a'],p=>p.devices[0].x=10),result=replayDeviceCommand(fixture(),command,createDeviceReplayState('test-session'));
  const reopened=JSON.parse(JSON.stringify(result.project));assert.deepEqual(reopened,c.project);
  assert.equal('commands' in reopened,false);assert.equal('revisions' in reopened,false);
});

test('a stale member of a multi-device transaction rejects every change, including earlier valid members',()=>{
  const initial=fixture(),c=setup(),command=c.record(['a','b'],p=>p.devices.forEach(d=>d.x+=100));
  initial.devices[1].y=20;const baseline=structuredClone(initial),state=createDeviceReplayState('test-session');
  assert.throws(()=>replayDeviceCommand(initial,command,state),{code:'STALE_REVISION'});
  assert.deepEqual(initial,baseline);assert.deepEqual(state,createDeviceReplayState('test-session'));
});

test('multi-device deletion restores original array order and identities on undo',()=>{
  const initial=fixture();initial.devices.splice(1,0,{instanceId:'middle',x:20,y:20});
  const c=setup(structuredClone(initial)),first=c.record(['a','b'],p=>{p.devices=p.devices.filter(d=>d.instanceId==='middle');p.connections=[];});
  const second=c.record(['a','b'],p=>Object.assign(p,structuredClone(initial)),'undo');
  const deleted=replayDeviceCommand(initial,first,createDeviceReplayState('test-session'));
  assert.deepEqual(replayDeviceCommand(deleted.project,second,deleted.state).project,initial);
});

test('unrelated objects and large artwork are not copied into a movement command',()=>{
  const project=fixture();project.devices.push({instanceId:'unrelated',faceImage:'x'.repeat(100000),x:900,y:900});
  const c=setup(project),command=c.record(['a'],p=>p.devices[0].y=50);
  assert.deepEqual(command.affected.map(c=>c.id),['a']);assert.ok(JSON.stringify(command).length<2000);
});

test('property commands cannot replace connectors, inject null structural fields, rewire or delete unrelated cables',()=>{
  for(const edit of [p=>p.devices[0].connectors=null,p=>p.devices[0].templateOverride={},
    p=>p.devices[0].locked='yes',p=>p.devices[0].notes={},p=>p.connections[0].to.deviceId='a']) {
    const c=setup();assert.throws(()=>c.record(['a'],p=>{p.devices[0].name='Edited';edit(p);}),{code:'INVALID_COMMAND'});
    assert.equal(c.journal.export().commands.length,0);
  }
});

test('bounded diagnostic history keeps entity revisions, while separate loads have independent sessions',()=>{
  let id=0;const j=new DeviceCommandJournal({sessionId:'one',nextId:()=>String(++id),limit:1}),project=fixture();
  for(let i=0;i<3;i++){const before=j.capture(project,['a']);project.devices[0].x++;j.record(before,j.capture(project,['a']));}
  const exported=j.export();assert.equal(exported.commands.length,1);assert.equal(exported.commands[0].changes[0].expectedRevision,2);
  assert.equal(new DeviceCommandJournal().export().commands.length,0);
  assert.notEqual(new DeviceCommandJournal().sessionId,new DeviceCommandJournal().sessionId);
});

test('state-wrapped historical projects retain their envelope and untouched collections',()=>{
  const wrapped={format:'old-format',state:fixture()},c=setup(structuredClone(wrapped));
  const command=c.record(['a'],p=>p.state.devices[0].x=30);
  assert.deepEqual(replayDeviceCommand(wrapped,command,createDeviceReplayState('test-session')).project,c.project);
});
