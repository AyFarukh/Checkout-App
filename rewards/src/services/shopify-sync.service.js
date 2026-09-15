import { Reward } from "../models/Reward.js";
import { ShopifySyncJob } from "../models/ShopifySyncJob.js";

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
  await ShopifySyncJob.updateMany({ shop, aggregateId: reward._id, status: "FAILED" }, { $set: { status: "SUPERSEDED" } });
  reward.version += 1;
  reward.shopifySync.status = reward.enabled ? "PENDING" : "DISABLED";
  await reward.save();
  return enqueueRewardSync(reward);
}

function retryDelay(attempt) { return Math.min(10 * 60_000, Math.max(5_000, 5_000 * 3 ** Math.max(0, attempt - 1))); }

async function syncToShopify(reward) {
  // The actual Admin GraphQL mutation is intentionally gated until the deployed
  // Shopify Function/discount owner ID is configured. Never mark a reward synced
  // when Shopify has not accepted its configuration.
  if (!process.env.SHOPIFY_REWARDS_FUNCTION_ID) throw Object.assign(new Error("SHOPIFY_REWARDS_FUNCTION_ID is not configured"), { permanent: true });
  throw Object.assign(new Error("Shopify rewards Function deployment/configuration is required before live sync can be enabled"), { permanent: true });
}

export async function processRewardSyncJobs(limit = 10) {
  const now = new Date();
  const jobs = await ShopifySyncJob.find({ status: "PENDING", nextAttemptAt: { $lte: now } }).sort({ createdAt: 1 }).limit(limit);
  for (const job of jobs) {
    const locked = await ShopifySyncJob.findOneAndUpdate({ _id: job._id, status: "PENDING" }, { $set: { status: "PROCESSING", lockedAt: new Date() }, $inc: { attempts: 1 } }, { new: true });
    if (!locked) continue;
    const reward = await Reward.findById(job.aggregateId);
    if (!reward || Number(reward.version) !== Number(job.aggregateVersion)) { await ShopifySyncJob.updateOne({ _id: job._id }, { $set: { status: "SUPERSEDED", completedAt: new Date() } }); continue; }
    try {
      await Reward.updateOne({ _id: reward._id }, { $set: { "shopifySync.status": "SYNCING", "shopifySync.lastAttemptAt": new Date() } });
      const result = await syncToShopify(reward);
      await Reward.updateOne({ _id: reward._id }, { $set: { "shopifySync.status": reward.enabled ? "SYNCED" : "DISABLED", "shopifySync.syncedVersion": reward.version, "shopifySync.discountId": result?.discountId, "shopifySync.lastSyncedAt": new Date(), "shopifySync.lastError": null } });
      await ShopifySyncJob.updateOne({ _id: job._id }, { $set: { status: "SYNCED", completedAt: new Date(), lastError: null } });
    } catch (error) {
      const permanent = !!error.permanent || locked.attempts >= 5;
      await Reward.updateOne({ _id: reward._id }, { $set: { "shopifySync.status": "FAILED", "shopifySync.lastError": error.message, "shopifySync.lastAttemptAt": new Date() } });
      await ShopifySyncJob.updateOne({ _id: job._id }, { $set: { status: permanent ? "FAILED" : "PENDING", lastError: error.message, nextAttemptAt: new Date(Date.now() + retryDelay(locked.attempts)) } });
    }
  }
}
