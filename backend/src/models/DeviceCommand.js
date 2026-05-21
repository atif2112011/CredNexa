import mongoose from "mongoose";

const deviceCommandSchema = new mongoose.Schema(
  {
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
    commandType: {
      type: String,
      enum: ["LOCK", "UNLOCK", "TEMP_UNLOCK"],
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "sent", "acknowledged", "failed"],
      default: "pending"
    },
    triggeredBy: {
      type: String,
      enum: ["auto_policy", "payment_unlock", "manual_tenant", "partner_admin", "super_admin", "temp_unlock_expiry"],
      required: true
    },
    triggeredByAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    fcmMessageId: String,
    sentAt: Date,
    acknowledgedAt: Date,
    retryCount: {
      type: Number,
      default: 0
    },
    maxRetries: {
      type: Number,
      default: 5
    },
    nextRetryAt: Date
  },
  { timestamps: true }
);

export const DeviceCommand = mongoose.model("DeviceCommand", deviceCommandSchema);
