import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ShopifyOfflineToken } from '../models/ShopifyOfflineToken.js';
import { LoopActionAttempt } from '../models/LoopActionAttempt.js';
import { getCustomerLoopSubscriptions, loopAdminRequest, loopMutationsEnabled } from './loop-subscriptions.service.js';
import { actionRequestHash, reserveLoopAction, claimLoopAction, finishLoopAction } from './loop-action-ledger.service.js';
import { actionError, canonical, normalizeAction, prepareAction, stateHash, verifyAction, frequencyMatches, nextScheduledOrder, addressFixturePlaceholderFields } from './loop-action-contract.service.js';

const keyPattern=/^[a-zA-Z0-9_-]{16,128}$/;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const previewStateHash=state=>createHash('sha256').update(canonical({subscription:stateHash(state.subscription),schedule:state.schedule,history:state.history})).digest('hex');
function secret() {
  const key=process.env.SHOPIFY_API_SECRET||process.env.SHOPIFY_API_SECRET_KEY;
  if(!key) throw actionError('PREVIEW_SIGNING_UNAVAILABLE',503);
  return key;
}
function sign(data) {
  const body=Buffer.from(canonical(data)).toString('base64url');
  return body+'.'+createHmac('sha256',secret()).update(body).digest('base64url');
}
function receipt(token) {
  if(typeof token!=='string'||token.length>2048) throw actionError('INVALID_PREVIEW');
  const [body,mac,...extra]=token.split('.');
  if(!body||!mac||extra.length) throw actionError('INVALID_PREVIEW');
  const expected=createHmac('sha256',secret()).update(body).digest(),given=Buffer.from(mac,'base64url');
  if(given.length!==expected.length||!timingSafeEqual(given,expected)) throw actionError('INVALID_PREVIEW');
  try { return JSON.parse(Buffer.from(body,'base64url').toString()); } catch { throw actionError('INVALID_PREVIEW'); }
}
function scope(identity,subscriptionId) {
  const {shop,customerId}=identity||{};
  if(typeof shop!=='string'||!/^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/.test(shop)||!/^\d+$/.test(customerId||'')) throw actionError('SIGN_IN_REQUIRED',401);
  if(shop!==process.env.LOOP_TEST_SHOP||customerId!==process.env.LOOP_TEST_CUSTOMER_ID||
      subscriptionId!=='42347174'||subscriptionId!==process.env.LOOP_TEST_SUBSCRIPTION_ID) throw actionError('TEST_ONLY',403);
  return {shop,customerId,subscriptionId};
}
function request(identity,body) {
  const bound=scope(identity,body?.subscriptionId);
  if(!keyPattern.test(body?.requestKey||'')) throw actionError('INVALID_REQUEST_KEY');
  const action=body?.action,payload=normalizeAction(action,body?.payload);
  return {...bound,action,payload,requestKey:body.requestKey};
}
function storedResult(attempt,replayed=false) {
  const applied=attempt.status==='applied';
  const addressResolved=attempt.status==='rejected'&&['INVALID_TEST_FIXTURE_RECONCILED','UNCHANGED_ADDRESS_RECONCILED'].includes(attempt.errorCode);
  return {ok:applied,applied,verified:applied,replayed,action:attempt.action,requestKey:attempt.requestKey,operationState:attempt.status,retrySafe:attempt.status==='rejected',
    ...(attempt.providerFailureKind?{providerHttpStatus:attempt.providerHttpStatus??null,providerFailureKind:attempt.providerFailureKind}:{}),
    code:applied?'ACTION_APPLIED':attempt.status==='rejected'?(attempt.errorCode||'LOOP_REJECTED'):'ACTION_OUTCOME_UNKNOWN',
    message:applied?'Your change was verified with Loop.':addressResolved?'Address test attempt resolved after operator confirmation and an unchanged-address read. No provider rejection or successful address change is claimed.':attempt.status==='rejected'&&attempt.errorCode==='NO_CHANGE'?'Billing and delivery already matched the requested frequency before this attempt and still match. No frequency change is claimed.':attempt.status==='rejected'?'The request was rejected. No verified change was applied.':'The outcome is not confirmed. Do not submit a new request; check this request again.'};
}
export function createLoopActionService({installationExists=shop=>ShopifyOfflineToken.exists({shop}),verificationDelayMs=300}={}) {
  async function authorized(bound) {
    if(!await installationExists(bound.shop)) throw actionError('STORE_NOT_AUTHORIZED',403);
    const subscriptions=await getCustomerLoopSubscriptions(bound.customerId,{signal:AbortSignal.timeout(10000)});
    if(!subscriptions.some(s=>String(s.id)===bound.subscriptionId)) throw actionError('SUBSCRIPTION_NOT_OWNED',403);
  }
  async function read(bound,action) {
    const response=await loopAdminRequest(`subscription/${bound.subscriptionId}`),subscription=response.data;
    if(!subscription||String(subscription.id)!==bound.subscriptionId) throw actionError('INVALID_LOOP_SUBSCRIPTION',502);
    if(String(subscription.customer?.shopifyId)!==bound.customerId) throw actionError('SUBSCRIPTION_NOT_OWNED',403);
    if(subscription.metaData?.myshopifyDomain && subscription.metaData.myshopifyDomain!==bound.shop) throw actionError('SUBSCRIPTION_NOT_OWNED',403);
    const state={subscription};
    if(['skip','order-now'].includes(action)) {
      const kind=action==='skip'?'schedule':'history';
      const result=await loopAdminRequest(`subscription/${bound.subscriptionId}/order/${kind}`);
      const list=Array.isArray(result.data)?result.data:result.data?.orders;
      if(!Array.isArray(list)) throw actionError('INVALID_LOOP_ORDER_RESPONSE',502);
      // Bounded evidence only: if the relevant event is not present, verification stays unknown.
      state[kind]=list;
    }
    return state;
  }
  async function find(bound) {
    return LoopActionAttempt.findOne({shop:bound.shop,customerId:bound.customerId,requestKey:bound.requestKey});
  }
  async function catalog(identity,body) {
    const bound=scope(identity,body?.subscriptionId);await authorized(bound);
    const products=[];let cursor='';
    for(let page=0;page<5;page++) {
      const query=new URLSearchParams({type:'SUBSCRIPTION',pageSize:'100',...(cursor?{afterCursor:cursor}:{})});
      const result=await loopAdminRequest('product?'+query);
      if(!Array.isArray(result.data))throw actionError('INVALID_LOOP_PRODUCT_RESPONSE',502);
      for(const product of result.data)for(const variant of product.productVariants||[])
        if(variant.hasSellingPlan)products.push({id:String(variant.shopifyId),title:product.title+' / '+variant.title});
      if(!result.pageInfo?.hasNextPage)break;
      const next=result.pageInfo.nextCursor;if(!next||next===cursor)throw actionError('INVALID_LOOP_PAGINATION',502);cursor=next;
    }
    return {ok:true,products};
  }
  async function validateVariant(identity,bound) {
    if(bound.action==='edit-products'&&bound.payload.variantShopifyId) {
      const result=await catalog(identity,{subscriptionId:bound.subscriptionId});
      if(!result.products.some(v=>v.id===bound.payload.variantShopifyId))throw actionError('VARIANT_NOT_ELIGIBLE',400);
    }
  }
  async function preview(identity,body) {
    const bound=request(identity,body);await authorized(bound);
    await validateVariant(identity,bound);
    const state=await read(bound,bound.action),plan=prepareAction(bound.action,bound.subscriptionId,bound.payload,state.subscription);
    if(bound.action==='skip')nextScheduledOrder(state.subscription,state.schedule);
    const expiresAt=Date.now()+300000;
    return {ok:true,preview:true,applied:false,action:bound.action,expiresAt,
      previewToken:sign({hash:actionRequestHash(bound),state:previewStateHash(state),requestKey:bound.requestKey,expiresAt}),
      message:'Details verified. Confirm to submit this change.',
      ...(plan.body?.newBillingDateEpoch?{requestedBillingDateEpoch:plan.body.newBillingDateEpoch,billingTimezone:process.env.LOOP_BILLING_TIMEZONE}:{})};
  }
  async function execute(identity,body) {
    let dispatched=false;
    try {
    const bound=request(identity,body);
    if(body.confirm!==true) throw actionError('CONFIRMATION_REQUIRED');
    if(!loopMutationsEnabled()) throw actionError('LOOP_MUTATIONS_DISABLED',503,'Subscription changes are disabled.');
    await authorized(bound);
    const existing=await find(bound);
    if(existing) {
      if(existing.requestHash!==actionRequestHash(bound)) throw actionError('IDEMPOTENCY_KEY_REUSED',409);
      return storedResult(existing,true);
    }
    const token=receipt(body.previewToken);
    if(token.hash!==actionRequestHash(bound)||token.requestKey!==bound.requestKey) throw actionError('INVALID_PREVIEW');
    if(!Number.isFinite(token.expiresAt)||token.expiresAt<Date.now()) throw actionError('PREVIEW_EXPIRED',409);
    const state=await read(bound,bound.action);
    if(token.state!==previewStateHash(state)) throw actionError('STALE_PREVIEW',409,'Subscription details changed. Review them again before confirming.');
    const plan=prepareAction(bound.action,bound.subscriptionId,bound.payload,state.subscription);
    await validateVariant(identity,bound);
    if(bound.action==='skip') {
      const order=nextScheduledOrder(state.subscription,state.schedule);
      plan.scheduleId=String(order.id);
    }
    if(bound.action==='order-now') plan.historyIds=state.history.map(o=>String(o.id));
    const reservation=await reserveLoopAction({...bound,context:{before:state.subscription,plan}});
    if(!reservation.accepted) {
      if(reservation.code==='REQUEST_ALREADY_RESERVED') return storedResult(await find(bound),true);
      throw actionError(reservation.code,409);
    }
    const attempt=await claimLoopAction(reservation.attempt._id);
    if(!attempt) throw actionError('ACTION_CLAIM_FAILED',409);
    // Recheck after acquiring the durable subscription lock: a parallel operation
    // might have completed between the first read and the reservation.
    try {
      const fresh=await read(bound,bound.action);
      if(previewStateHash(fresh)!==token.state) {
        await finishLoopAction(attempt._id,'rejected','STALE_PREVIEW');
        throw actionError('STALE_PREVIEW',409);
      }
    } catch(error) {
      await finishLoopAction(attempt._id,'rejected',error.code||'PRE_WRITE_READ_FAILED');
      throw error;
    }
    try {
      dispatched=true;
      await loopAdminRequest(plan.pathname,{...plan,testScope:bound});
    } catch(error) {
      const status=error.definiteRejection?'rejected':'unknown';
      // Only coarse, allowlisted diagnostics survive. Never store provider
      // messages, headers, tokens, response bodies or address values here.
      const providerHttpStatus=Number.isInteger(error.providerHttpStatus)&&error.providerHttpStatus>=100&&error.providerHttpStatus<=599?error.providerHttpStatus:null;
      const providerFailureKind=['HTTP_ERROR','BUSINESS_REJECTION','UNEXPECTED_RESPONSE'].includes(error.providerFailureKind)?error.providerFailureKind:'TRANSPORT_OR_PRE_DISPATCH';
      await LoopActionAttempt.updateOne({_id:attempt._id,status:'in_flight'},{$set:{providerHttpStatus,providerFailureKind}});
      const final=await finishLoopAction(attempt._id,status,status==='rejected'?'LOOP_REJECTED':'ACTION_OUTCOME_UNKNOWN');
      return storedResult(final||attempt);
    }
    for(let i=0;i<3;i++) {
      if(i) await sleep(verificationDelayMs*i);
      try {
        if(verifyAction(bound.action,bound.payload,state.subscription,await read(bound,bound.action),plan)) {
          const final=await finishLoopAction(attempt._id,'applied');
          return storedResult(final||attempt);
        }
      } catch { /* A failed read cannot prove that a dispatched write failed. */ }
    }
    const final=await finishLoopAction(attempt._id,'unknown','ACTION_OUTCOME_UNKNOWN');
    return storedResult(final||attempt);
    } catch(error) {
      if(!dispatched)error.dispatched=false;
      throw error;
    }
  }
  async function status(identity,body) {
    const bound=scope(identity,body?.subscriptionId);
    if(!keyPattern.test(body?.requestKey||'')) throw actionError('INVALID_REQUEST_KEY');
    await authorized(bound);
    const attempt=await LoopActionAttempt.findOne({...bound,requestKey:body.requestKey}).select('+payload +context');
    if(!attempt) throw actionError('ACTION_NOT_FOUND',404);
    if((attempt.status==='unknown'||(attempt.status==='in_flight'&&Date.now()-new Date(attempt.updatedAt).getTime()>120000)) && attempt.context?.before && attempt.context?.plan) {
      const state=await read(bound,attempt.action);
      // Recover old no-op frequency requests only after the worker has recorded
      // unknown. Never release an in-flight worker or infer a new change.
      if(attempt.status==='unknown'&&attempt.action==='frequency'&&
          frequencyMatches(attempt.context.before,attempt.payload)&&frequencyMatches(state.subscription,attempt.payload)) {
        const final=await finishLoopAction(attempt._id,'rejected','NO_CHANGE');
        return storedResult(final||attempt,true);
      }
      if(verifyAction(attempt.action,attempt.payload,attempt.context.before,state,attempt.context.plan)) {
        const final=await finishLoopAction(attempt._id,'applied');return storedResult(final||attempt,true);
      }
    }
    return storedResult(attempt,true);
  }
  // Operator-only CLI recovery. No HTTP route exposes this method. It does not
  // infer a provider rejection: it records the operator's invalid-fixture
  // resolution after checking the current address against the saved original.
  async function recoverAddressFixture(identity,body,invalidOnly) {
    const resolutionCode=invalidOnly?'INVALID_TEST_FIXTURE_RECONCILED':'UNCHANGED_ADDRESS_RECONCILED';
    if(process.env.NODE_ENV!=='test')throw actionError('LOCAL_TEST_RECOVERY_ONLY',403);
    if(body?.confirmWorkerStopped!==true)throw actionError('CONFIRM_WORKER_STOPPED_REQUIRED');
    const bound=scope(identity,body?.subscriptionId);
    if(!keyPattern.test(body?.requestKey||''))throw actionError('INVALID_REQUEST_KEY');
    await authorized(bound);
    const attempt=await LoopActionAttempt.findOne({...bound,requestKey:body.requestKey}).select('+payload +context');
    if(attempt?.action!=='edit-address')throw actionError('INVALID_RECOVERY_ACTION');
    if(attempt.status==='rejected'&&attempt.errorCode===resolutionCode)return storedResult(attempt,true);
    if(attempt.status!=='unknown'||!attempt.completedAt||Date.now()-new Date(attempt.completedAt).getTime()<120000)
      throw actionError('RECOVERY_NOT_READY',409);
    if(invalidOnly&&!addressFixturePlaceholderFields(attempt.payload).length)throw actionError('INVALID_FIXTURE_EVIDENCE_REQUIRED');
    const original=attempt.context?.before;
    if(String(original?.id)!==bound.subscriptionId||!['firstName','lastName','address1','city','countryCode'].every(k=>typeof original.shippingAddress?.[k]==='string'&&original.shippingAddress[k].trim()))
      throw actionError('ORIGINAL_ADDRESS_UNAVAILABLE');
    const {subscription:current}=await read(bound,'edit-address');
    const keys=['firstName','lastName','company','phone','address1','address2','city','countryCode','provinceCode','zip'];
    if(!current.shippingAddress||!keys.every(k=>String(current.shippingAddress[k]??'').trim()===String(original.shippingAddress[k]??'').trim()))
      throw actionError('ADDRESS_STATE_CHANGED',409);
    const final=await finishLoopAction(attempt._id,'rejected',resolutionCode);
    return storedResult(final||attempt,true);
  }
  const recoverInvalidAddressFixture=(identity,body)=>recoverAddressFixture(identity,body,true);
  const recoverUnchangedAddressFixture=(identity,body)=>recoverAddressFixture(identity,body,false);
  return {preview,execute,status,catalog,recoverInvalidAddressFixture,recoverUnchangedAddressFixture};
}
export const loopActionService=createLoopActionService();
