import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setBundleTestRollout} from '../src/services/bundle-test-rollout.service.js';
const transformId='gid://shopify/CartTransform/138019188';
const shop='test.myshopify.com';
const app='gid://shopify/App/123';
function harness(change={}) {
 const calls=[];let enabled=false;
 const graphql=async(domain,query,variables)=>{
  calls.push({domain,query,variables});
  if(query.includes('mutation')){enabled=JSON.parse(variables.metafields[0].value).testEnabled;return {metafieldsSet:{metafields:[{id:'field'}],userErrors:[]}};}
  return {currentAppInstallation:{app:{id:app}},shopifyFunctions:{nodes:[{id:'our-function',handle:'cart-grouped-merge',appKey:'2faa75d1b8a04a2fb7872c3b0b1b437f',app:{id:app}}]},cartTransforms:{nodes:[{id:transformId,functionId:'our-function',configuration:{jsonValue:{testEnabled:enabled}}}]},...change};
 };
 return {calls,graphql};
}
test('sets only the selected registration and verifies the app-owned value',async()=>{
 const h=harness();const result=await setBundleTestRollout({shop,transformId,enabled:true},h);
 assert.equal(result.verified,true);assert.equal(result.enabled,true);
 const writes=h.calls.filter(c=>c.query.includes('mutation'));assert.equal(writes.length,1);
 assert.deepEqual(writes[0].variables.metafields,[{ownerId:transformId,namespace:'$app',key:'bundle-test-rollout',type:'json',value:'{"testEnabled":true}'}]);
});
test('can turn test mode off',async()=>{
 const h=harness();assert.equal((await setBundleTestRollout({shop,transformId,enabled:false},h)).enabled,false);
});
test('rejects invalid arguments before any API request',async()=>{
 for(const change of [{shop:'https://test.myshopify.com'},{transformId:'other'},{enabled:'true'}]){
  const h=harness();await assert.rejects(setBundleTestRollout({shop,transformId,enabled:true,...change},h));assert.equal(h.calls.length,0);
 }
});
test('rejects a token from another app without writing',async()=>{
 const h=harness({currentAppInstallation:{app:{id:'gid://shopify/App/999'}}});
 await assert.rejects(setBundleTestRollout({shop,transformId,enabled:true},h),/app/i);assert.equal(h.calls.filter(c=>c.query.includes('mutation')).length,0);
});
test('rejects the old registration without writing',async()=>{
 const h=harness({cartTransforms:{nodes:[{id:transformId,functionId:'old-function'}]}});
 await assert.rejects(setBundleTestRollout({shop,transformId,enabled:true},h),/app/i);assert.equal(h.calls.length,1);
});
test('does not report success on mutation user errors',async()=>{
 const h=harness();const graphql=async(...args)=>args[1].includes('mutation')?{metafieldsSet:{userErrors:[{message:'Permission denied'}]}}:h.graphql(...args);
 await assert.rejects(setBundleTestRollout({shop,transformId,enabled:true},{graphql}),/Permission denied/);
});
test('requires the read-back to confirm the switch',async()=>{
 const h=harness();const graphql=async(...args)=>args[1].includes('mutation')?{metafieldsSet:{userErrors:[]}}:h.graphql(...args);
 await assert.rejects(setBundleTestRollout({shop,transformId,enabled:true},{graphql}),/read-back/i);
});
