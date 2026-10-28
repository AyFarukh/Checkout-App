import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shop: { type: String, required: true }, friendId: { type: String, required: true }, referrerId: { type: String, required: true },
  referralCode: { type: String, required: true }, discountCode: { type: String, required: true }, discountId: String,
  policy: { type: mongoose.Schema.Types.Mixed, required: true }, expiresAt: { type: Date, required: true },
  status: { type: String, enum: ["PENDING", "QUALIFIED", "REVOKED"], default: "PENDING" },
  orderId: String, originalCents: Number, refundedCents: { type: Number, default: 0 },
  settledPoints: { type: Number, default: 0 }, settlementVersion: { type: Number, default: 0 },
  issueLock: String, issueLockUntil: Date,
}, { timestamps: true });
schema.index({ shop: 1, friendId: 1 }, { unique: true });
schema.index({ shop: 1, discountCode: 1 }, { unique: true });
schema.index({ shop: 1, referrerId: 1, status: 1 });
schema.index({ shop: 1, orderId: 1 });
export const ReferralClaim = mongoose.models.ReferralClaim || mongoose.model("ReferralClaim", schema);
