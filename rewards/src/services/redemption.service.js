import crypto from "node:crypto";
import mongoose from "mongoose";
import { Reward } from "../models/Reward.js";
import { RewardCustomer } from "../models/RewardCustomer.js";
import { Redemption } from "../models/Redemption.js";
import { PointsTransaction } from "../models/PointsTransaction.js";

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
export async function reserveRedemption({ shop, shopifyCustomerId, rewardId, requestId, cartId }) {
  if (!requestId) throw Object.assign(new Error("requestId is required"), { statusCode: 400 });
  const existing = await Redemption.findOne({ shop, shopifyCustomerId, requestId }); if (existing) return existing;
  const reward = await Reward.findOne({ _id: rewardId, shop, enabled: true }).lean();
  if (!reward) throw Object.assign(new Error("Reward not found or disabled"), { statusCode: 404 });
  if (reward.shopifySync?.status !== "SYNCED") throw Object.assign(new Error("Reward is not synchronized with Shopify"), { statusCode: 409 });
  const token = crypto.randomBytes(32).toString("base64url"), publicReference = `rwd_${crypto.randomBytes(18).toString("base64url")}`, expiresAt = new Date(Date.now() + 30 * 60_000);
  const dbSession = await mongoose.startSession(); let redemption;
  try { await dbSession.withTransaction(async () => {
    const customer = await RewardCustomer.findOneAndUpdate({ shop, shopifyCustomerId, pointsBalance: { $gte: reward.pointsCost } }, { $inc: { pointsBalance: -reward.pointsCost, pointsReserved: reward.pointsCost } }, { new: true, session: dbSession });
    if (!customer) throw Object.assign(new Error("Insufficient points balance"), { statusCode: 409 });
    [redemption] = await Redemption.create([{ shop, shopifyCustomerId, rewardId: reward._id, rewardVersion: reward.version, points: reward.pointsCost, requestId, publicReference, tokenHash: hash(token), expiresAt, shopifyCartId: cartId }], { session: dbSession });
  }); } finally { await dbSession.endSession(); }
  return { ...redemption.toObject(), token };
}

export async function commitRedemption({ shop, publicReference, shopifyCustomerId, shopifyOrderId }) {
  const dbSession = await mongoose.startSession(); let result;
  try { await dbSession.withTransaction(async () => {
    const redemption = await Redemption.findOne({ shop, publicReference }).session(dbSession);
    if (!redemption) return;
    if (redemption.status === "COMMITTED") { result = redemption; return; }
    if (redemption.status !== "RESERVED" || redemption.shopifyCustomerId !== shopifyCustomerId) return;
    const customer = await RewardCustomer.findOneAndUpdate({ shop, shopifyCustomerId, pointsReserved: { $gte: redemption.points } }, { $inc: { pointsReserved: -redemption.points, lifetimeRedeemed: redemption.points } }, { new: true, session: dbSession });
    if (!customer) throw new Error("Reserved points invariant failed");
    await PointsTransaction.create([{ shop, shopifyCustomerId, type: "REDEEM", points: -redemption.points, balanceAfter: customer.pointsBalance, source: "SHOPIFY_REWARD", rewardId: String(redemption.rewardId), shopifyOrderId: String(shopifyOrderId), reason: "Reward redemption", idempotencyKey: `REDEEM:${redemption._id}`, metadata: { redemptionId: String(redemption._id), publicReference } }], { session: dbSession });
    redemption.status = "COMMITTED"; redemption.shopifyOrderId = String(shopifyOrderId); redemption.committedAt = new Date(); await redemption.save({ session: dbSession }); result = redemption;
  }); } finally { await dbSession.endSession(); } return result;
}

export async function releaseExpiredRedemptions(limit = 50) {
  const expired = await Redemption.find({ status: "RESERVED", expiresAt: { $lt: new Date() } }).limit(limit);
  for (const item of expired) { const dbSession = await mongoose.startSession(); try { await dbSession.withTransaction(async () => {
    const redemption = await Redemption.findOneAndUpdate({ _id: item._id, status: "RESERVED", expiresAt: { $lt: new Date() } }, { $set: { status: "RELEASED", releasedAt: new Date() } }, { new: true, session: dbSession }); if (!redemption) return;
    await RewardCustomer.updateOne({ shop: redemption.shop, shopifyCustomerId: redemption.shopifyCustomerId, pointsReserved: { $gte: redemption.points } }, { $inc: { pointsReserved: -redemption.points, pointsBalance: redemption.points } }, { session: dbSession });
  }); } finally { await dbSession.endSession(); } }
}
