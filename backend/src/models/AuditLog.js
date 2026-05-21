import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      trim: true
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId
    },
    actorCollection: {
      type: String,
      enum: ["accounts", "users", "system"],
      default: "accounts"
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant"
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner"
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device"
    },
    caseId: {
      type: String
    },
    reason: {
      type: String
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    logHash: {
      type: String
    }
  },
  { timestamps: { createdAt: "timestamp", updatedAt: false } }
);

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
