import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true, trim: true, lowercase: true },
  webhookId: { type: String, required: true, trim: true },
  topic: { type: String, required: true, index: true, trim: true },
  apiVersion: { type: String, trim: true },
  status: { type: String, enum: ["PENDING", "PROCESSING", "PROCESSED", "FAILED", "DEAD"], default: "PENDING", index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  attempts: { type: Number, default: 0, min: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: Date,
  lockOwner: { type: String, trim: true, maxlength: 255 },
  processedAt: Date,
  deadAt: Date,
  lastError: { type: String, maxlength: 4000 },
  lastErrorCode: { type: String, maxlength: 100 },
  failureReason: { type: String, maxlength: 100 },
  retryable: Boolean,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

webhookEventSchema.index({ shop: 1, webhookId: 1 }, { unique: true });
webhookEventSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
webhookEventSchema.index({ shop: 1, status: 1, deadAt: -1 });
webhookEventSchema.index({ shop: 1, topic: 1, createdAt: -1 });

export const WebhookEvent = mongoose.models.WebhookEvent || mongoose.model("WebhookEvent", webhookEventSchema);
