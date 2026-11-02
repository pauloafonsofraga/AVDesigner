import test from 'node:test';
import assert from 'node:assert/strict';
import {portalView} from '../src/accountPortal.js';

const signed={ready:true,configurationKnown:true,configured:true,authenticated:true};
test('configured unauthenticated and failed configuration sessions remain on login',()=>{
  assert.equal(portalView({...signed,authenticated:false},true),'login');
  assert.equal(portalView({configurationKnown:false,configured:false}),'login');
});
test('restored authenticated sessions land at dashboard before explicitly launching designer',()=>{
  assert.equal(portalView(signed),'dashboard');assert.equal(portalView(signed,true),'designer');
});
test('MFA and password recovery prevent navigation into designer',()=>{
  for(const flag of ['requiresMfa','passwordRecovery','recoveryRequested'])assert.equal(portalView({...signed,[flag]:true},true),'login');
});
test('unconfigured local installations retain existing offline designer workflows',()=>{
  assert.equal(portalView({configurationKnown:true,configured:false}),'offline');
});
test('plan and browser-provided role flags do not override the authentication gate',()=>{
  for(const plan of ['free','paid','enterprise'])assert.equal(portalView({...signed,plan,authenticated:false,admin:true},true),'login');
});
