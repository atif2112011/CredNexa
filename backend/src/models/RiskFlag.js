import mongoose from "mongoose";

const riskFlagSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium"
    },
    status: {
      type: String,
      enum: ["open", "acknowledged", "resolved"],
      default: "open"
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant"
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner"
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device"
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    caseId: {
      type: String
    },
    message: {
      type: String,
      required: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    acknowledgedAt: Date
  },
  { timestamps: true }
);

export const RiskFlag = mongoose.model("RiskFlag", riskFlagSchema);
