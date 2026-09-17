import mongoose from "mongoose";

const redemptionSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true, trim: true, lowercase: true },
  shopifyCustomerId: { type: String, required: true, index: true },
  rewardId: { type: mongoose.Schema.Types.ObjectId, ref: "Reward", required: true, index: true },
  rewardVersion: { type: Number, required: true, min: 1 },
  points: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ["RESERVED", "COMMITTED", "RELEASED", "CANCELLED", "REFUNDED"], default: "RESERVED", index: true },
  requestId: { type: String, required: true },
  publicReference: { type: String, required: true, unique: true },
  tokenHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: true },
  shopifyCartId: String,
  shopifyOrderId: { type: String, index: true },
  shopifyDiscountId: { type: String, index: true },
  discountCode: { type: String, index: true },
  discountCreatedAt: Date,
  committedAt: Date,
  releasedAt: Date,
  cancelledAt: Date,
  refundedAt: Date,
  refundedPoints: { type: Number, default: 0, min: 0 },
  refundIds: { type: [String], default: [] },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });
redemptionSchema.index({ shop: 1, shopifyCustomerId: 1, requestId: 1 }, { unique: true });
redemptionSchema.index({ shop: 1, status: 1, expiresAt: 1 });
redemptionSchema.index({ shop: 1, shopifyOrderId: 1, status: 1 });
redemptionSchema.index({ shop: 1, discountCode: 1 }, { sparse: true });
export const Redemption = mongoose.models.Redemption || mongoose.model("Redemption", redemptionSchema);
