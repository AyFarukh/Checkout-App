import mongoose from "mongoose";

const shopifySyncJobSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true, trim: true },
  type: { type: String, required: true, enum: ["REWARD_SYNC"] },
  aggregateId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  aggregateVersion: { type: Number, required: true, min: 1 },
  idempotencyKey: { type: String, required: true },
  status: { type: String, enum: ["PENDING", "PROCESSING", "SYNCED", "FAILED", "SUPERSEDED"], default: "PENDING", index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: Date,
  lastError: String,
  completedAt: Date,
}, { timestamps: true });
shopifySyncJobSchema.index({ shop: 1, idempotencyKey: 1 }, { unique: true });
shopifySyncJobSchema.index({ status: 1, nextAttemptAt: 1 });
export const ShopifySyncJob = mongoose.models.ShopifySyncJob || mongoose.model("ShopifySyncJob", shopifySyncJobSchema);
