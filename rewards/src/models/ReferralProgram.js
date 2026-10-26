import mongoose from "mongoose";

const milestone = new mongoose.Schema({
  id: { type: String, required: true }, threshold: { type: Number, required: true },
  title: { type: String, required: true }, kind: { type: String, enum: ["REFERRAL_POINTS", "POINTS", "PRODUCT"], required: true },
  points: { type: Number, default: 0 }, quantity: { type: Number, default: 1 },
  productId: { type: String, default: null }, variantId: { type: String, default: null },
  productTitle: { type: String, default: "" }, variantTitle: { type: String, default: "" },
}, { _id: false });
const schema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  revision: { type: Number, required: true, default: 0 },
  liveEnabled: { type: Boolean, default: false },
  friendDiscountAmount: { type: Number, required: true, default: 10 },
  referrerPoints: { type: Number, required: true, default: 200 },
  minimumOrderAmount: { type: Number, default: 0 },
  attributionDays: { type: Number, default: 30 },
  milestones: { type: [milestone], default: [] },
}, { timestamps: true });
export const ReferralProgram = mongoose.models.ReferralProgram || mongoose.model("ReferralProgram", schema);
