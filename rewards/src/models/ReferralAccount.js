import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shop: { type: String, required: true }, customerId: { type: String, required: true },
  code: { type: String, required: true },
}, { timestamps: true });
schema.index({ shop: 1, customerId: 1 }, { unique: true });
schema.index({ shop: 1, code: 1 }, { unique: true });
export const ReferralAccount = mongoose.models.ReferralAccount || mongoose.model("ReferralAccount", schema);
