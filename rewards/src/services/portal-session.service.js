import crypto from "node:crypto";

const TTL_SECONDS = 5 * 60;
const secret = () => String(process.env.SHOPIFY_API_SECRET || "");

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(payload) {
  if (!secret()) throw Object.assign(new Error("Portal authentication is not configured"), { statusCode: 503 });
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createPortalSession(customerSession) {
  const payload = b64({
    shop: customerSession.shop,
    numericCustomerId: customerSession.numericCustomerId,
    shopifyCustomerId: customerSession.shopifyCustomerId,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    nonce: crypto.randomBytes(12).toString("base64url"),
  });
  return `${payload}.${sign(payload)}`;
}

export function consumePortalSession(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!value?.numericCustomerId || Number(value.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return value;
  } catch {
    return null;
  }
}
