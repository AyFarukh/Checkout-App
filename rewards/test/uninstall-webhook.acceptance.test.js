import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import { webhookRouter } from "../src/routes/webhooks.js";
import { ShopifyOfflineToken } from "../src/models/ShopifyOfflineToken.js";

test("uninstall webhook authenticates body and removes only the matching installation", { skip: !process.env.MONGODB_URI }, async t => {
  await mongoose.connect(process.env.MONGODB_URI);
  const secretBefore = process.env.SHOPIFY_API_SECRET;
  process.env.SHOPIFY_API_SECRET = "uninstall-test-secret";
  const originalFetch = globalThis.fetch;
  let active = false;
  t.mock.method(globalThis, "fetch", (url, options) => String(url).includes(".myshopify.com/")
    ? Promise.resolve(active ? Response.json({ data: { shop: { id: "active-test-shop" } } }) : Response.json({}, { status: 401 })) : originalFetch(url, options));
  const keyBefore = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  const shop = `uninstall-${Date.now()}.myshopify.com`;
  const app = express(); app.use(express.raw({ type: "application/json" }), webhookRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const body = JSON.stringify({ myshopify_domain: shop });
  const signature = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(body).digest("base64");
  const send = headers => fetch(`http://127.0.0.1:${server.address().port}/app-uninstalled`, {
    method: "POST", body,
    headers: { "Content-Type": "application/json", "X-Shopify-Hmac-Sha256": signature,
      "X-Shopify-Shop-Domain": shop, "X-Shopify-Topic": "app/uninstalled",
      "X-Shopify-Triggered-At": new Date().toISOString(), ...headers },
  });
  try {
    await ShopifyOfflineToken.create({ shop, accessToken: "test-only", acquiredAt: new Date(0) });
    assert.equal((await send({ "X-Shopify-Hmac-Sha256": "invalid" })).status, 401);
    assert.equal((await send({ "X-Shopify-Shop-Domain": "someone-else.myshopify.com" })).status, 400);
    assert.equal((await send({ "X-Shopify-Triggered-At": "invalid" })).status, 400);
    assert.equal((await ShopifyOfflineToken.findOne({ shop })).accessToken, "test-only");
    assert.equal((await send({})).status, 200);
    assert.equal((await send({})).status, 200);
    assert.equal((await ShopifyOfflineToken.findOne({ shop })).accessToken, null);
    await ShopifyOfflineToken.updateOne({ shop }, { $set: { accessToken: "new-install-token", acquiredAt: new Date(), uninstalledAt: null } });
    active = true;
    // Replay the identical signed body with a later unsigned timestamp.
    assert.equal((await send({ "X-Shopify-Triggered-At": new Date(Date.now() + 1000).toISOString() })).status, 200);
    assert.notEqual((await ShopifyOfflineToken.findOne({ shop })).accessToken, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await ShopifyOfflineToken.deleteMany({ shop }); await mongoose.disconnect();
    if (secretBefore === undefined) delete process.env.SHOPIFY_API_SECRET; else process.env.SHOPIFY_API_SECRET = secretBefore;
    if (keyBefore === undefined) delete process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY; else process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = keyBefore;
  }
});
