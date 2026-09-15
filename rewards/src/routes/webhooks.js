import crypto from "node:crypto";
import { Router } from "express";
import { WebhookEvent } from "../models/WebhookEvent.js";

export const webhookRouter = Router();
const TOPICS = new Map([
  ["/orders-paid", "orders/paid"],
  ["/refunds-create", "refunds/create"],
  ["/customers-create", "customers/create"],
]);

function verifyWebhook(req) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const hmac = req.get("X-Shopify-Hmac-Sha256") || "";
  if (!secret || !hmac || !Buffer.isBuffer(req.body)) return false;
  const digest = crypto.createHmac("sha256", secret).update(req.body).digest("base64");
  const expected = Buffer.from(digest);
  const supplied = Buffer.from(hmac);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

webhookRouter.use((req, res, next) => {
  if (!verifyWebhook(req)) return res.status(401).send("Invalid webhook signature");
  next();
});

webhookRouter.post(["/orders-paid", "/refunds-create", "/customers-create"], async (req, res, next) => {
  try {
    const shop = String(req.get("X-Shopify-Shop-Domain") || "").trim().toLowerCase();
    const webhookId = String(req.get("X-Shopify-Webhook-Id") || "").trim();
    const apiVersion = String(req.get("X-Shopify-Api-Version") || "").trim();
    const topic = TOPICS.get(req.path);
    if (!shop || !webhookId || !topic) return res.status(400).send("Missing Shopify webhook metadata");

    let payload;
    try { payload = JSON.parse(req.body.toString("utf8")); }
    catch { return res.status(400).send("Invalid JSON payload"); }

    try {
      await WebhookEvent.create({ shop, webhookId, topic, apiVersion, payload, status: "PENDING", nextAttemptAt: new Date() });
    } catch (error) {
      // Shopify can redeliver the same webhook. The unique (shop, webhookId)
      // index turns those deliveries into a successful no-op.
      if (error?.code !== 11000) throw error;
    }
    return res.status(200).send("OK");
  } catch (error) {
    next(error);
  }
});
