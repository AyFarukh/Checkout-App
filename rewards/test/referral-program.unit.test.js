import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReferralProgram, defaultReferralProgram } from "../src/services/referral-program.service.js";

test("the first milestone represents the single 200-point referral award", () => {
  const program = normalizeReferralProgram(defaultReferralProgram());
  assert.equal(program.referrerPoints, 200);
  assert.equal(program.friendDiscountAmount, 10);
  assert.deepEqual(program.milestones.map(m => [m.threshold, m.kind]), [[1, "REFERRAL_POINTS"], [3, "PRODUCT"], [5, "PRODUCT"], [10, "PRODUCT"]]);
  assert.equal(program.milestones[0].points, 0, "first milestone must not pay a second bonus");
});
test("draft milestones may have no product and support additional thresholds", () => {
  const draft = defaultReferralProgram();
  draft.milestones.push({ id: "extra", threshold: 20, title: "VIP gift", kind: "PRODUCT", variantId: null });
  const result = normalizeReferralProgram(draft);
  assert.equal(result.milestones.length, 5);
  assert.equal(result.milestones[4].variantId, null);
});
test("separate point milestones have a positive explicit amount", () => {
  const draft = defaultReferralProgram();
  draft.milestones.push({ id: "extra-points", threshold: 7, title: "Loyal advocate", kind: "POINTS", points: 350 });
  assert.equal(normalizeReferralProgram(draft).milestones.find(m => m.id === "extra-points").points, 350);
  draft.milestones[4].points = 0;
  assert.throws(() => normalizeReferralProgram(draft), { statusCode: 400 });
});
test("thresholds are unique safe positive integers and gift quantities are bounded", () => {
  for (const value of [0, -1, 1.5, Infinity, 3]) {
    const draft = defaultReferralProgram();
    draft.milestones.push({ id: "bad", threshold: value, title: "Invalid", kind: "PRODUCT" });
    assert.throws(() => normalizeReferralProgram(draft), { statusCode: 400 });
  }
  const draft = defaultReferralProgram(); draft.milestones[1].quantity = 99999;
  assert.throws(() => normalizeReferralProgram(draft), { statusCode: 400 });
});
test("only a single base-award row may exist at the first referral", () => {
  const draft = defaultReferralProgram();
  draft.milestones[1].kind = "REFERRAL_POINTS";
  assert.throws(() => normalizeReferralProgram(draft), { statusCode: 400 });
});
test("product mapping requires matching Shopify product and variant identifiers", () => {
  const draft = defaultReferralProgram();
  draft.milestones[1].variantId = "gid://shopify/ProductVariant/12";
  assert.throws(() => normalizeReferralProgram(draft), { statusCode: 400 });
  draft.milestones[1].productId = "gid://shopify/Product/2";
  assert.equal(normalizeReferralProgram(draft).milestones[1].variantId, "gid://shopify/ProductVariant/12");
  draft.milestones[1].variantId = "https://other-store.example";
  assert.throws(() => normalizeReferralProgram(draft), { statusCode: 400 });
});
test("milestone ids must be unique and configuration ignores tenant/control fields", () => {
  const draft = { ...defaultReferralProgram(), shop: "attacker.myshopify.com", enabled: true };
  assert.equal(normalizeReferralProgram(draft).shop, undefined);
  assert.equal(normalizeReferralProgram(draft).enabled, undefined);
  draft.milestones[1].id = draft.milestones[0].id;
  assert.throws(() => normalizeReferralProgram(draft), { statusCode: 400 });
});
