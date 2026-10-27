import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHmac} from 'node:crypto';
import {rewardsProxy} from '../src/routes/rewardsStorefront.js';
import {RewardCustomer} from '../src/models/RewardCustomer.js';
import {Reward} from '../src/models/Reward.js';
import {EarningRule} from '../src/models/EarningRule.js';
import {PointsTransaction} from '../src/models/PointsTransaction.js';
import {Redemption} from '../src/models/Redemption.js';
import {signed} from '../src/routes/welcomeVerification.js';

test('custom rewards page requires signed storefront requests and signed customer identity', async t=>{
 const queries=[];
 t.mock.method(RewardCustomer,'findOne',filter=>{queries.push(filter);return {lean:async()=>({firstName:'Signed customer',pointsBalance:123})};});
 for(const model of [Reward,EarningRule,PointsTransaction,Redemption])t.mock.method(model,'find',filter=>{queries.push(filter);const query={sort:()=>query,select:()=>query,limit:()=>query,lean:async()=>[]};return query;});
 const old=process.env.SHOPIFY_API_SECRET;process.env.SHOPIFY_API_SECRET='test-storefront-secret';
 const app=express();app.use(express.json());app.use('/rewards',rewardsProxy(signed));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/rewards`;
 function query(customer=''){const q={shop:'example.myshopify.com',timestamp:String(Math.floor(Date.now()/1000)),logged_in_customer_id:customer};q.signature=createHmac('sha256',process.env.SHOPIFY_API_SECRET).update(Object.keys(q).sort().map(k=>k+'='+q[k]).join('')).digest('hex');return new URLSearchParams(q);}
 try{
  assert.equal((await fetch(base)).status,403);
  const page=await fetch(base+'?'+query());assert.equal(page.status,200);assert.match(await page.text(),/rewards-customer.js/);
  assert.equal((await fetch(base+'/api/me?'+query())).status,401);
  const profile=await fetch(base+'/api/me?'+query('101'));assert.equal(profile.status,200);
  const result=await profile.json();assert.equal(result.customer.pointsBalance,123);assert.equal(result.storefrontRewardsUrl,'https://example.myshopify.com/apps/ftr-welcome/rewards');
  assert.ok(queries.length>=5);assert.ok(queries.every(q=>q.shop==='example.myshopify.com'));assert.ok(queries.filter(q=>q.shopifyCustomerId).every(q=>q.shopifyCustomerId==='gid://shopify/Customer/101'));
  assert.match(profile.headers.get('cache-control'),/no-store/);
  const forged=query('101');forged.set('logged_in_customer_id','202');assert.equal((await fetch(base+'/api/me?'+forged)).status,403);
  assert.equal((await fetch(base+'/api/redemptions/reserve?'+query('101'),{method:'POST',headers:{'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/assets/../customerApi.js?'+query('101'))).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));if(old===undefined)delete process.env.SHOPIFY_API_SECRET;else process.env.SHOPIFY_API_SECRET=old;}
});
