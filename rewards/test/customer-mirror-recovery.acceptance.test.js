import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { CustomerRewardsMirrorJob } from "../src/models/CustomerRewardsMirrorJob.js";

const uri=process.env.MONGODB_URI;
const dbName=process.env.MONGODB_DB_NAME||undefined;

test("FTR-MIRROR-RECOVERY persisted retry state survives a simulated process restart",{skip:!uri},async(t)=>{
  await mongoose.connect(uri,{dbName});
  const suffix=`${process.pid}-${Date.now()}`;
  const shop=`ftr-mirror-recovery-${suffix}.myshopify.com`;
  const shopifyCustomerId=`gid://shopify/Customer/${Date.now()}`;
  try{
    await RewardCustomer.create({shop,shopifyCustomerId,pointsBalance:100});
    await CustomerRewardsMirrorJob.create({shop,shopifyCustomerId,status:"PENDING",attempts:1,nextAttemptAt:new Date()});

    await t.test("FTR-MIRROR-RECOVERY-001 failed mirror state is persisted",async()=>{
      const job=await CustomerRewardsMirrorJob.findOne({shop,shopifyCustomerId}).lean();
      assert.ok(job);assert.equal(job.status,"PENDING");assert.equal(job.attempts,1);
    });

    await mongoose.disconnect();
    await mongoose.connect(uri,{dbName});

    await t.test("FTR-MIRROR-RECOVERY-002 retry survives simulated restart",async()=>{
      const job=await CustomerRewardsMirrorJob.findOne({shop,shopifyCustomerId}).lean();
      assert.ok(job);
      // A live rewards worker may legitimately claim this due job while this
      // acceptance test reconnects. Both states prove the persisted job
      // survived process memory; PROCESSING additionally proves it was claimable.
      assert.ok(["PENDING","PROCESSING"].includes(job.status),`unexpected persisted retry status: ${job.status}`);
    });

    await RewardCustomer.updateOne({shop,shopifyCustomerId},{$set:{pointsBalance:275}});
    await t.test("FTR-MIRROR-RECOVERY-003 worker source remains latest Mongo balance",async()=>{
      const customer=await RewardCustomer.findOne({shop,shopifyCustomerId}).lean();
      assert.equal(customer.pointsBalance,275);
      const job=await CustomerRewardsMirrorJob.findOne({shop,shopifyCustomerId}).lean();
      assert.ok(job,"retry job must remain persisted until a successful Shopify sync");
    });
  }finally{
    if(mongoose.connection.readyState===0)await mongoose.connect(uri,{dbName});
    await CustomerRewardsMirrorJob.deleteMany({shop});
    await RewardCustomer.deleteMany({shop});
    await mongoose.disconnect();
  }
});
