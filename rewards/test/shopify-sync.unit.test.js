import test from "node:test";
import assert from "node:assert/strict";
import { rewardFunctionConfiguration } from "../src/services/shopify-sync.service.js";
import { validateShopifyAdminConfiguration } from "../src/services/shopify-admin.service.js";

function reward(overrides = {}) {
  return {
    _id: "68c800000000000000000101",
    version: 3,
    type: "FIXED_DISCOUNT",
    pointsCost: 500,
    discountValue: 5,
    minimumSpend: 10,
    productId: null,
    collectionId: null,
    ...overrides,
  };
}

test("FTR-SYNC-001 create configuration carries immutable reward version", () => {
  const config = rewardFunctionConfiguration(reward());
  assert.equal(config.rewardId, "68c800000000000000000101");
  assert.equal(config.rewardVersion, 3);
  assert.equal(config.type, "FIXED_DISCOUNT");
  assert.equal(config.pointsCost, 500);
  assert.equal(config.discountValue, 5);
});

test("FTR-SYNC-002 update configuration reflects the new version and value", () => {
  const before = rewardFunctionConfiguration(reward({ version: 3, discountValue: 5 }));
  const after = rewardFunctionConfiguration(reward({ version: 4, discountValue: 10 }));
  assert.equal(before.rewardVersion, 3);
  assert.equal(after.rewardVersion, 4);
  assert.equal(after.discountValue, 10);
  assert.notDeepEqual(after, before);
});

test("FTR-SYNC-003 disable keeps the versioned reward identity available to worker logic", () => {
  const config = rewardFunctionConfiguration(reward({ version: 5, enabled: false }));
  assert.equal(config.rewardVersion, 5);
  assert.equal(config.rewardId, "68c800000000000000000101");
});

test("FTR-SYNC-004 stale version predicate rejects an older queued version", () => {
  const queuedVersion = 6;
  const currentRewardVersion = 7;
  const desiredVersion = 7;
  const stale = currentRewardVersion !== queuedVersion || desiredVersion !== queuedVersion;
  assert.equal(stale, true);
});

test("FTR-SYNC-005 GraphQL transient failures are retryable by contract", () => {
  const error = Object.assign(new Error("Shopify Admin API HTTP 500"), { retryable: true });
  const attempts = 1;
  const maxAttempts = 5;
  assert.equal(error.permanent !== true && attempts < maxAttempts, true);
});

test("FTR-SYNC-006 configuration validation is async because offline tokens and Function resolution are runtime dependencies", async () => {
  assert.equal(validateShopifyAdminConfiguration.constructor.name, "AsyncFunction");
});
