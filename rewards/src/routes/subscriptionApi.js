import { Router } from "express";
import { customerAuth } from "../middleware/customerAuth.js";
import { getCustomerLoopSubscriptions, loopAdminRequest, loopMutationsEnabled, subscriptionPortalCapabilities } from "../services/loop-subscriptions.service.js";
import { createPortalSession, consumePortalSession } from "../services/portal-session.service.js";

export const subscriptionApi = Router();

subscriptionApi.get("/portal-data", async (req, res, next) => {
  try {
    const customer = consumePortalSession(req.query.ticket);
    if (!customer) return res.status(401).json({ ok: false, message: "This secure portal link has expired. Please reopen it from your Shopify account." });
    const subscriptions = await getCustomerLoopSubscriptions(customer.numericCustomerId);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, mode: loopMutationsEnabled() ? "interactive" : "read-only", mutationsEnabled: loopMutationsEnabled(), subscriptions });
  } catch (error) { next(error); }
});

subscriptionApi.post("/portal-action", async (req, res, next) => {
  try {
    const customer = consumePortalSession(req.body?.ticket);
    if (!customer) return res.status(401).json({ ok: false, message: "Your secure portal session expired. Reopen the portal from your Shopify account." });
    const subscriptions = await getCustomerLoopSubscriptions(customer.numericCustomerId);
    const subscriptionId = String(req.body?.subscriptionId || "");
    const owned = subscriptions.find((item) => String(item?.id) === subscriptionId || String(item?.shopifyId) === subscriptionId);
    if (!owned) return res.status(403).json({ ok: false, message: "Subscription does not belong to this customer." });

    const action = String(req.body?.action || "");
    const payload = req.body?.payload || {};
    let request;
    if (action === "cancel") request = { path: `subscription/${subscriptionId}/cancel`, method: "POST", body: payload };
    else if (action === "frequency") request = { path: `subscription/${subscriptionId}/frequency`, method: "PUT", body: payload };
    else if (action === "edit-line") {
      if (!payload.lineId) return res.status(400).json({ ok: false, message: "Line ID is required." });
      const { lineId, ...body } = payload;
      request = { path: `subscription/${subscriptionId}/line/${lineId}/update`, method: "PUT", body };
    } else if (action === "discount") request = { path: `subscription/${subscriptionId}/discount`, method: "POST", body: payload };
    else return res.status(400).json({ ok: false, message: "Unsupported subscription action." });

    const result = await loopAdminRequest(request.path, request);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, result });
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
