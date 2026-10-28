import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {parseHTML} from 'linkedom';
const source=await fs.readFile(new URL('../../../rewards/public/rewards-customer.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('storefront retries preserve uncertain requests but never call released rewards ready',async()=>{
 const {document}=parseHTML('<html><body><div id="rewards-content"></div><div id="rewards-status"></div><section id="refer"></section></body></html>');
 const keys=[];let attempt=0;
 const profile={customer:{pointsBalance:2000,lifetimeEarned:2000},rewards:[{_id:'reward',name:'Test reward',pointsCost:500,shopifySync:{status:'SYNCED'}}]};
 const fetch=async(_url,options)=>{
  if(options.method==='GET')return {ok:true,json:async()=>profile};
  keys.push(options.headers['Idempotency-Key']);attempt++;
  if(attempt===1)return {ok:false,status:503,json:async()=>({error:'Shopify temporarily unavailable'})};
  return {ok:true,json:async()=>({redemption:attempt===2?{status:'RELEASED'}:{status:'RESERVED',discountCode:'TEST-CODE'}})};
 };
 vm.runInNewContext(source,{document,fetch,crypto:{randomUUID},navigator:{},location:{pathname:'/apps/ftr-welcome/rewards',search:''},Intl,Date,console});
 await flush();
 const click=label=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent===label);assert.ok(button,label+' button exists');button.click();};
 document.querySelector('button.reward-card').click();click('Confirm redemption');await flush();
 assert.match(document.getElementById('rewards-status').textContent,/unavailable/);
 click('Confirm redemption');await flush();
 assert.doesNotMatch(document.getElementById('rewards-status').textContent,/reward is ready/i);
 click('Confirm redemption');await flush();
 assert.equal(keys[0],keys[1],'retry an uncertain response with the same key');
 assert.notEqual(keys[1],keys[2],'a terminal released attempt allows a fresh key');
 assert.match(document.getElementById('rewards-content').textContent,/TEST-CODE/);
 assert.match(document.getElementById('rewards-status').textContent,/reward is ready/i);
});
