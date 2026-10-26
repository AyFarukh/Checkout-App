import test from "node:test";
import assert from "node:assert/strict";
import { ShopifyOfflineToken } from "../src/models/ShopifyOfflineToken.js";
import { ensureOfflineTokenForAdminSession, storedOfflineTokenForShop } from "../src/services/shopify-token.service.js";
import { shopifyAdminGraphql } from "../src/services/shopify-admin.service.js";
import { decryptToken } from "../src/services/token-encryption.service.js";

const shop = "reinstalled.myshopify.com";
function setup(t, record) {
  t.mock.method(ShopifyOfflineToken, "findOne", async filter => filter.shop === shop ? record : null);
  t.mock.method(ShopifyOfflineToken, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.shop, shop);
    Object.assign(record, update.$set);
    return record;
  });
  t.mock.method(ShopifyOfflineToken, "updateOne", async () => ({ modifiedCount: 1 }));
  const previous = { ...process.env };
  process.env.SHOPIFY_API_KEY = "test-client";
  process.env.SHOPIFY_API_SECRET = "test-secret";
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  delete process.env.SHOPIFY_OFFLINE_TOKENS_JSON;
  delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  delete process.env.SHOPIFY_ADMIN_SHOP;
  t.after(() => { process.env = previous; });
  return record;
}

for (const expired of [true, false]) {
  test(`fresh admin session replaces ${expired ? "expired" : "apparently valid but revoked"} reinstall credentials`, async t => {
    const record = setup(t, { shop, accessToken: "revoked", refreshToken: "revoked-refresh", accessTokenExpiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)) });
    t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(url, `https://${shop}/admin/oauth/access_token`);
      const params = options.body;
      if (params.get("grant_type") === "refresh_token") return new Response("{}", { status: 401 });
      assert.equal(params.get("subject_token"), "fresh-admin-id-token");
      assert.equal(params.get("requested_token_type"), "urn:shopify:params:oauth:token-type:offline-access-token");
      assert.equal(params.get("expiring"), "1");
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, refresh_token_expires_in: 7776000, scope: "write_discounts" });
    });
    await ensureOfflineTokenForAdminSession({ shop, idToken: "fresh-admin-id-token" });
    assert.equal(await storedOfflineTokenForShop(shop), "new-access");
    assert.equal(decryptToken(record.refreshToken, shop, "refresh"), "new-refresh");
  });
}

test("bootstrap requires an admin ID token even with a stored access token", async t => {
  setup(t, { shop, accessToken: "old-access" });
  await assert.rejects(ensureOfflineTokenForAdminSession({ shop }), { code: "SHOPIFY_ID_TOKEN_REQUIRED" });
});

test("missing encryption key fails before Shopify retires any existing token", async t => {
  setup(t, { shop, accessToken: "existing" });
  delete process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
  t.mock.method(globalThis, "fetch", async () => assert.fail("must validate encryption before token exchange"));
  await assert.rejects(ensureOfflineTokenForAdminSession({ shop, idToken: "fresh-admin-id-token" }), { code: "SHOPIFY_TOKEN_KEY_INVALID" });
});

test("rejected refresh tells redemption callers to reopen the app without leaking Shopify response", async t => {
  setup(t, { shop, accessToken: "old", refreshToken: "revoked", accessTokenExpiresAt: new Date(0) });
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_description: "sensitive-provider-detail" }, { status: 401 }));
  await assert.rejects(storedOfflineTokenForShop(shop), error => {
    assert.equal(error.code, "SHOPIFY_REAUTH_REQUIRED");
    assert.equal(error.statusCode, 409);
    assert.doesNotMatch(error.message, /sensitive-provider-detail/);
    return true;
  });
});

test("transient refresh failures do not become permanent reauthorization errors", async t => {
  setup(t, { shop, accessToken: "old", refreshToken: "refresh", accessTokenExpiresAt: new Date(0) });
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 503 }));
  await assert.rejects(storedOfflineTokenForShop(shop), { code: "SHOPIFY_TOKEN_EXCHANGE_FAILED", permanent: false });
});

test("normal background refresh persists the replacement pair", async t => {
  const record = setup(t, { shop, accessToken: "old", refreshToken: "refresh", accessTokenExpiresAt: new Date(0) });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.body.get("grant_type"), "refresh_token");
    return Response.json({ access_token: "renewed", refresh_token: "rotated", expires_in: 3600 });
  });
  assert.equal(await storedOfflineTokenForShop(shop), "renewed");
  assert.equal(decryptToken(record.refreshToken, shop, "refresh"), "rotated");
});

test("expired refresh credentials require reauthorization without a network request", async t => {
  setup(t, { shop, accessToken: "old", refreshToken: "expired", accessTokenExpiresAt: new Date(0), refreshTokenExpiresAt: new Date(0) });
  t.mock.method(globalThis, "fetch", async () => assert.fail("expired refresh must not be sent"));
  await assert.rejects(storedOfflineTokenForShop(shop), { code: "SHOPIFY_REAUTH_REQUIRED" });
});

test("failed fresh exchange preserves stored credentials and does not expose provider text", async t => {
  const record = setup(t, { shop, accessToken: "existing", refreshToken: "existing-refresh" });
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_description: "sensitive-provider-detail" }, { status: 401 }));
  await assert.rejects(ensureOfflineTokenForAdminSession({ shop, idToken: "fresh-admin-id-token" }), error => {
    assert.equal(error.code, "SHOPIFY_TOKEN_EXCHANGE_FAILED");
    assert.doesNotMatch(error.message, /sensitive-provider-detail/);
    return true;
  });
  assert.equal(record.accessToken, "existing");
  assert.equal(record.refreshToken, "existing-refresh");
});

test("legacy fallback remains available only for its explicitly configured shop", async t => {
  setup(t, {});
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "legacy-shop-a";
  process.env.SHOPIFY_ADMIN_SHOP = "shop-a.myshopify.com";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://shop-a.myshopify.com/admin/api/2026-07/graphql.json");
    assert.equal(options.headers["X-Shopify-Access-Token"], "legacy-shop-a");
    return Response.json({ data: { shop: { id: "shop-a" } } });
  });
  assert.deepEqual(await shopifyAdminGraphql("shop-a.myshopify.com", "query { shop { id } }"), { shop: { id: "shop-a" } });
});

test("a global legacy token is never sent to a different shop", async t => {
  setup(t, {});
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "legacy-shop-a";
  process.env.SHOPIFY_ADMIN_SHOP = "shop-a.myshopify.com";
  t.mock.method(globalThis, "fetch", async () => assert.fail("cross-shop credential request"));
  await assert.rejects(shopifyAdminGraphql("shop-b.myshopify.com", "query { shop { id } }"), { code: "SHOPIFY_OFFLINE_TOKEN_MISSING" });
});

test("GraphQL authentication rejection requests reauthorization without retrying a mutation", async t => {
  setup(t, { shop, accessToken: "revoked", accessTokenExpiresAt: null });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({}, { status: 401 }); });
  await assert.rejects(shopifyAdminGraphql(shop, "mutation { ignored }"), { code: "SHOPIFY_REAUTH_REQUIRED", statusCode: 409 });
  assert.equal(calls, 1);
});
