import mongoose from "mongoose";

const ALLOWED_ACTIONS = [
  "ONBOARDING_PRE_REGISTRATION",
  "APP_STARTUP",
  "DAILY_HEARTBEAT",
  "BEFORE_POLICY_SYNC",
  "BEFORE_UNLOCK",
  "SUSPICIOUS_SIGNAL"
];

const deviceIntegrityChallengeSchema = new mongoose.Schema(
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
    enrollmentTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnrollmentToken"
    },
    action: {
      type: String,
      enum: ALLOWED_ACTIONS,
      required: true
    },
    requestHash: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    nonce: {
      type: String,
      required: true,
      trim: true
    },
    deviceContext: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    expiresAt: {
      type: Date,
      required: true
    },
    consumedAt: Date,
    verifiedAt: Date,
    decision: {
      type: String,
      enum: ["allow", "retry", "manual_review", "block"]
    },
    integrityStatus: {
      type: String,
      enum: ["pending", "passed", "failed", "temporary_failure", "observed_failure"],
      default: "pending"
    },
    reasonCode: String,
    verificationSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

deviceIntegrityChallengeSchema.index({ userId: 1, action: 1, consumedAt: 1 });
deviceIntegrityChallengeSchema.index({ expiresAt: 1 });

export const DEVICE_INTEGRITY_ACTIONS = Object.freeze(
  ALLOWED_ACTIONS.reduce((acc, action) => ({ ...acc, [action]: action }), {})
);

export const DeviceIntegrityChallenge = mongoose.model("DeviceIntegrityChallenge", deviceIntegrityChallengeSchema);
