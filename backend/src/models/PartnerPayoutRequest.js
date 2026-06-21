import mongoose from "mongoose";

export const PARTNER_PAYOUT_STATUSES = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED"
});

const partnerPayoutRequestSchema = new mongoose.Schema(
  {
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner",
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: Object.values(PARTNER_PAYOUT_STATUSES),
      default: PARTNER_PAYOUT_STATUSES.PENDING,
      index: true
    },
    upiId: {
      type: String,
      required: true,
      trim: true
    },
    upiName: {
      type: String,
      required: true,
      trim: true
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true
    },
    requestedAt: {
      type: Date,
      default: Date.now
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    approvedAt: Date,
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    rejectedAt: Date,
    rejectionReason: {
      type: String,
      trim: true
    },
    adminReferenceId: {
      type: String,
      trim: true
    },
    paymentProof: {
      imageUrl: String,
      storagePath: String,
      mimeType: String,
      originalName: String,
      size: Number,
      uploadedAt: Date
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const PartnerPayoutRequest = mongoose.model("PartnerPayoutRequest", partnerPayoutRequestSchema);
