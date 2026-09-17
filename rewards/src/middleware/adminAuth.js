import { jwtVerify } from "jose";

function bearerToken(req) {
  const header = req.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function adminAuth(req, res, next) {
  try {
    const token = bearerToken(req);
    const apiSecret = process.env.SHOPIFY_API_SECRET;
    const apiKey = process.env.SHOPIFY_API_KEY;

    if (token && apiSecret && apiKey) {
      const secret = new TextEncoder().encode(apiSecret);
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
        audience: apiKey,
      });

      const issuerHost = new URL(String(payload.iss || "")).hostname;
      const destinationHost = new URL(String(payload.dest || "")).hostname;
      if (issuerHost !== destinationHost || !destinationHost.endsWith(".myshopify.com")) {
        return res.status(401).json({ error: "Invalid Shopify session" });
      }

      req.shopifySession = {
        shop: destinationHost,
        subject: payload.sub ? String(payload.sub) : "shopify-admin",
        idToken: token,
      };
      return next();
    }

    const configuredKey = process.env.REWARDS_ADMIN_KEY;
    const suppliedKey = req.get("x-rewards-admin-key");
    if (configuredKey && suppliedKey === configuredKey) {
      req.shopifySession = { shop: String(req.query.shop || req.body?.shop || ""), subject: "local-admin" };
      return next();
    }

    return res.status(401).json({ error: "Unauthorized" });
  } catch (error) {
    console.error("[Rewards Auth]", error.message);
    res.set("X-Shopify-Retry-Invalid-Session-Request", "1");
    return res.status(401).json({ error: "Invalid or expired Shopify session" });
  }
}
