import mongoose from "mongoose";

const adminAuditLogSchema = new mongoose.Schema({
  shop: { type: String, required: true, trim: true, lowercase: true, index: true },
  actorId: { type: String, required: true, trim: true },
  action: { type: String, required: true, enum: ["WEBHOOK_DEAD_RETRY", "REDEMPTION_CANCELLED"] },
  resourceType: { type: String, required: true, enum: ["WebhookEvent", "Redemption"] },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  requestId: { type: String, trim: true },
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });

adminAuditLogSchema.index({ shop: 1, createdAt: -1 });
adminAuditLogSchema.index({ shop: 1, resourceType: 1, resourceId: 1, createdAt: -1 });
adminAuditLogSchema.index({ shop: 1, actorId: 1, createdAt: -1 });

function immutable() { throw new Error("Admin audit logs are immutable"); }
adminAuditLogSchema.pre("updateOne", immutable);
adminAuditLogSchema.pre("updateMany", immutable);
adminAuditLogSchema.pre("findOneAndUpdate", immutable);
adminAuditLogSchema.pre("deleteOne", immutable);
adminAuditLogSchema.pre("deleteMany", immutable);
adminAuditLogSchema.pre("findOneAndDelete", immutable);

export const AdminAuditLog = mongoose.models.AdminAuditLog || mongoose.model("AdminAuditLog", adminAuditLogSchema);
