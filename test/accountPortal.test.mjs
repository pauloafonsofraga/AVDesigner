import test from 'node:test';
import assert from 'node:assert/strict';
import {portalView,projectActions,recentProjects} from '../src/accountPortal.js';

const signed={ready:true,configurationKnown:true,configured:true,authenticated:true};
test('configured unauthenticated and failed configuration sessions remain on login',()=>{
  assert.equal(portalView({...signed,authenticated:false},true),'login');
  assert.equal(portalView({configurationKnown:false,configured:false}),'login');
});
test('restored authenticated sessions land at dashboard before explicitly launching designer',()=>{
  assert.equal(portalView(signed),'dashboard');assert.equal(portalView(signed,true),'designer');
});
test('MFA and password recovery prevent navigation into designer',()=>{
  for(const flag of ['requiresMfa','passwordRecovery','recoveryRequested','registrationPending'])assert.equal(portalView({...signed,[flag]:true},true),'login');
});
test('unconfigured local installations retain existing offline designer workflows',()=>{
  assert.equal(portalView({configurationKnown:true,configured:false}),'offline');
});
test('plan and browser-provided role flags do not override the authentication gate',()=>{
  for(const plan of ['free','paid','enterprise'])assert.equal(portalView({...signed,plan,authenticated:false,admin:true},true),'login');
});
test('only authorized write roles get project mutation actions, with restore for archived rows',()=>{
  for(const role of ['owner','admin','editor']){
    assert.deepEqual(projectActions(role),['rename','duplicate','archive']);
    assert.deepEqual(projectActions(role,true),['rename','duplicate','restore']);
  }
  for(const role of ['viewer','platform-admin',undefined])assert.deepEqual(projectActions(role),[]);
});
test('recent project sorting and search are stable and do not mutate source rows',()=>{
  const rows=[{id:'b',name:'Stage B',updated_at:'2026-10-01'},{id:'a',name:'Stage A',updated_at:'2026-11-01'},{id:'c',name:'Screen',updated_at:'2026-11-01'}];
  const before=structuredClone(rows);
  assert.deepEqual(recentProjects(rows).map(r=>r.id),['a','c','b']);
  assert.deepEqual(recentProjects(rows,' STAGE ').map(r=>r.id),['a','b']);assert.deepEqual(rows,before);
  assert.deepEqual(recentProjects(rows,'missing'),[]);
});
