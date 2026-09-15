import crypto from "node:crypto";
import mongoose from "mongoose";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { IdempotencyRecord } from "../models/IdempotencyRecord.js";
import { AdminAuditLog } from "../models/AdminAuditLog.js";
import { ADMIN_ERROR_CODES, apiError } from "../errors/api-error.js";

function hashRequest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function retryDeadWebhook({ shop, eventId, actorId, idempotencyKey, requestId }) {
  if (!idempotencyKey) throw apiError(400, ADMIN_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED, "Idempotency-Key is required.");
  if (idempotencyKey.length < 8 || idempotencyKey.length > 255) throw apiError(400, ADMIN_ERROR_CODES.INVALID_REQUEST, "Idempotency-Key must contain between 8 and 255 characters.");

  const operation = "WEBHOOK_DEAD_RETRY";
  const requestHash = hashRequest({ eventId: String(eventId) });
  const session = await mongoose.startSession();
  let response;

  try {
    await session.withTransaction(async () => {
      let idem;
      try {
        [idem] = await IdempotencyRecord.create([{
          shop, actorType: "ADMIN", actorId, operation, key: idempotencyKey, requestHash,
          status: "PROCESSING", expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        }], { session });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const existing = await IdempotencyRecord.findOne({ shop, actorType: "ADMIN", actorId, operation, key: idempotencyKey }).session(session).lean();
        if (!existing) throw error;
        if (existing.requestHash !== requestHash) throw apiError(409, ADMIN_ERROR_CODES.IDEMPOTENCY_KEY_REUSED, "The idempotency key was already used with different request data.");
        if (existing.status === "COMPLETED") {
          response = { ...(existing.responseBody || {}), meta: { ...(existing.responseBody?.meta || {}), idempotentReplay: true } };
          return;
        }
        throw apiError(409, ADMIN_ERROR_CODES.IDEMPOTENCY_IN_PROGRESS, "An identical retry request is already being processed.");
      }

      const before = await WebhookEvent.findOne({ _id: eventId, shop }).session(session).lean();
      if (!before) throw apiError(404, ADMIN_ERROR_CODES.WEBHOOK_EVENT_NOT_FOUND, "Webhook event not found.");
      if (before.status !== "DEAD") throw apiError(409, ADMIN_ERROR_CODES.WEBHOOK_NOT_RETRYABLE, `A ${before.status} webhook cannot be manually retried.`, { currentStatus: before.status });

      const event = await WebhookEvent.findOneAndUpdate(
        { _id: eventId, shop, status: "DEAD" },
        { $set: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), retryable: true }, $unset: { deadAt: "", lockedAt: "", lockOwner: "", lastError: "", lastErrorCode: "", failureReason: "" } },
        { new: true, session },
      );
      if (!event) throw apiError(409, ADMIN_ERROR_CODES.WEBHOOK_STATE_CHANGED, "The webhook state changed while the retry was being requested.", { expectedStatus: "DEAD" });

      await AdminAuditLog.create([{
        shop, actorId, action: "WEBHOOK_DEAD_RETRY", resourceType: "WebhookEvent", resourceId: event._id, requestId,
        before: { status: before.status, attempts: before.attempts, deadAt: before.deadAt, lastErrorCode: before.lastErrorCode, failureReason: before.failureReason },
        after: { status: event.status, attempts: event.attempts, nextAttemptAt: event.nextAttemptAt },
        metadata: { topic: event.topic, webhookId: event.webhookId, idempotencyKey },
      }], { session });

      response = {
        data: { id: String(event._id), status: event.status, topic: event.topic, webhookId: event.webhookId, attempts: event.attempts, nextAttemptAt: event.nextAttemptAt },
        meta: { message: "Webhook event queued for retry.", idempotentReplay: false },
      };

      await IdempotencyRecord.updateOne({ _id: idem._id, status: "PROCESSING" }, { $set: { status: "COMPLETED", resourceType: "WebhookEvent", resourceId: String(event._id), responseCode: 202, responseBody: response } }, { session });
    });
    return response;
  } finally {
    await session.endSession();
  }
}
