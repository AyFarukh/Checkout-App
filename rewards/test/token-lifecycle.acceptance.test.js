import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { ShopifyOfflineToken } from "../src/models/ShopifyOfflineToken.js";
import { exchangeOfflineToken, storedOfflineTokenForShop, revokeOfflineTokenForShop, migrateOfflineTokenRecord } from "../src/services/shopify-token.service.js";

test("encrypted credentials, migration, uninstall isolation, delayed delivery and in-flight exchange", { skip: !process.env.MONGODB_URI }, async t => {
  await mongoose.connect(process.env.MONGODB_URI);
  await ShopifyOfflineToken.init();
  const shop = `lifecycle-${Date.now()}.myshopify.com`, other = `other-${Date.now()}.myshopify.com`;
  const previous = { ...process.env };
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.SHOPIFY_API_KEY = "test-key"; process.env.SHOPIFY_API_SECRET = "test-secret";
  t.mock.method(globalThis, "fetch", async url => url.endsWith("graphql.json") ? Response.json({}, { status: 401 }) : Response.json({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 }));
  try {
    await exchangeOfflineToken({ shop, idToken: "test-id" });
    let raw = await ShopifyOfflineToken.collection.findOne({ shop });
    assert.match(raw.accessToken, /^enc:v1:/);
    assert.match(raw.refreshToken, /^enc:v1:/);
    assert.equal(await storedOfflineTokenForShop(shop), "test-access");

    await ShopifyOfflineToken.collection.updateOne({ shop }, { $set: { accessToken: "legacy-access", refreshToken: "legacy-refresh" } });
    assert.equal(await storedOfflineTokenForShop(shop), "legacy-access");
    raw = await ShopifyOfflineToken.collection.findOne({ shop });
    assert.match(raw.accessToken, /^enc:v1:/);
    assert.match(raw.refreshToken, /^enc:v1:/);

    await ShopifyOfflineToken.create({ shop: other, accessToken: "other-access" });
    const eventAt = new Date(Date.now() + 1);
    await revokeOfflineTokenForShop(shop, eventAt);
    await revokeOfflineTokenForShop(shop, eventAt);
    await assert.rejects(storedOfflineTokenForShop(shop), { code: "SHOPIFY_REAUTH_REQUIRED" });
    raw = await ShopifyOfflineToken.collection.findOne({ shop });
    assert.equal(raw.accessToken, null); assert.equal(raw.refreshToken, null);
    assert.equal(await ShopifyOfflineToken.countDocuments({ shop }), 1);
    assert.equal((await ShopifyOfflineToken.findOne({ shop: other })).accessToken, "other-access");

    // A newly authorized installation survives the old uninstall event.
    await ShopifyOfflineToken.updateOne({ shop }, { $set: { acquiredAt: new Date(eventAt.getTime() + 1000), uninstalledAt: null, accessToken: "new-install" } });
    await revokeOfflineTokenForShop(shop, eventAt);
    assert.equal(await storedOfflineTokenForShop(shop), "new-install");

    // A captured signed body with a forged recent header cannot clear active auth.
    t.mock.method(globalThis, "fetch", async () => Response.json({ data: { shop: { id: "active-shop" } } }));
    await revokeOfflineTokenForShop(shop, new Date(Date.now() + 2000));
    assert.equal((await ShopifyOfflineToken.findOne({ shop })).accessToken.startsWith("enc:v1:"), true);

    // Encryption migration during refresh must not invalidate its write guard.
    await ShopifyOfflineToken.updateOne({ shop }, { $set: { accessToken: "legacy", refreshToken: "legacy-refresh", accessTokenExpiresAt: new Date(0), acquiredAt: new Date(0), uninstalledAt: null } });
    t.mock.method(globalThis, "fetch", async () => {
      await migrateOfflineTokenRecord(await ShopifyOfflineToken.findOne({ shop }));
      return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 });
    });
    assert.equal(await storedOfflineTokenForShop(shop), "rotated-access");

    // The exchange started before uninstall but completes after it.
    await ShopifyOfflineToken.updateOne({ shop }, { $set: { acquiredAt: new Date(0) } });
    t.mock.method(globalThis, "fetch", async url => {
      if (url.endsWith("graphql.json")) return Response.json({}, { status: 401 });
      await revokeOfflineTokenForShop(shop, new Date(Date.now() + 1));
      return Response.json({ access_token: "must-not-resurrect", refresh_token: "no", expires_in: 3600 });
    });
    await assert.rejects(exchangeOfflineToken({ shop, idToken: "test-id" }), { code: "SHOPIFY_REAUTH_REQUIRED" });
    assert.equal((await ShopifyOfflineToken.findOne({ shop })).accessToken, null);
  } finally {
    await ShopifyOfflineToken.deleteMany({ shop: { $in: [shop, other] } });
    await mongoose.disconnect(); process.env = previous;
  }
});
