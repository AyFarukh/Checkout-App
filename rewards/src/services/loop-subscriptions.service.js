const DEFAULT_LOOP_ADMIN_API = "https://api.loopsubscriptions.com/admin/2026-04";

function serviceError(message, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

export function loopReadOnlyConfig() {
  const baseUrl = String(process.env.LOOP_ADMIN_API_URL || DEFAULT_LOOP_ADMIN_API).replace(/\/$/, "");
  const requestHeaders = JSON.parse(process.env.LOOP_ADMIN_REQUEST_HEADERS_JSON || "{}");
  if (!Object.keys(requestHeaders).length) throw serviceError("Loop Admin API headers are not configured", 503);
  return { baseUrl, requestHeaders };
}

async function json(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

export async function getCustomerLoopSubscriptions(customerShopifyId, { signal } = {}) {
  const { baseUrl, requestHeaders } = loopReadOnlyConfig();
  const id = String(customerShopifyId || "").replace(/\D/g, "");
  if (!id) throw serviceError("A valid Shopify customer ID is required", 400);
  const response = await fetch(`${baseUrl}/customer/${encodeURIComponent(id)}/subscription`, {
    method: "GET",
    headers: { Accept: "application/json", ...requestHeaders },
    signal,
  });
  const body = await json(response);
  if (response.status === 404) return [];
  if (!response.ok) throw serviceError(body?.message || `Loop request failed with status ${response.status}`, response.status);
  const candidates = [body?.subscriptions, body?.data?.subscriptions, body?.data, body?.result?.subscriptions, body?.result, body];
  return candidates.find(Array.isArray) || [];
}

export function subscriptionPortalCapabilities() {
  return {
    mode: "read-only", mutationsEnabled: false,
    actions: { skip:false,reschedule:false,delay:false,orderNow:false,changeFrequency:false,editProducts:false,discount:false,shippingAddress:false,pause:false,cancel:false },
  };
}
