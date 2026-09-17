import crypto from "node:crypto";
import { assertNoUserErrors, shopifyAdminGraphql, validateShopifyAdminConfiguration } from "./shopify-admin.service.js";

const CREATE_CODE = `mutation RewardCodeCreate($input: DiscountCodeAppInput!) {
  discountCodeAppCreate(codeAppDiscount: $input) {
    codeAppDiscount { discountId title status usageLimit codes(first: 1) { nodes { code } } appDiscountType { functionId } }
    userErrors { field message }
  }
}`;
const DEACTIVATE_CODE = `mutation RewardCodeDeactivate($id: ID!) {
  discountCodeDeactivate(id: $id) {
    codeDiscountNode { id }
    userErrors { field message }
  }
}`;
function codeFor(reference){const suffix=crypto.createHash("sha256").update(String(reference)).digest("hex").slice(0,12).toUpperCase();return `FTR-${suffix}`}
function functionConfiguration(reward,redemption){return{schemaVersion:1,rewardId:String(reward._id),rewardVersion:Number(redemption.rewardVersion||reward.version||1),redemptionReference:String(redemption.publicReference),shopifyCustomerId:String(redemption.shopifyCustomerId),type:reward.type,pointsCost:Number(redemption.points),discountValue:Number(reward.discountValue||0),minimumSpend:Number(reward.minimumSpend||0),productId:reward.productId||null,collectionId:reward.collectionId||null}}
function discountClassesFor(reward){const type=String(reward?.type||"").toUpperCase();if(type==="FREE_SHIPPING")return["SHIPPING"];if(type==="FREE_PRODUCT"||reward?.productId||reward?.collectionId)return["PRODUCT"];return["ORDER"]}
export async function createRedemptionDiscount({shop,reward,redemption}){const{functionId}=await validateShopifyAdminConfiguration(shop);const code=codeFor(redemption.publicReference);const customerId=String(redemption.shopifyCustomerId||"").trim();if(!customerId)throw Object.assign(new Error("Redemption customer is required for Shopify discount eligibility"),{permanent:true,code:"REDEMPTION_CUSTOMER_MISSING"});const input={code,title:`FreeTheRoots reward ${redemption.publicReference}`,functionId,discountClasses:discountClassesFor(reward),context:{customers:{add:[customerId]}},startsAt:new Date().toISOString(),endsAt:new Date(redemption.expiresAt).toISOString(),usageLimit:1,appliesOncePerCustomer:true,combinesWith:{orderDiscounts:true,productDiscounts:true,shippingDiscounts:true},metafields:[{namespace:"freetheroot_rewards",key:"function-configuration",type:"json",value:JSON.stringify(functionConfiguration(reward,redemption))}]};const data=await shopifyAdminGraphql(shop,CREATE_CODE,{input});const payload=assertNoUserErrors(data?.discountCodeAppCreate),created=payload?.codeAppDiscount;if(!created?.discountId)throw Object.assign(new Error("Shopify reward code creation returned no discount ID"),{retryable:true,code:"SHOPIFY_REDEMPTION_DISCOUNT_EMPTY"});return{discountId:created.discountId,code:created.codes?.nodes?.[0]?.code||code}}
export async function deactivateRedemptionDiscount({shop,discountId}){if(!discountId)return false;const data=await shopifyAdminGraphql(shop,DEACTIVATE_CODE,{id:String(discountId)});assertNoUserErrors(data?.discountCodeDeactivate);return true}
