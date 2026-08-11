import mongoose from "mongoose";

import { DEVICE_CONTROL_MODES } from "../constants/tenant.js";

const tenantPolicySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      unique: true
    },
    version: {
      type: Number,
      default: 1
    },
    deviceControlRules: {
      mode: {
        type: String,
        enum: Object.values(DEVICE_CONTROL_MODES),
        default: DEVICE_CONTROL_MODES.EMI_AUTOMATED,
        immutable: true
      }
    },
    lockRules: {
      dpd: { type: Number, default: 30 },
      gracePeriodDays: { type: Number, default: 7 },
      lockOnGraceExpiry: { type: Boolean, default: true }
    },
    unlockRules: {
      unlockType: {
        type: String,
        enum: ["instant", "delayed", "partial"],
        default: "instant"
      },
      delayMinutes: { type: Number, default: 0 },
      requireFullPayment: { type: Boolean, default: true },
      partialUnlockOnPartialPayment: { type: Boolean, default: false },
      requireReasonOnManualUnlock: { type: Boolean, default: false }
    },
    tempUnlockRules: {
      defaultDurationHours: { type: Number, default: 24 },
      maxDurationHours: { type: Number, default: 72 }
    },
    escalationRules: {
      slaHours: { type: Number, default: 24 },
      partnerEscalationSlaHours: { type: Number, default: 48 },
      autoEscalateOnSLABreach: { type: Boolean, default: true }
    },
    riskRules: {
      autoLockOnCriticalSecurityRisk: { type: Boolean, default: true },
      destructiveEnforcementEnabled: { type: Boolean, default: false },
      wipeRequiresAdminAction: { type: Boolean, default: true },
      autoLockTypes: {
        type: [String],
        default: [
          // Confirmed/permanent device compromise.
          "ROOT_DETECTED",
          "TAMPER_DETECTED",
          "SYSTEM_TAMPER_DETECTED",
          "CUSTOM_ROM_DETECTED",
          "BOOTLOADER_UNLOCKED",
          "DEVICE_INTEGRITY_COMPROMISED",
          // Critical app compromise. Protocol/config mismatch and warning-only settings
          // are intentionally excluded from default auto-lock.
          "APP_INTEGRITY_COMPROMISED",
          "APP_TAMPER_DETECTED"
        ]
      }
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

export const TenantPolicy = mongoose.model("TenantPolicy", tenantPolicySchema);
