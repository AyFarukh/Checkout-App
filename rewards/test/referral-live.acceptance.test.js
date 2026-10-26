import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { ReferralProgram } from "../src/models/ReferralProgram.js";
import { ReferralAccount } from "../src/models/ReferralAccount.js";
import { ReferralClaim } from "../src/models/ReferralClaim.js";
import { ReferralEntitlement } from "../src/models/ReferralEntitlement.js";
import { RewardCustomer } from "../src/models/RewardCustomer.js";
import { PointsTransaction } from "../src/models/PointsTransaction.js";
import { defaultReferralProgram } from "../src/services/referral-program.service.js";
import { referralProfile, claimFriendOffer, reconcileReferralOrder, claimReferralGift } from "../src/services/referral-live.service.js";
import { applyPointsTransaction } from "../src/services/rewards.service.js";

test("live referral lifecycle is isolated, idempotent and refund-safe", { skip: !process.env.MONGODB_URI }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: (process.env.MONGODB_DB_NAME || "ftr_test") + "_referral_live" });
  await Promise.all([ReferralAccount.init(), ReferralClaim.init(), ReferralEntitlement.init(), RewardCustomer.init(), PointsTransaction.init()]);
  const shop = `live-${Date.now()}.myshopify.com`, referrer = "gid://shopify/Customer/100", friend = "gid://shopify/Customer/200";
  const prev = process.env.REFERRALS_FUNCTION_V2_READY; process.env.REFERRALS_FUNCTION_V2_READY = "1";
  const program = defaultReferralProgram(); program.milestones[1].threshold = 2;
  Object.assign(program.milestones[1], { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/12", quantity: 1 });
  program.milestones.push({ id: "bonus", threshold: 4, kind: "POINTS", points: 300, title: "Bonus" });
  let orders = new Map(), firstOrders = new Map(), created = 0;
  const graphql = async (_shop, query, vars) => {
    if (query.includes("ReferralGiftAvailability")) return { node: { id: "gid://shopify/ProductVariant/12", product: { id: "gid://shopify/Product/2", status: "ACTIVE", onlineStoreUrl: `https://${shop}/products/shampoo` } } };
    if (query.includes("ReferralShop")) return { shop: { currencyCode: "USD", primaryDomain: { url: `https://${shop}` } } };
    if (query.includes("ReferralCustomer")) return { customer: { id: vars.id, numberOfOrders: 0 } };
    if (query.includes("ReferralOrder")) return { order: orders.get(vars.id) };
    throw new Error("Unexpected query in test");
  };
  const discountCreator = async input => { created++; return { discountId: `discount-${created}`, code: input.code }; };
  const options = { graphql, discountCreator, mirror: async () => {} };
  async function paid(claim, id, customer = claim.friendId, refund = "0.00") {
    const gid = `gid://shopify/Order/${id}`;
    if (!firstOrders.has(customer)) firstOrders.set(customer, gid);
    orders.set(gid, { id: gid, createdAt: new Date().toISOString(), cancelledAt: null, displayFinancialStatus: refund === "0.00" ? "PAID" : "PARTIALLY_REFUNDED",
      customer: { id: customer, orders: { nodes: [{ id: firstOrders.get(customer) }] } },
      totalPriceSet: { shopMoney: { amount: "100.00" } }, totalRefundedSet: { shopMoney: { amount: refund } }, subtotalPriceSet: { shopMoney: { amount: "90.00" } },
      discountApplications: { nodes: [{ code: claim.discountCode }] } });
    return reconcileReferralOrder({ shop, orderId: gid }, options);
  }
  try {
    await ReferralProgram.create({ ...program, shop, liveEnabled: true });
    const profile = await referralProfile({ shop, customerId: referrer }, options);
    assert.equal(profile.enabled, true); assert.match(profile.shareUrl, /ref=/);
    assert.equal(profile.qualifiedCount, 0);
    await assert.rejects(claimFriendOffer({ shop, customerId: referrer, code: profile.code }, options), { statusCode: 400 });
    const offer = await claimFriendOffer({ shop, customerId: friend, code: profile.code }, options);
    assert.match(offer.discountCode, /^FTR-FRIEND-/);
    assert.equal((await claimFriendOffer({ shop, customerId: friend, code: profile.code }, options)).discountCode, offer.discountCode);
    assert.equal(created, 1);
    await assert.rejects(claimFriendOffer({ shop: "other.myshopify.com", customerId: friend, code: profile.code }, options));
    let claim = await ReferralClaim.findOne({ shop, friendId: friend });
    await paid(claim, 1); await paid(claim, 1);
    assert.equal((await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer })).pointsBalance, 200);
    assert.equal(await PointsTransaction.countDocuments({ shop, source: "SHOPIFY_REFERRAL", type: "EARN" }), 1);
    assert.equal((await referralProfile({ shop, customerId: referrer }, options)).qualifiedCount, 1);
    await claimFriendOffer({ shop, customerId: "gid://shopify/Customer/201", code: profile.code }, options);
    const second = await ReferralClaim.findOne({ shop, friendId: "gid://shopify/Customer/201" });
    await paid(second, 2);
    const gift = await claimReferralGift({ shop, customerId: referrer, milestoneId: "shampoo-bar" }, options);
    assert.equal(gift.variantId, "gid://shopify/ProductVariant/12");
    assert.equal((await claimReferralGift({ shop, customerId: referrer, milestoneId: "shampoo-bar" }, options)).discountCode, gift.discountCode);
    await assert.rejects(claimReferralGift({ shop, customerId: friend, milestoneId: "shampoo-bar" }, options));
    // Partial refunds adjust only once and leave the referral count qualified.
    await paid(claim, 1, friend, "25.00"); await paid(claim, 1, friend, "25.00");
    assert.equal((await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer })).pointsBalance, 350);
    // Spent points cannot make the wallet negative; retain debt for future earnings.
    await RewardCustomer.updateOne({ shop, shopifyCustomerId: referrer }, { $set: { pointsBalance: 0 } });
    await paid(claim, 1, friend, "100.00"); await paid(claim, 1, friend, "100.00");
    const account = await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer });
    assert.equal(account.pointsBalance, 0); assert.equal(account.referralDebt, 150);
    assert.equal((await referralProfile({ shop, customerId: referrer }, options)).qualifiedCount, 1);
    const entitlement = await ReferralEntitlement.findOne({ shop, milestoneId: "shampoo-bar" });
    assert.equal(entitlement.qualified, false); assert.equal(entitlement.syncAction, "DISABLE");
    await assert.rejects(claimReferralGift({ shop, customerId: referrer, milestoneId: "shampoo-bar" }, options));
    // A second order cannot replace the first qualifying order or award again.
    await paid(second, 3); assert.equal(await ReferralClaim.countDocuments({ shop, orderId: "gid://shopify/Order/3" }), 0);
    const tokensBefore = process.env.SHOPIFY_OFFLINE_TOKENS_JSON;
    process.env.SHOPIFY_OFFLINE_TOKENS_JSON = JSON.stringify({ [shop]: "fake-test-token" });
    t.mock.method(globalThis, "fetch", async () => Response.json({ data: { metafieldsSet: { metafields: [], userErrors: [] } } }));
    try {
      await applyPointsTransaction({ shop, shopifyCustomerId: referrer, type: "EARN", points: 100, source: "TEST_PURCHASE", idempotencyKey: "debt-earn-1" });
      let wallet = await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer });
      assert.equal(wallet.pointsBalance, 0); assert.equal(wallet.referralDebt, 50);
      await applyPointsTransaction({ shop, shopifyCustomerId: referrer, type: "EARN", points: 100, source: "TEST_PURCHASE", idempotencyKey: "debt-earn-1" });
      assert.equal((await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer })).referralDebt, 50);
      await applyPointsTransaction({ shop, shopifyCustomerId: referrer, type: "EARN", points: 100, source: "TEST_PURCHASE", idempotencyKey: "debt-earn-2" });
      wallet = await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer });
      assert.equal(wallet.pointsBalance, 50); assert.equal(wallet.referralDebt, 0);
    } finally { if (tokensBefore === undefined) delete process.env.SHOPIFY_OFFLINE_TOKENS_JSON; else process.env.SHOPIFY_OFFLINE_TOKENS_JSON = tokensBefore; }
    await Promise.all([202, 203, 204].map(async number => {
      const customerId = `gid://shopify/Customer/${number}`;
      await claimFriendOffer({ shop, customerId, code: profile.code }, options);
      await paid(await ReferralClaim.findOne({ shop, friendId: customerId }), number);
    }));
    let wallet = await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer });
    assert.equal(wallet.pointsBalance, 950, "concurrent qualifiers award 600 plus the single 300-point milestone");
    assert.equal((await referralProfile({ shop, customerId: referrer }, options)).qualifiedCount, 4);
    assert.equal(await ReferralEntitlement.countDocuments({ shop, milestoneId: "bonus" }), 1);
    await ReferralProgram.updateOne({ shop }, { $push: { milestones: { id: "new-config-bonus", threshold: 2, kind: "POINTS", points: 500, title: "New bonus" } } });
    await referralProfile({ shop, customerId: referrer }, options); await referralProfile({ shop, customerId: referrer }, options);
    wallet = await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer });
    assert.equal(wallet.pointsBalance, 1450, "newly configured milestones reconcile once against existing verified progress");
    await assert.rejects(claimFriendOffer({ shop, customerId: "gid://shopify/Customer/205", code: profile.code }, { ...options,
      graphql: async (_shop, _query, vars) => ({ customer: { id: vars.id, numberOfOrders: 1 } }) }), { statusCode: 409 });
    assert.equal(await ReferralClaim.countDocuments({ shop, friendId: "gid://shopify/Customer/205" }), 0);
    await claimFriendOffer({ shop, customerId: "gid://shopify/Customer/206", code: profile.code }, options);
    await ReferralClaim.updateOne({ shop, friendId: "gid://shopify/Customer/206" }, { $set: { expiresAt: new Date(0) } });
    await assert.rejects(claimFriendOffer({ shop, customerId: "gid://shopify/Customer/206", code: profile.code }, options), { statusCode: 409 });
    await claimFriendOffer({ shop, customerId: "gid://shopify/Customer/207", code: profile.code }, options);
    const late = await ReferralClaim.findOne({ shop, friendId: "gid://shopify/Customer/207" });
    await paid(late, 207, late.friendId, "100.00");
    await paid(late, 207, late.friendId, "0.00");
    assert.equal((await RewardCustomer.findOne({ shop, shopifyCustomerId: referrer })).pointsBalance, 1450, "refund-before-paid and stale paid retries cannot mint points");
    assert.equal(await PointsTransaction.countDocuments({ shop, "metadata.claimId": String(late._id) }), 0);
    orders.set("gid://shopify/Order/300", { id: "gid://shopify/Order/300", customer: { id: referrer }, displayFinancialStatus: "PAID", discountApplications: { nodes: [{ code: gift.discountCode }] } });
    await reconcileReferralOrder({ shop, orderId: "gid://shopify/Order/300" }, options);
    assert.equal((await ReferralEntitlement.findOne({ shop, milestoneId: "shampoo-bar" })).status, "CONSUMED");
    await assert.rejects(claimReferralGift({ shop, customerId: referrer, milestoneId: "shampoo-bar" }, options), { statusCode: 409 });
  } finally {
    for (const model of [ReferralProgram, ReferralAccount, ReferralClaim, ReferralEntitlement, RewardCustomer]) await model.deleteMany({ shop });
    await PointsTransaction.collection.deleteMany({ shop }); await mongoose.disconnect();
    if (prev === undefined) delete process.env.REFERRALS_FUNCTION_V2_READY; else process.env.REFERRALS_FUNCTION_V2_READY = prev;
  }
});
