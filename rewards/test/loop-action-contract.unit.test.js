import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAction, prepareAction, verifyAction, stateHash, dateEpoch, nextScheduledOrder } from '../src/services/loop-action-contract.service.js';

const now = Date.parse('2026-10-23T12:00:00Z');
const before = { id:42347174,status:'ACTIVE',nextBillingDateEpoch:1793451600,
  billingPolicy:{interval:'MONTH',intervalCount:1},deliveryPolicy:{interval:'MONTH',intervalCount:1},
  lineItems:[{id:7,quantity:1}],shippingAddress:{firstName:'Test',lastName:'User',address1:'1 Test Road',city:'Boston',countryCode:'US',provinceCode:'MA',zip:'02108'},note:'',discounts:[] };
export const cases = [
 ['skip',{},'POST','skipNext'],
 ['reschedule',{date:'2026-11-06'},'POST','reschedule'],
 ['delay',{days:7},'POST','reschedule'],
 ['order-now',{preponeFutureOrder:true},'POST','placeOrder'],
 ['frequency',{interval:'WEEK',intervalCount:2},'PUT','frequency'],
 ['pause',{confirmPause:true},'POST','pause'],
 ['cancel',{confirmCancellation:true},'POST','cancel'],
 ['edit-products',{lineId:'7',quantity:2},'PUT','line/7/update'],
 ['edit-address',{...before.shippingAddress,address1:'2 Test Road'},'PUT','address'],
 ['discount',{value:'TEST10'},'POST','discount'],
 ['order-note',{value:'Leave at the door'},'PUT','note'],
];
for(const [action,payload,method,path] of cases) test(`${action}: validates input and prepares documented request`,()=>{
 const normalized=normalizeAction(action,payload);
 const plan=prepareAction(action,'42347174',normalized,before,{now,timezone:'America/New_York'});
 assert.equal(plan.method,method);assert.equal(plan.pathname,`subscription/42347174/${path}`);
 assert.equal(verifyAction(action,normalized,before,{subscription:before,history:[],schedule:[]},plan),false,'unchanged state is not proof');
});
test('gift is explicitly blocked without an invented endpoint',()=>assert.throws(()=>normalizeAction('gift',{}),e=>e.code==='GIFT_API_UNAVAILABLE'));
test('skip selects the matching next Admin billingDate from unordered UNPROCESSED rows',()=>{
 const s={...before,nextOrderDateEpoch:1799944018};
 const first={id:431535744,status:'UNPROCESSED',billingDate:'2027-01-14T16:26:58.000Z'};
 const later={id:431535745,status:'UNPROCESSED',billingDate:'2027-04-14T16:26:58.000Z'};
 assert.equal(nextScheduledOrder(s,[later,{id:1,status:'SKIPPED',billingDate:'2026-10-14T16:26:58.000Z'},first]).id,first.id);
});
test('skip supports the earlier SCHEDULED and scheduledAt shape',()=>{
 const first={id:1,status:'SCHEDULED',scheduledAt:new Date(before.nextBillingDateEpoch*1000).toISOString()};
 assert.equal(nextScheduledOrder(before,[first]).id,1);
});
test('skip refuses missing, invalid, ambiguous or mismatched next-order evidence',()=>{
 const first={id:1,status:'UNPROCESSED',billingDate:new Date(before.nextBillingDateEpoch*1000).toISOString()};
 for(const rows of [[],[{...first,id:null}],[{...first,billingDate:'invalid'}],[{...first,billingDate:null,scheduledAt:first.billingDate}],[{...first,billingDate:'2027-04-14T16:26:58.000Z'}],[first,{...first,id:2}],[{...first,status:'SUCCESS'}]])
  assert.throws(()=>nextScheduledOrder(before,rows),e=>e.code==='NEXT_ORDER_UNAVAILABLE');
});
test('frequency rejects a no-op only when both policies already match',()=>{
 assert.throws(()=>prepareAction('frequency','42347174',{interval:'MONTH',intervalCount:1},before,{now}),e=>e.code==='NO_CHANGE');
 assert.doesNotThrow(()=>prepareAction('frequency','42347174',{interval:'MONTH',intervalCount:1},{...before,deliveryPolicy:{interval:'MONTH',intervalCount:2}},{now}));
});
test('strict validation rejects unknown fields, unsafe prices and invalid numeric types',()=>{
 for(const [a,p] of [['skip',{customerId:'1'}],['frequency',{interval:'MONTH',intervalCount:'2'}],['edit-products',{lineId:'7',quantity:2,price:0}],['order-now',{preponeFutureOrder:'true'}],['cancel',{}],['pause',{}],['order-note',{value:'a'.repeat(501)}],['discount',{value:''}],['reschedule',{date:'2026-02-30'}]])
  assert.throws(()=>normalizeAction(a,p),a);
});
test('line must belong to subscription and quantities must be bounded',()=>{
 assert.throws(()=>prepareAction('edit-products','42347174',{lineId:'9',quantity:2},before,{now}));
 assert.throws(()=>normalizeAction('edit-products',{lineId:'7',quantity:0}));
});
test('product editing supports add, swap and remove using server-derived pricing',()=>{
 const add=prepareAction('edit-products','42347174',{operation:'add',variantShopifyId:'101',quantity:1},before,{now});
 assert.equal(add.method,'POST');assert.equal(add.pathname,'subscription/42347174/line');assert.deepEqual(add.body,{variantShopifyId:101,quantity:1,pricingType:'SELLING_PLAN'});
 const swap=prepareAction('edit-products','42347174',{operation:'swap',lineId:'7',variantShopifyId:'101',quantity:1},before,{now});
 assert.equal(swap.pathname,'subscription/42347174/line/7/swap');assert.equal(swap.body.pricingType,'NEW');
 assert.throws(()=>prepareAction('edit-products','42347174',{operation:'remove',lineId:'7'},before,{now}),e=>e.code==='LAST_LINE_REMOVAL_BLOCKED');
 const removal=prepareAction('edit-products','42347174',{operation:'remove',lineId:'7'},{...before,lineItems:[...before.lineItems,{id:8,quantity:1}]},{now});assert.equal(removal.method,'DELETE');
 assert.equal(verifyAction('edit-products',{operation:'add',variantShopifyId:'101',quantity:1},before,{subscription:{...before,lineItems:[...before.lineItems,{id:8,variantShopifyId:101,quantity:1}]}},add),true);
});
test('state hash uses stable key order and binds relevant state',()=>{
 assert.equal(stateHash(before),stateHash({...before,shippingAddress:{...before.shippingAddress},id:42347174}));
 assert.notEqual(stateHash(before),stateHash({...before,note:'changed'}));
});
test('Admin orderNote is authoritative for state binding and exact verification',()=>{
 const initial={...before,orderNote:'old'};delete initial.note;
 const updated={...initial,orderNote:'Leave at the door'};
 assert.notEqual(stateHash(initial),stateHash(updated));
 assert.equal(verifyAction('order-note',{value:'Leave at the door'},initial,{subscription:updated},{}),true);
 assert.equal(verifyAction('order-note',{value:'wrong'},initial,{subscription:updated},{}),false);
 assert.equal(verifyAction('order-note',{value:'Leave at the door'},initial,{subscription:{...updated,orderNote:null,note:'Leave at the door'}},{}),false);
 assert.equal(verifyAction('order-note',{value:''},initial,{subscription:{...initial,orderNote:''}},{}),true);
});
test('merchant calendar dates preserve billing time through DST',()=>{
 assert.equal(dateEpoch('2026-11-06','America/New_York',before.nextBillingDateEpoch),1793973600);
 assert.equal(new Date(dateEpoch('2026-03-09','America/New_York',Date.parse('2026-03-07T15:00:00Z')/1000)*1000).toISOString(),'2026-03-09T14:00:00.000Z');
});
test('scheduling rejects impossible/past dates, missing timezone and active anchors',()=>{
 assert.throws(()=>dateEpoch('2026-02-30','America/New_York',before.nextBillingDateEpoch));
 assert.throws(()=>prepareAction('reschedule','42347174',{date:'2026-10-22'},before,{now,timezone:'America/New_York'}));
 assert.throws(()=>prepareAction('delay','42347174',{days:7},before,{now,timezone:''}));
 assert.throws(()=>prepareAction('delay','42347174',{days:7},{...before,billingPolicy:{anchors:{type:'MONTHDAY'}}},{now,timezone:'America/New_York'}));
});
test('verification checks exact policy, address, line, note, discount and terminal state',()=>{
 const changes={frequency:{billingPolicy:{interval:'WEEK',intervalCount:2},deliveryPolicy:{interval:'WEEK',intervalCount:2}},pause:{status:'PAUSED'},cancel:{status:'CANCELLED'},'edit-products':{lineItems:[{id:7,quantity:2}]},'edit-address':{shippingAddress:{...before.shippingAddress,address1:'2 Test Road'}},discount:{discounts:[{node:{code:'TEST10',rejectionReason:null}}]},'order-note':{note:'Leave at the door'}};
 for(const [a,p] of cases.filter(([a])=>changes[a]))assert.equal(verifyAction(a,p,before,{subscription:{...before,...changes[a]}},prepareAction(a,'42347174',p,before,{now,timezone:'America/New_York'})),true,a);
 const plan=prepareAction('delay','42347174',{days:7},before,{now,timezone:'America/New_York'});
 assert.equal(verifyAction('delay',{days:7},before,{subscription:{...before,nextBillingDateEpoch:plan.body.newBillingDateEpoch}},plan),true);
 assert.equal(verifyAction('order-now',{},before,{subscription:before,history:[{id:99,status:'FAILED'}]},{}),false);
 assert.equal(verifyAction('order-now',{},before,{subscription:before,history:[{id:99,status:'SUCCESS',shopifyId:100}]},{historyIds:[]}),true);
 assert.equal(verifyAction('skip',{},before,{subscription:{...before,nextBillingDateEpoch:before.nextBillingDateEpoch+86400},schedule:[]},{scheduleId:'1'}),false,'date drift alone is not a verified skip');
 assert.equal(verifyAction('skip',{},before,{subscription:{...before,nextBillingDateEpoch:before.nextBillingDateEpoch+86400},schedule:[{id:1,status:'SKIPPED'}]},{scheduleId:'1'}),true);
});
