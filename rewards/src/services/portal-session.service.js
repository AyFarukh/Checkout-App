import crypto from "node:crypto";

const sessions = new Map();
const TTL_MS = 5 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
}

export function createPortalSession(customerSession) {
  cleanup();
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, {
    shop: customerSession.shop,
    numericCustomerId: customerSession.numericCustomerId,
    shopifyCustomerId: customerSession.shopifyCustomerId,
    expiresAt: Date.now() + TTL_MS,
  });
  return token;
}

export function consumePortalSession(token) {
  cleanup();
  const value = sessions.get(String(token || ""));
  if (!value) return null;
  sessions.delete(String(token));
  return value.expiresAt > Date.now() ? value : null;
}
