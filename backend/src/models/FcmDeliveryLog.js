import mongoose from "mongoose";

const fcmDeliveryLogSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device"
    },
    commandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeviceCommand"
    },
    token: String,
    messageType: {
      type: String,
      default: "POLICY_UPDATE"
    },
    status: {
      type: String,
      enum: ["sent", "failed", "skipped"],
      required: true
    },
    providerMessageId: String,
    error: String,
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const FcmDeliveryLog = mongoose.model("FcmDeliveryLog", fcmDeliveryLogSchema);
