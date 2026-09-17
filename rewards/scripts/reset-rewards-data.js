import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../src/config/db.js";
import { Redemption } from "../src/models/Redemption.js";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { PointsTransaction } from "../src/models/PointsTransaction.js";
import { Reward } from "../src/models/Reward.js";
import { EarningRule } from "../src/models/EarningRule.js";
import { RewardSettings } from "../src/models/RewardSettings.js";
import { ShopifySyncJob } from "../src/models/ShopifySyncJob.js";
import { WebhookEvent } from "../src/models/WebhookEvent.js";
import { AdminAuditLog } from "../src/models/AdminAuditLog.js";
import { IdempotencyRecord } from "../src/models/IdempotencyRecord.js";
import { deactivateRedemptionDiscount } from "../src/services/shopify-redemption-discount.service.js";

const expected = "RESET_FREETHE_ROOT_REWARDS";
if (process.argv[2] !== expected) {
  console.error(`Refusing destructive reset. Run: npm run reset:rewards -- ${expected}`);
  process.exit(2);
}

await connectDatabase();

const shops = await Redemption.distinct("shop");
const redemptions = await Redemption.find({ shopifyDiscountId: { $exists: true, $ne: null } })
  .select("shop shopifyDiscountId discountCode")
  .lean();

console.log(`[Rewards Reset] Found ${redemptions.length} generated Shopify reward discount(s).`);
let deactivated = 0;
let deactivateFailed = 0;
for (const redemption of redemptions) {
  try {
    await deactivateRedemptionDiscount({ shop: redemption.shop, discountId: redemption.shopifyDiscountId });
    deactivated += 1;
    console.log(`[Rewards Reset] Deactivated ${redemption.discountCode || redemption.shopifyDiscountId}`);
  } catch (error) {
    // Do not delete the DB evidence if Shopify cleanup failed. This makes the reset
    // fail closed instead of leaving an active orphaned FTR code behind.
    deactivateFailed += 1;
    console.error(`[Rewards Reset] FAILED to deactivate ${redemption.discountCode || redemption.shopifyDiscountId}: ${error?.message || error}`);
  }
}

if (deactivateFailed) {
  console.error(`[Rewards Reset] Aborted database deletion because ${deactivateFailed} Shopify reward discount(s) could not be deactivated.`);
  console.error("Fix Shopify authorization/network access and run the reset again.");
  await mongoose.disconnect();
  process.exit(1);
}

const collections = [
  ["admin audit logs", AdminAuditLog],
  ["idempotency records", IdempotencyRecord],
  ["webhook events", WebhookEvent],
  ["sync jobs", ShopifySyncJob],
  ["points transactions", PointsTransaction],
  ["redemptions", Redemption],
  ["reward customers", RewardCustomer],
  ["earning rules", EarningRule],
  ["rewards", Reward],
  ["reward settings", RewardSettings],
];

const deleted = {};
for (const [label, Model] of collections) {
  const result = await Model.deleteMany({});
  deleted[label] = result.deletedCount || 0;
}

console.log("\n[Rewards Reset] COMPLETE");
console.log(`[Rewards Reset] Shopify reward discounts deactivated: ${deactivated}`);
for (const [label, count] of Object.entries(deleted)) console.log(`[Rewards Reset] Deleted ${label}: ${count}`);
console.log(`[Rewards Reset] Shops previously represented in redemption data: ${shops.join(", ") || "none"}`);
console.log("[Rewards Reset] PRESERVED: Shopify customers, ShopifyOfflineToken records, unrelated Shopify discounts, Smart FBT, checkout-upsell, app code/config.");

await mongoose.disconnect();
