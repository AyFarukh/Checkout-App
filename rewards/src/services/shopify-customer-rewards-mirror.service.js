import { assertNoUserErrors, shopifyAdminGraphql } from "./shopify-admin.service.js";

const SET_CUSTOMER_METAFIELD = `mutation RewardsCustomerMirror($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value type }
    userErrors { field message code }
  }
}`;

export async function syncCustomerRewardsMirror({ shop, shopifyCustomerId, pointsBalance }) {
  const ownerId=String(shopifyCustomerId||"").trim();
  if(!ownerId.startsWith("gid://shopify/Customer/"))throw Object.assign(new Error("Valid Shopify customer GID is required for rewards mirror"),{code:"REWARDS_MIRROR_CUSTOMER_INVALID",permanent:true});
  const value=String(Math.max(0,Math.trunc(Number(pointsBalance)||0)));
  const data=await shopifyAdminGraphql(shop,SET_CUSTOMER_METAFIELD,{metafields:[{
    ownerId,
    namespace:"freetheroot_rewards",
    key:"points_balance",
    type:"number_integer",
    value,
  }]});
  assertNoUserErrors(data?.metafieldsSet);
  return data?.metafieldsSet?.metafields?.[0]||null;
}

export async function syncCustomerRewardsMirrorBestEffort(input) {
  try{return await syncCustomerRewardsMirror(input)}
  catch(error){
    console.error("[Rewards Mirror] customer points sync failed",{shop:input?.shop,customerId:input?.shopifyCustomerId,message:error?.message||String(error),code:error?.code});
    return null;
  }
}
