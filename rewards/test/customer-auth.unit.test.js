import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { customerAuth } from "../src/middleware/customerAuth.js";

const secret = "customer-auth-test-secret";
const apiKey = "customer-auth-test-key";

async function token({dest="https://ftr-test.myshopify.com", sub="gid://shopify/Customer/123"}={}) {
  const now = Math.floor(Date.now()/1000);
  return new SignJWT({dest, sub}).setProtectedHeader({alg:"HS256"}).setAudience(apiKey).setIssuedAt(now).setExpirationTime(now+60).sign(new TextEncoder().encode(secret));
}

function invoke(value) {
  return new Promise((resolve) => {
    const req = { get: (name) => name.toLowerCase() === "authorization" ? value : "" };
    customerAuth(req, {}, (error) => resolve({req, error}));
  });
}

test("FTR-CUST-AUTH-001 verifies shop and customer identity from Shopify JWT", async () => {
  const previous = {key: process.env.SHOPIFY_API_KEY, secret: process.env.SHOPIFY_API_SECRET};
  process.env.SHOPIFY_API_KEY = apiKey; process.env.SHOPIFY_API_SECRET = secret;
  try {
    const result = await invoke(`Bearer ${await token()}`);
    assert.equal(result.error, undefined);
    assert.equal(result.req.customerSession.shop, "ftr-test.myshopify.com");
    assert.equal(result.req.customerSession.shopifyCustomerId, "gid://shopify/Customer/123");
    assert.equal(result.req.customerSession.numericCustomerId, "123");
  } finally { process.env.SHOPIFY_API_KEY = previous.key; process.env.SHOPIFY_API_SECRET = previous.secret; }
});

test("FTR-CUST-AUTH-002 rejects a token without a Shopify Customer subject", async () => {
  const previous = {key: process.env.SHOPIFY_API_KEY, secret: process.env.SHOPIFY_API_SECRET};
  process.env.SHOPIFY_API_KEY = apiKey; process.env.SHOPIFY_API_SECRET = secret;
  try {
    const result = await invoke(`Bearer ${await token({sub:"shopify-admin"})}`);
    assert.equal(result.error?.statusCode, 401);
  } finally { process.env.SHOPIFY_API_KEY = previous.key; process.env.SHOPIFY_API_SECRET = previous.secret; }
});
