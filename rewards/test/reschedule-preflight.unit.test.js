import test from 'node:test';
import assert from 'node:assert/strict';
import {signed} from '../src/middleware/subscriptionProxyAuth.js';
import {createHmac} from 'node:crypto';
import {prepareAction} from '../src/services/loop-action-contract.service.js';

test('proxy HMAC rejects multi-value query fields, malformed signatures and stale timestamps',()=>{
 process.env.SHOPIFY_API_SECRET='fixture-secret';
 const q={shop:'test.myshopify.com',logged_in_customer_id:'123',timestamp:String(Math.floor(Date.now()/1000))};
 q.signature=createHmac('sha256','fixture-secret').update(Object.keys(q).sort().map(k=>`${k}=${q[k]}`).join('')).digest('hex');
 assert.equal(signed(q),true);assert.equal(signed({...q,logged_in_customer_id:['123','456']}),false);assert.equal(signed({...q,signature:'bad'}),false);assert.equal(signed({...q,timestamp:'1'}),false);
});
test('reschedule rejects anchors and dates within 24 hours',()=>{
 const before={id:42347174,status:'ACTIVE',nextBillingDateEpoch:Date.now()/1000+864000,billingPolicy:{anchors:{type:'MONTHDAY'}}};
 assert.throws(()=>prepareAction('reschedule','42347174',{date:new Date(Date.now()+864000000).toISOString().slice(0,10)},before,{timezone:'America/New_York'}),e=>e.code==='LOOP_ANCHOR_REVIEW_REQUIRED');
 assert.throws(()=>prepareAction('reschedule','42347174',{date:new Date().toISOString().slice(0,10)},{...before,billingPolicy:{}},{timezone:'America/New_York'}),e=>e.code==='INVALID_RESCHEDULE_DATE');
});
