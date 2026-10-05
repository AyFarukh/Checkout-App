import { Router } from "express";
import { customerAuth } from "../middleware/customerAuth.js";
import { subscriptionPortalCapabilities } from "../services/loop-subscriptions.service.js";

export const subscriptionApi = Router();

subscriptionApi.use(customerAuth);

subscriptionApi.get("/capabilities", (req, res) => {
  res.json({
    ok: true,
    customer: {
      shop: req.customerSession.shop,
      id: req.customerSession.shopifyCustomerId,
    },
    loop: subscriptionPortalCapabilities(),
  });
});

subscriptionApi.get("/subscription", (_req, res) => {
  // Deliberately blocked until Loop customer-session exchange is wired and
  // verified against a dedicated test subscriber. Never use a live customer's
  // shared portal token for development.
  res.status(501).json({
    ok: false,
    code: "LOOP_READ_ONLY_POC_NOT_CONNECTED",
    message: "Loop read-only subscription retrieval is not connected yet.",
    mutationsEnabled: false,
  });
});
