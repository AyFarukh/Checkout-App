import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {SubscriberJourney,JourneySkip} from '../models/SubscriberJourney.js';
import {ShopifyOfflineToken} from '../models/ShopifyOfflineToken.js';
import {LoopActionAttempt} from '../models/LoopActionAttempt.js';
import {getCustomerLoopSubscriptions,loopAdminRequest,loopMutationsEnabled} from './loop-subscriptions.service.js';
import {subscriptionActionScope} from './loop-action-access.service.js';
import {reserveLoopAction,claimLoopAction,finishLoopAction} from './loop-action-ledger.service.js';
import {actionError} from './loop-action-contract.service.js';
import {assertLoopMerchantShop} from './loop-customer-read.service.js';
const id=x=>typeof x==='string'&&/^[1-9]\d*$/.test(x)&&Number.isSafeInteger(Number(x));
const error=(code,status=503)=>actionError(code,status);
const epoch=x=>x==null?NaN:new Date(x).getTime();
export function journeyConfig(env=process.env){
 const enabled=env.LOOP_JOURNEY_ENABLED==='true';
 const program=env.LOOP_JOURNEY_PROGRAM||'ftr-first-five-v1';
 const rollout=(env.LOOP_JOURNEY_ALLOWED_SUBSCRIPTION_IDS??'42347174').trim(),all=rollout==='all',allowedIds=all?[]:rollout.split(',').map(s=>s.trim()).filter(id);
 return {enabled,program,all,allowedIds,automation:enabled&&env.LOOP_JOURNEY_AUTOMATION_ENABLED==='true'&&env.LOOP_JOURNEY_MANUAL_DISCOUNTS_VERIFIED==='true'&&env.LOOP_JOURNEY_WEBHOOK_VERIFIED==='true'&&(env.LOOP_JOURNEY_WEBHOOK_SECRETS||'').split(',').some(k=>k.length>=16)};
}
export const journeySubscriptionAllowed=subscriptionId=>{const config=journeyConfig();return config.all||config.allowedIds.includes(String(subscriptionId));};
export function paidOrders(rows){
 if(!Array.isArray(rows))throw error('JOURNEY_HISTORY_INCOMPLETE');
 const found=new Map();
 for(const row of rows){if(row?.status!=='PROCESSED'||!['paid','partially_refunded'].includes(String(row.financialStatus).toLowerCase()))continue;
  if(!id(String(row.id))||!id(String(row.shopifyId)))throw error('JOURNEY_HISTORY_INCOMPLETE');found.set(String(row.id),row);
 }
 return [...found.values()];
}
export function journeyProgress(enrollment,history,skips){
 let completed=Math.min(5,enrollment.seedCount),cycle=0,finished=!!enrollment.completedAt||completed>=5;
 if(finished)return {completed:5,cycle:0,finished:true,rewardPercent:0,nextOrder:null};
 const seed=new Set(enrollment.seedOrderIds),start=epoch(enrollment.enrolledAt),events=[];
 for(const row of paidOrders(history))if(!seed.has(String(row.id))){const at=epoch(row.shopifyProcessedAt||row.shopifyCreatedAt);if(!Number.isFinite(at))throw error('JOURNEY_HISTORY_INCOMPLETE');if(at<start-300000)throw error('JOURNEY_HISTORY_CHANGED');events.push({at,key:String(row.id),kind:'paid'});}
 const seen=new Set();for(const s of skips){if(seen.has(s.key))continue;seen.add(s.key);const at=epoch(s.occurredAt);if(!Number.isFinite(at))throw error('JOURNEY_SKIP_REVIEW_REQUIRED');if(at>=start)events.push({at,key:s.key,kind:'skip'});}
 // A same-time skip takes precedence: do not offer a reward from uncertain ordering.
 events.sort((a,b)=>a.at-b.at||(a.kind===b.kind?a.key.localeCompare(b.key):a.kind==='skip'?-1:1));
 for(const e of events){if(completed>=5){finished=true;break;}if(e.kind==='skip'){completed=0;cycle++;}else completed++;}
 finished=completed>=5;
 return {completed:Math.min(5,completed),cycle,finished,rewardPercent:finished?0:completed===1?10:completed===4?20:0,nextOrder:finished?null:completed+1};
}
export function verifyJourneySignature(raw,header,keys){
 if(!Buffer.isBuffer(raw)||typeof header!=='string'||header.length>2048||!Array.isArray(keys))return false;
 const signatures=header.split(',').map(s=>s.trim()).filter(s=>/^v1=[a-f0-9]{64}$/.test(s));
 return keys.filter(k=>typeof k==='string'&&k.length>=16).some(k=>{const expected=Buffer.from('v1='+createHmac('sha256',k).update(raw).digest('hex'));return signatures.some(s=>timingSafeEqual(expected,Buffer.from(s)));});
}
const discountRows=s=>(s.discounts||[]).map(d=>d?.node||d).filter(Boolean);
const discountCode=d=>String(d.code||d.discountCode||d.title||'').toUpperCase();
export function rewardMatches(d,code,percent){return !!d&&discountCode(d)===code.toUpperCase()&&d.isActive===true&&!d.rejectionReason&&d.type==='PERCENTAGE'&&Number(d.value)===percent&&d.orderLimit===1&&d.usageCount===0;}
const subtotal=s=>Number(s.totalLineItemDiscountedPrice);
export const rewardTitle=(program,subscriptionId,cycle,percent)=>`FTR Journey +${percent}% ${createHash('sha256').update(JSON.stringify([program,subscriptionId,cycle,percent])).digest('hex').slice(0,16)}`;
const requestKey=(program,subscriptionId,cycle,milestone,operation)=>'journey_'+createHash('sha256').update(JSON.stringify([program,subscriptionId,cycle,milestone,operation])).digest('hex');
export function createSubscriberJourneyService({installationExists=shop=>ShopifyOfflineToken.exists({shop,uninstalledAt:null,accessToken:{$type:'string',$ne:''}}),provider=loopAdminRequest,subscriptions=getCustomerLoopSubscriptions,now=()=>new Date()}={}){
 async function authorized(identity,subscriptionId){
  if(!identity||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(identity.shop)||!id(identity.customerId))throw error('SIGN_IN_REQUIRED',401);
  if(!id(subscriptionId))throw error('INVALID_SUBSCRIPTION_ID',400);assertLoopMerchantShop(identity.shop);
  if(!await installationExists(identity.shop))throw error('STORE_NOT_AUTHORIZED',403);
  if(!(await subscriptions(identity.customerId,{signal:AbortSignal.timeout(10000)})).some(s=>String(s.id)===subscriptionId))throw error('SUBSCRIPTION_NOT_OWNED',403);
  const {data:s}=await provider(`subscription/${subscriptionId}`);
  if(!s||String(s.id)!==subscriptionId||String(s.customer?.shopifyId)!==identity.customerId||(s.metaData?.myshopifyDomain&&s.metaData.myshopifyDomain!==identity.shop))throw error('SUBSCRIPTION_NOT_OWNED',403);
  return s;
 }
 async function history(subscriptionId){const r=await provider(`subscription/${subscriptionId}/order/history`),rows=Array.isArray(r.data)?r.data:r.data?.orders;
  if(!Array.isArray(rows)||r.pageInfo?.hasNextPage===true||rows.length>10000)throw error('JOURNEY_HISTORY_INCOMPLETE');return rows;
 }
 async function enrollment(identity,subscriptionId,s,{persist=true}={}){
  const config=journeyConfig(),query={shop:identity.shop,subscriptionId,program:config.program};let row=await SubscriberJourney.findOne(query);
  if(row)return row;
  if(s.status!=='ACTIVE')return null;
  const h=await history(subscriptionId),paid=paidOrders(h),seedCount=Math.min(paid.length,5),enrolledAt=now();
  const seed={...query,customerId:identity.customerId,seedCount,seedOrderIds:paid.map(o=>String(o.id)),enrolledAt,...(seedCount>=5?{completedAt:enrolledAt}:{})};
  if(!persist)return seed;
  await SubscriberJourney.init();try{return await SubscriberJourney.create(seed);}catch(e){if(e.code!==11000)throw e;return SubscriberJourney.findOne(query);}
 }
 async function state(row){
  const skips=await JourneySkip.find({shop:row.shop,subscriptionId:row.subscriptionId});
  const progress=journeyProgress(row,row.completedAt?[]:await history(row.subscriptionId),skips);
  return progress;
 }
 function publicState(s,p,config,verified,code){
  const applied=verified&&p.rewardPercent>0&&discountRows(s).some(d=>rewardMatches(d,code,p.rewardPercent));
  return {enabled:true,program:config.program,status:p.finished?'COMPLETED':'ACTIVE',completedOrders:p.completed,totalOrders:5,nextOrder:p.nextOrder,nextReward:p.finished?null:{order:p.completed<2?2:5,percent:p.completed<2?10:20,applied},nextBillingDateEpoch:s.nextBillingDateEpoch??null,resetOnSkip:true,resetCount:p.cycle};
 }
 async function view(identity,body){
  const config=journeyConfig();if(!config.enabled)return {ok:true,journey:{enabled:false}};
  const subscriptionId=String(body?.subscriptionId||'');if(!journeySubscriptionAllowed(subscriptionId))return {ok:true,journey:{enabled:false}};const s=await authorized(identity,subscriptionId);
  if(s.status!=='ACTIVE')return {ok:true,journey:{enabled:false}};
  const row=await enrollment(identity,subscriptionId,s),p=await state(row);
  // Display never dispatches or reserves a provider write.
  const code=rewardTitle(config.program,subscriptionId,p.cycle,p.rewardPercent);
  const verified=!!await LoopActionAttempt.exists({shop:identity.shop,customerId:identity.customerId,requestKey:requestKey(config.program,subscriptionId,p.cycle,p.nextOrder||5,'add_'+code),status:'applied'});
  return {ok:true,journey:publicState(s,p,config,verified,code)};
 }
 async function enroll(identity,subscriptionId,{apply=false}={}){
  if(!journeySubscriptionAllowed(subscriptionId))return {subscriptionId,eligible:false,reason:'JOURNEY_NOT_IN_ROLLOUT'};
  const s=await authorized(identity,subscriptionId);if(s.status!=='ACTIVE')return {subscriptionId,eligible:false};
  const row=await enrollment(identity,subscriptionId,s,{persist:apply}),p=await state(row);
  return {subscriptionId,eligible:true,persisted:apply,completed:p.completed,finished:p.finished,nextRewardPercent:p.rewardPercent};
 }
 async function operation(row,kind,code,percent,p,s){
  const identity={shop:row.shop,customerId:row.customerId},bound=subscriptionActionScope(identity,row.subscriptionId);
  if(kind==='add'&&(!Number.isFinite(subtotal(s))||subtotal(s)<=0))throw error('JOURNEY_NO_DISCOUNTABLE_BALANCE');
  const key=requestKey(row.program,row.subscriptionId,p.cycle,p.nextOrder||5,kind+'_'+code);
  const matches=after=>kind==='remove'?!discountRows(after).some(d=>discountCode(d)===code.toUpperCase()):discountRows(after).some(d=>rewardMatches(d,code,percent))&&Number.isFinite(subtotal(s))&&Number.isFinite(subtotal(after))&&Math.abs(subtotal(after)-Math.round(subtotal(s)*(1-percent/100)*100)/100)<=0.011;
  const prior=await LoopActionAttempt.findOne({shop:row.shop,customerId:row.customerId,requestKey:key}).select('+context');
  if(prior){
   if(prior.status==='applied')throw error('JOURNEY_REWARD_ALREADY_DISPATCHED');
   if(prior.status==='unknown'){
    const {data:after}=await provider(`subscription/${row.subscriptionId}`);
    const before=prior.context?.before;
    const verified=kind==='remove'?!discountRows(after).some(d=>discountCode(d)===code.toUpperCase()):before&&discountRows(after).some(d=>rewardMatches(d,code,percent))&&Number.isFinite(subtotal(before))&&Number.isFinite(subtotal(after))&&Math.abs(subtotal(after)-Math.round(subtotal(before)*(1-percent/100)*100)/100)<=0.011;
    if(verified){await finishLoopAction(prior._id,'applied');return 'applied';}
   }
   throw error('JOURNEY_OUTCOME_UNKNOWN');
  }
  const reservation=await reserveLoopAction({...bound,action:'journey-'+kind,requestKey:key,payload:{code,percent},context:{before:{totalLineItemDiscountedPrice:s.totalLineItemDiscountedPrice},program:row.program}});
  if(!reservation.accepted)throw error(reservation.code);
  const attempt=await claimLoopAction(reservation.attempt._id);if(!attempt)throw error('ACTION_CLAIM_FAILED');
  // Re-authorize within the shared subscription write lock and compare eligibility again.
  let fresh;try{fresh=await authorized(identity,row.subscriptionId);const current=await state(row);if(fresh.status!=='ACTIVE'||current.cycle!==p.cycle||current.completed!==p.completed||!journeyConfig().automation||!loopMutationsEnabled()||!journeySubscriptionAllowed(row.subscriptionId))throw error('JOURNEY_STATE_CHANGED');
   if(JSON.stringify(discountRows(fresh))!==JSON.stringify(discountRows(s))||subtotal(fresh)!==subtotal(s))throw error('JOURNEY_STATE_CHANGED');
  }catch(e){await finishLoopAction(attempt._id,'rejected',e.code||'JOURNEY_STATE_CHANGED');throw e;}
  const target=discountRows(fresh).find(d=>discountCode(d)===code.toUpperCase());
  if(kind==='remove'&&(!target||!target.shopifyId)){await finishLoopAction(attempt._id,'rejected','JOURNEY_DISCOUNT_ID_MISSING');throw error('JOURNEY_DISCOUNT_ID_MISSING');}
  const pathname=`subscription/${row.subscriptionId}/discount`+(kind==='remove'?'/'+encodeURIComponent(String(target.shopifyId)):'');
  try{await provider(pathname,{method:kind==='remove'?'DELETE':'POST',...(kind==='add'?{body:{manualDiscount:{title:code,type:'PERCENTAGE',value:percent,orderLimit:1,lineIds:null}}}:{}),testScope:bound});}
  catch(e){await finishLoopAction(attempt._id,e.definiteRejection?'rejected':'unknown',e.definiteRejection?'LOOP_REJECTED':'JOURNEY_OUTCOME_UNKNOWN');throw error('JOURNEY_OUTCOME_UNKNOWN');}
  try{const {data:after}=await provider(`subscription/${row.subscriptionId}`);if(matches(after)){await finishLoopAction(attempt._id,'applied');return 'applied';}}catch{}
  await finishLoopAction(attempt._id,'unknown','JOURNEY_OUTCOME_UNKNOWN');throw error('JOURNEY_OUTCOME_UNKNOWN');
 }
 async function managedTitles(row){const attempts=await LoopActionAttempt.find({shop:row.shop,subscriptionId:row.subscriptionId,action:'journey-add','context.program':row.program,status:'applied'}).select('+payload');return [...new Set(attempts.map(a=>a.payload.code))];}
 async function reconcile(row){
  const config=journeyConfig();if(!config.automation||!loopMutationsEnabled()||!journeySubscriptionAllowed(row.subscriptionId))return {disabled:true};
  const leaseToken=randomUUID(),locked=await SubscriberJourney.findOneAndUpdate({_id:row._id,$or:[{leaseUntil:{$lt:now()}},{leaseUntil:{$exists:false}}]},{$set:{leaseToken,leaseUntil:new Date(now().getTime()+120000)}},{new:true});
  if(!locked)return {busy:true};
  try{
   let s=await authorized({shop:row.shop,customerId:row.customerId},row.subscriptionId);
   if(s.status!=='ACTIVE')return {inactive:true};
   const pending=await LoopActionAttempt.findOne({lockKey:`${row.shop}:${row.subscriptionId}`,action:{$in:['journey-add','journey-remove']}}).select('+payload +context');
   if(pending){
    if(pending.status==='unknown'||(pending.status==='in_flight'&&Date.now()-new Date(pending.updatedAt).getTime()>120000)){
     const {code,percent}=pending.payload||{},before=pending.context?.before;
     const proven=pending.action==='journey-remove'?!discountRows(s).some(d=>discountCode(d)===String(code).toUpperCase()):before&&discountRows(s).some(d=>rewardMatches(d,code,percent))&&Number.isFinite(subtotal(before))&&Number.isFinite(subtotal(s))&&Math.abs(subtotal(s)-Math.round(subtotal(before)*(1-percent/100)*100)/100)<=0.011;
     if(proven)await finishLoopAction(pending._id,'applied');else throw error('JOURNEY_OUTCOME_UNKNOWN');
    }else throw error('JOURNEY_OUTCOME_UNKNOWN');
   }
   const p=await state(row);
   const wanted=p.rewardPercent?rewardTitle(row.program,row.subscriptionId,p.cycle,p.rewardPercent):null;
   const managed=await managedTitles(row);
   for(const code of new Set([...managed,...(wanted?[wanted]:[])])){
    const d=discountRows(s).find(d=>discountCode(d)===code.toUpperCase());
    const consumed=d&&(d.isActive===false||d.orderLimit===1&&Number(d.usageCount)>=1);
    if(d&&(code!==wanted||consumed)){
     if(!managed.includes(code))throw error('JOURNEY_DISCOUNT_NOT_MANAGED');
     await operation(row,'remove',code,0,p,s);s=(await provider(`subscription/${row.subscriptionId}`)).data;
    }
   }
   if(wanted){const existing=discountRows(s).find(d=>discountCode(d)===wanted.toUpperCase());if(existing&&(!managed.includes(wanted)||!rewardMatches(existing,wanted,p.rewardPercent)))throw error('JOURNEY_DISCOUNT_REVIEW_REQUIRED');if(!existing)await operation(row,'add',wanted,p.rewardPercent,p,s);}
   await SubscriberJourney.updateOne({_id:row._id,leaseToken},{$set:{checkedAt:now(),issue:null,...(p.finished?{completedAt:row.completedAt||now()}:{})}});
   return {ok:true,progress:p};
  }catch(e){await SubscriberJourney.updateOne({_id:row._id,leaseToken},{$set:{issue:/^[A-Z_]+$/.test(e.code||'')?e.code:'JOURNEY_UNAVAILABLE'}});throw e;}
  finally{await SubscriberJourney.updateOne({_id:row._id,leaseToken},{$set:{checkedAt:now()},$unset:{leaseToken:1,leaseUntil:1}});}
 }
 async function recordVerifiedSkip(identity,subscriptionId,orderId){
  if(!journeyConfig().enabled||!journeySubscriptionAllowed(subscriptionId))return;
  await view(identity,{subscriptionId});
  if(!id(String(orderId)))throw error('JOURNEY_SKIP_REVIEW_REQUIRED');
  await JourneySkip.init();await JourneySkip.updateOne({shop:identity.shop,key:'skip:'+orderId},{$setOnInsert:{subscriptionId,key:'skip:'+orderId,occurredAt:now()}},{upsert:true});
 }
 async function assertOrderReady(identity,subscriptionId){
  const config=journeyConfig();if(!config.enabled)return;
  const result=await view(identity,{subscriptionId});if(!result.journey.enabled)return;
  const s=await authorized(identity,subscriptionId),row=await SubscriberJourney.findOne({shop:identity.shop,subscriptionId,program:config.program}),p=await state(row);
  const wanted=p.rewardPercent?rewardTitle(row.program,subscriptionId,p.cycle,p.rewardPercent):null;
  const managed=await managedTitles(row);
  if(discountRows(s).some(d=>managed.map(c=>c.toUpperCase()).includes(discountCode(d))&&discountCode(d)!==wanted?.toUpperCase()&&d.isActive!==false))throw error('JOURNEY_REWARD_PENDING',409);
  if(wanted){const key=requestKey(config.program,subscriptionId,p.cycle,p.nextOrder,'add_'+wanted);
   const verified=await LoopActionAttempt.exists({shop:identity.shop,customerId:identity.customerId,requestKey:key,status:'applied'});
   if(!verified||!discountRows(s).some(d=>rewardMatches(d,wanted,p.rewardPercent)))throw error('JOURNEY_REWARD_PENDING',409);
  }
 }
 async function processBatch(){if(!journeyConfig().automation||!loopMutationsEnabled())return {disabled:true,processed:0,failed:0};const config=journeyConfig();const rows=await SubscriberJourney.find({program:config.program,...(config.all?{}:{subscriptionId:{$in:config.allowedIds}})}).sort({checkedAt:1,_id:1}).limit(20);const results=[];for(const row of rows){try{results.push({subscriptionId:row.subscriptionId,...await reconcile(row)});}catch(e){results.push({subscriptionId:row.subscriptionId,ok:false,code:/^[A-Z_]+$/.test(e.code||'')?e.code:'JOURNEY_UNAVAILABLE'});}}return {processed:rows.length,failed:results.filter(r=>r.ok===false).length,results};}
 async function enrollFromEvent(shop,subscriptionId,expectedOrderId){
  if(!journeySubscriptionAllowed(subscriptionId))return;
  const s=(await provider(`subscription/${subscriptionId}`)).data;
  if(!s||String(s.id)!==subscriptionId||!id(String(s.customer?.shopifyId)))throw error('JOURNEY_EVENT_REVIEW_REQUIRED');
  if(s.status!=='ACTIVE')return;
  if(expectedOrderId&&!paidOrders(await history(subscriptionId)).some(o=>String(o.id)===expectedOrderId))throw error('JOURNEY_HISTORY_INCOMPLETE');
  await enroll({shop,customerId:String(s.customer.shopifyId)},subscriptionId,{apply:true});
 }
 return {view,enroll,reconcile,processBatch,authorized,recordVerifiedSkip,assertOrderReady,enrollFromEvent};
}
export const subscriberJourneyService=createSubscriberJourneyService();
