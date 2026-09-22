import crypto from "node:crypto";
import { RewardCustomer } from "../models/RewardCustomer.js";
import { CustomerRewardsMirrorJob } from "../models/CustomerRewardsMirrorJob.js";
import { assertNoUserErrors, shopifyAdminGraphql } from "./shopify-admin.service.js";

const SET_CUSTOMER_METAFIELD = `mutation RewardsCustomerMirror($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value type }
    userErrors { field message code }
  }
}`;
const LOCK_MS=5*60_000,WORKER_ID=`${process.pid}:${crypto.randomUUID()}`;
const normalizedShop=value=>String(value||"").trim().toLowerCase();
const retryDelay=attempts=>Math.min(300000,5000*2**Math.min(Math.max(0,attempts),6));

async function clearPersistentRetry(shop,shopifyCustomerId){
  await CustomerRewardsMirrorJob.deleteOne({shop:normalizedShop(shop),shopifyCustomerId}).catch(error=>{
    console.error("[Rewards Mirror] could not clear retry job",{shop,customerId:shopifyCustomerId,message:error?.message||String(error)});
  });
}
async function queuePersistentRetry(input,error){
  const shop=normalizedShop(input?.shop),shopifyCustomerId=String(input?.shopifyCustomerId||"").trim();
  if(!shop||!shopifyCustomerId)return;
  const existing=await CustomerRewardsMirrorJob.findOne({shop,shopifyCustomerId}).select("attempts").lean();
  const attempts=(existing?.attempts||0)+1;
  await CustomerRewardsMirrorJob.findOneAndUpdate(
    {shop,shopifyCustomerId},
    {$set:{status:"PENDING",attempts,nextAttemptAt:new Date(Date.now()+retryDelay(attempts-1)),lastError:String(error?.message||"Rewards mirror failed").slice(0,4000),lastErrorCode:String(error?.code||error?.name||"MIRROR_ERROR").slice(0,100)},$unset:{lockedAt:"",lockOwner:"",completedAt:""}},
    {upsert:true,new:true,setDefaultsOnInsert:true}
  );
}

export async function syncCustomerRewardsMirror({ shop, shopifyCustomerId, pointsBalance, graphql = shopifyAdminGraphql }) {
  const ownerId=String(shopifyCustomerId||"").trim();
  if(!ownerId.startsWith("gid://shopify/Customer/"))throw Object.assign(new Error("Valid Shopify customer GID is required for rewards mirror"),{code:"REWARDS_MIRROR_CUSTOMER_INVALID",permanent:true});
  const value=String(Math.max(0,Math.trunc(Number(pointsBalance)||0)));
  const data=await graphql(shop,SET_CUSTOMER_METAFIELD,{metafields:[{ownerId,namespace:"freetheroot_rewards",key:"points_balance",type:"number_integer",value}]});
  assertNoUserErrors(data?.metafieldsSet);
  await clearPersistentRetry(shop,ownerId);
  return data?.metafieldsSet?.metafields?.[0]||null;
}

export async function syncCustomerRewardsMirrorBestEffort(input) {
  try{return await syncCustomerRewardsMirror(input)}
  catch(error){
    try{await queuePersistentRetry(input,error)}catch(queueError){console.error("[Rewards Mirror] persistent retry enqueue failed",{shop:input?.shop,customerId:input?.shopifyCustomerId,message:queueError?.message||String(queueError)})}
    console.error("[Rewards Mirror] customer points sync failed",{shop:input?.shop,customerId:input?.shopifyCustomerId,message:error?.message||String(error),code:error?.code});
    return null;
  }
}

async function claimRetry(){
  const now=new Date(),stale=new Date(Date.now()-LOCK_MS);
  return CustomerRewardsMirrorJob.findOneAndUpdate(
    {$or:[{status:"PENDING",nextAttemptAt:{$lte:now}},{status:"PROCESSING",lockedAt:{$lte:stale}}]},
    {$set:{status:"PROCESSING",lockedAt:now,lockOwner:WORKER_ID}},
    {new:true,sort:{nextAttemptAt:1,createdAt:1}}
  );
}
export async function processCustomerRewardsMirrorRetries(limit=25,{graphql=shopifyAdminGraphql}={}){
  let processed=0,synced=0,failed=0;
  while(processed<limit){
    const job=await claimRetry();if(!job)break;processed++;
    const customer=await RewardCustomer.findOne({shop:job.shop,shopifyCustomerId:job.shopifyCustomerId}).select("pointsBalance").lean();
    if(!customer){await CustomerRewardsMirrorJob.deleteOne({_id:job._id});continue}
    try{
      await syncCustomerRewardsMirror({shop:job.shop,shopifyCustomerId:job.shopifyCustomerId,pointsBalance:customer.pointsBalance,graphql});synced++;
    }catch(error){
      failed++;const attempts=Number(job.attempts||0)+1;
      await CustomerRewardsMirrorJob.updateOne({_id:job._id,status:"PROCESSING",lockOwner:WORKER_ID},{$set:{status:"PENDING",attempts,nextAttemptAt:new Date(Date.now()+retryDelay(attempts-1)),lastError:String(error?.message||"Rewards mirror failed").slice(0,4000),lastErrorCode:String(error?.code||error?.name||"MIRROR_ERROR").slice(0,100)},$unset:{lockedAt:"",lockOwner:""}});
    }
  }
  return{processed,synced,failed,pending:await CustomerRewardsMirrorJob.countDocuments({status:"PENDING"})};
}

export async function reconcileCustomerRewardsMirrors({shop,limit=100}={}){
  if(!shop)return{processed:0,synced:0,failed:0};
  const customers=await RewardCustomer.find({shop:normalizedShop(shop)}).select("shopifyCustomerId pointsBalance").limit(Math.min(Math.max(Number(limit)||100,1),250)).lean();
  let synced=0,failed=0;
  for(const customer of customers){try{await syncCustomerRewardsMirror({shop,shopifyCustomerId:customer.shopifyCustomerId,pointsBalance:customer.pointsBalance});synced++}catch(error){failed++;await queuePersistentRetry({shop,shopifyCustomerId:customer.shopifyCustomerId},error)}}
  return{processed:customers.length,synced,failed};
}
