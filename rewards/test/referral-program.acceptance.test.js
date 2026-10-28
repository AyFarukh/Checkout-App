import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import { SignJWT } from "jose";
import { adminApi } from "../src/routes/adminApi.js";
import { errorHandler, requestId } from "../src/middleware/errorHandler.js";
import { ReferralProgram } from "../src/models/ReferralProgram.js";
import { AdminAuditLog } from "../src/models/AdminAuditLog.js";

test("referral configuration is authenticated, tenant-scoped, product-validated and versioned", { skip: !process.env.MONGODB_URI }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || undefined });
  await Promise.all([ReferralProgram.init(), AdminAuditLog.init()]);
  const suffix = Date.now(), shopA = `referral-a-${suffix}.myshopify.com`, shopB = `referral-b-${suffix}.myshopify.com`;
  const previous = { ...process.env };
  process.env.SHOPIFY_API_KEY = "referral-test-key"; process.env.SHOPIFY_API_SECRET = "referral-test-secret";
  process.env.SHOPIFY_OFFLINE_TOKENS_JSON = JSON.stringify({ [shopA]: "test-only-a", [shopB]: "test-only-b" });
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, options) => {
    if (!String(url).includes(".myshopify.com/")) return nativeFetch(url, options);
    assert.equal(new URL(url).hostname, shopA);
    assert.equal(options.headers["X-Shopify-Access-Token"], "test-only-a");
    return Promise.resolve(Response.json({ data: { nodes: [{ id: "gid://shopify/ProductVariant/12", title: "Default Title", product: { id: "gid://shopify/Product/2", title: "Verified Shampoo", status: "ACTIVE" } }] } }));
  });
  const app = express(); app.use(express.json(), requestId); app.use("/api/admin", adminApi); app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/referrals`;
  async function token(shop) {
    return new SignJWT({ dest: `https://${shop}`, sub: "referral-test-admin" }).setProtectedHeader({ alg: "HS256" }).setIssuer(`https://${shop}/admin`).setAudience("referral-test-key").setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode("referral-test-secret"));
  }
  async function request(shop, method = "GET", body) {
    const response = await fetch(base, { method, headers: { ...(shop ? { Authorization: `Bearer ${await token(shop)}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  try {
    assert.equal((await request(null)).status, 401);
    const defaults = (await request(shopA)).body.program;
    assert.equal(defaults.referrerPoints, 200);
    const draft = await request(shopA, "PUT", { ...defaults, shop: shopB, enabled: true });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.program.shop, shopA);
    assert.equal(draft.body.status, "DRAFT");
    assert.equal(draft.body.program.enabled, undefined);
    assert.equal(draft.body.program.milestones[1].variantId, null);
    assert.equal((await request(shopB)).body.program.revision, 0);
    assert.equal(await ReferralProgram.countDocuments({ shop: shopB }), 0);
    assert.equal((await request(shopA, "PUT", defaults)).status, 409);
    const current = draft.body.program;
    current.milestones.push({ id: "new-milestone", threshold: 20, kind: "POINTS", title: "Extra bonus", points: 500 });
    Object.assign(current.milestones[1], { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/12", productTitle: "untrusted title" });
    const mapped = await request(shopA, "PUT", current);
    assert.equal(mapped.status, 200);
    assert.equal(mapped.body.program.milestones.length, 5);
    assert.equal(mapped.body.program.milestones[1].productTitle, "Verified Shampoo");
    assert.equal(mapped.body.program.milestones[0].points, 0);
    const bad = mapped.body.program;
    bad.milestones[1].productId = "gid://shopify/Product/999";
    assert.equal((await request(shopA, "PUT", bad)).status, 400);
    assert.equal(await AdminAuditLog.countDocuments({ shop: shopA, action: "REFERRAL_PROGRAM_UPDATED" }), 2);
    assert.equal((await ReferralProgram.findOne({ shop: shopA })).revision, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await ReferralProgram.deleteMany({ shop: { $in: [shopA, shopB] } });
    await AdminAuditLog.collection.deleteMany({ shop: { $in: [shopA, shopB] } });
    await mongoose.disconnect(); process.env = previous;
  }
});
