import mongoose from "mongoose";

const rewardSettingsSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, unique: true, trim: true },
    pointNameSingular: { type: String, default: "point", trim: true },
    pointNamePlural: { type: String, default: "points", trim: true },
    pointsExpireEnabled: { type: Boolean, default: false },
    pointsExpireAfterDays: { type: Number, min: 1, default: 365 },
    earnOnTaxes: { type: Boolean, default: false },
    earnOnShipping: { type: Boolean, default: false },
    earnOnGiftCards: { type: Boolean, default: false },
    refundPolicy: {
      type: String,
      enum: ["REVERSE_PROPORTIONAL", "REVERSE_FULL", "NO_REVERSAL"],
      default: "REVERSE_PROPORTIONAL",
    },
    allowDiscountCombinations: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const RewardSettings =
  mongoose.models.RewardSettings || mongoose.model("RewardSettings", rewardSettingsSchema);
