import { createHash } from 'node:crypto';

export const ACTIONS = Object.freeze(['skip','reschedule','delay','order-now','gift','frequency','pause','cancel','edit-products','edit-address','discount','order-note']);
export function actionError(code, statusCode=400, message=code) { return Object.assign(new Error(message),{code,statusCode}); }
export const canonical = value => JSON.stringify(sort(value));
function sort(v) {
  if(Array.isArray(v)) return v.map(sort);
  if(v && typeof v==='object') return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,sort(v[k])]));
  return v;
}
const fail = code => { throw actionError(code); };
const id = v => typeof v==='string' && /^[1-9]\d{0,17}$/.test(v);
const text = (v,max,empty=false) => typeof v==='string' && v.length<=max && (empty || v.trim().length>0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const fields={skip:[],reschedule:['date'],delay:['days'],'order-now':['preponeFutureOrder'],frequency:['interval','intervalCount'],pause:['confirmPause'],cancel:['confirmCancellation','comment'],'edit-products':['operation','lineId','quantity','variantShopifyId'],'edit-address':['firstName','lastName','company','phone','address1','address2','city','countryCode','provinceCode','zip'],discount:['value'],'order-note':['value']};
export function normalizeAction(action,payload) {
  if(action==='gift') throw actionError('GIFT_API_UNAVAILABLE',501,'Loop has not published a gift-order API contract. Use the Loop customer portal for gifting.');
  if(!Object.hasOwn(fields,action)) fail('UNSUPPORTED_ACTION');
  if(!payload||Object.getPrototypeOf(payload)!==Object.prototype||Buffer.byteLength(JSON.stringify(payload))>4096||Object.keys(payload).some(k=>!fields[action].includes(k))) fail('INVALID_PAYLOAD');
  const p={...payload};
  if(action==='reschedule' && !validDate(p.date)) fail('INVALID_RESCHEDULE_DATE');
  if(action==='delay' && ![7,14,30].includes(p.days)) fail('INVALID_DELAY');
  if(action==='frequency' && (!['WEEK','MONTH'].includes(p.interval)||![1,2,3,4,6].includes(p.intervalCount))) fail('INVALID_FREQUENCY');
  if(action==='order-now' && p.preponeFutureOrder!==true) fail('ORDER_NOW_CONFIRMATION_REQUIRED');
  if(action==='pause' && p.confirmPause!==true) fail('PAUSE_CONFIRMATION_REQUIRED');
  if(action==='cancel' && (p.confirmCancellation!==true || (p.comment!==undefined&&!text(p.comment,500,true)))) fail('CANCELLATION_CONFIRMATION_REQUIRED');
  if(action==='edit-products') {
    const op=p.operation||'quantity';
    if(!['quantity','add','swap','remove'].includes(op)||
      (op!=='add'&&!id(p.lineId))||
      (op!=='remove'&&(!Number.isInteger(p.quantity)||p.quantity<1||p.quantity>99))||
      (['add','swap'].includes(op)&&(!id(p.variantShopifyId)||!Number.isSafeInteger(Number(p.variantShopifyId))))) fail('INVALID_LINE_UPDATE');
    if((op==='quantity'&&p.variantShopifyId!==undefined)||(op==='add'&&p.lineId!==undefined)||(op==='remove'&&(p.quantity!==undefined||p.variantShopifyId!==undefined))) fail('INVALID_LINE_UPDATE');
  }
  if(action==='edit-address') {
    for(const k of ['firstName','lastName','address1','city','countryCode']) if(!text(p[k],255)) fail('INVALID_ADDRESS');
    for(const k of fields[action]) if(p[k]!==undefined && !text(p[k],255,true)) fail('INVALID_ADDRESS');
    if(!/^[A-Z]{2}$/.test(p.countryCode)) fail('INVALID_COUNTRY_CODE');
    // Explicit empty fields clear optional address data instead of retaining a previous recipient's data.
    for(const k of fields[action]) p[k]=(p[k]||'').trim();
  }
  if(action==='discount' && (!text(p.value,100)||!/^[a-zA-Z0-9_-]+$/.test(p.value))) fail('INVALID_DISCOUNT');
  if(action==='order-note' && !text(p.value,500,true)) fail('INVALID_NOTE');
  return p;
}
function validDate(v) {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t=Date.parse(v+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;
}
function localParts(epoch,timezone) {
  const f=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  return Object.fromEntries(f.formatToParts(new Date(epoch*1000)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
export function dateEpoch(date,timezone,previousEpoch) {
  if(!validDate(date)) fail('INVALID_RESCHEDULE_DATE');
  if(!timezone) throw actionError('BILLING_TIMEZONE_REQUIRED',503);
  let prev;
  try { prev=localParts(previousEpoch,timezone); } catch { throw actionError('INVALID_BILLING_TIMEZONE',503); }
  const [year,month,day]=date.split('-').map(Number);
  const target=Date.UTC(year,month-1,day,prev.hour,prev.minute,prev.second)/1000;
  let candidate=target;
  for(let i=0;i<4;i++) {
    const p=localParts(candidate,timezone);
    const seen=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)/1000;
    candidate+=target-seen;
    if(seen===target) return candidate;
  }
  fail('NONEXISTENT_LOCAL_BILLING_TIME');
}
export const nextEpoch = s => Number(s.nextOrderDateEpoch ?? s.nextBillingDateEpoch);
export function nextScheduledOrder(subscription,schedule) {
  const unavailable=()=>{throw actionError('NEXT_ORDER_UNAVAILABLE',409);};
  if(!Array.isArray(schedule))unavailable();
  const pending=schedule.filter(o=>['UNPROCESSED','SCHEDULED'].includes(o?.status)).map(order=>{
    // The live Admin schedule uses billingDate; retain the older shape only
    // when that field is absent, never when it is explicitly invalid.
    const date=Object.hasOwn(order,'billingDate')?order.billingDate:order.scheduledAt;
    if(!id(String(order.id))||(typeof order.id==='number'&&!Number.isSafeInteger(order.id))||
       typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(date))unavailable();
    const epoch=Date.parse(date)/1000;
    if(!Number.isFinite(epoch))unavailable();
    return {order,epoch};
  }).sort((a,b)=>a.epoch-b.epoch);
  if(!pending.length||pending[0].epoch!==nextEpoch(subscription)||
      pending[1]?.epoch===pending[0].epoch||new Set(pending.map(x=>String(x.order.id))).size!==pending.length)unavailable();
  return pending[0].order;
}
export const subscriptionLines = s => s.lineItems || s.lines || [];
// Admin read-subscription-details returns orderNote. Webhook/older payloads use
// note; fall back only when orderNote is absent, never when explicitly null.
const subscriptionNote=s=>Object.hasOwn(s,'orderNote')?s.orderNote:s.note;
export const frequencyMatches=(s,p)=>['billingPolicy','deliveryPolicy'].every(k=>s?.[k]?.interval===p.interval&&Number(s?.[k]?.intervalCount)===p.intervalCount);
export function stateHash(s) {
  const relevant={id:String(s.id),status:s.status,next:nextEpoch(s),billing:s.billingPolicy,delivery:s.deliveryPolicy,lines:subscriptionLines(s),address:s.shippingAddress,discounts:s.discounts,note:subscriptionNote(s),isBillingRetryOn:s.isBillingRetryOn};
  return createHash('sha256').update(canonical(relevant)).digest('hex');
}
export function prepareAction(action,subscriptionId,payload,before,{now=Date.now(),timezone=process.env.LOOP_BILLING_TIMEZONE}={}) {
  if(!id(String(subscriptionId))) fail('INVALID_SUBSCRIPTION_ID');
  const p=normalizeAction(action,payload);
  if(String(before.status).toUpperCase()!=='ACTIVE' && action!=='order-note') throw actionError('SUBSCRIPTION_NOT_ACTIVE',409);
  if(before.isBillingRetryOn && ['order-now','skip','reschedule','delay'].includes(action)) throw actionError('SUBSCRIPTION_IN_DUNNING',409);
  let suffix,body,method='POST';
  if(action==='skip') suffix='skipNext';
  if(action==='order-now') {suffix='placeOrder';body={preponeFutureOrder:true};}
  if(['reschedule','delay'].includes(action)) {
    if(before.billingPolicy?.anchors?.type && before.billingPolicy.anchors.type!=='NONE') throw actionError('LOOP_ANCHOR_REVIEW_REQUIRED',409);
    const old=nextEpoch(before);
    if(!Number.isFinite(old)||old<=0) throw actionError('CURRENT_BILLING_DATE_UNAVAILABLE',409);
    let date=p.date;
    if(action==='delay') {
      if(!timezone) throw actionError('BILLING_TIMEZONE_REQUIRED',503);
      const t=localParts(old,timezone),d=new Date(Date.UTC(t.year,t.month-1,t.day+p.days));
      date=d.toISOString().slice(0,10);
    }
    const epoch=dateEpoch(date,timezone,old);
    if(epoch*1000<now+86400000||epoch*1000>now+366*86400000||epoch===old) fail('INVALID_RESCHEDULE_DATE');
    suffix='reschedule';body={newBillingDateEpoch:epoch,rescheduleFutureOrders:true,notifyCustomer:true};
  }
  if(action==='frequency') {
    if(frequencyMatches(before,p))throw actionError('NO_CHANGE',409,'Billing and delivery already match the requested frequency.');
    suffix='frequency';method='PUT';body={billingPolicy:{interval:p.interval,intervalCount:p.intervalCount},deliveryPolicy:{interval:p.interval,intervalCount:p.intervalCount},discountType:'OLD'};
  }
  if(action==='pause') {suffix='pause';body={};}
  if(action==='cancel') {suffix='cancel';body={notifyCustomer:true,...(p.comment!==undefined?{comment:p.comment}:{})};}
  if(action==='edit-products') {
    const op=p.operation||'quantity',all=subscriptionLines(before),line=all.find(l=>String(l.id)===p.lineId);
    if(op!=='add'&&!line) throw actionError('LINE_NOT_OWNED',403);
    if(line?.bundleTransactionId || before.hasBundle) throw actionError('BUNDLE_REQUIRES_LOOP_EDITOR',409);
    if(op==='quantity') {
      if(Number(line.quantity)===p.quantity) throw actionError('NO_CHANGE',409);
      suffix=`line/${p.lineId}/update`;method='PUT';body={quantity:p.quantity};
    } else if(op==='remove') {
      if(all.filter(l=>!l.isOneTimeAdded&&!l.isOneTimeRemoved).length<=1) throw actionError('LAST_LINE_REMOVAL_BLOCKED',409);
      suffix=`line/${p.lineId}`;method='DELETE';
    } else {
      suffix=op==='add'?'line':`line/${p.lineId}/swap`;method=op==='add'?'POST':'PUT';
      body={variantShopifyId:Number(p.variantShopifyId),quantity:p.quantity,pricingType:op==='add'?'SELLING_PLAN':'NEW'};
    }
  }
  if(action==='edit-address') {suffix='address';method='PUT';body=p;}
  if(action==='discount') {suffix='discount';body={discountCode:p.value};}
  if(action==='order-note') {suffix='note';method='PUT';body={note:p.value};}
  return {pathname:`subscription/${subscriptionId}/${suffix}`,method,body};
}
export function verifyAction(action,p,before,after,plan) {
  const s=after.subscription;
  if(!s || String(s.id)!==String(before.id)) return false;
  if(stateHash(s)===stateHash(before) && !['order-now','skip'].includes(action)) return false;
  if(['reschedule','delay'].includes(action)) return nextEpoch(s)===plan.body.newBillingDateEpoch;
  if(action==='pause') return s.status==='PAUSED';
  if(action==='cancel') return ['CANCELLED','CANCELED'].includes(s.status);
  if(action==='frequency') return frequencyMatches(s,p);
  if(action==='edit-products') {
    const all=subscriptionLines(s),op=p.operation||'quantity';
    if(op==='remove')return !all.some(l=>String(l.id)===p.lineId);
    if(op==='add')return all.some(l=>String(l.variantShopifyId)===p.variantShopifyId&&Number(l.quantity)===p.quantity&&!subscriptionLines(before).some(old=>String(old.id)===String(l.id)));
    if(op==='swap')return all.some(l=>String(l.variantShopifyId)===p.variantShopifyId&&Number(l.quantity)===p.quantity)&&!all.some(l=>String(l.id)===p.lineId&&String(l.variantShopifyId)!==p.variantShopifyId);
    return all.some(l=>String(l.id)===p.lineId&&Number(l.quantity)===p.quantity);
  }
  if(action==='edit-address') return Object.keys(p).every(k=>String(s.shippingAddress?.[k]||'').trim()===p[k]);
  if(action==='order-note') return subscriptionNote(s)===p.value;
  if(action==='discount') return (s.discounts||[]).some(x=>{const d=x.node||x;return !d.rejectionReason && String(d.code||d.discountCode||d.title||'').toUpperCase()===p.value.toUpperCase();});
  if(action==='skip') return Boolean(plan.scheduleId) && nextEpoch(s)>nextEpoch(before) && (after.schedule||[]).some(o=>String(o.id)===plan.scheduleId&&o.status==='SKIPPED');
  if(action==='order-now') return Array.isArray(plan.historyIds) && (after.history||[]).some(o=>!plan.historyIds.includes(String(o.id))&&o.status==='SUCCESS'&&o.shopifyId);
  return false;
}
