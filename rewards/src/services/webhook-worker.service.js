import crypto from "node:crypto";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { awardForAction, reverseForRefund } from "./rules.service.js";
import { refundRedemption } from "./redemption.service.js";

const MAX_ATTEMPTS = Number(process.env.REWARDS_WEBHOOK_MAX_ATTEMPTS || 8);
const LOCK_MS = Number(process.env.REWARDS_WEBHOOK_LOCK_MS || 5 * 60_000);
const WORKER_ID = `${process.pid}:${crypto.randomUUID()}`;
function backoff(attempt){const base=Math.min(30*60_000,5_000*(2**Math.max(0,attempt-1)));return Math.round(base*(0.8+Math.random()*0.4))}
function retryable(error){if(error?.permanent===true)return false;if(["ValidationError","CastError"].includes(error?.name))return false;if(error?.code===11000)return false;return true}

async function processPayload(event) {
  const body = event.payload || {};
  if (event.topic === "orders/paid") {
    const eligibleAmount = Number(body.subtotal_price || body.current_subtotal_price || 0);
    const productIds = (body.line_items || []).map(i=>i.product_id).filter(Boolean).map(String);
    return awardForAction({ shop:event.shop,type:"PURCHASE",customer:body.customer,eventId:body.id,amount:eligibleAmount,source:"SHOPIFY_ORDER_PAID",shopifyOrderId:String(body.id),metadata:{orderName:body.name,eligibleAmount,currency:body.currency,productIds,collectionIds:[],customerOrdersCount:body.customer?.orders_count} });
  }
  if (event.topic === "customers/create") return awardForAction({shop:event.shop,type:"ACCOUNT_CREATE",customer:body,eventId:body.id,source:"SHOPIFY_CUSTOMER_CREATED"});
  if (event.topic === "refunds/create") {
    const refundedAmount=(body.transactions||[]).filter(i=>i.kind==="refund"&&i.status==="success").reduce((s,i)=>s+Number(i.amount||0),0);
    const orderAmount=Number(body.order_adjustments?.[0]?.amount || body.total_price || body.order_total || 0);
    const ratio=orderAmount>0?Math.min(1,refundedAmount/orderAmount):1;
    const [earning,redemption]=await Promise.all([
      reverseForRefund({shop:event.shop,orderId:body.order_id,refundId:body.id,refundedAmount}),
      refundRedemption({shop:event.shop,shopifyOrderId:body.order_id,refundId:body.id,ratio}),
    ]);
    return {earning,redemption};
  }
  const error=new Error(`Unsupported webhook topic: ${event.topic}`);error.permanent=true;throw error;
}

async function claimOne(){const now=new Date(),stale=new Date(Date.now()-LOCK_MS);return WebhookEvent.findOneAndUpdate({$or:[{status:"PENDING",nextAttemptAt:{$lte:now}},{status:"PROCESSING",lockedAt:{$lte:stale}}]},{$set:{status:"PROCESSING",lockedAt:now,lockOwner:WORKER_ID},$inc:{attempts:1}},{new:true,sort:{nextAttemptAt:1,createdAt:1}})}
export async function processWebhookJobs(limit=20){let processed=0;while(processed<limit){const event=await claimOne();if(!event)break;try{await processPayload(event);await WebhookEvent.updateOne({_id:event._id,status:"PROCESSING",lockOwner:WORKER_ID},{$set:{status:"PROCESSED",processedAt:new Date(),retryable:false},$unset:{lockedAt:"",lockOwner:"",lastError:"",lastErrorCode:"",failureReason:""}})}catch(error){const canRetry=retryable(error)&&event.attempts<MAX_ATTEMPTS;const update=canRetry?{$set:{status:"PENDING",retryable:true,nextAttemptAt:new Date(Date.now()+backoff(event.attempts)),lastError:String(error?.message||"Webhook processing failed").slice(0,4000),lastErrorCode:String(error?.code||error?.name||"PROCESSING_ERROR").slice(0,100)},$unset:{lockedAt:"",lockOwner:""}}:{$set:{status:"DEAD",retryable:retryable(error),deadAt:new Date(),lastError:String(error?.message||"Webhook processing failed").slice(0,4000),lastErrorCode:String(error?.code||error?.name||"PROCESSING_ERROR").slice(0,100),failureReason:event.attempts>=MAX_ATTEMPTS?"MAX_ATTEMPTS_EXCEEDED":"PERMANENT_FAILURE"},$unset:{lockedAt:"",lockOwner:""}};await WebhookEvent.updateOne({_id:event._id,status:"PROCESSING",lockOwner:WORKER_ID},update)}processed++}return processed}
