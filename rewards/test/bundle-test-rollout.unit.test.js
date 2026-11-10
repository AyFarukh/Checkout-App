import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setBundleTestRollout,snapshotBlockCounts} from '../src/services/bundle-test-rollout.service.js';
const transformId='gid://shopify/CartTransform/138019188';
const shop='test.myshopify.com';
const app='gid://shopify/App/123';
function harness(change={}) {
 const calls=[];let configuration={testEnabled:false};
 const graphql=async(domain,query,variables)=>{
  calls.push({domain,query,variables});
  if(query.includes('ReadBundleTestCounts'))return {products:{nodes:[{id:'gid://shopify/Product/100',block1Count:{type:'number_integer',jsonValue:2}}],pageInfo:{hasNextPage:false,endCursor:null}}};
  if(query.includes('mutation')){configuration=JSON.parse(variables.metafields[0].value);return {metafieldsSet:{metafields:[{id:'field'}],userErrors:[]}};}
  return {currentAppInstallation:{app:{id:app}},shopifyFunctions:{nodes:[{id:'our-function',handle:'cart-grouped-merge',appKey:'2faa75d1b8a04a2fb7872c3b0b1b437f',app:{id:app}}]},cartTransforms:{nodes:[{id:transformId,functionId:'our-function',configuration:{jsonValue:configuration}}]},...change};
 };
 return {calls,graphql};
}
test('sets only the selected registration and verifies the app-owned value',async()=>{
 const h=harness();const result=await setBundleTestRollout({shop,transformId,enabled:true},h);
 assert.equal(result.verified,true);assert.equal(result.enabled,true);
 const writes=h.calls.filter(c=>c.query.includes('mutation'));assert.equal(writes.length,1);
 assert.deepEqual(writes[0].variables.metafields,[{ownerId:transformId,namespace:'$app',key:'bundle-test-rollout',type:'json',value:'{"testEnabled":true,"countsVersion":1,"blockCounts":{"100":[2,0,0,0]}}'}]);
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

test('snapshots counts across product pages and ignores products without active blocks',async()=>{
 const cursors=[];
 const graphql=async(_shop,_query,variables)=>{
  cursors.push(variables.after);
  return {products:variables.after?{nodes:[{id:'gid://shopify/Product/200',block4Count:{type:'number_integer',jsonValue:3}},{id:'gid://shopify/Product/300'}],pageInfo:{hasNextPage:false,endCursor:null}}:{nodes:[{id:'gid://shopify/Product/100',block1Count:{type:'number_integer',jsonValue:2}}],pageInfo:{hasNextPage:true,endCursor:'next'}}};
 };
 assert.deepEqual(await snapshotBlockCounts(shop,graphql),{'100':[2,0,0,0],'200':[0,0,0,3]});assert.deepEqual(cursors,[null,'next']);
});
test('refuses malformed counts or excessive combined quantities',async()=>{
 for(const field of [{type:'json',jsonValue:1},{type:'number_integer',jsonValue:'2'},{type:'number_integer',jsonValue:-1},{type:'number_integer',jsonValue:51}]){
  await assert.rejects(snapshotBlockCounts(shop,async()=>({products:{nodes:[{id:'gid://shopify/Product/100',block1Count:field}],pageInfo:{hasNextPage:false}}})),/count/i);
 }
});
test('fails closed when product pagination does not advance',async()=>{
 await assert.rejects(snapshotBlockCounts(shop,async()=>({products:{nodes:[],pageInfo:{hasNextPage:true,endCursor:null}}})),/pagination/i);
});
test('does not scan products when disabling the switch',async()=>{
 const h=harness();await setBundleTestRollout({shop,transformId,enabled:false},h);
 assert.equal(h.calls.some(call=>call.query.includes('ReadBundleTestCounts')),false);
});
test('requires count snapshot read-back as well as the enabled flag',async()=>{
 const h=harness();let written=false;
 const graphql=async(...args)=>{
  const data=await h.graphql(...args);
  if(args[1].includes('mutation'))written=true;
  else if(written&&data.cartTransforms)data.cartTransforms.nodes[0].configuration.jsonValue={testEnabled:true,countsVersion:1,blockCounts:{'100':[9,0,0,0]}};
  return data;
 };
 await assert.rejects(setBundleTestRollout({shop,transformId,enabled:true},{graphql}),/read-back/i);
});
test('refuses an oversized count snapshot before the Function would omit its metafield',async()=>{
 let page=0;
 await assert.rejects(snapshotBlockCounts(shop,async()=>({products:{
  nodes:Array.from({length:50},(_,index)=>({id:`gid://shopify/Product/${12345678900000+page*50+index}`,block1Count:{type:'number_integer',jsonValue:1}})),
  pageInfo:{hasNextPage:true,endCursor:String(++page)}
 }})),/size budget/i);
});
test('rejects excessive total across individually valid block counts',async()=>{
 await assert.rejects(snapshotBlockCounts(shop,async()=>({products:{nodes:[{id:'gid://shopify/Product/100',block1Count:{type:'number_integer',jsonValue:25},block2Count:{type:'number_integer',jsonValue:26}}],pageInfo:{hasNextPage:false}}})),/exceed/i);
});
test('does not enable a snapshot with no active bundle counts',async()=>{
 const h=harness();const graphql=async(...args)=>args[1].includes('ReadBundleTestCounts')?{products:{nodes:[],pageInfo:{hasNextPage:false}}}:h.graphql(...args);
 await assert.rejects(setBundleTestRollout({shop,transformId,enabled:true},{graphql}),/No active/i);
 assert.equal(h.calls.some(call=>call.query.includes('mutation')),false);
});
