import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shop: { type: String, required: true }, customerId: { type: String, required: true }, milestoneId: { type: String, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true }, qualified: { type: Boolean, default: true },
  status: { type: String, enum: ["AVAILABLE", "ISSUED", "CONSUMED", "REFUNDED"], default: "AVAILABLE" },
  discountCode: String, discountId: String, expiresAt: Date, consumedOrderId: String,
  settledPoints: { type: Number, default: 0 }, settlementVersion: { type: Number, default: 0 },
  issueLock: String, issueLockUntil: Date,
  syncAction: { type: String, enum: ["ENABLE", "DISABLE", null], default: null },
  syncLock: String, syncLockUntil: Date, nextSyncAt: Date,
}, { timestamps: true });
schema.index({ shop: 1, customerId: 1, milestoneId: 1 }, { unique: true });
schema.index({ shop: 1, discountCode: 1 }, { sparse: true });
schema.index({ syncAction: 1 });
export const ReferralEntitlement = mongoose.models.ReferralEntitlement || mongoose.model("ReferralEntitlement", schema);
