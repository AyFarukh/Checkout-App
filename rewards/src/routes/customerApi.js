import { Router } from "express";
import { customerAuth } from "../middleware/customerAuth.js";
import { RewardCustomer } from "../models/RewardCustomer.js";
import { PointsTransaction } from "../models/PointsTransaction.js";
import { Reward } from "../models/Reward.js";
import { EarningRule } from "../models/EarningRule.js";
import { Redemption } from "../models/Redemption.js";
import { reserveRedemption, releaseRedemption } from "../services/redemption.service.js";

export const customerApi = Router();
customerApi.use(customerAuth);

function context(req) { return req.customerSession; }
function safeRedemption(value) { const item = value?.toObject ? value.toObject() : { ...value }; delete item.tokenHash; return item; }

customerApi.get("/me", async (req, res, next) => {
  try {
    const { shop, shopifyCustomerId } = context(req);
    const [customer, rewards, rules, activity, redemptions] = await Promise.all([
      RewardCustomer.findOne({ shop, shopifyCustomerId }).lean(),
      // Customer Account is the rewards catalogue. Enabled rewards must remain visible
      // even while Shopify discount synchronization is pending/failed. The sync state
      // is returned so checkout/redemption flows can enforce readiness separately.
      Reward.find({ shop, enabled: true }).sort({ pointsCost: 1 }).select("name type pointsCost discountValue minimumSpend productId collectionId metadata shopifySync.status shopifySync.syncedVersion version").lean(),
      EarningRule.find({ shop, enabled: true }).sort({ priority: 1 }).select("name type points pointsPerDollar multiplier conditions").lean(),
      PointsTransaction.find({ shop, shopifyCustomerId }).sort({ createdAt: -1 }).limit(50).select("type points balanceAfter source reason createdAt rewardId shopifyOrderId").lean(),
      Redemption.find({ shop, shopifyCustomerId }).sort({ createdAt: -1 }).limit(20).select("-tokenHash").lean(),
    ]);
    res.json({
      customer: customer || { shopifyCustomerId, pointsBalance: 0, pointsReserved: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, tier: "Member" },
      rewards,
      rules,
      activity,
      redemptions: redemptions.map(safeRedemption),
    });
  } catch (error) { next(error); }
});

customerApi.post("/redemptions/reserve", async (req, res, next) => {
  try {
    const { shop, shopifyCustomerId } = context(req);
    const rewardId = String(req.body?.rewardId || "").trim();
    const requestId = String(req.get("Idempotency-Key") || req.body?.requestId || "").trim();
    if (!rewardId || !requestId) throw Object.assign(new Error("rewardId and Idempotency-Key are required"), { statusCode: 400 });
    const result = await reserveRedemption({ shop, shopifyCustomerId, rewardId, requestId, cartId: req.body?.cartId });
    res.status(result.duplicate ? 200 : 201).json({ redemption: result });
  } catch (error) { next(error); }
});

customerApi.post("/redemptions/:reference/cancel", async (req, res, next) => {
  try {
    const { shop, shopifyCustomerId } = context(req);
    const owned = await Redemption.findOne({ shop, shopifyCustomerId, publicReference: req.params.reference }).lean();
    if (!owned) return res.status(404).json({ error: "Redemption not found" });
    const result = await releaseRedemption({ shop, publicReference: req.params.reference, status: "CANCELLED" });
    res.json({ redemption: result });
  } catch (error) { next(error); }
});
