import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { EarningRule } from "../src/models/EarningRule.js";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { PointsTransaction } from "../src/models/PointsTransaction.js";
import { awardForAction } from "../src/services/rules.service.js";

const uri=process.env.MONGODB_URI;
const dbName=process.env.MONGODB_DB_NAME||undefined;

test("FTR-ACCOUNT-CREATE account creation awards are correct and idempotent",{skip:!uri},async(t)=>{
  await mongoose.connect(uri,{dbName});
  const suffix=`${process.pid}-${Date.now()}`;
  const shop=`ftr-account-create-${suffix}.myshopify.com`;
  const customer={id:`${Date.now()}`,email:`account-${suffix}@example.test`,first_name:"Acceptance",last_name:"Customer"};
  const gid=`gid://shopify/Customer/${customer.id}`;
  let rule;
  try{
    rule=await EarningRule.create({shop,name:"Create an account",type:"ACCOUNT_CREATE",enabled:true,points:100,pointsPerDollar:0,multiplier:1,priority:20,conditions:{oncePerCustomer:true}});

    await t.test("FTR-ACCOUNT-CREATE-001 first customer/create event awards configured points",async()=>{
      const result=await awardForAction({shop,type:"ACCOUNT_CREATE",customer,eventId:customer.id,source:"SHOPIFY_CUSTOMER_CREATED"});
      assert.equal(result.awarded,1);
      const account=await RewardCustomer.findOne({shop,shopifyCustomerId:gid}).lean();
      assert.equal(account.pointsBalance,100);
      assert.equal(account.lifetimeEarned,100);
      const tx=await PointsTransaction.findOne({shop,shopifyCustomerId:gid,type:"EARN",source:"SHOPIFY_CUSTOMER_CREATED"}).lean();
      assert.ok(tx);
      assert.equal(tx.points,100);
      assert.equal(tx.metadata.ruleType,"ACCOUNT_CREATE");
      assert.equal(tx.metadata.ruleId,String(rule._id));
    });

    await t.test("FTR-ACCOUNT-CREATE-002 duplicate delivery cannot award twice",async()=>{
      const before=await RewardCustomer.findOne({shop,shopifyCustomerId:gid}).lean();
      const result=await awardForAction({shop,type:"ACCOUNT_CREATE",customer,eventId:customer.id,source:"SHOPIFY_CUSTOMER_CREATED"});
      assert.equal(result.awarded,1);
      assert.equal(result.results[0].duplicate,true);
      const after=await RewardCustomer.findOne({shop,shopifyCustomerId:gid}).lean();
      assert.equal(after.pointsBalance,before.pointsBalance);
      assert.equal(after.lifetimeEarned,before.lifetimeEarned);
      assert.equal(await PointsTransaction.countDocuments({shop,shopifyCustomerId:gid,type:"EARN",source:"SHOPIFY_CUSTOMER_CREATED"}),1);
    });

    await t.test("FTR-ACCOUNT-CREATE-003 disabled rule awards nothing",async()=>{
      rule.enabled=false; await rule.save();
      const second={...customer,id:String(Number(customer.id)+1),email:`disabled-${suffix}@example.test`};
      const result=await awardForAction({shop,type:"ACCOUNT_CREATE",customer:second,eventId:second.id,source:"SHOPIFY_CUSTOMER_CREATED"});
      assert.equal(result.skipped,true);
      assert.equal(result.reason,"No enabled ACCOUNT_CREATE rule");
      assert.equal(await RewardCustomer.countDocuments({shop,shopifyCustomerId:`gid://shopify/Customer/${second.id}`}),0);
      assert.equal(await PointsTransaction.countDocuments({shop,shopifyCustomerId:`gid://shopify/Customer/${second.id}`}),0);
    });
  }finally{
    // Test fixture cleanup intentionally bypasses immutable ledger model middleware.\n    await PointsTransaction.collection.deleteMany({shop});
    await RewardCustomer.deleteMany({shop});
    await EarningRule.deleteMany({shop});
    await mongoose.disconnect();
  }
});
