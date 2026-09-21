import "dotenv/config";
import mongoose from "mongoose";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { syncCustomerRewardsMirror } from "../src/services/shopify-customer-rewards-mirror.service.js";

const shop=String(process.argv[2]||"").trim().toLowerCase();
if(!shop||!shop.endsWith(".myshopify.com")){
  console.error("Usage: node scripts/sync-customer-rewards-metafields.js <shop.myshopify.com>");
  process.exit(1);
}
const uri=process.env.MONGODB_URI||process.env.MONGO_URI;
if(!uri){console.error("MONGODB_URI (or MONGO_URI) is required");process.exit(1)}
await mongoose.connect(uri);
let ok=0,failed=0;
try{
  const cursor=RewardCustomer.find({shop}).select("shopifyCustomerId pointsBalance").lean().cursor();
  for await(const customer of cursor){
    try{
      await syncCustomerRewardsMirror({shop,shopifyCustomerId:customer.shopifyCustomerId,pointsBalance:customer.pointsBalance});
      ok++;
      console.log(`[Rewards Mirror] synced ${customer.shopifyCustomerId}: ${customer.pointsBalance}`);
    }catch(error){
      failed++;
      console.error(`[Rewards Mirror] failed ${customer.shopifyCustomerId}: ${error.message}`);
    }
  }
}finally{await mongoose.disconnect()}
console.log(`[Rewards Mirror] complete shop=${shop} synced=${ok} failed=${failed}`);
if(failed)process.exitCode=1;
