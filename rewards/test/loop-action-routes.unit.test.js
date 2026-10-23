import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHmac} from 'node:crypto';
import {createSubscriptionActionRouter} from '../src/routes/subscriptionActions.js';

test('signed proxy rejects absent, stale, array and tampered identity; valid request uses signed identity only',async()=>{
 process.env.SHOPIFY_API_SECRET='fixture-secret';
 const calls=[];const service={preview:async(identity,body)=>{calls.push({identity,body});return {ok:true,applied:false};},execute:async()=>({ok:true,applied:true}),status:async()=>({ok:true,applied:true})};
 const app=express();app.use(express.json());app.use(createSubscriptionActionRouter({service}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 const query=(extra={})=>{
  const q={shop:'test.myshopify.com',logged_in_customer_id:'123',timestamp:String(Math.floor(Date.now()/1000)),...extra};
  q.signature=createHmac('sha256','fixture-secret').update(Object.keys(q).sort().map(k=>`${k}=${q[k]}`).join('')).digest('hex');return new URLSearchParams(q);
 };
 try{
  assert.equal((await fetch(url+'/action-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/action-preview?'+query({timestamp:'1'}),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const tampered=query();tampered.set('logged_in_customer_id','456');
  assert.equal((await fetch(url+'/action-preview?'+tampered,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const r=await fetch(url+'/action-preview?'+query(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerId:'evil',shop:'evil.myshopify.com'})});
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(calls[0].identity,{shop:'test.myshopify.com',customerId:'123'});
  assert.equal((await fetch(url+'/action-preview?'+query({logged_in_customer_id:''}),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 }finally{await new Promise(r=>server.close(r));}
});
test('provider errors are sanitized before returning to the browser',async()=>{
 process.env.SHOPIFY_API_SECRET='fixture-secret';
 const app=express();app.use(express.json());app.use(createSubscriptionActionRouter({service:{execute:async()=>{throw new Error('secret-token-and-customer-email');}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const q={shop:'test.myshopify.com',logged_in_customer_id:'123',timestamp:String(Math.floor(Date.now()/1000))};q.signature=createHmac('sha256','fixture-secret').update(Object.keys(q).sort().map(k=>`${k}=${q[k]}`).join('')).digest('hex');
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/action-execute?`+new URLSearchParams(q),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret-token|customer-email/);}finally{await new Promise(r=>server.close(r));}
});
