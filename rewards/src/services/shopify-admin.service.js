const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";

function normalizedShop(shop) {
  const value = String(shop || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)) {
    throw Object.assign(new Error("Invalid Shopify shop domain"), { permanent: true, code: "SHOPIFY_SHOP_INVALID" });
  }
  return value;
}

export function tokenForShop(shop) {
  const domain = normalizedShop(shop);
  const map = process.env.SHOPIFY_OFFLINE_TOKENS_JSON;
  if (map) {
    let parsed;
    try { parsed = JSON.parse(map); } catch { throw Object.assign(new Error("SHOPIFY_OFFLINE_TOKENS_JSON is invalid JSON"), { permanent: true, code: "SHOPIFY_OFFLINE_TOKENS_INVALID" }); }
    const token = parsed?.[domain];
    if (typeof token === "string" && token.trim()) return token.trim();
  }
  const fallback = String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
  if (fallback) return fallback;
  throw Object.assign(new Error(`No offline Shopify Admin token configured for ${domain}`), { permanent: true, code: "SHOPIFY_OFFLINE_TOKEN_MISSING" });
}

export function validateShopifyAdminConfiguration(shop) {
  const domain = normalizedShop(shop);
  const token = tokenForShop(domain);
  const functionId = String(process.env.SHOPIFY_REWARDS_FUNCTION_ID || "").trim();
  if (!functionId) throw Object.assign(new Error("SHOPIFY_REWARDS_FUNCTION_ID is not configured"), { permanent: true, code: "SHOPIFY_REWARDS_FUNCTION_ID_MISSING" });
  return { shop: domain, apiVersion: API_VERSION, tokenConfigured: Boolean(token), functionId };
}

export async function shopifyAdminGraphql(shop, query, variables = {}) {
  const domain = normalizedShop(shop);
  const token = tokenForShop(domain);
  let response;
  try {
    response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw Object.assign(new Error(`Shopify Admin API network failure: ${error.message}`), { code: "SHOPIFY_NETWORK_ERROR", retryable: true });
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw Object.assign(new Error(`Shopify Admin API HTTP ${response.status}`), { code: `SHOPIFY_HTTP_${response.status}`, retryable, permanent: !retryable });
  }
  if (json.errors?.length) throw Object.assign(new Error(json.errors.map((e) => e.message).join("; ")), { code: "SHOPIFY_GRAPHQL_ERROR", retryable: true });
  return json.data;
}

export function assertNoUserErrors(payload) {
  const errors = payload?.userErrors || [];
  if (errors.length) throw Object.assign(new Error(errors.map((e) => e.message).join("; ")), { code: "SHOPIFY_USER_ERROR", permanent: true, details: errors });
  return payload;
}
