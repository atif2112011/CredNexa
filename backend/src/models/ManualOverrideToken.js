import mongoose from "mongoose";

export const MANUAL_OVERRIDE_TOKEN_STATUSES = Object.freeze({
  GENERATED: "GENERATED",
  DOWNLOADED: "DOWNLOADED",
  USED: "USED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
  SUPERSEDED: "SUPERSEDED"
});

const manualOverrideTokenSchema = new mongoose.Schema(
  {
    tokenId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner",
      index: true
    },
    status: {
      type: String,
      enum: Object.values(MANUAL_OVERRIDE_TOKEN_STATUSES),
      default: MANUAL_OVERRIDE_TOKEN_STATUSES.GENERATED,
      index: true
    },
    issuedAt: {
      type: Date,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    usedAt: Date,
    downloadedAt: Date,
    supersededAt: Date,
    revokedAt: Date,
    signedToken: {
      type: String,
      required: true
    },
    qrDataUrl: {
      type: String,
      required: true
    },
    reason: {
      type: String,
      trim: true
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    downloadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    usedSyncEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeviceEvent"
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

manualOverrideTokenSchema.index({ deviceId: 1, status: 1, expiresAt: 1 });
manualOverrideTokenSchema.index({ tenantId: 1, status: 1, expiresAt: 1 });

export const ManualOverrideToken = mongoose.model("ManualOverrideToken", manualOverrideTokenSchema);
