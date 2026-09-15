import mongoose from "mongoose";

const redemptionSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true, trim: true },
  shopifyCustomerId: { type: String, required: true, index: true },
  rewardId: { type: mongoose.Schema.Types.ObjectId, ref: "Reward", required: true, index: true },
  rewardVersion: { type: Number, required: true, min: 1 },
  points: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ["RESERVED", "COMMITTED", "RELEASED", "CANCELLED", "REFUNDED"], default: "RESERVED", index: true },
  requestId: { type: String, required: true },
  publicReference: { type: String, required: true, unique: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: true },
  shopifyCartId: String,
  shopifyOrderId: { type: String, index: true },
  committedAt: Date,
  releasedAt: Date,
  cancelledAt: Date,
  refundedAt: Date,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });
redemptionSchema.index({ shop: 1, shopifyCustomerId: 1, requestId: 1 }, { unique: true });
redemptionSchema.index({ shop: 1, status: 1, expiresAt: 1 });
export const Redemption = mongoose.models.Redemption || mongoose.model("Redemption", redemptionSchema);
