import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import {createHmac} from 'node:crypto';
import {ShopifyOfflineToken} from '../src/models/ShopifyOfflineToken.js';
import {welcomeVerification} from '../src/routes/welcomeVerification.js';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createLoopActionService } from '../src/services/loop-action-executor.service.js';
import { LoopActionAttempt } from '../src/models/LoopActionAttempt.js';
import { startLoopFixture, baseSubscription, actionCases } from './support/loop-fixture.js';

let mongo,provider,service;
const identity={shop:'test.myshopify.com',customerId:'123'};
before(async()=>{
 mongo=await MongoMemoryServer.create({instance:{args:["--nounixsocket"]}});await mongoose.connect(mongo.getUri());
 provider=await startLoopFixture();
 Object.assign(process.env,{NODE_ENV:'test',LOOP_ALLOW_LOCAL_TEST_API:'true',LOOP_ADMIN_API_URL:provider.url,LOOP_ADMIN_REQUEST_HEADERS_JSON:'{"X-Loop-Token":"fixture-only"}',LOOP_TEST_SHOP:identity.shop,LOOP_TEST_CUSTOMER_ID:'123',LOOP_TEST_SUBSCRIPTION_ID:'42347174',LOOP_BILLING_TIMEZONE:'America/New_York',SHOPIFY_API_SECRET:'fixture-secret',LOOP_TEST_MUTATIONS_ENABLED:'true'});
 service=createLoopActionService({installationExists:async()=>true,verificationDelayMs:1});
});
after(async()=>{await mongoose.disconnect();await mongo?.stop();await provider?.close();});
beforeEach(async()=>{provider.reset();await LoopActionAttempt.deleteMany({});});
const request=(action,payload,key='request-key-123456789')=>({subscriptionId:'42347174',action,payload,requestKey:key,confirm:true});
for(const [action,payload] of actionCases) test(`${action}: real HTTP adapter, Mongo reservation, read-back and replay`,async()=>{
 const body=request(action,payload);
 const preview=await service.preview(identity,body);assert.equal(preview.applied,false);
 const result=await service.execute(identity,{...body,previewToken:preview.previewToken});
 assert.equal(result.applied,true,JSON.stringify(result));assert.equal(result.verified,true);
 const replay=await service.execute(identity,{...body,previewToken:preview.previewToken});
 assert.equal(replay.applied,true);assert.equal(replay.replayed,true);assert.equal(provider.writes.length,1);
 const attempt=await LoopActionAttempt.findOne({requestKey:body.requestKey});
 assert.equal(attempt.status,'applied');assert.ok(attempt.verifiedAt);assert.equal(attempt.lockKey,undefined);
});
test('gift cannot claim success or send an unverified provider request',async()=>{
 await assert.rejects(service.preview(identity,request('gift',{})),e=>e.code==='GIFT_API_UNAVAILABLE');assert.equal(provider.writes.length,0);
});
for(const scenario of ['unchanged','changed','code-present','active-worker','recent','no-provider-evidence'])test(`operator discount test deferral: ${scenario}`,async()=>{
 const b=request('discount',{value:'SUBTESTING1'}),original=structuredClone(provider.subscription);
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'discount-test-deferral',status:scenario==='active-worker'?'in_flight':'unknown',completedAt:new Date(Date.now()-(scenario==='recent'?0:180000)),providerHttpStatus:scenario==='no-provider-evidence'?null:500,providerFailureKind:scenario==='no-provider-evidence'?null:'HTTP_ERROR',lockKey:`${identity.shop}:${b.subscriptionId}`,context:{before:original,plan:{}}});
 if(scenario==='changed')provider.subscription.discounts.push({title:'another discount',isActive:true});
 if(scenario==='code-present')provider.subscription.discounts.push({title:'SUBTESTING1',isActive:true});
 const body={subscriptionId:b.subscriptionId,requestKey:b.requestKey,confirmWorkerStopped:true,confirmLoopRejected:true};
 if(scenario==='unchanged'){
  for(const flag of ['confirmWorkerStopped','confirmLoopRejected'])await assert.rejects(service.deferDiscountTest(identity,{...body,[flag]:false}));
  process.env.NODE_ENV='production';
  try{await assert.rejects(service.deferDiscountTest(identity,body),e=>e.code==='LOCAL_TEST_RECOVERY_ONLY');}finally{process.env.NODE_ENV='test';}
  const result=await service.deferDiscountTest(identity,body);
  assert.equal(result.code,'DISCOUNT_TEST_DEFERRED');assert.equal(result.applied,false);assert.equal(result.verified,false);
  assert.equal((await service.deferDiscountTest(identity,body)).code,'DISCOUNT_TEST_DEFERRED');
  const saved=await LoopActionAttempt.findOne({requestKey:b.requestKey}).select('+operatorResolution');
  assert.equal(saved.operatorResolution.confirmedLoopRejected,true);assert.equal(saved.providerHttpStatus,500);
  const cancel=request('cancel',{confirmCancellation:true},'cancel-after-deferral-1234'),preview=await service.preview(identity,cancel);
  assert.equal((await service.execute(identity,{...cancel,previewToken:preview.previewToken})).verified,true);
  assert.equal(provider.writes.length,1);assert.ok(provider.writes[0].path.endsWith('/cancel'));
 }else{
  await assert.rejects(service.deferDiscountTest(identity,body));assert.equal(provider.writes.length,0);
 }
 const saved=await LoopActionAttempt.findOne({requestKey:b.requestKey});
 assert.equal(Boolean(saved.lockKey),scenario!=='unchanged');
});
for(const financialStatus of ['paid','pending','refunded'])test(`existing unknown order-now reconciles Admin ${financialStatus} history without redispatch`,async()=>{
 const b=request('order-now',{preponeFutureOrder:true});
 provider.history=[{id:451548046,shopifyId:12721784717684,status:'PROCESSED',financialStatus}];
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'existing-order-now',status:'unknown',lockKey:`${identity.shop}:${b.subscriptionId}`,context:{before:structuredClone(provider.subscription),plan:{historyIds:[]}}});
 const result=await service.status(identity,b);
 assert.equal(result.applied,financialStatus==='paid');assert.equal(result.verified,financialStatus==='paid');
 assert.equal(provider.writes.length,0);
 const stored=await LoopActionAttempt.findOne({requestKey:b.requestKey});
 assert.equal(Boolean(stored.lockKey),financialStatus!=='paid');
 assert.equal((await service.status(identity,b)).applied,financialStatus==='paid');assert.equal(provider.writes.length,0);
});
for(const scenario of ['unchanged','changed','active-worker','valid-fixture','recent'])test(`invalid address test-fixture recovery: ${scenario}`,async()=>{
 const b=request('edit-address',{...provider.subscription.shippingAddress,address1:scenario==='valid-fixture'?'2 Test Road':'REPLACE'});
 const original=structuredClone(provider.subscription);
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'invalid-address-fixture',status:scenario==='active-worker'?'in_flight':'unknown',completedAt:new Date(Date.now()-(scenario==='recent'?0:180000)),lockKey:`${identity.shop}:${b.subscriptionId}`,context:{before:original,plan:{}}});
 if(scenario==='changed')provider.subscription.shippingAddress.address2='changed';
 const recover=()=>service.recoverInvalidAddressFixture(identity,{subscriptionId:b.subscriptionId,requestKey:b.requestKey,confirmWorkerStopped:true});
 if(scenario==='unchanged'){
  await assert.rejects(service.recoverInvalidAddressFixture(identity,b),e=>e.code==='CONFIRM_WORKER_STOPPED_REQUIRED');
  const result=await recover();assert.equal(result.code,'INVALID_TEST_FIXTURE_RECONCILED');assert.equal(result.applied,false);assert.equal(result.verified,false);
  assert.equal((await service.status(identity,b)).operationState,'rejected');
  assert.equal((await recover()).code,'INVALID_TEST_FIXTURE_RECONCILED');
 }else await assert.rejects(recover);
 const stored=await LoopActionAttempt.findOne({requestKey:b.requestKey});
 assert.equal(Boolean(stored.lockKey),scenario!=='unchanged');assert.equal(provider.writes.length,0);
});
test('invalid address fixture recovery is unavailable in production',async()=>{
 process.env.NODE_ENV='production';
 try{await assert.rejects(service.recoverInvalidAddressFixture(identity,{subscriptionId:'42347174',requestKey:'recovery-request-12345',confirmWorkerStopped:true}),e=>e.code==='LOCAL_TEST_RECOVERY_ONLY');}
 finally{process.env.NODE_ENV='test';}
 assert.equal(provider.writes.length,0);
});
for(const scenario of ['unchanged','changed','active-worker','recent'])test(`operator unchanged-address resolution: ${scenario}`,async()=>{
 const b=request('edit-address',{...provider.subscription.shippingAddress,address2:'test change',countryCode:'GB'});
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'address-baseline-mismatch',status:scenario==='active-worker'?'in_flight':'unknown',completedAt:new Date(Date.now()-(scenario==='recent'?0:180000)),lockKey:`${identity.shop}:${b.subscriptionId}`,context:{before:structuredClone(provider.subscription),plan:{}}});
 if(scenario==='changed')provider.subscription.shippingAddress.address2='actual change';
 const body={subscriptionId:b.subscriptionId,requestKey:b.requestKey,confirmWorkerStopped:true};
 if(scenario==='unchanged'){
  await assert.rejects(service.recoverUnchangedAddressFixture(identity,{...body,confirmWorkerStopped:false}),e=>e.code==='CONFIRM_WORKER_STOPPED_REQUIRED');
  const result=await service.recoverUnchangedAddressFixture(identity,body);
  assert.equal(result.code,'UNCHANGED_ADDRESS_RECONCILED');assert.equal(result.applied,false);assert.equal(result.verified,false);
  assert.equal((await service.status(identity,b)).operationState,'rejected');
 }else await assert.rejects(service.recoverUnchangedAddressFixture(identity,body));
 assert.equal(Boolean((await LoopActionAttempt.findOne({requestKey:b.requestKey})).lockKey),scenario!=='unchanged');
 assert.equal(provider.writes.length,0);
});
test('skip rejects unavailable schedule evidence during preview without a reservation',async()=>{
 provider.schedule[0].billingDate='2020-01-01T00:00:00Z';
 await assert.rejects(service.preview(identity,request('skip',{})),e=>e.code==='NEXT_ORDER_UNAVAILABLE');
 assert.equal(provider.writes.length,0);assert.equal(await LoopActionAttempt.countDocuments({}),0);
});
test('skip cannot claim success from date drift when the skipped row is absent',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);provider.omitSkipped=true;
 assert.equal((await service.execute(identity,{...b,previewToken:p.previewToken})).code,'ACTION_OUTCOME_UNKNOWN');
 assert.equal((await service.execute(identity,{...b,previewToken:p.previewToken})).applied,false);
 assert.equal(provider.writes.length,1);
 provider.omitSkipped=false;
 assert.equal((await service.status(identity,b)).verified,true);assert.equal(provider.writes.length,1);
});
test('frequency no-op preview dispatches nothing and creates no lock',async()=>{
 await assert.rejects(service.preview(identity,request('frequency',{interval:'MONTH',intervalCount:1})),e=>e.code==='NO_CHANGE');
 assert.equal(provider.writes.length,0);assert.equal(await LoopActionAttempt.countDocuments({}),0);
});
for(const scenario of ['matches','changed','missing-policy'])test(`existing unknown frequency no-op: ${scenario}`,async()=>{
 const b=request('frequency',{interval:'MONTH',intervalCount:1}),original=structuredClone(provider.subscription);
 if(scenario==='changed')provider.subscription.deliveryPolicy.intervalCount=2;
 if(scenario==='missing-policy'){delete original.deliveryPolicy;delete provider.subscription.deliveryPolicy;}
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'old-no-op',status:'unknown',lockKey:`${identity.shop}:${b.subscriptionId}`,context:{before:original,plan:{pathname:'subscription/42347174/frequency',method:'PUT',body:{billingPolicy:b.payload,deliveryPolicy:b.payload}}}});
 const result=await service.status(identity,b);
 assert.equal(result.code,scenario==='matches'?'NO_CHANGE':'ACTION_OUTCOME_UNKNOWN');
 assert.equal(result.applied,false);assert.equal(result.verified,false);assert.equal(provider.writes.length,0);
 const stored=await LoopActionAttempt.findOne({requestKey:b.requestKey});
 assert.equal(stored.status,scenario==='matches'?'rejected':'unknown');
 assert.equal(Boolean(stored.lockKey),scenario!=='matches');
 if(scenario==='matches'){
  assert.equal((await service.status(identity,b)).code,'NO_CHANGE');
  const next=request('frequency',{interval:'MONTH',intervalCount:2},'next-frequency-key-1234'),p=await service.preview(identity,next);
  assert.equal((await service.execute(identity,{...next,previewToken:p.previewToken})).verified,true);
  assert.equal(provider.writes.length,1);
 }
});
test('an active frequency no-op worker keeps its lock during a status check',async()=>{
 const b=request('frequency',{interval:'MONTH',intervalCount:1});
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'active-frequency',status:'in_flight',lockKey:`${identity.shop}:${b.subscriptionId}`,context:{before:structuredClone(provider.subscription),plan:{}}});
 const result=await service.status(identity,b);
 assert.equal(result.code,'ACTION_OUTCOME_UNKNOWN');assert.equal(result.operationState,'in_flight');
 assert.ok((await LoopActionAttempt.findOne({requestKey:b.requestKey})).lockKey);assert.equal(provider.writes.length,0);
});
test('Admin orderNote read-back verifies and replays one provider write',async()=>{
 provider.subscription.orderNote='old';delete provider.subscription.note;
 const b=request('order-note',{value:'new note'}),p=await service.preview(identity,b);
 const result=await service.execute(identity,{...b,previewToken:p.previewToken});
 assert.equal(result.verified,true);assert.equal(provider.writes.length,1);
 assert.equal((await service.execute(identity,{...b,previewToken:p.previewToken})).replayed,true);
 assert.equal(provider.writes.length,1);
});
test('an existing unknown Admin orderNote attempt reconciles without redispatch',async()=>{
 const original={...provider.subscription,orderNote:'old'};delete original.note;
 provider.subscription={...original,orderNote:'already applied'};
 const b=request('order-note',{value:'already applied'});
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'existing-unknown',status:'unknown',lockKey:`${identity.shop}:${b.subscriptionId}`,context:{before:original,plan:{pathname:'subscription/42347174/note',method:'PUT',body:{note:b.payload.value}}}});
 const result=await service.status(identity,b);
 assert.equal(result.applied,true);assert.equal(result.verified,true);
 assert.equal(provider.writes.length,0);
 assert.equal((await LoopActionAttempt.findOne({requestKey:b.requestKey})).lockKey,undefined);
});
for(const operation of ['add','swap','remove'])test(`edit-products ${operation}: provider operation is verified`,async()=>{
 if(operation==='remove')provider.subscription.lineItems.push({id:8,quantity:1});
 const payload={operation,...(operation==='add'?{}:{lineId:'7'}),...(operation==='remove'?{}:{quantity:2,variantShopifyId:'101'})};
 const b=request('edit-products',payload),p=await service.preview(identity,b);
 const result=await service.execute(identity,{...b,previewToken:p.previewToken});assert.equal(result.applied,true);assert.equal(provider.writes.length,1);
});
test('product variants must come from the merchant subscription catalog',async()=>{
 const b=request('edit-products',{operation:'add',variantShopifyId:'999',quantity:1});
 await assert.rejects(service.preview(identity,b),e=>e.code==='VARIANT_NOT_ELIGIBLE');assert.equal(provider.writes.length,0);
});
test('simultaneous requests with the same key dispatch only once',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);
 const results=await Promise.allSettled(Array.from({length:8},()=>service.execute(identity,{...b,previewToken:p.previewToken})));
 assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.applied));assert.equal(provider.writes.length,1);
});
test('different keys cannot concurrently mutate the same subscription',async()=>{
 const a=request('skip',{}),b=request('skip',{},'another-request-123456789');
 const [pa,pb]=await Promise.all([service.preview(identity,a),service.preview(identity,b)]);
 provider.writeDelay=20;
 const results=await Promise.allSettled([service.execute(identity,{...a,previewToken:pa.previewToken}),service.execute(identity,{...b,previewToken:pb.previewToken})]);
 assert.equal(provider.writes.length,1);assert.ok(results.some(r=>r.status==='rejected'||r.value.applied===false));
});
test('key reuse with a different action or body is rejected',async()=>{
 const a=request('skip',{}),p=await service.preview(identity,a);await service.execute(identity,{...a,previewToken:p.previewToken});
 const b=request('order-note',{value:'changed'}),q=await service.preview(identity,b);
 await assert.rejects(service.execute(identity,{...b,previewToken:q.previewToken}),e=>e.code==='IDEMPOTENCY_KEY_REUSED');assert.equal(provider.writes.length,1);
});
test('payload and subscription state are bound to the preview',async()=>{
 const a=request('order-note',{value:'one'}),p=await service.preview(identity,a);
 await assert.rejects(service.execute(identity,{...a,payload:{value:'two'},previewToken:p.previewToken}),e=>e.code==='INVALID_PREVIEW');
 provider.subscription.orderNote='external edit';
 await assert.rejects(service.execute(identity,{...a,previewToken:p.previewToken}),e=>e.code==='STALE_PREVIEW');assert.equal(provider.writes.length,0);
});
test('unknown outcome survives new executor instance and blocks every new key',async()=>{
 const b=request('order-note',{value:'test'}),p=await service.preview(identity,b);provider.noStateChange=true;
 const first=await service.execute(identity,{...b,previewToken:p.previewToken});assert.equal(first.code,'ACTION_OUTCOME_UNKNOWN');
 const restarted=createLoopActionService({installationExists:async()=>true,verificationDelayMs:1});
 const replay=await restarted.execute(identity,{...b,previewToken:p.previewToken});assert.equal(replay.applied,false);assert.equal(provider.writes.length,1);
 const b2=request('skip',{},'second-key-1234567890'),p2=await service.preview(identity,b2);
 await assert.rejects(restarted.execute(identity,{...b2,previewToken:p2.previewToken}),e=>e.code==='SUBSCRIPTION_ACTION_PENDING');assert.equal(provider.writes.length,1);
});
test('read-only reconciliation can verify a delayed result without another write',async()=>{
 const b=request('order-note',{value:'delayed'}),p=await service.preview(identity,b);provider.noStateChange=true;
 await service.execute(identity,{...b,previewToken:p.previewToken});provider.subscription.orderNote='delayed';
 const result=await service.status(identity,{subscriptionId:'42347174',requestKey:b.requestKey});assert.equal(result.applied,true);assert.equal(provider.writes.length,1);
});
test('provider HTTP 200 success:false is a rejection, not success',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);provider.businessFailure=true;
 const result=await service.execute(identity,{...b,previewToken:p.previewToken});assert.equal(result.applied,false);assert.equal(result.code,'LOOP_REJECTED');
 assert.equal(result.providerHttpStatus,200);assert.equal(result.providerFailureKind,'BUSINESS_REJECTION');
 assert.equal((await LoopActionAttempt.findOne({requestKey:b.requestKey})).status,'rejected');
});
test('HTTP 500 after a provider write is unknown and is never retried',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);provider.ambiguousFailure=true;
 const result=await service.execute(identity,{...b,previewToken:p.previewToken});assert.equal(result.code,'ACTION_OUTCOME_UNKNOWN');
 assert.equal(result.providerHttpStatus,500);assert.equal(result.providerFailureKind,'HTTP_ERROR');
 const replay=await service.status(identity,b);assert.equal(replay.providerHttpStatus,500);assert.equal(replay.providerFailureKind,'HTTP_ERROR');
 await service.execute(identity,{...b,previewToken:p.previewToken});assert.equal(provider.writes.length,1);
});
test('ownership, shop, customer and test allowlist failures dispatch nothing',async()=>{
 const b=request('skip',{});
 for(const who of [{...identity,shop:'other.myshopify.com'},{...identity,customerId:'456'}])await assert.rejects(service.preview(who,b));
 await assert.rejects(service.preview(identity,{...b,subscriptionId:'42347175'}));
 provider.owned=false;await assert.rejects(service.preview(identity,b),e=>e.code==='SUBSCRIPTION_NOT_OWNED');assert.equal(provider.writes.length,0);
});
test('production and default-disabled environments cannot mutate',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);
 process.env.LOOP_TEST_MUTATIONS_ENABLED='false';await assert.rejects(service.execute(identity,{...b,previewToken:p.previewToken}),e=>e.code==='LOOP_MUTATIONS_DISABLED');
 process.env.LOOP_TEST_MUTATIONS_ENABLED='true';process.env.NODE_ENV='production';
 const savedShop=process.env.LOOP_ADMIN_SHOP;process.env.LOOP_ADMIN_SHOP=identity.shop;
 try{await assert.rejects(service.execute(identity,{...b,previewToken:p.previewToken}),e=>e.code==='LOOP_MUTATIONS_DISABLED');}
 finally{process.env.NODE_ENV='test';if(savedShop===undefined)delete process.env.LOOP_ADMIN_SHOP;else process.env.LOOP_ADMIN_SHOP=savedShop;}assert.equal(provider.writes.length,0);
});
test('a worker crash after reservation cannot allow another request to dispatch',async()=>{
 const b=request('skip',{});
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,requestKey:b.requestKey,requestHash:'fixture-crashed-request',lockKey:`${identity.shop}:${b.subscriptionId}`,status:'reserved'});
 const second=request('skip',{},'fresh-key-1234567890'),p=await service.preview(identity,second);
 await assert.rejects(service.execute(identity,{...second,previewToken:p.previewToken}),e=>e.code==='SUBSCRIPTION_ACTION_PENDING');assert.equal(provider.writes.length,0);
});
test('a changed provider read after the reservation releases the lock without a write',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);
 // A stale signed receipt cannot reserve an operation against current state.
 provider.subscription.nextBillingDateEpoch+=86400;
 await assert.rejects(service.execute(identity,{...b,previewToken:p.previewToken}),e=>e.code==='STALE_PREVIEW');
 assert.equal(await LoopActionAttempt.countDocuments(),0);assert.equal(provider.writes.length,0);
});
test('a missing or forged preview cannot dispatch a write',async()=>{
 const b=request('skip',{});
 await assert.rejects(service.execute(identity,b),e=>e.code==='INVALID_PREVIEW');
 await assert.rejects(service.execute(identity,{...b,previewToken:'forged.signature'}),e=>e.code==='INVALID_PREVIEW');assert.equal(provider.writes.length,0);
});
test('in-flight record from a crashed worker is reconciled without redispatch',async()=>{
 const b=request('order-note',{value:'after crash'}),before=structuredClone(provider.subscription);
 const record=await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'crashed-request',lockKey:`${identity.shop}:${b.subscriptionId}`,status:'in_flight',context:{before,plan:{pathname:'subscription/42347174/note',method:'PUT',body:{note:b.payload.value}}}});
 await LoopActionAttempt.collection.updateOne({_id:record._id},{$set:{updatedAt:new Date(Date.now()-180000)}});
 provider.subscription.orderNote=b.payload.value;
 const result=await service.status(identity,b);assert.equal(result.applied,true);assert.equal(result.operationState,'applied');assert.equal(provider.writes.length,0);
});
test('recent in-flight operations are never released by a concurrent status poll',async()=>{
 const b=request('order-note',{value:'pending'});
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'request',lockKey:`${identity.shop}:${b.subscriptionId}`,status:'in_flight',context:{before:structuredClone(provider.subscription),plan:{}}});
 provider.subscription.orderNote='pending';const result=await service.status(identity,b);assert.equal(result.applied,false);assert.equal(result.operationState,'in_flight');
});
test('pre-dispatch failures carry an explicit safe-to-review marker',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);provider.schedule=[];
 await assert.rejects(service.execute(identity,{...b,previewToken:p.previewToken}),e=>e.code==='STALE_PREVIEW'&&e.dispatched===false);
 assert.equal(provider.writes.length,0);
});
test('order-now previews bind order history even when the subscription date stays unchanged',async()=>{
 const a=request('order-now',{preponeFutureOrder:true}),b=request('order-now',{preponeFutureOrder:true},'another-order-key-123456');
 const [pa,pb]=await Promise.all([service.preview(identity,a),service.preview(identity,b)]);
 await service.execute(identity,{...a,previewToken:pa.previewToken});
 await assert.rejects(service.execute(identity,{...b,previewToken:pb.previewToken}),e=>e.code==='STALE_PREVIEW');assert.equal(provider.writes.length,1);
});

test('subscription access follows uninstall and reauthorization with retained credential records',async t=>{
 const originalFetch=globalThis.fetch;
 t.mock.method(globalThis,'fetch',(url,options)=>String(url).startsWith(`https://${identity.shop}/`)
  ? Promise.resolve(Response.json({data:{nodes:[],products:{nodes:[]}}}))
  : originalFetch(String(url).replace('https://api.loopsubscriptions.com/admin/2026-04',provider.url),options));
 const activeService=createLoopActionService({verificationDelayMs:1});
 const app=express();app.use(welcomeVerification);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const read=()=>{
  const q={shop:identity.shop,logged_in_customer_id:identity.customerId,timestamp:String(Math.floor(Date.now()/1000))};
  q.signature=createHmac('sha256',process.env.SHOPIFY_API_SECRET).update(Object.keys(q).sort().map(k=>`${k}=${q[k]}`).join('')).digest('hex');
  return fetch(`http://127.0.0.1:${server.address().port}/subscriptions?`+new URLSearchParams(q));
 };
 try{
  for(const token of [null,''])for(const uninstalledAt of [null,new Date()]){
   await ShopifyOfflineToken.updateOne({shop:identity.shop},{$set:{accessToken:token,uninstalledAt}},{upsert:true});
   await assert.rejects(activeService.preview(identity,request('pause',{confirmPause:true})),e=>e.code==='STORE_NOT_AUTHORIZED');
   assert.equal((await read()).status,403);
  }
  await ShopifyOfflineToken.updateOne({shop:identity.shop},{$set:{accessToken:'fixture-only',uninstalledAt:new Date()}});
  await assert.rejects(activeService.preview(identity,request('pause',{confirmPause:true})),e=>e.code==='STORE_NOT_AUTHORIZED');
  assert.equal((await read()).status,403);
  await ShopifyOfflineToken.updateOne({shop:identity.shop},{$set:{accessToken:'fixture-only',uninstalledAt:null}});
  assert.equal((await activeService.preview(identity,request('pause',{confirmPause:true}))).preview,true);
  const response=await read();assert.equal(response.status,200);const data=await response.json();assert.equal(data.subscriptions.length,1);
  assert.equal(data.mutationsEnabled,true);assert.equal(data.subscriptions[0].mutationAllowed,true);
  const localUrl=process.env.LOOP_ADMIN_API_URL;process.env.NODE_ENV='production';process.env.LOOP_ADMIN_API_URL='https://api.loopsubscriptions.com/admin/2026-04';
  try{const production=await (await read()).json();assert.equal(production.mutationsEnabled,false);assert.equal(production.subscriptions[0].mutationAllowed,false);}
  finally{process.env.NODE_ENV='test';process.env.LOOP_ADMIN_API_URL=localUrl;}
  assert.equal(provider.writes.length,0);
 }finally{await new Promise(r=>server.close(r));await ShopifyOfflineToken.deleteMany({shop:identity.shop});}
});

// Read-only customer order views must work outside the mutation test allowlist.
for(const kind of ['schedule','history'])test(`customer ${kind} view returns safe owned order fields without provider writes`,async()=>{
 const {createLoopCustomerReadService}=await import('../src/services/loop-customer-read.service.js');
 const reader=createLoopCustomerReadService({installationExists:async()=>true});
 provider.subscription.id=42347175;
 if(kind==='history')provider.history=[{id:21,status:'PROCESSED',financialStatus:'paid',shopifyOrderNumber:1001,billingDate:'2027-01-14T10:00:00Z',note:'private note',shippingAddress:{address1:'private address'},nextActionUrl:'https://private.invalid/secret'}];
 const result=await reader.orders(identity,{subscriptionId:'42347175',kind});
 assert.equal(result.ok,true);assert.equal(result.subscriptionId,'42347175');assert.equal(result.orders.length,1);
 assert.equal(result.orders[0].status,kind==='schedule'?'UNPROCESSED':'PROCESSED');
 assert.doesNotMatch(JSON.stringify(result),/private address|private note|private.invalid|nextActionUrl/);
 assert.equal(provider.writes.length,0);
});
test('customer order reads reject foreign identities, invalid IDs and unsupported kinds',async()=>{
 const {createLoopCustomerReadService}=await import('../src/services/loop-customer-read.service.js');
 const reader=createLoopCustomerReadService({installationExists:async()=>true});
 for(const body of [{subscriptionId:'42347174/../1',kind:'history'},{subscriptionId:'42347174',kind:'placeOrder'}])await assert.rejects(reader.orders(identity,body));
 await assert.rejects(reader.orders({...identity,customerId:'456'},{subscriptionId:'42347174',kind:'history'}),e=>e.code==='SUBSCRIPTION_NOT_OWNED');
 provider.owned=false;await assert.rejects(reader.orders(identity,{subscriptionId:'42347174',kind:'history'}),e=>e.code==='SUBSCRIPTION_NOT_OWNED');
 const inactive=createLoopCustomerReadService({installationExists:async()=>false});await assert.rejects(inactive.orders(identity,{subscriptionId:'42347174',kind:'history'}),e=>e.code==='STORE_NOT_AUTHORIZED');
 assert.equal(provider.writes.length,0);
});

test('customer order reads reject another installed merchant even with the same numeric customer ID',async()=>{
 const {createLoopCustomerReadService}=await import('../src/services/loop-customer-read.service.js');
 const reader=createLoopCustomerReadService({installationExists:async()=>true});
 delete provider.subscription.metaData;
 await assert.rejects(reader.orders({...identity,shop:'other.myshopify.com'},{subscriptionId:'42347174',kind:'history'}),e=>e.code==='STORE_NOT_AUTHORIZED');
 assert.equal(provider.writes.length,0);
});

for(const uncertain of [false,true])test(`one-time add verifies next-order-only line and durable replay, uncertain=${uncertain}`,async()=>{
 const payload={operation:'add-once',variantShopifyId:'202',quantity:2},b=request('edit-products',payload),p=await service.preview(identity,b);
 provider.ambiguousFailure=uncertain;
 const result=await service.execute(identity,{...b,previewToken:p.previewToken});
 if(uncertain)assert.equal(result.code,'ACTION_OUTCOME_UNKNOWN');else assert.equal(result.verified,true);
 const status=await service.status(identity,b);assert.equal(status.verified,true);
 assert.equal((await service.execute(identity,{...b,previewToken:p.previewToken})).replayed,true);
 assert.equal(provider.writes.length,1);assert.equal(provider.writes[0].path.endsWith('/line/once'),true);
 assert.deepEqual(provider.writes[0].body,{variantShopifyId:202,quantity:2,discountType:'NONE',discountValue:0,isUpsell:true});
 assert.equal(provider.subscription.lineItems[0].quantity,1);assert.equal(provider.subscription.lineItems[1].isOneTimeAdded,true);
});
test('one-time product catalog accepts non-selling-plan products without accepting arbitrary variants or discounts',async()=>{
 const catalog=await service.catalog(identity,{subscriptionId:'42347174',purchaseType:'one-time'});assert.ok(catalog.products.some(p=>p.id==='202'));
 assert.equal((await service.catalog(identity,{subscriptionId:'42347174'})).products.some(p=>p.id==='202'),false);
 for(const payload of [{operation:'add-once',variantShopifyId:'999',quantity:1},{operation:'add-once',variantShopifyId:'202',quantity:1,discountValue:100}])await assert.rejects(service.preview(identity,request('edit-products',payload)));
 assert.equal(provider.writes.length,0);
});
test('one-time add with unchanged read-back stays unknown and does not redispatch',async()=>{
 provider.noStateChange=true;const b=request('edit-products',{operation:'add-once',variantShopifyId:'202',quantity:1}),p=await service.preview(identity,b);
 assert.equal((await service.execute(identity,{...b,previewToken:p.previewToken})).code,'ACTION_OUTCOME_UNKNOWN');
 assert.equal((await service.status(identity,b)).verified,false);await service.execute(identity,{...b,previewToken:p.previewToken});assert.equal(provider.writes.length,1);
});

// Production-mode tests redirect the official API to the local HTTP fixture.
async function productionFixture(t,run) {
 const saved=Object.fromEntries(['NODE_ENV','LOOP_ADMIN_SHOP','LOOP_PRODUCTION_MUTATIONS_ENABLED','LOOP_ADMIN_API_URL'].map(k=>[k,process.env[k]]));
 const originalFetch=globalThis.fetch;
 t.mock.method(globalThis,'fetch',(url,options)=>String(url).startsWith('https://test.myshopify.com/')?Promise.resolve(Response.json({data:{nodes:[],products:{nodes:[]}}})):originalFetch(String(url).replace('https://api.loopsubscriptions.com/admin/2026-04',provider.url),options));
 Object.assign(process.env,{NODE_ENV:'production',LOOP_ADMIN_SHOP:identity.shop,LOOP_PRODUCTION_MUTATIONS_ENABLED:'true',LOOP_ADMIN_API_URL:'https://api.loopsubscriptions.com/admin/2026-04'});
 provider.subscription.id=55555;provider.subscription.customer.shopifyId=987;
 try{await run({shop:identity.shop,customerId:'987'});}finally{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
for(const [action,payload] of actionCases)test(`production ${action}: owned subscription, verified write and durable replay`,async t=>productionFixture(t,async owner=>{
 const body={...request(action,payload),subscriptionId:'55555'},preview=await service.preview(owner,body);
 const result=await service.execute(owner,{...body,previewToken:preview.previewToken});assert.equal(result.verified,true,JSON.stringify(result));assert.equal(result.replayed,false);
 assert.equal((await service.execute(owner,{...body,previewToken:preview.previewToken})).replayed,true);
 assert.equal((await service.status(owner,body)).verified,true);assert.equal(provider.writes.length,1);assert.ok(provider.writes[0].path.includes('/subscription/55555/'));
}));
test('production rejects foreign customer, merchant, inactive installation and gift',async t=>productionFixture(t,async owner=>{
 const body={...request('order-note',{value:'Test note'}),subscriptionId:'55555'};
 await assert.rejects(service.preview({...owner,customerId:'456'},body),e=>e.code==='SUBSCRIPTION_NOT_OWNED');
 await assert.rejects(service.preview({...owner,shop:'foreign.myshopify.com'},body),e=>e.code==='STORE_NOT_AUTHORIZED');
 await assert.rejects(createLoopActionService({installationExists:async()=>false}).preview(owner,body),e=>e.code==='STORE_NOT_AUTHORIZED');
 provider.owned=false;await assert.rejects(service.preview(owner,body),e=>e.code==='SUBSCRIPTION_NOT_OWNED');provider.owned=true;
 provider.subscription.metaData={myshopifyDomain:'foreign.myshopify.com'};await assert.rejects(service.preview(owner,body),e=>e.code==='SUBSCRIPTION_NOT_OWNED');delete provider.subscription.metaData;
 await assert.rejects(service.preview(owner,{...body,action:'gift',payload:{}}),e=>e.code==='GIFT_API_UNAVAILABLE');assert.equal(provider.writes.length,0);
}));
test('production kill switch blocks writes and preserves unknown verification',async t=>productionFixture(t,async owner=>{
 const body={...request('order-note',{value:'Test note'}),subscriptionId:'55555'},preview=await service.preview(owner,body);provider.ambiguousFailure=true;
 assert.equal((await service.execute(owner,{...body,previewToken:preview.previewToken})).code,'ACTION_OUTCOME_UNKNOWN');
 process.env.LOOP_PRODUCTION_MUTATIONS_ENABLED='false';await assert.rejects(service.execute(owner,{...body,previewToken:preview.previewToken}),e=>e.code==='LOOP_MUTATIONS_DISABLED');
 assert.equal((await service.status(owner,body)).verified,true);assert.equal(provider.writes.length,1);
 await assert.rejects(service.status({...owner,customerId:'456'},body),e=>['SUBSCRIPTION_NOT_OWNED','ACTION_NOT_FOUND'].includes(e.code));
}));
test('production signed routes reject body spoofing and return matching capabilities',async t=>productionFixture(t,async owner=>{
 await ShopifyOfflineToken.updateOne({shop:identity.shop},{$set:{accessToken:'fixture-only',uninstalledAt:null}},{upsert:true});
 const app=express();app.use(express.json());app.use(welcomeVerification);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=(path,customerId,body)=>{
  const q={shop:identity.shop,logged_in_customer_id:customerId,timestamp:String(Math.floor(Date.now()/1000))};q.signature=createHmac('sha256',process.env.SHOPIFY_API_SECRET).update(Object.keys(q).sort().map(k=>`${k}=${q[k]}`).join('')).digest('hex');
  return fetch(`http://127.0.0.1:${server.address().port}/subscriptions${path}?`+new URLSearchParams(q),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 };
 const body={...request('order-note',{value:'Signed production note'}),subscriptionId:'55555',shop:owner.shop,customerId:owner.customerId};
 try{
  const spoof=await call('/action-preview','456',body);assert.equal(spoof.status,403);assert.equal((await spoof.json()).code,'SUBSCRIPTION_NOT_OWNED');
  const gift=await call('/action-execute',owner.customerId,{...body,action:'gift',payload:{}});assert.equal((await gift.json()).code,'GIFT_API_UNAVAILABLE');assert.equal(await LoopActionAttempt.countDocuments({}),0);assert.equal(provider.writes.length,0);
  const caps=await (await call('',owner.customerId)).json();assert.equal(caps.mode,'production');assert.equal(caps.mutationsEnabled,true);assert.equal(caps.subscriptions[0].mutationAllowed,true);
  const preview=await (await call('/action-preview',owner.customerId,body)).json();assert.equal(preview.preview,true);
  assert.equal((await (await call('/action-execute',owner.customerId,{...body,previewToken:preview.previewToken})).json()).verified,true);
  assert.equal((await (await call('/action-execute',owner.customerId,{...body,previewToken:preview.previewToken})).json()).replayed,true);
  process.env.LOOP_PRODUCTION_MUTATIONS_ENABLED='false';const disabled=await (await call('',owner.customerId)).json();assert.equal(disabled.mutationsEnabled,false);assert.equal(disabled.subscriptions[0].mutationAllowed,false);
  assert.equal((await (await call('/action-status',owner.customerId,body)).json()).verified,true);assert.equal(provider.writes.length,1);
 }finally{await new Promise(r=>server.close(r));await ShopifyOfflineToken.deleteMany({shop:identity.shop});}
}));
test('production concurrent keys acquire a single durable subscription lock',async t=>productionFixture(t,async owner=>{
 const bodies=['production-key-first-12345','production-key-second-12345'].map(key=>({...request('order-note',{value:'Concurrent note'},key),subscriptionId:'55555'}));
 const previews=await Promise.all(bodies.map(b=>service.preview(owner,b)));provider.writeDelay=60;
 const results=await Promise.allSettled(bodies.map((b,i)=>service.execute(owner,{...b,previewToken:previews[i].previewToken})));
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.verified===true).length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&['SUBSCRIPTION_ACTION_PENDING','STALE_PREVIEW'].includes(r.reason.code)).length,1);
 assert.equal(provider.writes.length,1);assert.equal(await LoopActionAttempt.countDocuments({}),1);
}));
test('production rechecks ownership and installation after preview without reserving or writing',async t=>productionFixture(t,async owner=>{
 const body={...request('order-note',{value:'Test note'}),subscriptionId:'55555'};
 const preview=await service.preview(owner,body);provider.subscription.customer.shopifyId=456;
 await assert.rejects(service.execute(owner,{...body,previewToken:preview.previewToken}),e=>e.code==='SUBSCRIPTION_NOT_OWNED');provider.subscription.customer.shopifyId=987;
 let installed=true;const active=createLoopActionService({installationExists:async()=>installed}),receipt=await active.preview(owner,body);installed=false;
 await assert.rejects(active.execute(owner,{...body,previewToken:receipt.previewToken}),e=>e.code==='STORE_NOT_AUTHORIZED');
 assert.equal(provider.writes.length,0);assert.equal(await LoopActionAttempt.countDocuments({}),0);
}));
