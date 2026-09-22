import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { CustomerRewardsMirrorJob } from "../src/models/CustomerRewardsMirrorJob.js";

const uri=process.env.MONGODB_URI;
const dbName=process.env.MONGODB_DB_NAME||undefined;

test("FTR-MIRROR-QUEUE persistent mirror retry job survives process memory",{skip:!uri},async(t)=>{
  await mongoose.connect(uri,{dbName});
  const suffix=`${process.pid}-${Date.now()}`,shop=`ftr-mirror-${suffix}.myshopify.com`,customerId=`gid://shopify/Customer/${Date.now()}`;
  try{
    await CustomerRewardsMirrorJob.create({shop,shopifyCustomerId:customerId,status:"PENDING",attempts:1,nextAttemptAt:new Date()});
    await t.test("FTR-MIRROR-QUEUE-001 job is persisted in Mongo",async()=>{
      const job=await CustomerRewardsMirrorJob.findOne({shop,shopifyCustomerId:customerId}).lean();
      assert.ok(job);assert.equal(job.status,"PENDING");assert.equal(job.attempts,1);
    });
    await t.test("FTR-MIRROR-QUEUE-002 customer has only one retry job",async()=>{
      await assert.rejects(()=>CustomerRewardsMirrorJob.create({shop,shopifyCustomerId:customerId,status:"PENDING"}),error=>error?.code===11000);
      assert.equal(await CustomerRewardsMirrorJob.countDocuments({shop,shopifyCustomerId:customerId}),1);
    });
  }finally{await CustomerRewardsMirrorJob.deleteMany({shop});await mongoose.disconnect()}
});
