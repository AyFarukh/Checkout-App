import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Reward } from "../src/models/Reward.js";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { Redemption } from "../src/models/Redemption.js";
import { PointsTransaction } from "../src/models/PointsTransaction.js";
import { reserveRedemption } from "../src/services/redemption.service.js";

const uri=process.env.MONGODB_URI;
const dbName=process.env.MONGODB_DB_NAME||undefined;

test("FTR-ROLLBACK-001 failed Shopify discount creation releases reservation and restores points",{skip:!uri},async(t)=>{
  await mongoose.connect(uri,{dbName});
  const suffix=`${process.pid}-${Date.now()}`;
  const shop=`ftr-rollback-${suffix}.myshopify.com`;
  const customerId=`gid://shopify/Customer/${Date.now()}`;
  let reward;
  try{
    [reward]=await Reward.create([{
      shop,name:"Rollback acceptance reward",type:"FIXED_DISCOUNT",enabled:true,
      pointsCost:500,discountValue:5,version:1,
      shopifySync:{desiredVersion:1,syncedVersion:1,status:"SYNCED"},
      metadata:{acceptanceFixture:suffix},
    }]);
    await RewardCustomer.create({shop,shopifyCustomerId:customerId,pointsBalance:2000});
    const before=await RewardCustomer.findOne({shop,shopifyCustomerId:customerId}).lean();

    const forced=Object.assign(new Error("Forced Shopify discount creation failure for acceptance test"),{code:"FTR_FORCED_DISCOUNT_FAILURE"});
    await assert.rejects(
      reserveRedemption({
        shop,shopifyCustomerId:customerId,rewardId:reward._id,
        requestId:`rollback:${suffix}`,
        discountCreator:async()=>{throw forced;},
      }),
      error=>error?.code==="FTR_FORCED_DISCOUNT_FAILURE"
    );

    const customer=await RewardCustomer.findOne({shop,shopifyCustomerId:customerId}).lean();
    assert.equal(customer.pointsBalance,before.pointsBalance,"points balance must be fully restored");
    assert.equal(customer.pointsReserved,0,"no points may remain reserved");

    const redemption=await Redemption.findOne({shop,shopifyCustomerId:customerId,requestId:`rollback:${suffix}`}).lean();
    assert.ok(redemption,"reservation record should remain for audit history");
    assert.equal(redemption.status,"RELEASED");
    assert.equal(redemption.shopifyDiscountId,undefined);
    assert.equal(redemption.discountCode,undefined);

    assert.equal(await PointsTransaction.countDocuments({shop,shopifyCustomerId:customerId,type:"REDEEM"}),0,"failed reservation must not create a REDEEM ledger row");
  }finally{
    if(reward)await Reward.deleteOne({_id:reward._id});
    await Redemption.deleteMany({shop});
    await RewardCustomer.deleteMany({shop});
    await PointsTransaction.deleteMany({shop}).catch(()=>{});
    await mongoose.disconnect();
  }
});
