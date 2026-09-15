import mongoose from "mongoose";
const webhookEventSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true, trim: true },
  webhookId: { type: String, required: true },
  topic: { type: String, required: true, index: true },
  status: { type: String, enum: ["PENDING", "PROCESSING", "PROCESSED", "FAILED"], default: "PENDING", index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: Date,
  processedAt: Date,
  lastError: String,
}, { timestamps: true });
webhookEventSchema.index({ shop: 1, webhookId: 1 }, { unique: true });
webhookEventSchema.index({ status: 1, nextAttemptAt: 1 });
export const WebhookEvent = mongoose.models.WebhookEvent || mongoose.model("WebhookEvent", webhookEventSchema);
