import { Router } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { exchangeOfflineToken, storedOfflineTokenForShop } from "../services/shopify-token.service.js";

export const shopifyAuth = Router();

shopifyAuth.post("/offline", adminAuth, async (req, res, next) => {
  try {
    const shop = String(req.shopifySession?.shop || "").trim().toLowerCase();
    const idToken = req.shopifySession?.idToken;
    if (!shop || !idToken) return res.status(401).json({ error: "A fresh Shopify ID token is required" });

    const existing = await storedOfflineTokenForShop(shop);
    if (existing) return res.json({ ok: true, shop, status: "ready" });

    await exchangeOfflineToken({ shop, idToken });
    const persisted = await storedOfflineTokenForShop(shop);
    if (!persisted) throw new Error("Shopify offline token was not persisted");

    console.log(`[Rewards Auth] offline Shopify token ready for ${shop}`);
    res.json({ ok: true, shop, status: "authorized" });
  } catch (error) {
    if (error?.code === "SHOPIFY_TOKEN_EXCHANGE_FAILED" && error?.permanent) {
      res.set("X-Shopify-Retry-Invalid-Session-Request", "1");
    }
    next(error);
  }
});
