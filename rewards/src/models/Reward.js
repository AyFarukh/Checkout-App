import mongoose from "mongoose";

const rewardSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["FIXED_DISCOUNT", "PERCENTAGE_DISCOUNT", "FREE_SHIPPING", "FREE_PRODUCT"],
    },
    enabled: { type: Boolean, default: true },
    pointsCost: { type: Number, required: true, min: 1 },
    discountValue: { type: Number, min: 0 },
    minimumSpend: { type: Number, min: 0, default: 0 },
    productId: { type: String, trim: true },
    collectionId: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

rewardSchema.index({ shop: 1, enabled: 1, pointsCost: 1 });

export const Reward = mongoose.models.Reward || mongoose.model("Reward", rewardSchema);
