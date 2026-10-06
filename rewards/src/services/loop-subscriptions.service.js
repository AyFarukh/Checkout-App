const DEFAULT_LOOP_STOREFRONT_API = "https://api.loopsubscriptions.com/storefront/2026-04";

function configurationError(message) {
  return Object.assign(new Error(message), { statusCode: 503 });
}

export function loopReadOnlyConfig() {
  const baseUrl = String(process.env.LOOP_STOREFRONT_API_URL || DEFAULT_LOOP_STOREFRONT_API).replace(/\/$/, "");
  const apiKey = String(process.env.LOOP_STOREFRONT_API_KEY || "").trim();
  if (!apiKey) throw configurationError("Loop Storefront API is not configured");
  return { baseUrl, apiKey };
}

/**
 * Read-only Loop transport for the subscription portal proof of concept.
 * Mutation methods intentionally do not exist in this module.
 */
export async function loopGet(pathname, { sessionToken, signal } = {}) {
  const { baseUrl, apiKey } = loopReadOnlyConfig();
  if (!sessionToken) throw Object.assign(new Error("Loop customer session token is required"), { statusCode: 401 });

  const response = await fetch(`${baseUrl}/${String(pathname || "").replace(/^\//, "")}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${sessionToken}`,
      "X-Loop-Api-Key": apiKey,
    },
    signal,
  });

  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(body?.message || `Loop request failed with status ${response.status}`);
    error.statusCode = response.status;
    error.loopStatus = response.status;
    throw error;
  }
  return body;
}

export function subscriptionPortalCapabilities() {
  return {
    mode: "read-only",
    mutationsEnabled: false,
    actions: {
      skip: false,
      reschedule: false,
      delay: false,
      orderNow: false,
      changeFrequency: false,
      editProducts: false,
      discount: false,
      shippingAddress: false,
      pause: false,
      cancel: false,
    },
  };
}
