import mongoose from "mongoose";

export const RISK_FLAG_STATUSES = Object.freeze({
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
  WARNING_PENDING: "warning_pending",
  REMEDIATION_REQUIRED: "remediation_required",
  LOCKED: "locked",
  COMPROMISED_PERMANENT: "compromised_permanent",
  WIPED_PENDING_REPROVISION: "wiped_pending_reprovision",
  CLEARED: "cleared",
  TEMP_OVERRIDDEN: "temp_overridden",
  FALSE_POSITIVE: "false_positive"
});

export const INACTIVE_RISK_FLAG_STATUSES = [
  RISK_FLAG_STATUSES.RESOLVED,
  RISK_FLAG_STATUSES.CLEARED,
  RISK_FLAG_STATUSES.FALSE_POSITIVE
];

const riskFlagSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true
    },
    riskType: {
      type: String,
      trim: true
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium"
    },
    status: {
      type: String,
      enum: Object.values(RISK_FLAG_STATUSES),
      default: "open"
    },
    riskBucket: {
      type: String,
      enum: [
        "device_compromise",
        "app_compromise",
        "protocol_mismatch",
        "play_protect",
        "remediable_setting",
        "stale_integrity",
        "operational",
        "unknown"
      ],
      default: "unknown"
    },
    remediationMethod: {
      type: String,
      enum: [
        "warning_only",
        "user_fix",
        "app_update",
        "reinstall",
        "reset_reprovision",
        "physical_recovery",
        "permanent_block",
        "retry_fresh_challenge",
        "manual_review",
        "none"
      ],
      default: "manual_review"
    },
    source: {
      type: String,
      enum: [
        "server_verified_play_integrity",
        "server_evaluated_local_signal",
        "app_reported_security_event",
        "admin",
        "system"
      ],
      default: "system"
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant"
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner"
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device"
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    caseId: {
      type: String
    },
    message: {
      type: String,
      required: true
    },
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    relatedIntegrityCheckId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IntegrityCheck"
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    firstDetectedAt: {
      type: Date,
      default: Date.now
    },
    lastDetectedAt: Date,
    lastCleanCheckAt: Date,
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    acknowledgedAt: Date,
    acknowledgedNote: String,
    clearedAt: Date,
    clearedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    clearanceReason: String,
    overrideUntil: Date,
    overrideReason: String,
    overrideBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

riskFlagSchema.pre("validate", function ensureRiskType(next) {
  if (!this.riskType && this.type) {
    this.riskType = this.type;
  }
  if (!this.lastDetectedAt) {
    this.lastDetectedAt = this.firstDetectedAt || new Date();
  }
  next();
});

riskFlagSchema.index({ deviceId: 1, status: 1, type: 1 });
riskFlagSchema.index({ tenantId: 1, severity: 1, status: 1, createdAt: -1 });
riskFlagSchema.index({ relatedIntegrityCheckId: 1 });

export const RiskFlag = mongoose.model("RiskFlag", riskFlagSchema);
