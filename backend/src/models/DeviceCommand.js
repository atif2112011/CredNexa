import mongoose from "mongoose";

import { DEVICE_STATES } from "../constants/deviceStates.js";
import { Device } from "./Device.js";

export const DEVICE_COMMAND_FAILURE_SOURCES = Object.freeze({
  DELIVERY: "delivery",
  DEVICE_ENFORCEMENT: "device_enforcement"
});

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
      enum: [
        "LOCK",
        "UNLOCK",
        "TEMP_UNLOCK",
        "POLICY_UPDATE",
        "UPCOMING_PAYMENT",
        "NOTIFICATION",
        "RUN_INTEGRITY_CHECK",
        "SHOW_REMEDIATION",
        "INSTALL_UPDATE",
        "WIPE_DEVICE",
        "REPROVISION_REQUIRED",
        "RESTRICTIONS_UPDATE",
        "RELEASE_DEVICE",
        "EMI_REMINDER"
      ],
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "sent", "acknowledged", "failed", "expired"],
      default: "pending"
    },
    triggeredBy: {
      type: String,
      enum: [
        "auto_policy",
        "payment_unlock",
        "manual_tenant",
        "partner_admin",
        "super_admin",
        "temp_unlock_expiry",
        "system_notification",
        "risk_management",
        "admin_security",
        "payment_settlement"
      ],
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
    ackPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    failureReason: String,
    failureSource: {
      type: String,
      enum: Object.values(DEVICE_COMMAND_FAILURE_SOURCES)
    },
    retryCount: {
      type: Number,
      default: 0
    },
    maxRetries: {
      type: Number,
      default: 5
    },
    nextRetryAt: Date,
    expiresAt: Date
  },
  { timestamps: true }
);

deviceCommandSchema.pre("validate", async function preventCommandsAfterRelease() {
  if (!this.isNew || this.commandType === "RELEASE_DEVICE") return;

  const device = await Device.findById(this.deviceId).select("state").lean();
  const isReleased = device?.state === DEVICE_STATES.RELEASED;
  const isReleasePending = device?.state === DEVICE_STATES.RELEASE_PENDING;
  const notificationAllowedWhilePending =
    isReleasePending && this.commandType === "NOTIFICATION";

  if (isReleased || (isReleasePending && !notificationAllowedWhilePending)) {
    const error = new Error("Device release is pending or complete; management commands are no longer allowed");
    error.statusCode = 409;
    throw error;
  }
});

export const DeviceCommand = mongoose.model("DeviceCommand", deviceCommandSchema);
