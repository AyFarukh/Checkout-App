import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { CustomerRewardsMirrorJob } from "../src/models/CustomerRewardsMirrorJob.js";
import { processCustomerRewardsMirrorRetries } from "../src/services/shopify-customer-rewards-mirror.service.js";

const uri=process.env.MONGODB_URI;
const dbName=process.env.MONGODB_DB_NAME||undefined;

test("FTR-MIRROR-RECOVERY-SUCCESS worker syncs latest balance and removes retry",{skip:!uri},async(t)=>{
  await mongoose.connect(uri,{dbName});
  const suffix=`${process.pid}-${Date.now()}`,shop=`ftr-mirror-success-${suffix}.myshopify.com`,shopifyCustomerId=`gid://shopify/Customer/${Date.now()}`;
  const calls=[];
  try{
    await RewardCustomer.create({shop,shopifyCustomerId,pointsBalance:275});
    await CustomerRewardsMirrorJob.create({shop,shopifyCustomerId,status:"PENDING",attempts:2,nextAttemptAt:new Date(Date.now()-1000)});
    const graphql=async(receivedShop,_query,variables)=>{
      calls.push({shop:receivedShop,variables});
      return{metafieldsSet:{metafields:[{id:"gid://shopify/Metafield/test",namespace:"freetheroot_rewards",key:"points_balance",value:variables.metafields[0].value,type:"number_integer"}],userErrors:[]}};
    };
    const result=await processCustomerRewardsMirrorRetries(1,{graphql});
    await t.test("FTR-MIRROR-RECOVERY-SUCCESS-001 worker sends latest Mongo balance",()=>{
      assert.equal(calls.length,1);assert.equal(calls[0].shop,shop);assert.equal(calls[0].variables.metafields[0].ownerId,shopifyCustomerId);assert.equal(calls[0].variables.metafields[0].value,"275");
    });
    await t.test("FTR-MIRROR-RECOVERY-SUCCESS-002 successful retry is removed",async()=>{
      assert.equal(result.processed,1);assert.equal(result.synced,1);assert.equal(result.failed,0);assert.equal(await CustomerRewardsMirrorJob.countDocuments({shop,shopifyCustomerId}),0);
    });
  }finally{await CustomerRewardsMirrorJob.deleteMany({shop});await RewardCustomer.deleteMany({shop});await mongoose.disconnect()}
});
