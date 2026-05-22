import mongoose from "mongoose";

const deviceEventSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true
    },
    eventType: {
      type: String,
      enum: ["ping", "sync", "security"],
      required: true
    },
    severity: {
      type: String,
      enum: ["info", "low", "medium", "high", "critical"],
      default: "info"
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const DeviceEvent = mongoose.model("DeviceEvent", deviceEventSchema);
