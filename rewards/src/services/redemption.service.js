import crypto from "node:crypto";
import mongoose from "mongoose";
import { Reward } from "../models/Reward.js";
import { RewardCustomer } from "../models/RewardCustomer.js";
import { Redemption } from "../models/Redemption.js";
import { PointsTransaction } from "../models/PointsTransaction.js";
import { createRedemptionDiscount, deactivateRedemptionDiscount } from "./shopify-redemption-discount.service.js";
import { syncCustomerRewardsMirrorBestEffort } from "./shopify-customer-rewards-mirror.service.js";

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const publicView = doc => { const value = doc?.toObject ? doc.toObject() : { ...doc }; delete value.tokenHash; return value; };

export async function reserveRedemption({ shop, shopifyCustomerId, rewardId, requestId, cartId }) {
  if (!requestId) throw Object.assign(new Error("requestId is required"), { statusCode: 400 });
  const existing = await Redemption.findOne({ shop, shopifyCustomerId, requestId }).lean();
  if (existing) return { ...publicView(existing), duplicate: true };
  const reward = await Reward.findOne({ _id: rewardId, shop, enabled: true }).lean();
  if (!reward) throw Object.assign(new Error("Reward not found or disabled"), { statusCode: 404 });
  if (reward.shopifySync?.status !== "SYNCED" || Number(reward.shopifySync?.syncedVersion || 0) !== Number(reward.version || 1)) throw Object.assign(new Error("Reward is not ready for Shopify checkout yet"), { statusCode: 409, code: "REWARD_NOT_SYNCED" });
  const rewardVersion = Number.isInteger(reward.version) && reward.version >= 1 ? reward.version : 1;
  if (reward.version !== rewardVersion) await Reward.updateOne({ _id: reward._id, shop }, { $set: { version: rewardVersion, "shopifySync.desiredVersion": rewardVersion } });
  const token = crypto.randomBytes(32).toString("base64url"), publicReference = `rwd_${crypto.randomBytes(18).toString("base64url")}`, expiresAt = new Date(Date.now() + 30 * 60_000);
  const session = await mongoose.startSession(); let redemption;
  try { await session.withTransaction(async () => {
    const customer = await RewardCustomer.findOneAndUpdate({ shop, shopifyCustomerId, pointsBalance: { $gte: reward.pointsCost } }, { $inc: { pointsBalance: -reward.pointsCost, pointsReserved: reward.pointsCost } }, { new: true, session });
    if (!customer) throw Object.assign(new Error("Insufficient points balance"), { statusCode: 409 });
    const redemptionData = { shop, shopifyCustomerId, rewardId: reward._id, rewardVersion, points: reward.pointsCost, requestId, publicReference, tokenHash: hash(token), expiresAt };
    if (cartId != null && String(cartId).trim()) redemptionData.shopifyCartId = String(cartId).trim();
    [redemption] = await Redemption.create([redemptionData], { session });
  }); } finally { await session.endSession(); }
  try { const discount = await createRedemptionDiscount({ shop, reward, redemption }); redemption = await Redemption.findOneAndUpdate({ _id: redemption._id, status: "RESERVED" }, { $set: { shopifyDiscountId: discount.discountId, discountCode: discount.code, discountCreatedAt: new Date() } }, { new: true }); }
  catch (error) { try { await releaseRedemption({ shop, publicReference, status: "RELEASED" }); } catch {} throw error; }
  const reservedCustomer=await RewardCustomer.findOne({shop,shopifyCustomerId}).select("pointsBalance").lean();
  if(reservedCustomer)await syncCustomerRewardsMirrorBestEffort({shop,shopifyCustomerId,pointsBalance:reservedCustomer.pointsBalance});
  return { ...publicView(redemption), token, duplicate: false };
}

export async function commitRedemption({ shop, publicReference, shopifyCustomerId, shopifyOrderId }) {
  const session = await mongoose.startSession(); let result;
  try { await session.withTransaction(async () => {
    const redemption = await Redemption.findOne({ shop, publicReference }).session(session);
    if (!redemption) throw Object.assign(new Error("Redemption not found"), { statusCode: 404 });
    if (redemption.status === "COMMITTED") { result = redemption; return; }
    if (redemption.status !== "RESERVED" || redemption.shopifyCustomerId !== String(shopifyCustomerId)) throw Object.assign(new Error("Redemption cannot be committed"), { statusCode: 409 });
    const customer = await RewardCustomer.findOneAndUpdate({ shop, shopifyCustomerId: String(shopifyCustomerId), pointsReserved: { $gte: redemption.points } }, { $inc: { pointsReserved: -redemption.points, lifetimeRedeemed: redemption.points } }, { new: true, session });
    if (!customer) throw new Error("Reserved points invariant failed");
    await PointsTransaction.create([{ shop, shopifyCustomerId: String(shopifyCustomerId), type: "REDEEM", points: -redemption.points, balanceAfter: customer.pointsBalance, source: "SHOPIFY_REWARD", rewardId: String(redemption.rewardId), shopifyOrderId: String(shopifyOrderId), reason: "Reward redemption", idempotencyKey: `REDEEM:${redemption._id}`, metadata: { redemptionId: String(redemption._id), publicReference } }], { session });
    redemption.status = "COMMITTED"; redemption.shopifyOrderId = String(shopifyOrderId); redemption.committedAt = new Date(); await redemption.save({ session }); result = redemption;
  }); } finally { await session.endSession(); }
  const committedCustomer=await RewardCustomer.findOne({shop,shopifyCustomerId:String(shopifyCustomerId)}).select("pointsBalance").lean();
  if(committedCustomer)await syncCustomerRewardsMirrorBestEffort({shop,shopifyCustomerId:String(shopifyCustomerId),pointsBalance:committedCustomer.pointsBalance});
  return publicView(result);
}
export async function commitRedemptionFromPaidOrder({ shop, shopifyOrderId, shopifyCustomerId, discountCodes = [] }) { if (!shopifyCustomerId || !shopifyOrderId) return null; const codes = discountCodes.map(value => String(value || "").trim().toUpperCase()).filter(Boolean); if (!codes.length) return null; const redemption = await Redemption.findOne({ shop, shopifyCustomerId: String(shopifyCustomerId), status: "RESERVED", discountCode: { $in: codes } }).lean(); if (!redemption) return null; return commitRedemption({ shop, publicReference: redemption.publicReference, shopifyCustomerId, shopifyOrderId }); }

export async function releaseRedemption({ shop, publicReference, status = "RELEASED" }) {
  const session = await mongoose.startSession(); let result;
  try { await session.withTransaction(async () => {
    const redemption = await Redemption.findOneAndUpdate({ shop, publicReference, status: "RESERVED" }, { $set: { status, ...(status === "CANCELLED" ? { cancelledAt: new Date() } : { releasedAt: new Date() }) } }, { new: true, session });
    if (!redemption) { const existing = await Redemption.findOne({ shop, publicReference }).session(session); if (existing && existing.status === status) { result = existing; return; } throw Object.assign(new Error("Redemption is not releasable"), { statusCode: existing ? 409 : 404 }); }
    const customer = await RewardCustomer.findOneAndUpdate({ shop, shopifyCustomerId: redemption.shopifyCustomerId, pointsReserved: { $gte: redemption.points } }, { $inc: { pointsReserved: -redemption.points, pointsBalance: redemption.points } }, { new: true, session });
    if (!customer) throw new Error("Reserved points invariant failed"); result = redemption;
  }); } finally { await session.endSession(); }
  if (result?.shopifyDiscountId) { try { await deactivateRedemptionDiscount({ shop, discountId: result.shopifyDiscountId }); } catch (error) { console.error(`[Rewards Redemption] failed to deactivate ${result.shopifyDiscountId}:`, error?.message || error); } }
  const releasedCustomer=result?await RewardCustomer.findOne({shop,shopifyCustomerId:result.shopifyCustomerId}).select("pointsBalance").lean():null;
  if(releasedCustomer)await syncCustomerRewardsMirrorBestEffort({shop,shopifyCustomerId:result.shopifyCustomerId,pointsBalance:releasedCustomer.pointsBalance});
  return publicView(result);
}

export async function refundRedemption({ shop, shopifyOrderId, refundId, ratio = 1 }) {
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0)); if (!refundId || safeRatio <= 0) return { refunded: 0 };
  const session = await mongoose.startSession(); let refunded = 0;
  try { await session.withTransaction(async () => { const redemptions = await Redemption.find({ shop, shopifyOrderId: String(shopifyOrderId), status: { $in: ["COMMITTED", "REFUNDED"] }, refundIds: { $ne: String(refundId) } }).session(session); for (const redemption of redemptions) { const remaining = Math.max(0, redemption.points - (redemption.refundedPoints || 0)), restore = Math.min(remaining, Math.floor(redemption.points * safeRatio)); if (!restore) continue; const customer = await RewardCustomer.findOneAndUpdate({ shop, shopifyCustomerId: redemption.shopifyCustomerId }, { $inc: { pointsBalance: restore, lifetimeRedeemed: -restore } }, { new: true, session }); if (!customer) throw new Error("Redemption customer missing"); await PointsTransaction.create([{ shop, shopifyCustomerId: redemption.shopifyCustomerId, type: "REVERSAL", points: restore, balanceAfter: customer.pointsBalance, source: "SHOPIFY_REFUND", rewardId: String(redemption.rewardId), shopifyOrderId: String(shopifyOrderId), reason: "Reward redemption reversed after refund", idempotencyKey: `REDEMPTION_REFUND:${refundId}:${redemption._id}`, metadata: { redemptionId: String(redemption._id), refundId: String(refundId) } }], { session }); redemption.refundedPoints = (redemption.refundedPoints || 0) + restore; redemption.refundIds.addToSet(String(refundId)); if (redemption.refundedPoints >= redemption.points) { redemption.status = "REFUNDED"; redemption.refundedAt = new Date(); } await redemption.save({ session }); refunded += restore; } }); } finally { await session.endSession(); }
  if(refunded>0){const affected=await Redemption.find({shop,shopifyOrderId:String(shopifyOrderId)}).distinct("shopifyCustomerId");for(const customerId of affected){const customer=await RewardCustomer.findOne({shop,shopifyCustomerId:customerId}).select("pointsBalance").lean();if(customer)await syncCustomerRewardsMirrorBestEffort({shop,shopifyCustomerId:customerId,pointsBalance:customer.pointsBalance})}}
  return { refunded };
}
export async function releaseExpiredRedemptions(limit = 50) { const expired = await Redemption.find({ status: "RESERVED", expiresAt: { $lt: new Date() } }).limit(limit).select("publicReference shop").lean(); for (const item of expired) { try { await releaseRedemption({ shop: item.shop, publicReference: item.publicReference }); } catch (error) { if (error?.statusCode !== 409) throw error; } } }
