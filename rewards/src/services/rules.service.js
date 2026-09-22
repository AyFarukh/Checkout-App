import { EarningRule } from "../models/EarningRule.js";
import { RewardSettings } from "../models/RewardSettings.js";
import { PointsTransaction } from "../models/PointsTransaction.js";
import { applyPointsTransaction, normalizeShopifyCustomerId } from "./rewards.service.js";

function money(value){const n=Number(value||0);return Number.isFinite(n)?n:0}
function strings(value){return Array.isArray(value)?value.map(String):[]}
function normalizeId(value){return String(value||"").split("/").pop()}
function intersects(required,actual){const a=new Set(strings(actual).map(normalizeId));return strings(required).some(v=>a.has(normalizeId(v)))}
function activeNow(c){const now=Date.now(),start=c?.startsAt?new Date(c.startsAt).getTime():null,end=c?.endsAt?new Date(c.endsAt).getTime():null;return !(start&&now<start)&&!(end&&now>end)}

async function ruleEligible({rule,shop,customer,amount,metadata}){
  const c=rule.conditions||{};
  if(!activeNow(c))return false;
  if(money(c.minimumOrderAmount)>0&&money(amount)<money(c.minimumOrderAmount))return false;
  if(c.firstOrderOnly&&Number(metadata?.customerOrdersCount??customer?.orders_count??0)>0)return false;
  const requiredTags=strings(c.customerTags).map(x=>x.toLowerCase());
  if(requiredTags.length){const tags=Array.isArray(customer?.tags)?customer.tags:String(customer?.tags||"").split(",");const actual=new Set(tags.map(x=>String(x).trim().toLowerCase()).filter(Boolean));if(!requiredTags.some(x=>actual.has(x)))return false;}
  if(strings(c.productIds).length&&!intersects(c.productIds,metadata?.productIds))return false;
  if(strings(c.collectionIds).length){const directCollectionMatch=intersects(c.collectionIds,metadata?.collectionIds);const productMembershipMatch=intersects(c.collectionProductIds,metadata?.productIds);if(!directCollectionMatch&&!productMembershipMatch)return false;}
  const max=Number(c.maxAwardsPerCustomer||0);
  if(max>0){const count=await PointsTransaction.countDocuments({shop,shopifyCustomerId:normalizeShopifyCustomerId(customer.id),type:"EARN","metadata.ruleId":String(rule._id)});if(count>=max)return false;}
  return true;
}

export async function awardForAction({shop,type,customer,eventId,amount=0,source,shopifyOrderId,metadata={}}){if(!customer?.id)return{skipped:true,reason:"No customer attached to event"};const rules=await EarningRule.find({shop,type,enabled:true}).sort({priority:1,createdAt:1}).lean();if(!rules.length)return{skipped:true,reason:`No enabled ${type} rule`};const results=[];for(const rule of rules){if(!(await ruleEligible({rule,shop,customer,amount,metadata})))continue;const base=type==="PURCHASE"?money(amount)*money(rule.pointsPerDollar)+money(rule.points):money(rule.points),points=Math.floor(base*money(rule.multiplier||1));if(points<=0)continue;results.push(await applyPointsTransaction({shop,shopifyCustomerId:normalizeShopifyCustomerId(customer.id),type:"EARN",points,source,reason:rule.name,shopifyOrderId,customer:{email:customer.email,firstName:customer.first_name,lastName:customer.last_name},idempotencyKey:`${source}:${eventId}:${rule._id}`,metadata:{...metadata,ruleId:String(rule._id),ruleType:rule.type}}))}return{awarded:results.length,results}}

export async function reverseForRefund({shop,orderId,refundId,refundedAmount=0}){
  const settings=await RewardSettings.findOne({shop}).lean();
  if(settings?.refundPolicy==="NO_REVERSAL")return{skipped:true,reason:"Refund reversal disabled"};
  const earns=await PointsTransaction.find({shop,shopifyOrderId:String(orderId),type:"EARN",source:"SHOPIFY_ORDER_PAID"}).lean(),results=[];
  for(const earn of earns){
    const idempotencyKey=`SHOPIFY_REFUND:${refundId}:${earn._id}`;
    const existing=await PointsTransaction.findOne({shop,idempotencyKey}).lean();
    if(existing){results.push({transaction:existing,duplicate:true});continue}

    // Cap each purchase EARN independently. New refund rows always record the
    // originating immutable EARN id, so multiple purchase rules on one order
    // cannot consume each other's reversal allowance. For legacy rows that did
    // not record an origin, only use the order-wide fallback when this order has
    // a single EARN; attributing an ambiguous legacy deduction to every rule
    // would under-reverse valid points.
    const linkedRefunds=await PointsTransaction.find({
      shop,
      shopifyOrderId:String(orderId),
      shopifyCustomerId:earn.shopifyCustomerId,
      type:"REFUND",
      source:"SHOPIFY_REFUND",
      "metadata.originalTransactionId":String(earn._id)
    }).select("points").lean();
    let alreadyReversed=linkedRefunds.reduce((sum,row)=>sum+Math.abs(Number(row.points)||0),0);
    if(earns.length===1){
      const legacyRefunds=await PointsTransaction.find({
        shop,
        shopifyOrderId:String(orderId),
        shopifyCustomerId:earn.shopifyCustomerId,
        type:"REFUND",
        source:"SHOPIFY_REFUND",
        $or:[
          {"metadata.originalTransactionId":{$exists:false}},
          {"metadata.originalTransactionId":null},
          {"metadata.originalTransactionId":""}
        ]
      }).select("points").lean();
      alreadyReversed+=legacyRefunds.reduce((sum,row)=>sum+Math.abs(Number(row.points)||0),0);
    }
    const originalPoints=Math.abs(Number(earn.points)||0);
    const remaining=Math.max(0,originalPoints-alreadyReversed);
    if(remaining<=0)continue;

    let requested=originalPoints;
    if(settings?.refundPolicy!=="REVERSE_FULL"){
      const originalAmount=money(earn.metadata?.eligibleAmount);
      if(originalAmount>0)requested=Math.ceil(originalPoints*Math.min(1,money(refundedAmount)/originalAmount));
    }
    const points=Math.min(remaining,Math.max(0,requested));
    if(points<=0)continue;

    try{
      results.push(await applyPointsTransaction({
        shop,shopifyCustomerId:earn.shopifyCustomerId,type:"REFUND",points,source:"SHOPIFY_REFUND",
        reason:"Points reversed after refund",shopifyOrderId:String(orderId),idempotencyKey,
        metadata:{refundId:String(refundId),originalTransactionId:String(earn._id),refundedAmount,originalEarnPoints:originalPoints,previouslyReversedPoints:alreadyReversed}
      }));
    }catch(error){
      if(error?.code===11000){const duplicate=await PointsTransaction.findOne({shop,idempotencyKey}).lean();if(duplicate){results.push({transaction:duplicate,duplicate:true});continue}}
      throw error;
    }
  }
  return{reversed:results.filter(item=>!item?.duplicate).length,results};
}
