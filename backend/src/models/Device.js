import mongoose from "mongoose";

import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../constants/deviceStates.js";

const deviceSchema = new mongoose.Schema(
  {
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
    imei: {
      type: String,
      required: true,
      index: true,
      trim: true
    },
    imei2: {
      type: String,
      trim: true
    },
    deviceModel: String,
    manufacturer: String,
    androidVersion: String,
    appVersion: String,
    simInfo: {
      simOperator: String,
      simSerial: String,
      phoneNumber: String
    },
    fcmToken: String,
    fcmTokenUpdatedAt: Date,
    state: {
      type: String,
      enum: Object.values(DEVICE_STATES),
      default: DEVICE_STATES.ACTIVE
    },
    stateUpdatedAt: {
      type: Date,
      default: Date.now
    },
    stateUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    tempUnlockExpiresAt: Date,
    graceReminderHistory: [
      {
        installmentId: {
          type: mongoose.Schema.Types.ObjectId
        },
        sentAt: {
          type: Date,
          required: true
        },
        graceStartedAt: Date,
        graceExpiresAt: Date,
        commandId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DeviceCommand"
        }
      }
    ],
    currentPolicyKey: {
      type: String,
      enum: Object.values(DEVICE_POLICY_KEYS),
      default: DEVICE_POLICY_KEYS.EMI_PAID
    },
    currentPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DevicePolicy"
    },
    desiredPolicyVersion: {
      type: Number,
      default: 0
    },
    lastAppliedPolicyVersion: {
      type: Number,
      default: 0
    },
    lastPolicyAppliedAt: Date,
    lastSeenAt: Date,
    lastSyncAt: Date,
    batteryLevel: Number,
    networkType: String,
    isOnline: {
      type: Boolean,
      default: false
    },
    isRooted: {
      type: Boolean,
      default: false
    },
    isTampered: {
      type: Boolean,
      default: false
    },
    deviceOwnerStatus: {
      type: String,
      enum: ["CONFIRMED", "UNKNOWN", "LOST"],
      default: "UNKNOWN"
    },
    deviceSecurityState: {
      type: String,
      enum: ["HEALTHY", "WARNING", "LOCKED", "REMEDIATION", "COMPROMISED_PERMANENT", "WIPED_PENDING_REPROVISION"],
      default: "HEALTHY"
    },
    lastIntegrityCheckAt: Date,
    lastCleanIntegrityAt: Date,
    lastRiskAt: Date,
    integrityStaleAfter: Date,
    autoWipeEnabled: {
      type: Boolean,
      default: false
    },
    destructiveEnforcementEnabled: {
      type: Boolean,
      default: false
    },
    currentRiskIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RiskFlag"
      }
    ],
    simChangedAt: Date
  },
  { timestamps: true }
);

export const Device = mongoose.model("Device", deviceSchema);
