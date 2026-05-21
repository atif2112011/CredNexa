import mongoose from "mongoose";

import { DEVICE_POLICY_KEYS } from "../constants/deviceStates.js";

const devicePolicySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true
    },
    policyKey: {
      type: String,
      enum: Object.values(DEVICE_POLICY_KEYS),
      required: true
    },
    restrictions: {
      lockMode: { type: Boolean, default: false },
      allowedApps: [{ type: String, trim: true }],
      blockedApps: [{ type: String, trim: true }],
      disableFactoryReset: { type: Boolean, default: true },
      disableStatusBar: { type: Boolean, default: false },
      disableAdb: { type: Boolean, default: false }
    },
    version: {
      type: Number,
      default: 1
    },
    isActive: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

export const DevicePolicy = mongoose.model("DevicePolicy", devicePolicySchema);
