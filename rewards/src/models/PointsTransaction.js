import mongoose from "mongoose";

const pointsTransactionSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, index: true, trim: true },
    shopifyCustomerId: { type: String, required: true, index: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["EARN", "REDEEM", "ADJUST", "REFUND", "EXPIRE", "REVERSAL"],
    },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    source: { type: String, required: true, trim: true },
    shopifyOrderId: { type: String, trim: true },
    rewardId: { type: mongoose.Schema.Types.ObjectId, ref: "Reward" },
    reason: { type: String, trim: true },
    note: { type: String, trim: true },
    createdBy: { type: String, default: "system", trim: true },
    idempotencyKey: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

pointsTransactionSchema.index(
  { shop: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);
pointsTransactionSchema.index({ shop: 1, shopifyCustomerId: 1, createdAt: -1 });

pointsTransactionSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany"], function () {
  throw new Error("Points transactions are immutable. Create a reversal transaction instead.");
});

export const PointsTransaction =
  mongoose.models.PointsTransaction ||
  mongoose.model("PointsTransaction", pointsTransactionSchema);
