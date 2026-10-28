const DEFAULT_LOOP_ADMIN_API = "https://api.loopsubscriptions.com/admin/2026-04";

function serviceError(message, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

export function loopReadOnlyConfig() {
  const baseUrl = String(process.env.LOOP_ADMIN_API_URL || DEFAULT_LOOP_ADMIN_API).replace(/\/$/, "");
  const url=new URL(baseUrl);
  const local=process.env.NODE_ENV==='test' && process.env.LOOP_ALLOW_LOCAL_TEST_API==='true' && ['127.0.0.1','localhost'].includes(url.hostname);
  if(!local && (url.protocol!=='https:' || url.hostname!=='api.loopsubscriptions.com' || url.pathname!=='/admin/2026-04')) throw serviceError('Invalid Loop API configuration',503);
  let headers;
  try { headers=JSON.parse(process.env.LOOP_ADMIN_REQUEST_HEADERS_JSON||'{}'); } catch { throw serviceError('Invalid Loop header configuration',503); }
  const token=Object.entries(headers||{}).find(([k])=>k.toLowerCase()==='x-loop-token')?.[1];
  if(typeof token!=='string'||!token.trim()) throw serviceError('Loop Admin credentials are not configured',503);
  return { baseUrl, requestHeaders:{'X-Loop-Token':token} };
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
  // The existing production flag is intentionally insufficient to enable writes.
  return ['test','development'].includes(process.env.NODE_ENV) && process.env.LOOP_TEST_MUTATIONS_ENABLED==='true';
}

export async function loopAdminRequest(pathname, { method = "GET", body, signal, testScope } = {}) {
  if (method !== "GET" && (!loopMutationsEnabled() ||
      testScope?.shop!==process.env.LOOP_TEST_SHOP || testScope?.customerId!==process.env.LOOP_TEST_CUSTOMER_ID ||
      testScope?.subscriptionId!=='42347174' || process.env.LOOP_TEST_SUBSCRIPTION_ID!=='42347174' ||
      !String(pathname).startsWith('subscription/42347174/'))) {
    throw serviceError("Subscription changes are disabled until test verification is complete", 503);
  }
  const { baseUrl, requestHeaders } = loopReadOnlyConfig();
  const response = await fetch(`${baseUrl}/${String(pathname || "").replace(/^\//, "")}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...requestHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal || AbortSignal.timeout(10000),
    redirect:'error',
  });
  const result = await json(response);
  if (!response.ok || result?.success===false) {
    // Provider messages can contain personal details. Never forward or log them.
    const error=serviceError('Loop rejected the request',502);
    error.code='LOOP_REJECTED';
    error.providerHttpStatus=response.status;
    error.providerFailureKind=response.ok?'BUSINESS_REJECTION':'HTTP_ERROR';
    error.definiteRejection=(response.ok && result?.success===false)||[400,401,403,404,422].includes(response.status);
    throw error;
  }
  if(!result || typeof result!=='object' || result.message && !('success' in result) && !('data' in result)) throw Object.assign(serviceError('Unexpected Loop response',502),{providerHttpStatus:response.status,providerFailureKind:'UNEXPECTED_RESPONSE'});
  return result;
}

export function subscriptionPortalCapabilities() {
  return {
    mode: "read-only", mutationsEnabled: false,
    actions: { skip:false,reschedule:false,delay:false,orderNow:false,changeFrequency:false,editProducts:false,discount:false,shippingAddress:false,pause:false,cancel:false },
  };
}

