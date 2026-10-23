import { createHash } from "node:crypto";
import { LoopActionAttempt } from "../models/LoopActionAttempt.js";

export function actionRequestHash({ shop, customerId, subscriptionId, action, payload }) {
  return createHash("sha256").update(JSON.stringify({ shop, customerId, subscriptionId, action, payload })).digest("hex");
}

// A unique database index makes concurrent claims across server instances safe.
// Existing attempts are never automatically retried after an ambiguous outcome.
export async function reserveLoopAction({ shop, customerId, subscriptionId, action, requestKey, payload }) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(String(requestKey || ""))) {
    return { accepted: false, code: "INVALID_REQUEST_KEY" };
  }
  const requestHash = actionRequestHash({ shop, customerId, subscriptionId, action, payload });
  try {
    const attempt = await LoopActionAttempt.create({
      shop, customerId, subscriptionId, action, requestKey, requestHash, status: "reserved"
    });
    return { accepted: true, attempt };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await LoopActionAttempt.findOne({ shop, customerId, requestKey });
    if (!existing) return { accepted: false, code: "REQUEST_CONFLICT" };
    return { accepted: false, code: existing.requestHash === requestHash ? "REQUEST_ALREADY_RESERVED" : "IDEMPOTENCY_KEY_REUSED", status: existing.status };
  }
}

export async function claimLoopAction(attemptId) {
  return LoopActionAttempt.findOneAndUpdate(
    { _id: attemptId, status: "reserved" },
    { $set: { status: "in_flight" } },
    { new: true }
  );
}

export async function finishLoopAction(attemptId, status, errorCode = null) {
  if (!["applied", "rejected", "unknown"].includes(status)) throw new Error("Invalid final attempt status");
  return LoopActionAttempt.findOneAndUpdate(
    { _id: attemptId, status: "in_flight" },
    { $set: { status, errorCode, completedAt: new Date() } },
    { new: true }
  );
}
