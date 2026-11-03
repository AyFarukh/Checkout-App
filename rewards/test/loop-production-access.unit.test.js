import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../src/services/loop-action-access.service.js';
import {loopAdminRequest} from '../src/services/loop-subscriptions.service.js';
let savedEnv;
beforeEach(()=>{savedEnv={...process.env};});
afterEach(()=>{for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);});
const setEnv=(key,value)=>{process.env[key]=value;};
const identity={shop:'merchant.myshopify.com',customerId:'987'};
const bound={...identity,subscriptionId:'55555'};
function env(t,extra={}) {
 for(const [key,value] of Object.entries({NODE_ENV:'production',LOOP_ADMIN_SHOP:identity.shop,LOOP_PRODUCTION_MUTATIONS_ENABLED:'true',LOOP_TEST_MUTATIONS_ENABLED:'true',LOOP_TEST_SHOP:'test.myshopify.com',LOOP_TEST_CUSTOMER_ID:'123',LOOP_TEST_SUBSCRIPTION_ID:'42347174',...extra}))setEnv(key,value);
}
test('production scope is customer-bound and only explicit exact merchant configuration enables writes',t=>{
 env(t);assert.deepEqual(policy.subscriptionActionScope(identity,'55555'),bound);assert.equal(policy.subscriptionMutationAllowed(identity,'55555'),true);
 for(const flag of ['false','1','TRUE','']){setEnv('LOOP_PRODUCTION_MUTATIONS_ENABLED',flag);assert.equal(policy.loopMutationsEnabled(),false);assert.equal(policy.subscriptionMutationAllowed(identity,'55555'),false);}
 setEnv('LOOP_PRODUCTION_MUTATIONS_ENABLED','true');setEnv('LOOP_ADMIN_SHOP','');assert.equal(policy.loopMutationsEnabled(),false);
 assert.throws(()=>policy.subscriptionActionScope({shop:'test.myshopify.com',customerId:'123'},'42347174'),e=>e.code==='STORE_NOT_AUTHORIZED');
});
test('production scope rejects foreign stores and noncanonical unsafe identifiers',t=>{
 env(t);
 assert.throws(()=>policy.subscriptionActionScope({...identity,shop:'foreign.myshopify.com'},'55555'),e=>e.code==='STORE_NOT_AUTHORIZED');
 for(const id of ['0','01','-1','1.0','1/../2','1%2f2','9007199254740992',55555,null])assert.throws(()=>policy.subscriptionActionScope(identity,id));
 for(const customerId of ['0','01','abc',987,null])assert.throws(()=>policy.subscriptionActionScope({...identity,customerId},'55555'),e=>e.code==='SIGN_IN_REQUIRED');
});
test('production flag cannot widen local test scope',t=>{
 env(t,{NODE_ENV:'test'});assert.throws(()=>policy.subscriptionActionScope(identity,'55555'),e=>e.code==='TEST_ONLY');
 const local={shop:'test.myshopify.com',customerId:'123'};
 assert.equal(policy.subscriptionMutationAllowed(local,'42347174'),true);
 assert.equal(policy.subscriptionMutationAllowed(local,'42347175'),false);
 setEnv('LOOP_TEST_MUTATIONS_ENABLED','false');assert.equal(policy.loopMutationsEnabled(),false);
});
test('transport production gate blocks disabled or mismatched scopes and unsafe paths before any fetch',async t=>{
 env(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({success:true,data:null});});
 for(const [scope,path] of [[{...bound,shop:'foreign.myshopify.com'},'subscription/55555/note'],[bound,'subscription/55556/note'],[bound,'subscription/55555/../55556/note'],[bound,'subscription/55555/%2e%2e/note'],[null,'subscription/55555/note']])await assert.rejects(loopAdminRequest(path,{method:'PUT',body:{note:'test'},testScope:scope}));
 setEnv('LOOP_PRODUCTION_MUTATIONS_ENABLED','false');await assert.rejects(loopAdminRequest('subscription/55555/note',{method:'PUT',testScope:bound}));assert.equal(calls,0);
});
