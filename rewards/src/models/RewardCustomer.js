import mongoose from "mongoose";
const rewardCustomerSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true, trim: true },
  shopifyCustomerId: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true }, firstName: { type: String, trim: true }, lastName: { type: String, trim: true },
  pointsBalance: { type: Number, default: 0, min: 0 },
  pointsReserved: { type: Number, default: 0, min: 0 },
  lifetimeEarned: { type: Number, default: 0, min: 0 }, lifetimeRedeemed: { type: Number, default: 0, min: 0 }, lifetimeExpired: { type: Number, default: 0, min: 0 },
  tier: { type: String, default: "ROOT_MEMBER", trim: true },
}, { timestamps: true });
rewardCustomerSchema.index({ shop: 1, shopifyCustomerId: 1 }, { unique: true });rewardCustomerSchema.index({ shop: 1, email: 1 });
export const RewardCustomer = mongoose.models.RewardCustomer || mongoose.model("RewardCustomer", rewardCustomerSchema);
