const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";

function tokenForShop(shop) {
  const map = process.env.SHOPIFY_OFFLINE_TOKENS_JSON;
  if (map) {
    try { const parsed = JSON.parse(map); if (parsed?.[shop]) return parsed[shop]; } catch { throw new Error("SHOPIFY_OFFLINE_TOKENS_JSON is invalid JSON"); }
  }
  return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
}

export async function shopifyAdminGraphql(shop, query, variables = {}) {
  const token = tokenForShop(shop);
  if (!token) throw Object.assign(new Error(`No offline Shopify Admin token configured for ${shop}`), { permanent: true, code: "SHOPIFY_OFFLINE_TOKEN_MISSING" });
  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, { method:"POST", headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token}, body:JSON.stringify({query,variables}) });
  const json = await response.json().catch(()=>({}));
  if (!response.ok) throw Object.assign(new Error(`Shopify Admin API HTTP ${response.status}`), { code:`SHOPIFY_HTTP_${response.status}`, retryable: response.status===429 || response.status>=500 });
  if (json.errors?.length) throw Object.assign(new Error(json.errors.map(e=>e.message).join("; ")), { code:"SHOPIFY_GRAPHQL_ERROR" });
  return json.data;
}

export function assertNoUserErrors(payload) {
  const errors = payload?.userErrors || [];
  if (errors.length) throw Object.assign(new Error(errors.map(e=>e.message).join("; ")), { code:"SHOPIFY_USER_ERROR", permanent:true });
  return payload;
}
