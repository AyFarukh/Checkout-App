import {ShopifyOfflineToken} from '../models/ShopifyOfflineToken.js';
import {getCustomerLoopSubscriptions,loopAdminRequest} from './loop-subscriptions.service.js';
import {actionError} from './loop-action-contract.service.js';

export function assertLoopMerchantShop(shop) {
 const configured=process.env.LOOP_ADMIN_SHOP||process.env.LOOP_TEST_SHOP||process.env.SHOPIFY_ADMIN_SHOP;
 if(!configured||configured!==shop)throw actionError('STORE_NOT_AUTHORIZED',403);
}

export function createLoopCustomerReadService({installationExists=shop=>ShopifyOfflineToken.exists({shop,uninstalledAt:null,accessToken:{$type:'string',$ne:''}})}={}) {
 async function orders(identity,body) {
  const {shop,customerId}=identity||{},subscriptionId=String(body?.subscriptionId||''),kind=body?.kind;
  if(typeof shop!=='string'||!/^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/.test(shop)||!/^\d+$/.test(customerId||''))throw actionError('SIGN_IN_REQUIRED',401);
  if(!/^\d+$/.test(subscriptionId)||!Number.isSafeInteger(Number(subscriptionId))||Number(subscriptionId)<=0)throw actionError('INVALID_SUBSCRIPTION_ID');
  if(!['schedule','history'].includes(kind))throw actionError('INVALID_ORDER_VIEW');
  assertLoopMerchantShop(shop);
  if(!await installationExists(shop))throw actionError('STORE_NOT_AUTHORIZED',403);
  const subscriptions=await getCustomerLoopSubscriptions(customerId,{signal:AbortSignal.timeout(10000)});
  if(!subscriptions.some(s=>String(s.id)===subscriptionId))throw actionError('SUBSCRIPTION_NOT_OWNED',403);
  const {data:subscription}=await loopAdminRequest(`subscription/${subscriptionId}`);
  if(String(subscription?.id)!==subscriptionId||String(subscription?.customer?.shopifyId)!==customerId||
    (subscription?.metaData?.myshopifyDomain&&subscription.metaData.myshopifyDomain!==shop))throw actionError('SUBSCRIPTION_NOT_OWNED',403);
  const response=await loopAdminRequest(`subscription/${subscriptionId}/order/${kind}`);
  const rows=Array.isArray(response.data)?response.data:response.data?.orders;
  if(!Array.isArray(rows))throw actionError('INVALID_LOOP_ORDER_RESPONSE',502);
  const clean=rows.slice(0,100).map(row=>{
   if(!row||typeof row!=='object'||!/^\d+$/.test(String(row.id))||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0)throw actionError('INVALID_LOOP_ORDER_RESPONSE',502);
   const text=(value,max=80)=>typeof value==='string'||typeof value==='number'?String(value).slice(0,max):null;
   return {id:String(row.id),status:text(row.status),billingDate:text(row.billingDate??row.scheduledAt),financialStatus:text(row.financialStatus),shopifyOrderNumber:text(row.shopifyOrderNumber)};
  });
  return {ok:true,subscriptionId,kind,orders:clean,truncated:rows.length>100||response.pageInfo?.hasNextPage===true};
 }
 return {orders};
}
export const loopCustomerReadService=createLoopCustomerReadService();
