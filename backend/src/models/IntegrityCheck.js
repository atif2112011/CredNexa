import mongoose from "mongoose";

const integrityCheckSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device"
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
    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeviceIntegrityChallenge"
    },
    checkType: {
      type: String,
      enum: ["periodic", "on_demand", "app_start", "boot", "foreground", "pre_critical_action", "onboarding", "unknown"],
      default: "unknown"
    },
    triggerReason: {
      type: String,
      trim: true
    },
    requestHash: {
      type: String,
      trim: true
    },
    nonce: {
      type: String,
      trim: true
    },
    tokenReceivedAt: Date,
    verdictTimestampMillis: String,
    verifiedAt: Date,
    packageName: String,
    appIntegrityVerdict: String,
    deviceRecognitionVerdict: {
      type: [String],
      default: []
    },
    playProtectVerdict: String,
    appAccessRiskVerdict: String,
    localSignals: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    decision: {
      type: String,
      enum: ["allow", "retry", "manual_review", "block"]
    },
    observedDecision: String,
    integrityStatus: String,
    reasonCode: String,
    result: {
      type: String,
      enum: ["clean", "risk_found", "invalid", "stale", "error"],
      default: "clean"
    },
    createdRiskIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RiskFlag"
      }
    ],
    resolvedRiskIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RiskFlag"
      }
    ],
    rawVerdictSafeSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    providerError: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

integrityCheckSchema.index({ deviceId: 1, createdAt: -1 });
integrityCheckSchema.index({ userId: 1, createdAt: -1 });
integrityCheckSchema.index({ tenantId: 1, result: 1, createdAt: -1 });
integrityCheckSchema.index({ challengeId: 1 });

export const IntegrityCheck = mongoose.model("IntegrityCheck", integrityCheckSchema);
