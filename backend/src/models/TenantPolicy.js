import mongoose from "mongoose";

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
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

export const TenantPolicy = mongoose.model("TenantPolicy", tenantPolicySchema);
