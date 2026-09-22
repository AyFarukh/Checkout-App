import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { EarningRule } from "../src/models/EarningRule.js";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { PointsTransaction } from "../src/models/PointsTransaction.js";
import { RewardSettings } from "../src/models/RewardSettings.js";
import { awardForAction, reverseForRefund } from "../src/services/rules.service.js";

const uri=process.env.MONGODB_URI;
const dbName=process.env.MONGODB_DB_NAME||undefined;

test("FTR-MULTI-RULE-REFUND caps each purchase rule independently",{skip:!uri},async(t)=>{
  await mongoose.connect(uri,{dbName});
  const suffix=`${process.pid}-${Date.now()}`,shop=`ftr-multi-refund-${suffix}.myshopify.com`,orderId=`order-${suffix}`;
  const customer={id:String(Date.now()),email:`multi-${suffix}@example.test`,first_name:"Multi",last_name:"Rule"};
  const gid=`gid://shopify/Customer/${customer.id}`;
  try{
    await RewardSettings.create({shop,refundPolicy:"REVERSE_PROPORTIONAL"});
    await EarningRule.create([
      {shop,name:"Base earn",type:"PURCHASE",enabled:true,points:0,pointsPerDollar:1,multiplier:1,priority:10},
      {shop,name:"Bonus earn",type:"PURCHASE",enabled:true,points:0,pointsPerDollar:0.5,multiplier:1,priority:20}
    ]);
    const award=await awardForAction({shop,type:"PURCHASE",customer,eventId:orderId,amount:100,source:"SHOPIFY_ORDER_PAID",shopifyOrderId:orderId,metadata:{eligibleAmount:100}});
    assert.equal(award.awarded,2);

    await t.test("FTR-MULTI-REFUND-001 two rules create independent earns",async()=>{
      const earns=await PointsTransaction.find({shop,shopifyOrderId:orderId,type:"EARN"}).sort({points:-1}).lean();
      assert.deepEqual(earns.map(x=>x.points),[100,50]);
    });

    await reverseForRefund({shop,orderId,refundId:"refund-1",refundedAmount:60});
    await reverseForRefund({shop,orderId,refundId:"refund-2",refundedAmount:40});

    await t.test("FTR-MULTI-REFUND-002 cumulative partial refunds never exceed either original earn",async()=>{
      const earns=await PointsTransaction.find({shop,shopifyOrderId:orderId,type:"EARN"}).lean();
      for(const earn of earns){
        const rows=await PointsTransaction.find({shop,shopifyOrderId:orderId,type:"REFUND","metadata.originalTransactionId":String(earn._id)}).lean();
        assert.equal(rows.reduce((sum,row)=>sum+Math.abs(row.points),0),Math.abs(earn.points));
      }
      const account=await RewardCustomer.findOne({shop,shopifyCustomerId:gid}).lean();
      assert.equal(account.pointsBalance,0);
    });

    await t.test("FTR-MULTI-REFUND-003 duplicate refund replay is a no-op",async()=>{
      const before=await PointsTransaction.countDocuments({shop,type:"REFUND"});
      await reverseForRefund({shop,orderId,refundId:"refund-2",refundedAmount:40});
      assert.equal(await PointsTransaction.countDocuments({shop,type:"REFUND"}),before);
      assert.equal((await RewardCustomer.findOne({shop,shopifyCustomerId:gid}).lean()).pointsBalance,0);
    });
  }finally{
    await PointsTransaction.collection.deleteMany({shop});
    await RewardCustomer.deleteMany({shop});
    await EarningRule.deleteMany({shop});
    await RewardSettings.deleteMany({shop});
    await mongoose.disconnect();
  }
});
