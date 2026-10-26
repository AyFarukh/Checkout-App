import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
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
 await assert.rejects(service.execute(identity,{...b,previewToken:p.previewToken}),e=>e.code==='LOOP_MUTATIONS_DISABLED');process.env.NODE_ENV='test';assert.equal(provider.writes.length,0);
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
