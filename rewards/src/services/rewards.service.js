import mongoose from "mongoose";
import { RewardCustomer } from "../models/RewardCustomer.js";
import { PointsTransaction } from "../models/PointsTransaction.js";
import { syncCustomerRewardsMirrorBestEffort } from "./shopify-customer-rewards-mirror.service.js";

export function normalizeShopifyCustomerId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(?:gid:\/\/shopify\/Customer\/)?(\d+)$/);
  return match ? `gid://shopify/Customer/${match[1]}` : raw;
}

function normalizeDelta(type, points) {
  const numeric = Number(points);
  if (!Number.isFinite(numeric) || numeric === 0) throw new Error("Points must be a non-zero number");
  if (type === "ADJUST") return numeric;
  const absolute = Math.abs(numeric);
  return ["REDEEM", "REFUND", "EXPIRE"].includes(type) ? -absolute : absolute;
}

export async function ensureRewardCustomer({ shop, shopifyCustomerId, email, firstName, lastName }) {
  const customerId = normalizeShopifyCustomerId(shopifyCustomerId);
  return RewardCustomer.findOneAndUpdate(
    { shop, shopifyCustomerId: customerId },
    { $setOnInsert: { shop, shopifyCustomerId: customerId }, $set: { ...(email ? { email } : {}), ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) } },
    { upsert: true, new: true }
  );
}

export async function applyPointsTransaction(input) {
  const { shop, type, points, source, reason, note, createdBy, idempotencyKey, shopifyOrderId, rewardId, metadata, customer = {} } = input;
  const shopifyCustomerId = normalizeShopifyCustomerId(input.shopifyCustomerId);
  if (!shop || !shopifyCustomerId || !type || !source) throw new Error("shop, shopifyCustomerId, type and source are required");

  if (idempotencyKey) {
    const existing = await PointsTransaction.findOne({ shop, idempotencyKey });
    if (existing) {
      const existingCustomer=await RewardCustomer.findOne({ shop, shopifyCustomerId });
      if(existingCustomer)await syncCustomerRewardsMirrorBestEffort({shop,shopifyCustomerId,pointsBalance:existingCustomer.pointsBalance});
      return { customer: existingCustomer, transaction: existing, duplicate: true };
    }
  }

  const delta = normalizeDelta(type, points);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      let account = await RewardCustomer.findOne({ shop, shopifyCustomerId }).session(session);
      if (!account) [account] = await RewardCustomer.create([{ shop, shopifyCustomerId, ...customer }], { session });

      const nextBalance = account.pointsBalance + delta;
      if (nextBalance < 0) throw new Error("Insufficient points balance");
      account.pointsBalance = nextBalance;
      if (type === "EARN") account.lifetimeEarned += Math.max(0, delta);
      if (type === "REDEEM") account.lifetimeRedeemed += Math.abs(delta);
      if (type === "EXPIRE") account.lifetimeExpired += Math.abs(delta);
      await account.save({ session });

      const [transaction] = await PointsTransaction.create([{ shop, shopifyCustomerId, type, points: delta, balanceAfter: nextBalance, source, reason, note, createdBy: createdBy || "system", idempotencyKey, shopifyOrderId, rewardId, metadata: metadata || {} }], { session });
      result = { customer: account, transaction, duplicate: false };
    });
  } finally { await session.endSession(); }
  // MongoDB is authoritative. Shopify is a display mirror, so a Shopify outage must
  // never roll back a valid points transaction. Failed mirrors are logged and the
  // next balance mutation/duplicate delivery retries the current authoritative value.
  await syncCustomerRewardsMirrorBestEffort({shop,shopifyCustomerId,pointsBalance:result.customer.pointsBalance});
  return result;
}

export async function getCustomerLedger({ shop, shopifyCustomerId, limit = 50 }) {
  const customerId = normalizeShopifyCustomerId(shopifyCustomerId);
  const [customer, transactions] = await Promise.all([
    RewardCustomer.findOne({ shop, shopifyCustomerId: customerId }).lean(),
    PointsTransaction.find({ shop, shopifyCustomerId: customerId }).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean(),
  ]);
  return { customer, transactions };
}
