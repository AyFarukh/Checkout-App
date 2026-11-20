import test from 'node:test';
import assert from 'node:assert/strict';
import {journeyProgress,paidOrders,verifyJourneySignature,rewardMatches,journeyConfig} from '../src/services/subscriber-journey.service.js';
import {createHmac} from 'node:crypto';
const seed={seedCount:1,seedOrderIds:['1'],enrolledAt:new Date('2026-11-20T00:00:00Z')};
const order=(id,at)=>({id,shopifyId:id+100,status:'PROCESSED',financialStatus:'paid',shopifyProcessedAt:at});
for(const [count,expected] of [[0,0],[1,10],[2,0],[3,0],[4,20],[5,0],[9,0]])test(`carry ${count} orders without retrospective reward`,()=>{const s=journeyProgress({...seed,seedCount:count},[],[]);assert.equal(s.completed,Math.min(count,5));assert.equal(s.rewardPercent,expected);assert.equal(s.finished,count>=5);});
test('processed unpaid, failed, skipped and duplicate rows are not extra paid orders',()=>assert.equal(paidOrders([order(1,'2026-11-20'),order(1,'2026-11-20'),{...order(2,'2026-11-20'),financialStatus:'pending'},{...order(3,'2026-11-20'),status:'SKIPPED'}]).length,1));
test('skip resets before next paid order and replay never resets twice',()=>{const h=[order(1,'2026-11-19'),order(2,'2026-11-21T00:00:00Z')],skips=[{key:'a',occurredAt:new Date('2026-11-20T12:00:00Z')}];const s=journeyProgress(seed,h,[...skips,...skips]);assert.equal(s.completed,1);assert.equal(s.cycle,1);assert.equal(s.rewardPercent,10);});
test('out-of-order delivery uses event time, not receipt order',()=>{const a={key:'a',occurredAt:new Date('2026-11-21')},b={key:'b',occurredAt:new Date('2026-11-22')};assert.deepEqual(journeyProgress(seed,[],[b,a]),journeyProgress(seed,[],[a,b]));});
test('completion is terminal even after later skip',()=>{const s=journeyProgress({...seed,seedCount:4},[order(2,'2026-11-21')],[{key:'a',occurredAt:new Date('2026-11-22')}]);assert.equal(s.finished,true);assert.equal(s.completed,5);assert.equal(s.cycle,0);});
test('already completed enrollment never resets',()=>assert.equal(journeyProgress({...seed,seedCount:5},[],[{key:'a',occurredAt:new Date('2026-11-21')}]).finished,true));
test('new paid order missing timestamp cannot silently advance reward',()=>assert.throws(()=>journeyProgress(seed,[order(2,null)],[]),/HISTORY_INCOMPLETE/));
test('late discovery of old paid history requires review instead of guessing progress',()=>assert.throws(()=>journeyProgress(seed,[order(2,'2026-11-19')],[]),/HISTORY_CHANGED/));
test('raw body signature accepts rotated key and rejects parsed/tampered/unsigned body',()=>{const raw=Buffer.from('{ "payload": {} }'),sig='v1='+createHmac('sha256','new-signing-key-123').update(raw).digest('hex');assert.equal(verifyJourneySignature(raw,'v2=bad,'+sig,['old-signing-key-123','new-signing-key-123']),true);assert.equal(verifyJourneySignature(Buffer.from('{}'),sig,['new-signing-key-123']),false);assert.equal(verifyJourneySignature(raw,'',[]),false);});
test('reward requires exact percentage, one cycle, unused and active provider evidence',()=>{const d={title:'TEST10',type:'PERCENTAGE',value:10,orderLimit:1,usageCount:0,isActive:true};assert.equal(rewardMatches(d,'TEST10',10),true);for(const p of [{value:20},{orderLimit:null},{usageCount:1},{isActive:false},{rejectionReason:'invalid'},{type:'FIXED_AMOUNT'}])assert.equal(rewardMatches({...d,...p},'TEST10',10),false);});
test('feature defaults off and refuses unverified manual discounts',()=>{assert.equal(journeyConfig({}).enabled,false);assert.equal(journeyConfig({LOOP_JOURNEY_ENABLED:'true'}).automation,false);});

test('simultaneous skip wins over a potentially completing order',()=>{const at='2026-11-21';const p=journeyProgress({...seed,seedCount:4},[order(2,at)],[{key:'same-time',occurredAt:new Date(at)}]);assert.equal(p.finished,false);assert.equal(p.completed,1);});

test('default rollout is the single authorized test subscription, all requires explicit selection',()=>{assert.deepEqual(journeyConfig({}).allowedIds,['42347174']);assert.equal(journeyConfig({}).all,false);assert.equal(journeyConfig({LOOP_JOURNEY_ALLOWED_SUBSCRIPTION_IDS:'all'}).all,true);});
