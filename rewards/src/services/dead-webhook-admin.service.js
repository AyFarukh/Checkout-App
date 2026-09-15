import crypto from "node:crypto";
import mongoose from "mongoose";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { IdempotencyRecord } from "../models/IdempotencyRecord.js";
import { AdminAuditLog } from "../models/AdminAuditLog.js";
import { ADMIN_ERROR_CODES, apiError } from "../errors/api-error.js";

function hashRequest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function idemFilter({ shop, actorId, operation, idempotencyKey }) {
  return { shop, actorType: "ADMIN", actorId, operation, key: idempotencyKey };
}

async function readExistingIdempotency(filter, requestHash) {
  const existing = await IdempotencyRecord.findOne(filter).lean();
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw apiError(409, ADMIN_ERROR_CODES.IDEMPOTENCY_KEY_REUSED, "The idempotency key was already used with different request data.");
  }
  if (existing.status === "COMPLETED") {
    return { ...(existing.responseBody || {}), meta: { ...(existing.responseBody?.meta || {}), idempotentReplay: true } };
  }
  throw apiError(409, ADMIN_ERROR_CODES.IDEMPOTENCY_IN_PROGRESS, "An identical retry request is already being processed.");
}

export async function retryDeadWebhook({ shop, eventId, actorId, idempotencyKey, requestId }) {
  if (!idempotencyKey) throw apiError(400, ADMIN_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED, "Idempotency-Key is required.");
  if (idempotencyKey.length < 8 || idempotencyKey.length > 255) throw apiError(400, ADMIN_ERROR_CODES.INVALID_REQUEST, "Idempotency-Key must contain between 8 and 255 characters.");

  const operation = "WEBHOOK_DEAD_RETRY";
  const requestHash = hashRequest({ eventId: String(eventId) });
  const filter = idemFilter({ shop, actorId, operation, idempotencyKey });

  // Resolve completed/in-flight replays before opening a transaction. A duplicate
  // key write inside a Mongo transaction aborts that transaction, so it must not
  // be used as the normal replay detection path.
  const replay = await readExistingIdempotency(filter, requestHash);
  if (replay) return replay;

  let claim;
  try {
    claim = await IdempotencyRecord.create({
      ...filter,
      requestHash,
      status: "PROCESSING",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const concurrentReplay = await readExistingIdempotency(filter, requestHash);
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }

  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const before = await WebhookEvent.findOne({ _id: eventId, shop }).session(session).lean();
      if (!before) throw apiError(404, ADMIN_ERROR_CODES.WEBHOOK_EVENT_NOT_FOUND, "Webhook event not found.");
      if (before.status !== "DEAD") throw apiError(409, ADMIN_ERROR_CODES.WEBHOOK_NOT_RETRYABLE, `A ${before.status} webhook cannot be manually retried.`, { currentStatus: before.status });
      if (before.retryable === false) throw apiError(409, ADMIN_ERROR_CODES.WEBHOOK_NOT_RETRYABLE, "This DEAD webhook is marked as permanently non-retryable.");

      const event = await WebhookEvent.findOneAndUpdate(
        { _id: eventId, shop, status: "DEAD", retryable: { $ne: false } },
        { $set: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), retryable: true }, $unset: { deadAt: "", lockedAt: "", lockOwner: "", lastError: "", lastErrorCode: "", failureReason: "" } },
        { new: true, session },
      );
      if (!event) throw apiError(409, ADMIN_ERROR_CODES.WEBHOOK_STATE_CHANGED, "The webhook state changed while the retry was being requested.", { expectedStatus: "DEAD" });

      await AdminAuditLog.create([{
        shop,
        actorId,
        action: "WEBHOOK_DEAD_RETRY",
        resourceType: "WebhookEvent",
        resourceId: event._id,
        requestId,
        before: { status: before.status, attempts: before.attempts, deadAt: before.deadAt, lastErrorCode: before.lastErrorCode, failureReason: before.failureReason },
        after: { status: event.status, attempts: event.attempts, nextAttemptAt: event.nextAttemptAt },
        metadata: { topic: event.topic, webhookId: event.webhookId, idempotencyKeyHash: hashRequest(idempotencyKey) },
      }], { session });

      response = {
        data: { id: String(event._id), status: event.status, topic: event.topic, webhookId: event.webhookId, attempts: event.attempts, nextAttemptAt: event.nextAttemptAt },
        meta: { message: "Webhook event queued for retry.", idempotentReplay: false },
      };
    });

    await IdempotencyRecord.updateOne(
      { _id: claim._id, status: "PROCESSING" },
      { $set: { status: "COMPLETED", resourceType: "WebhookEvent", resourceId: String(eventId), responseCode: 202, responseBody: response } },
    );
    return response;
  } catch (error) {
    // Failed operations are not replayed as success. Remove the external claim so
    // a corrected request can be attempted again with the same key.
    await IdempotencyRecord.deleteOne({ _id: claim._id, status: "PROCESSING" }).catch(() => {});
    throw error;
  } finally {
    await session.endSession();
  }
}
