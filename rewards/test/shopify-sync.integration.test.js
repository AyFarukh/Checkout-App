import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Reward } from "../src/models/Reward.js";
import { ShopifySyncJob } from "../src/models/ShopifySyncJob.js";
import { enqueueRewardSync, processRewardSyncJobs } from "../src/services/shopify-sync.service.js";
import { shopifyAdminGraphql, validateShopifyAdminConfiguration } from "../src/services/shopify-admin.service.js";

const SHOP = String(process.env.SHOPIFY_SYNC_INTEGRATION_SHOP || "").trim().toLowerCase();
const MONGO = process.env.MONGODB_URI;
const DB = process.env.MONGODB_DB_NAME || "freetheroot_rewards_shopify_integration";
const RUN = process.env.SHOPIFY_SYNC_INTEGRATION === "1";
const PREFIX = `FTR integration ${Date.now()}`;

function requireEnv(name, value) { if (!value) throw new Error(`${name} is required`); return value; }
async function drain() { for (let i = 0; i < 10; i += 1) { await processRewardSyncJobs(20); if (!(await ShopifySyncJob.exists({ shop: SHOP, status: "PENDING", nextAttemptAt: { $lte: new Date() } }))) break; } }
async function reload(id) { return Reward.findById(id).lean(); }

async function queryDiscount(id) {
  if (!id) return null;
  const data = await shopifyAdminGraphql(SHOP, `query FtrDiscount($id: ID!) { automaticDiscountNode(id: $id) { id automaticDiscount { ... on DiscountAutomaticApp { title status startsAt endsAt appDiscountType { functionId } metafield(namespace: "freetheroot_rewards", key: "configuration") { value } } } } }`, { id });
  return data?.automaticDiscountNode?.automaticDiscount || null;
}

async function cleanupDiscount(id) {
  if (!id) return;
  const data = await shopifyAdminGraphql(SHOP, `mutation FtrCleanup($id: ID!) { discountAutomaticDelete(id: $id) { deletedAutomaticDiscountId userErrors { field message } } }`, { id });
  const result = data?.discountAutomaticDelete;
  if (result?.userErrors?.length) throw new Error(`Shopify cleanup failed: ${result.userErrors.map((e) => e.message).join("; ")}`);
  assert.equal(result?.deletedAutomaticDiscountId, id, `Shopify must confirm deletion of ${id}`);
}

async function assertRemoteDiscountRemoved(id) {
  if (!id) return;
  const remote = await queryDiscount(id);
  assert.equal(remote, null, `test-created Shopify discount ${id} must be removed`);
}

async function assertMongoFixturesRemoved(rewardIds) {
  const ids = [...rewardIds];
  const [namedRewards, rewardsById, jobsByAggregate] = await Promise.all([
    Reward.countDocuments({ shop: SHOP, name: { $regex: `^${PREFIX}` } }),
    ids.length ? Reward.countDocuments({ _id: { $in: ids } }) : 0,
    ids.length ? ShopifySyncJob.countDocuments({ shop: SHOP, aggregateId: { $in: ids } }) : 0,
  ]);
  assert.equal(namedRewards, 0, "all integration Reward fixtures must be removed");
  assert.equal(rewardsById, 0, "all tracked integration Reward IDs must be removed");
  assert.equal(jobsByAggregate, 0, "all integration ShopifySyncJob fixtures must be removed");
}

if (!RUN) {
  test("FTR-SYNC-INT integration harness is opt-in", { skip: "Set SHOPIFY_SYNC_INTEGRATION=1 to run against a Shopify development store" }, () => {});
} else {
  test("live Reward-to-Shopify synchronization", async (t) => {
    requireEnv("SHOPIFY_SYNC_INTEGRATION_SHOP", SHOP);
    requireEnv("MONGODB_URI", MONGO);
    requireEnv("SHOPIFY_REWARDS_FUNCTION_ID", process.env.SHOPIFY_REWARDS_FUNCTION_ID);
    validateShopifyAdminConfiguration(SHOP);
    await mongoose.connect(MONGO, { dbName: DB, serverSelectionTimeoutMS: 10000 });
    await Promise.all([Reward.deleteMany({ shop: SHOP, name: { $regex: `^${PREFIX}` } }), ShopifySyncJob.deleteMany({ shop: SHOP })]);

    const discountIds = new Set();
    const rewardIds = new Set();
    let discountId;
    let testFailure;

    try {
      await t.test("FTR-SYNC-INT-001 create", async () => {
        const reward = await Reward.create({ shop: SHOP, name: `${PREFIX} create`, type: "FIXED_DISCOUNT", enabled: true, pointsCost: 500, discountValue: 5, minimumSpend: 0, version: 1, shopifySync: { desiredVersion: 1, syncedVersion: 0, status: "PENDING" } });
        rewardIds.add(reward._id);
        await enqueueRewardSync(reward); await drain();
        const current = await reload(reward._id);
        assert.equal(current.shopifySync.status, "SYNCED"); assert.equal(current.shopifySync.syncedVersion, 1); assert.ok(current.shopifySync.discountId);
        discountId = current.shopifySync.discountId; discountIds.add(discountId);
        const remote = await queryDiscount(discountId); assert.ok(remote); assert.equal(remote.status, "ACTIVE");
        const config = JSON.parse(remote.metafield.value); assert.equal(config.rewardId, String(reward._id)); assert.equal(config.rewardVersion, 1); assert.equal(config.discountValue, 5);
      });

      await t.test("FTR-SYNC-INT-002 update", async () => {
        const reward = await Reward.findOne({ shop: SHOP, "shopifySync.discountId": discountId });
        reward.discountValue = 10; reward.version += 1; await reward.save(); await enqueueRewardSync(reward); await drain();
        const current = await reload(reward._id); assert.equal(current.shopifySync.syncedVersion, 2); assert.equal(current.shopifySync.discountId, discountId);
        const config = JSON.parse((await queryDiscount(discountId)).metafield.value); assert.equal(config.rewardVersion, 2); assert.equal(config.discountValue, 10);
      });

      await t.test("FTR-SYNC-INT-003 stale version is superseded without remote overwrite", async () => {
        const reward = await Reward.findOne({ shop: SHOP, "shopifySync.discountId": discountId });
        const staleVersion = reward.version + 1;
        await ShopifySyncJob.create({ shop: SHOP, type: "REWARD_SYNC", aggregateId: reward._id, aggregateVersion: staleVersion, idempotencyKey: `integration-stale:${reward._id}:${staleVersion}`, status: "PENDING", nextAttemptAt: new Date() });
        reward.version = staleVersion + 1; reward.discountValue = 15; reward.shopifySync.desiredVersion = reward.version; await reward.save();
        await processRewardSyncJobs(20);
        const stale = await ShopifySyncJob.findOne({ idempotencyKey: `integration-stale:${reward._id}:${staleVersion}` }).lean(); assert.equal(stale.status, "SUPERSEDED");
        const remoteConfig = JSON.parse((await queryDiscount(discountId)).metafield.value); assert.equal(remoteConfig.rewardVersion, 2);
        await enqueueRewardSync(await Reward.findById(reward._id)); await drain();
        assert.equal((await reload(reward._id)).shopifySync.syncedVersion, staleVersion + 1);
      });

      await t.test("FTR-SYNC-INT-004 disable", async () => {
        const reward = await Reward.findOne({ shop: SHOP, "shopifySync.discountId": discountId }); reward.enabled = false; reward.version += 1; await reward.save(); await enqueueRewardSync(reward); await drain();
        const current = await reload(reward._id); assert.equal(current.shopifySync.status, "DISABLED"); assert.equal(current.shopifySync.syncedVersion, reward.version);
        const remote = await queryDiscount(discountId); assert.ok(["EXPIRED", "SCHEDULED", "ACTIVE"].includes(remote.status)); assert.ok(remote.endsAt, "deactivated discount must have endsAt");
      });

      await t.test("FTR-SYNC-INT-005 GraphQL failure is retained and recoverable", async () => {
        const reward = await Reward.create({ shop: SHOP, name: `${PREFIX} failure`, type: "FIXED_DISCOUNT", enabled: true, pointsCost: 700, discountValue: 7, version: 1, shopifySync: { desiredVersion: 1, syncedVersion: 0, status: "PENDING" } });
        rewardIds.add(reward._id);
        const original = process.env.SHOPIFY_REWARDS_FUNCTION_ID;
        try {
          process.env.SHOPIFY_REWARDS_FUNCTION_ID = "00000000-0000-0000-0000-000000000000";
          await enqueueRewardSync(reward); await processRewardSyncJobs(20);
          let failed = await reload(reward._id); assert.notEqual(failed.shopifySync.status, "SYNCED"); assert.ok(failed.shopifySync.lastError);
          process.env.SHOPIFY_REWARDS_FUNCTION_ID = original;
          await ShopifySyncJob.updateMany({ shop: SHOP, aggregateId: reward._id, status: { $in: ["PENDING", "FAILED"] } }, { $set: { status: "PENDING", nextAttemptAt: new Date() } });
          await drain(); failed = await reload(reward._id); assert.equal(failed.shopifySync.status, "SYNCED"); assert.equal(failed.shopifySync.syncedVersion, 1);
          assert.ok(failed.shopifySync.discountId); discountIds.add(failed.shopifySync.discountId);
        } finally {
          process.env.SHOPIFY_REWARDS_FUNCTION_ID = original;
        }
      });
    } catch (error) {
      testFailure = error;
    } finally {
      const cleanupErrors = [];
      for (const id of discountIds) {
        try { await cleanupDiscount(id); } catch (error) { cleanupErrors.push(error); }
      }
      try {
        await Promise.all([
          Reward.deleteMany({ shop: SHOP, name: { $regex: `^${PREFIX}` } }),
          ShopifySyncJob.deleteMany({ shop: SHOP, aggregateId: { $in: [...rewardIds] } }),
        ]);
      } catch (error) { cleanupErrors.push(error); }

      for (const id of discountIds) {
        try { await assertRemoteDiscountRemoved(id); } catch (error) { cleanupErrors.push(error); }
      }
      try { await assertMongoFixturesRemoved(rewardIds); } catch (error) { cleanupErrors.push(error); }
      await mongoose.disconnect();

      if (cleanupErrors.length) {
        const cleanupError = new AggregateError(cleanupErrors, `Integration cleanup verification failed (${cleanupErrors.length} assertion/error${cleanupErrors.length === 1 ? "" : "s"})`);
        if (testFailure) throw new AggregateError([testFailure, cleanupError], "Integration test and cleanup verification both failed");
        throw cleanupError;
      }
      if (testFailure) throw testFailure;
    }
  });
}
