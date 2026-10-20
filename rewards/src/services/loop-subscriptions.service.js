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
  return prioritizeSubscriptions(candidates.find(Array.isArray) || []);
}

export function prioritizeSubscriptions(subscriptions = []) {
  const rank = (status) => {
    const value = String(status || "").toUpperCase();
    if (value === "ACTIVE") return 0;
    if (value === "PAUSED") return 1;
    if (value === "CANCELLED" || value === "CANCELED") return 3;
    return 2;
  };
  return [...subscriptions].sort((a, b) => rank(a?.status) - rank(b?.status));
}

export function loopMutationsEnabled() {
  return String(process.env.LOOP_SUBSCRIPTION_MUTATIONS_ENABLED || "").toLowerCase() === "true";
}

export async function loopAdminRequest(pathname, { method = "GET", body, signal } = {}) {
  if (method !== "GET" && !loopMutationsEnabled()) {
    throw serviceError("Subscription changes are disabled until test verification is complete", 503);
  }
  const { baseUrl, requestHeaders } = loopReadOnlyConfig();
  const response = await fetch(`${baseUrl}/${String(pathname || "").replace(/^\//, "")}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...requestHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const result = await json(response);
  if (!response.ok) throw serviceError(result?.message || `Loop request failed with status ${response.status}`, response.status);
  return result;
}

export function subscriptionPortalCapabilities() {
  return {
    mode: "read-only", mutationsEnabled: false,
    actions: { skip:false,reschedule:false,delay:false,orderNow:false,changeFrequency:false,editProducts:false,discount:false,shippingAddress:false,pause:false,cancel:false },
  };
}
