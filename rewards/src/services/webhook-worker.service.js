import crypto from "node:crypto";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { awardForAction, reverseForRefund } from "./rules.service.js";

const MAX_ATTEMPTS = Number(process.env.REWARDS_WEBHOOK_MAX_ATTEMPTS || 8);
const LOCK_MS = Number(process.env.REWARDS_WEBHOOK_LOCK_MS || 5 * 60_000);
const WORKER_ID = `${process.pid}:${crypto.randomUUID()}`;

function backoff(attempt) {
  const base = Math.min(30 * 60_000, 5_000 * (2 ** Math.max(0, attempt - 1)));
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(base * jitter);
}

function retryable(error) {
  if (error?.permanent === true) return false;
  if (["ValidationError", "CastError"].includes(error?.name)) return false;
  if ([11000].includes(error?.code)) return false;
  return true;
}

async function processPayload(event) {
  const body = event.payload || {};
  if (event.topic === "orders/paid") {
    const eligibleAmount = Number(body.subtotal_price || body.current_subtotal_price || 0);
    const productIds = (body.line_items || []).map((item) => item.product_id).filter(Boolean).map(String);
    return awardForAction({
      shop: event.shop,
      type: "PURCHASE",
      customer: body.customer,
      eventId: body.id,
      amount: eligibleAmount,
      source: "SHOPIFY_ORDER_PAID",
      shopifyOrderId: String(body.id),
      metadata: { orderName: body.name, eligibleAmount, currency: body.currency, productIds, collectionIds: [], customerOrdersCount: body.customer?.orders_count },
    });
  }
  if (event.topic === "customers/create") {
    return awardForAction({ shop: event.shop, type: "ACCOUNT_CREATE", customer: body, eventId: body.id, source: "SHOPIFY_CUSTOMER_CREATED" });
  }
  if (event.topic === "refunds/create") {
    const refundedAmount = (body.transactions || []).filter((item) => item.kind === "refund" && item.status === "success").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return reverseForRefund({ shop: event.shop, orderId: body.order_id, refundId: body.id, refundedAmount });
  }
  const error = new Error(`Unsupported webhook topic: ${event.topic}`);
  error.permanent = true;
  throw error;
}

async function claimOne() {
  const now = new Date();
  const stale = new Date(Date.now() - LOCK_MS);
  return WebhookEvent.findOneAndUpdate(
    {
      $or: [
        { status: "PENDING", nextAttemptAt: { $lte: now } },
        { status: "PROCESSING", lockedAt: { $lte: stale } },
      ],
    },
    { $set: { status: "PROCESSING", lockedAt: now, lockOwner: WORKER_ID }, $inc: { attempts: 1 } },
    { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } },
  );
}

export async function processWebhookJobs(limit = 20) {
  let processed = 0;
  while (processed < limit) {
    const event = await claimOne();
    if (!event) break;
    try {
      await processPayload(event);
      await WebhookEvent.updateOne(
        { _id: event._id, status: "PROCESSING", lockOwner: WORKER_ID },
        { $set: { status: "PROCESSED", processedAt: new Date(), retryable: false }, $unset: { lockedAt: "", lockOwner: "", lastError: "", lastErrorCode: "", failureReason: "" } },
      );
    } catch (error) {
      const canRetry = retryable(error) && event.attempts < MAX_ATTEMPTS;
      const update = canRetry
        ? { $set: { status: "PENDING", retryable: true, nextAttemptAt: new Date(Date.now() + backoff(event.attempts)), lastError: String(error?.message || "Webhook processing failed").slice(0, 4000), lastErrorCode: String(error?.code || error?.name || "PROCESSING_ERROR").slice(0, 100) }, $unset: { lockedAt: "", lockOwner: "" } }
        : { $set: { status: "DEAD", retryable: retryable(error), deadAt: new Date(), lastError: String(error?.message || "Webhook processing failed").slice(0, 4000), lastErrorCode: String(error?.code || error?.name || "PROCESSING_ERROR").slice(0, 100), failureReason: event.attempts >= MAX_ATTEMPTS ? "MAX_ATTEMPTS_EXCEEDED" : "PERMANENT_FAILURE" }, $unset: { lockedAt: "", lockOwner: "" } };
      await WebhookEvent.updateOne({ _id: event._id, status: "PROCESSING", lockOwner: WORKER_ID }, update);
    }
    processed += 1;
  }
  return processed;
}
