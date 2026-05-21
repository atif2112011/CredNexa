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
      unique: true,
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
    simChangedAt: Date
  },
  { timestamps: true }
);

deviceSchema.index({ userId: 1, tenantId: 1 });
deviceSchema.index({ imei: 1 }, { unique: true });
deviceSchema.index({ state: 1, tenantId: 1 });

export const Device = mongoose.model("Device", deviceSchema);
