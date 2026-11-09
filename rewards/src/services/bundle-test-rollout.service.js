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
 const result=await graphql(shop,SET_BUNDLE_TEST,{metafields:[{
  ownerId:transformId,namespace:'$app',key:'bundle-test-rollout',type:'json',value:JSON.stringify({testEnabled:enabled})
 }]});
 if(!result?.metafieldsSet)throw fail('BUNDLE_TEST_WRITE_EMPTY','Shopify returned no test configuration result.');
 assertNoUserErrors(result.metafieldsSet);
 const verified=ownedRegistration(await graphql(shop,INSPECT_BUNDLE_TEST),transformId);
 if(verified.configuration?.jsonValue?.testEnabled!==enabled){
  throw fail('BUNDLE_TEST_READBACK_FAILED','The test configuration read-back did not match the requested value.');
 }
 return {shop,transformId,enabled,verified:true};
}
