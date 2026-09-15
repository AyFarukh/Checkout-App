import { Reward } from "../models/Reward.js";
import { ShopifySyncJob } from "../models/ShopifySyncJob.js";
import { assertNoUserErrors, shopifyAdminGraphql, validateShopifyAdminConfiguration } from "./shopify-admin.service.js";

const MAX_ATTEMPTS = Number(process.env.REWARDS_SYNC_MAX_ATTEMPTS || 5);
const LOCK_MS = Number(process.env.REWARDS_SYNC_LOCK_MS || 5 * 60_000);

const CREATE = `mutation RewardDiscountCreate($input: DiscountAutomaticAppInput!) {
  discountAutomaticAppCreate(automaticAppDiscount: $input) {
    automaticAppDiscount { discountId title status appDiscountType { functionId } }
    userErrors { field message }
  }
}`;
const UPDATE = `mutation RewardDiscountUpdate($id: ID!, $input: DiscountAutomaticAppInput!) {
  discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $input) {
    automaticAppDiscount { discountId title status appDiscountType { functionId } }
    userErrors { field message }
  }
}`;
const DEACTIVATE = `mutation RewardDiscountDeactivate($id: ID!) {
  discountAutomaticDeactivate(id: $id) { automaticDiscountNode { id } userErrors { field message } }
}`;

export async function enqueueRewardSync(reward) {
  const version = Number(reward.version || 1);
  await Reward.updateOne({ _id: reward._id }, { $set: { "shopifySync.desiredVersion": version, "shopifySync.status": reward.enabled ? "PENDING" : "DISABLED", "shopifySync.lastError": null } });
  return ShopifySyncJob.findOneAndUpdate(
    { shop: reward.shop, idempotencyKey: `reward:${reward._id}:version:${version}` },
    { $setOnInsert: { shop: reward.shop, type: "REWARD_SYNC", aggregateId: reward._id, aggregateVersion: version, idempotencyKey: `reward:${reward._id}:version:${version}`, status: "PENDING", nextAttemptAt: new Date() } },
    { upsert: true, new: true }
  );
}

export async function retryRewardSync(shop, rewardId) {
  const reward = await Reward.findOne({ _id: rewardId, shop });
  if (!reward) throw Object.assign(new Error("Reward not found"), { statusCode: 404 });
  await ShopifySyncJob.updateMany({ shop, aggregateId: reward._id, status: "FAILED" }, { $set: { status: "SUPERSEDED", completedAt: new Date() } });
  reward.version += 1;
  reward.shopifySync.status = reward.enabled ? "PENDING" : "DISABLED";
  await reward.save();
  return enqueueRewardSync(reward);
}

function retryDelay(attempt) { return Math.min(10 * 60_000, Math.max(5_000, 5_000 * 3 ** Math.max(0, attempt - 1))); }

export function rewardFunctionConfiguration(reward) {
  return {
    schemaVersion: 1,
    rewardId: String(reward._id),
    rewardVersion: Number(reward.version),
    type: reward.type,
    pointsCost: Number(reward.pointsCost),
    discountValue: Number(reward.discountValue || 0),
    minimumSpend: Number(reward.minimumSpend || 0),
    productId: reward.productId || null,
    collectionId: reward.collectionId || null,
  };
}

function automaticDiscountInput(reward, functionId) {
  return {
    title: `FTR Reward: ${reward.name}`,
    functionId,
    startsAt: reward.createdAt || new Date(),
    combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
    metafields: [{ namespace: "freetheroot_rewards", key: "function-configuration", type: "json", value: JSON.stringify(rewardFunctionConfiguration(reward)) }],
  };
}

export async function syncRewardToShopify(reward) {
  const { functionId } = validateShopifyAdminConfiguration(reward.shop);
  const discountId = reward.shopifySync?.discountId;
  if (!reward.enabled) {
    if (!discountId) return { discountId: null, disabled: true };
    const data = await shopifyAdminGraphql(reward.shop, DEACTIVATE, { id: discountId });
    assertNoUserErrors(data?.discountAutomaticDeactivate);
    return { discountId, disabled: true };
  }
  const input = automaticDiscountInput(reward, functionId);
  if (discountId) {
    const data = await shopifyAdminGraphql(reward.shop, UPDATE, { id: discountId, input });
    const payload = assertNoUserErrors(data?.discountAutomaticAppUpdate);
    if (!payload?.automaticAppDiscount?.discountId) throw Object.assign(new Error("Shopify update returned no discount ID"), { retryable: true, code: "SHOPIFY_SYNC_EMPTY_RESPONSE" });
    return { discountId: payload.automaticAppDiscount.discountId, disabled: false };
  }
  const data = await shopifyAdminGraphql(reward.shop, CREATE, { input });
  const payload = assertNoUserErrors(data?.discountAutomaticAppCreate);
  if (!payload?.automaticAppDiscount?.discountId) throw Object.assign(new Error("Shopify create returned no discount ID"), { retryable: true, code: "SHOPIFY_SYNC_EMPTY_RESPONSE" });
  return { discountId: payload.automaticAppDiscount.discountId, disabled: false };
}

async function claimOne() {
  const stale = new Date(Date.now() - LOCK_MS);
  return ShopifySyncJob.findOneAndUpdate(
    { $or: [{ status: "PENDING", nextAttemptAt: { $lte: new Date() } }, { status: "PROCESSING", lockedAt: { $lte: stale } }] },
    { $set: { status: "PROCESSING", lockedAt: new Date() }, $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: 1 } },
  );
}

export async function processRewardSyncJobs(limit = 10) {
  let processed = 0;
  while (processed < limit) {
    const locked = await claimOne();
    if (!locked) break;
    const reward = await Reward.findOne({ _id: locked.aggregateId, shop: locked.shop });
    if (!reward || Number(reward.version) !== Number(locked.aggregateVersion) || Number(reward.shopifySync?.desiredVersion || 0) !== Number(locked.aggregateVersion)) {
      await ShopifySyncJob.updateOne({ _id: locked._id, status: "PROCESSING" }, { $set: { status: "SUPERSEDED", completedAt: new Date() }, $unset: { lockedAt: "" } });
      processed += 1;
      continue;
    }
    try {
      await Reward.updateOne({ _id: reward._id, version: locked.aggregateVersion }, { $set: { "shopifySync.status": "SYNCING", "shopifySync.lastAttemptAt": new Date() } });
      const result = await syncRewardToShopify(reward);
      const current = await Reward.findById(reward._id).lean();
      if (!current || Number(current.version) !== Number(locked.aggregateVersion) || Number(current.shopifySync?.desiredVersion) !== Number(locked.aggregateVersion)) {
        await ShopifySyncJob.updateOne({ _id: locked._id }, { $set: { status: "SUPERSEDED", completedAt: new Date() }, $unset: { lockedAt: "" } });
        processed += 1;
        continue;
      }
      await Reward.updateOne(
        { _id: reward._id, version: locked.aggregateVersion, "shopifySync.desiredVersion": locked.aggregateVersion },
        { $set: { "shopifySync.status": reward.enabled ? "SYNCED" : "DISABLED", "shopifySync.syncedVersion": locked.aggregateVersion, "shopifySync.discountId": result.discountId, "shopifySync.lastSyncedAt": new Date(), "shopifySync.lastError": null } },
      );
      await ShopifySyncJob.updateOne({ _id: locked._id }, { $set: { status: "SYNCED", completedAt: new Date(), lastError: null }, $unset: { lockedAt: "" } });
    } catch (error) {
      const canRetry = error?.permanent !== true && locked.attempts < MAX_ATTEMPTS;
      const current = await Reward.findById(reward._id).lean();
      const stillCurrent = current && Number(current.version) === Number(locked.aggregateVersion) && Number(current.shopifySync?.desiredVersion) === Number(locked.aggregateVersion);
      if (stillCurrent) await Reward.updateOne({ _id: reward._id, version: locked.aggregateVersion }, { $set: { "shopifySync.status": "FAILED", "shopifySync.lastError": String(error.message).slice(0, 4000), "shopifySync.lastAttemptAt": new Date() } });
      await ShopifySyncJob.updateOne({ _id: locked._id }, canRetry
        ? { $set: { status: "PENDING", lastError: String(error.message).slice(0, 4000), nextAttemptAt: new Date(Date.now() + retryDelay(locked.attempts)) }, $unset: { lockedAt: "" } }
        : { $set: { status: stillCurrent ? "FAILED" : "SUPERSEDED", lastError: String(error.message).slice(0, 4000), completedAt: new Date() }, $unset: { lockedAt: "" } });
    }
    processed += 1;
  }
  return processed;
}
