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
 provider.subscription.note='external edit';
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
 await service.execute(identity,{...b,previewToken:p.previewToken});provider.subscription.note='delayed';
 const result=await service.status(identity,{subscriptionId:'42347174',requestKey:b.requestKey});assert.equal(result.applied,true);assert.equal(provider.writes.length,1);
});
test('provider HTTP 200 success:false is a rejection, not success',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);provider.businessFailure=true;
 const result=await service.execute(identity,{...b,previewToken:p.previewToken});assert.equal(result.applied,false);assert.equal(result.code,'LOOP_REJECTED');
 assert.equal((await LoopActionAttempt.findOne({requestKey:b.requestKey})).status,'rejected');
});
test('HTTP 500 after a provider write is unknown and is never retried',async()=>{
 const b=request('skip',{}),p=await service.preview(identity,b);provider.ambiguousFailure=true;
 const result=await service.execute(identity,{...b,previewToken:p.previewToken});assert.equal(result.code,'ACTION_OUTCOME_UNKNOWN');
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
 provider.subscription.note=b.payload.value;
 const result=await service.status(identity,b);assert.equal(result.applied,true);assert.equal(result.operationState,'applied');assert.equal(provider.writes.length,0);
});
test('recent in-flight operations are never released by a concurrent status poll',async()=>{
 const b=request('order-note',{value:'pending'});
 await LoopActionAttempt.create({...identity,subscriptionId:b.subscriptionId,action:b.action,payload:b.payload,requestKey:b.requestKey,requestHash:'request',lockKey:`${identity.shop}:${b.subscriptionId}`,status:'in_flight',context:{before:structuredClone(provider.subscription),plan:{}}});
 provider.subscription.note='pending';const result=await service.status(identity,b);assert.equal(result.applied,false);assert.equal(result.operationState,'in_flight');
});
test('pre-dispatch failures carry an explicit safe-to-review marker',async()=>{
 provider.schedule=[];const b=request('skip',{}),p=await service.preview(identity,b);
 await assert.rejects(service.execute(identity,{...b,previewToken:p.previewToken}),e=>e.code==='NEXT_ORDER_UNAVAILABLE'&&e.dispatched===false);
 assert.equal(provider.writes.length,0);
});
test('order-now previews bind order history even when the subscription date stays unchanged',async()=>{
 const a=request('order-now',{preponeFutureOrder:true}),b=request('order-now',{preponeFutureOrder:true},'another-order-key-123456');
 const [pa,pb]=await Promise.all([service.preview(identity,a),service.preview(identity,b)]);
 await service.execute(identity,{...a,previewToken:pa.previewToken});
 await assert.rejects(service.execute(identity,{...b,previewToken:pb.previewToken}),e=>e.code==='STALE_PREVIEW');assert.equal(provider.writes.length,1);
});
