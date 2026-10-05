import test from "node:test";
import assert from "node:assert/strict";
import { subscriptionPortalCapabilities } from "../src/services/loop-subscriptions.service.js";

test("subscription portal starts in read-only mode", () => {
  const capabilities = subscriptionPortalCapabilities();
  assert.equal(capabilities.mode, "read-only");
  assert.equal(capabilities.mutationsEnabled, false);
  assert.ok(Object.values(capabilities.actions).every((enabled) => enabled === false));
});
