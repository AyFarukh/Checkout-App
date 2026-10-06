import { Router } from "express";
import { customerAuth } from "../middleware/customerAuth.js";
import { getCustomerLoopSubscriptions, subscriptionPortalCapabilities } from "../services/loop-subscriptions.service.js";
import { createPortalSession, consumePortalSession } from "../services/portal-session.service.js";

export const subscriptionApi = Router();

subscriptionApi.get("/portal-data", async (req, res, next) => {
  try {
    const customer = consumePortalSession(req.query.ticket);
    if (!customer) return res.status(401).json({ ok: false, message: "This secure portal link has expired. Please reopen it from your Shopify account." });
    const subscriptions = await getCustomerLoopSubscriptions(customer.numericCustomerId);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, mode: "read-only", mutationsEnabled: false, subscriptions });
  } catch (error) { next(error); }
});

subscriptionApi.use(customerAuth);

subscriptionApi.get("/capabilities", (req, res) => {
  res.json({ ok: true, customer: { shop: req.customerSession.shop, id: req.customerSession.shopifyCustomerId }, loop: subscriptionPortalCapabilities() });
});

subscriptionApi.post("/portal-session", (req, res) => {
  const ticket = createPortalSession(req.customerSession);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, portalUrl: `/subscription-portal/?ticket=${encodeURIComponent(ticket)}`, expiresInSeconds: 300 });
});

subscriptionApi.get("/subscription", async (req, res, next) => {
  try {
    const subscriptions = await getCustomerLoopSubscriptions(req.customerSession.numericCustomerId);
    res.json({ ok: true, mode: "read-only", mutationsEnabled: false, subscriptions });
  } catch (error) { next(error); }
});
