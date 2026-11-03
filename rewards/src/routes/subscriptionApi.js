import { Router } from "express";
import { loopActionService } from "../services/loop-action-executor.service.js";
import { createSubscriptionActionRouter, subscriptionActionFailure } from "./subscriptionActions.js";
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

// Older hosted-portal callers must use the same preview and idempotent executor.
for (const [path, method] of [["portal-preview", "preview"], ["portal-action", "execute"], ["portal-status", "status"]]) {
  subscriptionApi.post("/" + path, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const customer = consumePortalSession(req.body?.ticket);
    if (!customer) return res.status(401).json({ok:false,applied:false,code:"SIGN_IN_REQUIRED"});
    try {
      const result = await loopActionService[method]({shop:customer.shop,customerId:customer.numericCustomerId},req.body);
      res.status(result.code === "ACTION_OUTCOME_UNKNOWN" ? 202 : 200).json(result);
    } catch (error) { subscriptionActionFailure(res,error); }
  });
}
subscriptionApi.use(customerAuth);
subscriptionApi.use(createSubscriptionActionRouter({authenticate:(req,_res,next)=>{
  req.subscriptionIdentity={shop:req.customerSession.shop,customerId:req.customerSession.numericCustomerId};next();
}}));

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

