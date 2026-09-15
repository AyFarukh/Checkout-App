import mongoose from "mongoose";

const idempotencyRecordSchema = new mongoose.Schema({
  shop: { type: String, required: true, trim: true, lowercase: true, index: true },
  actorType: { type: String, required: true, enum: ["CUSTOMER", "ADMIN", "SYSTEM"] },
  actorId: { type: String, required: true, trim: true },
  operation: { type: String, required: true, trim: true },
  key: { type: String, required: true, trim: true, minlength: 8, maxlength: 255 },
  requestHash: { type: String, required: true },
  status: { type: String, enum: ["PROCESSING", "COMPLETED", "FAILED"], default: "PROCESSING" },
  resourceType: String,
  resourceId: String,
  responseCode: Number,
  responseBody: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

idempotencyRecordSchema.index({ shop: 1, actorType: 1, actorId: 1, operation: 1, key: 1 }, { unique: true });
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyRecord = mongoose.models.IdempotencyRecord || mongoose.model("IdempotencyRecord", idempotencyRecordSchema);
