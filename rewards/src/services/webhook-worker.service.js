import crypto from "node:crypto";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { PointsTransaction } from "../models/PointsTransaction.js";
import { awardForAction, reverseForRefund } from "./rules.service.js";
import { commitRedemptionFromPaidOrder, refundRedemption } from "./redemption.service.js";
import { shopifyAdminGraphql } from "./shopify-admin.service.js";

const MAX_ATTEMPTS = Number(process.env.REWARDS_WEBHOOK_MAX_ATTEMPTS || 8);
const LOCK_MS = Number(process.env.REWARDS_WEBHOOK_LOCK_MS || 5 * 60_000);
const WORKER_ID = `${process.pid}:${crypto.randomUUID()}`;
function backoff(attempt){const base=Math.min(30*60_000,5_000*(2**Math.max(0,attempt-1)));return Math.round(base*(0.8+Math.random()*0.4))}
function retryable(error){if(error?.permanent===true)return false;if(["ValidationError","CastError"].includes(error?.name))return false;if(error?.code===11000)return false;return true}
function customerGid(value){const id=String(value||"").trim();if(!id)return null;return id.startsWith("gid://shopify/Customer/")?id:`gid://shopify/Customer/${id}`}
function orderGid(value){const id=String(value||"").trim();if(!id)return null;return id.startsWith("gid://shopify/Order/")?id:`gid://shopify/Order/${id}`}
function normalizedCodes(values=[]){return [...new Set(values.map(item=>typeof item==="string"?item:item?.code).map(value=>String(value||"").trim().toUpperCase()).filter(Boolean))]}
function successfulRefundAmount(body){
  const transactions=Array.isArray(body?.transactions)?body.transactions:[];
  return transactions
    .filter(item=>String(item?.kind||"").toLowerCase()==="refund" && ["success","successful"].includes(String(item?.status||"").toLowerCase()))
    .reduce((sum,item)=>sum+Math.max(0,Number(item?.amount||0)||0),0);
}
async function originalEligibleAmount(shop,orderId){
  const earn=await PointsTransaction.findOne({shop,shopifyOrderId:String(orderId),type:"EARN",source:"SHOPIFY_ORDER_PAID"}).sort({createdAt:1}).lean();
  const amount=Number(earn?.metadata?.eligibleAmount||0);
  return Number.isFinite(amount)&&amount>0?amount:0;
}

const ORDER_REDEMPTION_CONTEXT = `query RewardsPaidOrder($id: ID!) {
  order(id: $id) {
    id
    customer { id }
    discountApplications(first: 50) {
      nodes {
        ... on DiscountCodeApplication { code }
      }
    }
  }
}`;

async function paidOrderRedemptionContext(event, body) {
  let customerId = customerGid(body.customer?.admin_graphql_api_id || body.customer?.id);
  let discountCodes = normalizedCodes(body.discount_codes || []);
  if ((!customerId || !discountCodes.length) && body.id != null) {
    const data = await shopifyAdminGraphql(event.shop, ORDER_REDEMPTION_CONTEXT, { id: orderGid(body.admin_graphql_api_id || body.id) });
    customerId ||= data?.order?.customer?.id || null;
    discountCodes = [...new Set([...discountCodes, ...normalizedCodes(data?.order?.discountApplications?.nodes || [])])];
  }
  return { customerId, discountCodes };
}

async function processPayload(event) {
  const body = event.payload || {};
  if (event.topic === "orders/paid") {
    const eligibleAmount = Number(body.subtotal_price || body.current_subtotal_price || 0);
    const productIds = (body.line_items || []).map(i=>i.product_id).filter(Boolean).map(String);
    const { customerId, discountCodes } = await paidOrderRedemptionContext(event, body);
    const [earning, redemption] = await Promise.all([
      awardForAction({ shop:event.shop,type:"PURCHASE",customer:body.customer,eventId:body.id,amount:eligibleAmount,source:"SHOPIFY_ORDER_PAID",shopifyOrderId:String(body.id),metadata:{orderName:body.name,eligibleAmount,currency:body.currency,productIds,collectionIds:[],customerOrdersCount:body.customer?.orders_count} }),
      commitRedemptionFromPaidOrder({ shop:event.shop,shopifyOrderId:String(body.id),shopifyCustomerId:customerId,discountCodes }),
    ]);
    console.log(`[Rewards Webhook] order ${body.id} paid; customer=${customerId||"none"}; rewardCodes=${discountCodes.filter(code=>code.startsWith("FTR-")).join(",")||"none"}; redemption=${redemption?.publicReference||"none"}`);
    return { earning, redemption };
  }
  if (event.topic === "customers/create") return awardForAction({shop:event.shop,type:"ACCOUNT_CREATE",customer:body,eventId:body.id,source:"SHOPIFY_CUSTOMER_CREATED"});
  if (event.topic === "refunds/create") {
    const orderId=String(body.order_id||"").trim();
    const refundId=String(body.id||"").trim();
    if(!orderId||!refundId)throw Object.assign(new Error("Refund webhook is missing order_id or id"),{permanent:true,code:"REFUND_IDENTITY_MISSING"});
    const refundedAmount=successfulRefundAmount(body);
    const originalAmount=await originalEligibleAmount(event.shop,orderId);
    const ratio=originalAmount>0?Math.min(1,refundedAmount/originalAmount):(refundedAmount>0?1:0);
    if(refundedAmount<=0){
      console.log(`[Rewards Webhook] refund ${refundId} for order ${orderId} has no successful refund transaction; no points changed`);
      return {earning:{skipped:true,reason:"No successful refund transaction"},redemption:{refunded:0}};
    }
    const [earning,redemption]=await Promise.all([
      reverseForRefund({shop:event.shop,orderId,refundId,refundedAmount}),
      refundRedemption({shop:event.shop,shopifyOrderId:orderId,refundId,ratio}),
    ]);
    console.log(`[Rewards Webhook] refund ${refundId} processed for order ${orderId}; amount=${refundedAmount}; original=${originalAmount||"unknown"}; ratio=${ratio.toFixed(4)}; rewardPointsRestored=${redemption?.refunded||0}`);
    return {earning,redemption};
  }
  const error=new Error(`Unsupported webhook topic: ${event.topic}`);error.permanent=true;throw error;
}

async function claimOne(){const now=new Date(),stale=new Date(Date.now()-LOCK_MS);return WebhookEvent.findOneAndUpdate({$or:[{status:"PENDING",nextAttemptAt:{$lte:now}},{status:"PROCESSING",lockedAt:{$lte:stale}}]},{$set:{status:"PROCESSING",lockedAt:now,lockOwner:WORKER_ID},$inc:{attempts:1}},{new:true,sort:{nextAttemptAt:1,createdAt:1}})}
export async function processWebhookJobs(limit=20){let processed=0;while(processed<limit){const event=await claimOne();if(!event)break;try{await processPayload(event);await WebhookEvent.updateOne({_id:event._id,status:"PROCESSING",lockOwner:WORKER_ID},{$set:{status:"PROCESSED",processedAt:new Date(),retryable:false},$unset:{lockedAt:"",lockOwner:"",lastError:"",lastErrorCode:"",failureReason:""}})}catch(error){const canRetry=retryable(error)&&event.attempts<MAX_ATTEMPTS;const update=canRetry?{$set:{status:"PENDING",retryable:true,nextAttemptAt:new Date(Date.now()+backoff(event.attempts)),lastError:String(error?.message||"Webhook processing failed").slice(0,4000),lastErrorCode:String(error?.code||error?.name||"PROCESSING_ERROR").slice(0,100)},$unset:{lockedAt:"",lockOwner:""}}:{$set:{status:"DEAD",retryable:retryable(error),deadAt:new Date(),lastError:String(error?.message||"Webhook processing failed").slice(0,4000),lastErrorCode:String(error?.code||error?.name||"PROCESSING_ERROR").slice(0,100),failureReason:event.attempts>=MAX_ATTEMPTS?"MAX_ATTEMPTS_EXCEEDED":"PERMANENT_FAILURE"},$unset:{lockedAt:"",lockOwner:""}};await WebhookEvent.updateOne({_id:event._id,status:"PROCESSING",lockOwner:WORKER_ID},update)}processed++}return processed}
