import mongoose from "mongoose";

const unlockRequestSchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner",
      required: true
    },
    status: {
      type: String,
      enum: [
        "PENDING_TENANT",
        "ESCALATED_PARTNER",
        "ESCALATED_ADMIN",
        "UNDER_REVIEW",
        "RESOLVED_TENANT",
        "RESOLVED_PARTNER",
        "RESOLVED_SUPER_ADMIN",
        "REJECTED",
        "CLOSED"
      ],
      default: "PENDING_TENANT"
    },
    reason: {
      type: String,
      required: true
    },
    reasonCategory: {
      type: String,
      enum: ["payment_made", "temporary_emergency", "gateway_issue", "payment_mismatch", "other"],
      default: "other"
    },
    details: {
      type: String
    },
    imageUrl: {
      type: String
    },
    slaDeadline: {
      type: Date
    },
    partnerSlaDeadline: {
      type: Date
    },
    escalatedToPartnerAt: {
      type: Date
    },
    escalatedToAdminAt: {
      type: Date
    },
    resolutionAction: {
      type: String,
      enum: ["unlocked", "temp_unlocked", "rejected", "waived", "override", null],
      default: null
    },
    resolutionNote: {
      type: String
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    resolvedAt: {
      type: Date
    },
    tempUnlockDurationHours: {
      type: Number
    }
  },
  { timestamps: true }
);

export const UnlockRequest = mongoose.model("UnlockRequest", unlockRequestSchema);
