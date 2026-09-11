import mongoose from "mongoose";
import { RewardCustomer } from "../models/RewardCustomer.js";
import { PointsTransaction } from "../models/PointsTransaction.js";

function normalizeDelta(type, points) {
  const absolute = Math.abs(Number(points));
  if (!Number.isFinite(absolute) || absolute <= 0) {
    throw new Error("Points must be a positive number");
  }

  return ["REDEEM", "REFUND", "EXPIRE"].includes(type) ? -absolute : absolute;
}

export async function ensureRewardCustomer({ shop, shopifyCustomerId, email, firstName, lastName }) {
  return RewardCustomer.findOneAndUpdate(
    { shop, shopifyCustomerId },
    {
      $setOnInsert: { shop, shopifyCustomerId },
      $set: {
        ...(email ? { email } : {}),
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
      },
    },
    { upsert: true, new: true }
  );
}

export async function applyPointsTransaction(input) {
  const {
    shop,
    shopifyCustomerId,
    type,
    points,
    source,
    reason,
    note,
    createdBy,
    idempotencyKey,
    shopifyOrderId,
    rewardId,
    metadata,
    customer = {},
  } = input;

  if (!shop || !shopifyCustomerId || !type || !source) {
    throw new Error("shop, shopifyCustomerId, type and source are required");
  }

  if (idempotencyKey) {
    const existing = await PointsTransaction.findOne({ shop, idempotencyKey });
    if (existing) return { customer: await RewardCustomer.findOne({ shop, shopifyCustomerId }), transaction: existing, duplicate: true };
  }

  const delta = normalizeDelta(type, points);
  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      let account = await RewardCustomer.findOne({ shop, shopifyCustomerId }).session(session);

      if (!account) {
        [account] = await RewardCustomer.create(
          [{ shop, shopifyCustomerId, ...customer }],
          { session }
        );
      }

      const nextBalance = account.pointsBalance + delta;
      if (nextBalance < 0) throw new Error("Insufficient points balance");

      account.pointsBalance = nextBalance;
      if (delta > 0 && ["EARN", "ADJUST", "REVERSAL"].includes(type)) account.lifetimeEarned += delta;
      if (type === "REDEEM") account.lifetimeRedeemed += Math.abs(delta);
      if (type === "EXPIRE") account.lifetimeExpired += Math.abs(delta);
      await account.save({ session });

      const [transaction] = await PointsTransaction.create(
        [
          {
            shop,
            shopifyCustomerId,
            type,
            points: delta,
            balanceAfter: nextBalance,
            source,
            reason,
            note,
            createdBy: createdBy || "system",
            idempotencyKey,
            shopifyOrderId,
            rewardId,
            metadata: metadata || {},
          },
        ],
        { session }
      );

      result = { customer: account, transaction, duplicate: false };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

export async function getCustomerLedger({ shop, shopifyCustomerId, limit = 50 }) {
  const [customer, transactions] = await Promise.all([
    RewardCustomer.findOne({ shop, shopifyCustomerId }).lean(),
    PointsTransaction.find({ shop, shopifyCustomerId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 200))
      .lean(),
  ]);

  return { customer, transactions };
}
