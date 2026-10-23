import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIONS} from '../src/services/loop-action-contract.service.js';
import {createLoopActionService} from '../src/services/loop-action-executor.service.js';
import {loopMutationsEnabled} from '../src/services/loop-subscriptions.service.js';

test('all twelve requested action names are part of the explicit contract',()=>{
 assert.deepEqual(new Set(ACTIONS),new Set(['skip','reschedule','delay','order-now','gift','frequency','pause','cancel','edit-products','edit-address','discount','order-note']));
});
test('execution requires confirmation and cannot be enabled with the legacy production flag',async()=>{
 Object.assign(process.env,{NODE_ENV:'production',LOOP_SUBSCRIPTION_MUTATIONS_ENABLED:'true',LOOP_TEST_MUTATIONS_ENABLED:'true',LOOP_TEST_SHOP:'test.myshopify.com',LOOP_TEST_CUSTOMER_ID:'123',LOOP_TEST_SUBSCRIPTION_ID:'42347174'});
 assert.equal(loopMutationsEnabled(),false);
 const service=createLoopActionService({installationExists:()=>{throw Error('must never reach installation');}});
 const request={subscriptionId:'42347174',action:'skip',payload:{},requestKey:'request-key-123456789'};
 await assert.rejects(service.execute({shop:'test.myshopify.com',customerId:'123'},request),e=>e.code==='CONFIRMATION_REQUIRED');
 await assert.rejects(service.execute({shop:'test.myshopify.com',customerId:'123'},{...request,confirm:true}),e=>e.code==='LOOP_MUTATIONS_DISABLED');
});
