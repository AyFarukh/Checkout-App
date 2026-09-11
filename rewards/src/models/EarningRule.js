import mongoose from "mongoose";

const earningRuleSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["PURCHASE", "ACCOUNT_CREATE", "BIRTHDAY", "REVIEW", "REFERRAL", "MANUAL", "BONUS"],
    },
    enabled: { type: Boolean, default: true },
    points: { type: Number, default: 0, min: 0 },
    pointsPerDollar: { type: Number, default: 0, min: 0 },
    multiplier: { type: Number, default: 1, min: 0 },
    priority: { type: Number, default: 100 },
    conditions: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

earningRuleSchema.index({ shop: 1, type: 1, priority: 1 });

export const EarningRule =
  mongoose.models.EarningRule || mongoose.model("EarningRule", earningRuleSchema);
