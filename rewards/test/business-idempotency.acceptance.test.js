import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { PointsTransaction } from "../src/models/PointsTransaction.js";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { Redemption } from "../src/models/Redemption.js";
import { applyPointsTransaction } from "../src/services/rewards.service.js";
import { reverseForRefund } from "../src/services/rules.service.js";
import { commitRedemption, refundRedemption } from "../src/services/redemption.service.js";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || undefined;

async function snapshot(shop, customerId) {
  const customer = await RewardCustomer.findOne({ shop, shopifyCustomerId: customerId }).lean();
  const transactionCount = await PointsTransaction.countDocuments({ shop, shopifyCustomerId: customerId });
  return {
    pointsBalance: customer?.pointsBalance,
    pointsReserved: customer?.pointsReserved,
    lifetimeEarned: customer?.lifetimeEarned,
    lifetimeRedeemed: customer?.lifetimeRedeemed,
    transactionCount,
  };
}

async function unchanged(shop, customerId, before) {
  assert.deepEqual(await snapshot(shop, customerId), before);
}

test("FTR-BIZ-IDEM existing business events are safe to replay", { skip: !uri }, async (t) => {
  await mongoose.connect(uri, { dbName });
  try {
    await t.test("FTR-BIZ-IDEM-001 duplicate EARN is a no-op", async (t) => {
      const tx = await PointsTransaction.findOne({ type: "EARN", source: "SHOPIFY_ORDER_PAID", idempotencyKey: { $type: "string" } }).sort({ createdAt: -1 }).lean();
      if (!tx) return t.skip("No paid-order EARN transaction exists yet");
      const before = await snapshot(tx.shop, tx.shopifyCustomerId);
      const result = await applyPointsTransaction({
        shop: tx.shop, shopifyCustomerId: tx.shopifyCustomerId, type: tx.type,
        points: tx.points, source: tx.source, reason: tx.reason,
        idempotencyKey: tx.idempotencyKey, shopifyOrderId: tx.shopifyOrderId,
        rewardId: tx.rewardId, metadata: tx.metadata,
      });
      assert.equal(result.duplicate, true);
      assert.equal(String(result.transaction._id), String(tx._id));
      await unchanged(tx.shop, tx.shopifyCustomerId, before);
    });

    await t.test("FTR-BIZ-IDEM-002 duplicate REFUND is a no-op", async (t) => {
      const tx = await PointsTransaction.findOne({ type: "REFUND", source: "SHOPIFY_REFUND", "metadata.refundId": { $exists: true } }).sort({ createdAt: -1 }).lean();
      if (!tx) return t.skip("No refund transaction exists yet");
      const before = await snapshot(tx.shop, tx.shopifyCustomerId);
      await reverseForRefund({
        shop: tx.shop, orderId: tx.shopifyOrderId,
        refundId: String(tx.metadata.refundId),
        refundedAmount: Number(tx.metadata.refundedAmount || 0),
      });
      await unchanged(tx.shop, tx.shopifyCustomerId, before);
      assert.equal(await PointsTransaction.countDocuments({ shop: tx.shop, idempotencyKey: tx.idempotencyKey }), 1);
    });

    await t.test("FTR-BIZ-IDEM-003 duplicate REDEEM commit is a no-op", async (t) => {
      const tx = await PointsTransaction.findOne({ type: "REDEEM", source: "SHOPIFY_REWARD", "metadata.publicReference": { $exists: true } }).sort({ createdAt: -1 }).lean();
      if (!tx) return t.skip("No committed reward transaction exists yet");
      const redemption = await Redemption.findOne({ shop: tx.shop, publicReference: tx.metadata.publicReference }).lean();
      if (!redemption) return t.skip("Matching redemption no longer exists");
      const before = await snapshot(tx.shop, tx.shopifyCustomerId);
      await commitRedemption({
        shop: tx.shop, publicReference: redemption.publicReference,
        shopifyCustomerId: tx.shopifyCustomerId, shopifyOrderId: tx.shopifyOrderId,
      });
      await unchanged(tx.shop, tx.shopifyCustomerId, before);
      assert.equal(await PointsTransaction.countDocuments({ shop: tx.shop, idempotencyKey: tx.idempotencyKey }), 1);
    });

    await t.test("FTR-BIZ-IDEM-004 duplicate reward REVERSAL is a no-op", async (t) => {
      const tx = await PointsTransaction.findOne({ type: "REVERSAL", source: "SHOPIFY_REFUND", "metadata.refundId": { $exists: true } }).sort({ createdAt: -1 }).lean();
      if (!tx) return t.skip("No reward reversal transaction exists yet");
      const before = await snapshot(tx.shop, tx.shopifyCustomerId);
      const result = await refundRedemption({
        shop: tx.shop, shopifyOrderId: tx.shopifyOrderId,
        refundId: String(tx.metadata.refundId), ratio: 1,
      });
      assert.equal(result.refunded, 0);
      await unchanged(tx.shop, tx.shopifyCustomerId, before);
      assert.equal(await PointsTransaction.countDocuments({ shop: tx.shop, idempotencyKey: tx.idempotencyKey }), 1);
    });
  } finally {
    await mongoose.disconnect();
  }
});
