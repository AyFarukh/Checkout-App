import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { referralProfile, claimFriendOffer, claimReferralGift } from "../services/referral-live.service.js";

const publicDir = fileURLToPath(new URL("../../public/", import.meta.url));
function register(router, getContext) {
  router.get("/me", async (req, res, next) => {
    try { res.set("Cache-Control", "private, no-store"); res.json(await referralProfile(getContext(req))); } catch (error) { next(error); }
  });
  router.post("/claim", async (req, res, next) => {
    try { res.set("Cache-Control", "private, no-store"); res.json(await claimFriendOffer({ ...getContext(req), code: req.body?.code })); } catch (error) { next(error); }
  });
  router.post("/milestones/:id/claim", async (req, res, next) => {
    try { res.set("Cache-Control", "private, no-store"); res.json(await claimReferralGift({ ...getContext(req), milestoneId: req.params.id })); } catch (error) { next(error); }
  });
}
export const referralCustomer = Router();
const customerContext = req => ({ shop: req.customerSession.shop, customerId: req.customerSession.shopifyCustomerId });
register(referralCustomer, customerContext);
referralCustomer.get("/", async (req, res, next) => {
  try { res.set("Cache-Control", "private, no-store"); res.json(await referralProfile(customerContext(req))); } catch (error) { next(error); }
});

export function referralProxy(verify) {
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store"); res.set("X-Content-Type-Options", "nosniff");
    if (!verify(req.query)) return res.status(403).json({ error: { message: "Invalid storefront signature" } });
    const shop = String(req.query.shop || "").toLowerCase(), id = String(req.query.logged_in_customer_id || "");
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return res.status(403).json({ error: { message: "Invalid shop" } });
    req.referralContext = { shop, customerId: /^\d+$/.test(id) ? `gid://shopify/Customer/${id}` : "" }; next();
  });
  for (const file of ["referrals-customer.js", "referrals-customer.css"]) router.get(`/assets/${file}`, (_req, res) => res.sendFile(path.join(publicDir, file)));
  router.get("/", (_req, res) => res.sendFile(path.join(publicDir, "referrals-customer.html")));
  register(router, req => req.referralContext);
  return router;
}
