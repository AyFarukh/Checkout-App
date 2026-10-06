import { Router } from "express";
import { customerAuth } from "../middleware/customerAuth.js";
import { getCustomerLoopSubscriptions, subscriptionPortalCapabilities } from "../services/loop-subscriptions.service.js";

export const subscriptionApi = Router();
subscriptionApi.use(customerAuth);

subscriptionApi.get("/capabilities", (req, res) => {
  res.json({ ok: true, customer: { shop: req.customerSession.shop, id: req.customerSession.shopifyCustomerId }, loop: subscriptionPortalCapabilities() });
});

subscriptionApi.get("/subscription", async (req, res, next) => {
  try {
    const subscriptions = await getCustomerLoopSubscriptions(req.customerSession.numericCustomerId);
    res.json({ ok: true, mode: "read-only", mutationsEnabled: false, subscriptions });
  } catch (error) {
    next(error);
  }
});
