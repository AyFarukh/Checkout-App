import { jwtVerify } from "jose";

function normalizeShop(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.endsWith(".myshopify.com") ? host : "";
  } catch {
    const host = String(value || "").trim().toLowerCase();
    return host.endsWith(".myshopify.com") ? host : "";
  }
}

export async function customerAuth(req, _res, next) {
  try {
    const header = String(req.get("authorization") || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw Object.assign(new Error("Customer session token is required"), { statusCode: 401 });
    const secret = process.env.SHOPIFY_API_SECRET;
    const audience = process.env.SHOPIFY_API_KEY;
    if (!secret || !audience) throw Object.assign(new Error("Customer authentication is not configured"), { statusCode: 503 });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"], audience });
    const shop = normalizeShop(payload.dest);
    const subject = String(payload.sub || "");
    const match = subject.match(/^gid:\/\/shopify\/Customer\/(\d+)$/);
    if (!shop || !match?.[1]) throw Object.assign(new Error("Signed-in Shopify customer is required"), { statusCode: 401 });
    const shopifyCustomerId = `gid://shopify/Customer/${match[1]}`;
    req.customerSession = { shop, shopifyCustomerId, numericCustomerId: match[1], subject };
    next();
  } catch (error) {
    if (!error.statusCode) error.statusCode = 401;
    next(error);
  }
}
