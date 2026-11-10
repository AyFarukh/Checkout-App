import {shopifyAdminGraphql,assertNoUserErrors} from './shopify-admin.service.js';

export const INSPECT_BUNDLE_TEST = `query InspectBundleTestRollout {
 currentAppInstallation { app { id } }
 shopifyFunctions(first: 100) { nodes { id handle appKey app { id } } }
 cartTransforms(first: 100) { nodes {
  id functionId configuration: metafield(namespace: "$app", key: "bundle-test-rollout") { jsonValue }
 } }
}`;
export const SET_BUNDLE_TEST = `mutation SetBundleTestRollout($metafields: [MetafieldsSetInput!]!) {
 metafieldsSet(metafields: $metafields) {
  metafields { id namespace key value }
  userErrors { field message }
 }
}`;
const fail=(code,message)=>Object.assign(new Error(message),{code});
function ownedRegistration(data,transformId){
 const registration=data?.cartTransforms?.nodes?.find(node=>node.id===transformId);
 const fn=data?.shopifyFunctions?.nodes?.find(node=>node.id===registration?.functionId);
 const appId=data?.currentAppInstallation?.app?.id;
 if(!registration||!appId||fn?.handle!=='cart-grouped-merge'||
    fn?.appKey!=='2faa75d1b8a04a2fb7872c3b0b1b437f'||fn?.app?.id!==appId){
  throw fail('BUNDLE_TEST_APP_MISMATCH','The selected registration and API token must belong to our bundle app.');
 }
 return registration;
}
export async function setBundleTestRollout({shop,transformId,enabled},{graphql=shopifyAdminGraphql}={}){
 if(typeof shop!=='string'||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||
    typeof transformId!=='string'||!/^gid:\/\/shopify\/CartTransform\/\d+$/.test(transformId)||typeof enabled!=='boolean'){
  throw fail('BUNDLE_TEST_ARGUMENT_INVALID','Provide a myshopify.com domain, Cart Transform GID and boolean enabled value.');
 }
 ownedRegistration(await graphql(shop,INSPECT_BUNDLE_TEST),transformId);
 const configuration=enabled
  ?{testEnabled:true,countsVersion:1,blockCounts:await snapshotBlockCounts(shop,graphql)}
  :{testEnabled:false};
 if(enabled&&Object.keys(configuration.blockCounts).length===0)throw fail('BUNDLE_TEST_COUNTS_MISSING','No active bundle counts were found; configuration was not changed.');
 const result=await graphql(shop,SET_BUNDLE_TEST,{metafields:[{
  ownerId:transformId,namespace:'$app',key:'bundle-test-rollout',type:'json',value:JSON.stringify(configuration)
 }]});
 if(!result?.metafieldsSet)throw fail('BUNDLE_TEST_WRITE_EMPTY','Shopify returned no test configuration result.');
 assertNoUserErrors(result.metafieldsSet);
 const verified=ownedRegistration(await graphql(shop,INSPECT_BUNDLE_TEST),transformId);
 if(verified.configuration?.jsonValue?.testEnabled!==enabled ||
    (enabled&&(verified.configuration.jsonValue.countsVersion!==1||
      canonicalCounts(verified.configuration.jsonValue.blockCounts)!==canonicalCounts(configuration.blockCounts)))){
  throw fail('BUNDLE_TEST_READBACK_FAILED','The test configuration read-back did not match the requested value.');
 }
 return {shop,transformId,enabled,verified:true,...(enabled?{productsConfigured:Object.keys(configuration.blockCounts).length}:{})};
}

export const READ_BUNDLE_COUNTS = `query ReadBundleTestCounts($after: String) {
 products(first: 50, after: $after) {
  nodes {
   id
   block1Count: metafield(namespace: "custom", key: "no_of_block_1_free_products") { type jsonValue }
   block2Count: metafield(namespace: "custom", key: "total_block_2_free_products") { type jsonValue }
   block3Count: metafield(namespace: "custom", key: "total_block_3_free_products") { type jsonValue }
   block4Count: metafield(namespace: "custom", key: "total_block_4_free_products") { type jsonValue }
  }
  pageInfo { hasNextPage endCursor }
 }
}`;
export async function snapshotBlockCounts(shop,graphql=shopifyAdminGraphql){
 const result={};let after=null;const seen=new Set();
 for(let page=0;page<100;page++){
  const data=await graphql(shop,READ_BUNDLE_COUNTS,{after});
  const products=data?.products;
  if(!Array.isArray(products?.nodes)||!products?.pageInfo)throw fail('BUNDLE_TEST_COUNTS_EMPTY','Shopify returned no product count page.');
  for(const product of products.nodes){
   const match=/^gid:\/\/shopify\/Product\/(\d+)$/.exec(product?.id||'');
   if(!match)throw fail('BUNDLE_TEST_COUNTS_INVALID','Product identity is invalid while reading counts.');
   const counts=[1,2,3,4].map(index=>{
    const field=product['block'+index+'Count'];
    if(field==null)return 0;
    if(field.type!=='number_integer'||!Number.isSafeInteger(field.jsonValue)||field.jsonValue<0||field.jsonValue>50){
     throw fail('BUNDLE_TEST_COUNTS_INVALID',`Invalid bundle count on product ${match[1]}.`);
    }
    return field.jsonValue;
   });
   const total=counts.reduce((sum,count)=>sum+count,0);
   if(total>50)throw fail('BUNDLE_TEST_COUNTS_INVALID',`Bundle counts exceed 50 on product ${match[1]}.`);
   if(total)result[match[1]]=counts;
  }
  // Function metafields over 10,000 bytes are omitted. Leave room for the envelope.
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>9000)throw fail('BUNDLE_TEST_COUNTS_TOO_LARGE','Bundle count snapshot exceeds the Function input size budget.');
  if(!products.pageInfo.hasNextPage)return result;
  const next=products.pageInfo.endCursor;
  if(!next||seen.has(next))throw fail('BUNDLE_TEST_COUNTS_PAGINATION','Bundle count pagination did not advance.');
  seen.add(next);after=next;
 }
 throw fail('BUNDLE_TEST_COUNTS_PAGINATION','Bundle count pagination exceeds the supported scan limit.');
}
function canonicalCounts(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 return JSON.stringify(Object.keys(value).sort().map(key=>[key,value[key]]));
}
