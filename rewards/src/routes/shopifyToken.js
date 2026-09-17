import { Router } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { ensureOfflineTokenForAdminSession } from "../services/shopify-token.service.js";
import { wakePendingRewardSyncs } from "../services/shopify-sync.service.js";

export const shopifyToken = Router();
shopifyToken.use(adminAuth);

shopifyToken.post("/exchange", async (req, res, next) => {
  try {
    const shop = String(req.shopifySession?.shop || "").trim().toLowerCase();
    const idToken = req.shopifySession?.idToken;
    if (!idToken || !shop) {
      res.set("X-Shopify-Retry-Invalid-Session-Request", "1");
      return res.status(401).json({ error: "Authenticated Shopify ID token required" });
    }

    console.log(`[Rewards Auth] App Bridge ID token received for ${shop}`);
    const result = await ensureOfflineTokenForAdminSession({ shop, idToken });
    const woken = await wakePendingRewardSyncs(shop);
    console.log(`[Rewards Auth] background sync authorization ${result.status} for ${shop}; ${woken} pending job(s) ready`);
    return res.json({ ok: true, ...result, pendingJobsWoken: woken });
  } catch (error) {
    console.error(`[Rewards Auth] offline token bootstrap failed: ${error.message}`);
    if (error?.code === "SHOPIFY_TOKEN_EXCHANGE_FAILED" || error?.code === "SHOPIFY_ID_TOKEN_REQUIRED") {
      res.set("X-Shopify-Retry-Invalid-Session-Request", "1");
    }
    return next(error);
  }
});
