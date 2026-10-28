import test from 'node:test';import assert from 'node:assert/strict';
import {checkoutRewardsModel,estimatedPurchasePoints} from '../src/model.mjs';
const reward=(cost,value,type='FIXED_DISCOUNT',status='SYNCED')=>({_id:String(cost),name:'Reward '+cost,pointsCost:cost,discountValue:value,type,version:1,shopifySync:{status,syncedVersion:1}});
test('checkout shows the highest three affordable order discounts and nearest next tier',()=>{
 const rewards=[reward(1200,50),reward(975,40),reward(750,30),reward(600,25),reward(475,20),reward(350,15),reward(250,10),reward(1800,75),reward(100,0,'FREE_SHIPPING'),reward(400,0,'FREE_PRODUCT'),reward(800,35,'FIXED_DISCOUNT','PENDING')];
 const model=checkoutRewardsModel({customer:{pointsBalance:1240,lifetimeEarned:2100},rewards,currencyCode:'USD'},false);
 assert.deepEqual(model.visible.map(r=>r.pointsCost),[1200,975,750]);assert.equal(model.eligible.length,7);assert.equal(model.next.pointsCost-1240,560);assert.equal(model.tier,'Rooted');assert.equal(model.visible[0].label,'$50 off');
 assert.equal(checkoutRewardsModel({customer:{pointsBalance:1240},rewards,currencyCode:'USD'},true).visible.length,7);
 assert.equal(checkoutRewardsModel({customer:{pointsBalance:0},rewards}).eligible.length,0);
});
test('order point estimate matches per-rule rounding and avoids unverifiable conditional/currency promises',()=>{
 const rule={type:'PURCHASE',pointsPerDollar:1,multiplier:1,conditions:{}};
 assert.equal(estimatedPurchasePoints([rule],{amount:74.99,currencyCode:'USD'},'USD'),74);
 assert.equal(estimatedPurchasePoints([{...rule,pointsPerDollar:.01,points:2,multiplier:2}],{amount:100,currencyCode:'USD'},'USD'),6);
 assert.equal(estimatedPurchasePoints([rule],{amount:74,currencyCode:'CAD'},'USD'),null);
 assert.equal(estimatedPurchasePoints([{...rule,conditions:{firstOrderOnly:true}}],{amount:74,currencyCode:'USD'},'USD'),null);
 assert.equal(estimatedPurchasePoints([{...rule,conditions:{minimumOrderAmount:100}}],{amount:74,currencyCode:'USD'},'USD'),0);
 assert.equal(estimatedPurchasePoints([{...rule,pointsPerDollar:0,points:.8},{...rule,pointsPerDollar:0,points:.8}],{amount:74,currencyCode:'USD'},'USD'),0);
});
