import { RewardCustomer } from "../models/RewardCustomer.js";
import { assertNoUserErrors, shopifyAdminGraphql } from "./shopify-admin.service.js";

const SET_CUSTOMER_METAFIELD = `mutation RewardsCustomerMirror($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value type }
    userErrors { field message code }
  }
}`;

const retryQueue=new Map();
const keyFor=(shop,customerId)=>`${String(shop).toLowerCase()}|${customerId}`;

export async function syncCustomerRewardsMirror({ shop, shopifyCustomerId, pointsBalance }) {
  const ownerId=String(shopifyCustomerId||"").trim();
  if(!ownerId.startsWith("gid://shopify/Customer/"))throw Object.assign(new Error("Valid Shopify customer GID is required for rewards mirror"),{code:"REWARDS_MIRROR_CUSTOMER_INVALID",permanent:true});
  const value=String(Math.max(0,Math.trunc(Number(pointsBalance)||0)));
  const data=await shopifyAdminGraphql(shop,SET_CUSTOMER_METAFIELD,{metafields:[{ownerId,namespace:"freetheroot_rewards",key:"points_balance",type:"number_integer",value}]});
  assertNoUserErrors(data?.metafieldsSet);
  retryQueue.delete(keyFor(shop,ownerId));
  return data?.metafieldsSet?.metafields?.[0]||null;
}

export async function syncCustomerRewardsMirrorBestEffort(input) {
  try{return await syncCustomerRewardsMirror(input)}
  catch(error){
    const key=keyFor(input?.shop,input?.shopifyCustomerId),previous=retryQueue.get(key);
    retryQueue.set(key,{shop:input?.shop,shopifyCustomerId:input?.shopifyCustomerId,attempts:(previous?.attempts||0)+1,nextAttemptAt:Date.now()+Math.min(300000,5000*2**Math.min(previous?.attempts||0,6))});
    console.error("[Rewards Mirror] customer points sync failed",{shop:input?.shop,customerId:input?.shopifyCustomerId,message:error?.message||String(error),code:error?.code});
    return null;
  }
}

export async function processCustomerRewardsMirrorRetries(limit=25){
  const due=[...retryQueue.values()].filter(item=>item.nextAttemptAt<=Date.now()).slice(0,limit);
  let synced=0,failed=0;
  for(const item of due){
    const customer=await RewardCustomer.findOne({shop:String(item.shop||"").toLowerCase(),shopifyCustomerId:item.shopifyCustomerId}).select("pointsBalance").lean();
    if(!customer){retryQueue.delete(keyFor(item.shop,item.shopifyCustomerId));continue}
    try{await syncCustomerRewardsMirror({...item,pointsBalance:customer.pointsBalance});synced++}
    catch(error){failed++;const key=keyFor(item.shop,item.shopifyCustomerId);retryQueue.set(key,{...item,attempts:item.attempts+1,nextAttemptAt:Date.now()+Math.min(300000,5000*2**Math.min(item.attempts,6))})}
  }
  return{processed:due.length,synced,failed,pending:retryQueue.size};
}

export async function reconcileCustomerRewardsMirrors({shop,limit=100}={}){
  if(!shop)return{processed:0,synced:0,failed:0};
  const customers=await RewardCustomer.find({shop:String(shop).toLowerCase()}).select("shopifyCustomerId pointsBalance").limit(Math.min(Math.max(Number(limit)||100,1),250)).lean();
  let synced=0,failed=0;
  for(const customer of customers){try{await syncCustomerRewardsMirror({shop,shopifyCustomerId:customer.shopifyCustomerId,pointsBalance:customer.pointsBalance});synced++}catch{failed++}}
  return{processed:customers.length,synced,failed};
}
