import mongoose from "mongoose";

export const TENANT_CREDIT_PURCHASE_STATUSES = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED"
});

const tenantCreditPurchaseRequestSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner",
      required: true,
      index: true
    },
    requestedCredits: {
      type: Number,
      required: true,
      min: 1
    },
    perKeyPrice: {
      type: Number,
      required: true,
      min: 0
    },
    purchaseAmount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: "INR"
    },
    status: {
      type: String,
      enum: Object.values(TENANT_CREDIT_PURCHASE_STATUSES),
      default: TENANT_CREDIT_PURCHASE_STATUSES.PENDING,
      index: true
    },
    adminPaymentSnapshot: {
      upiId: String,
      upiName: String,
      qrImageUrl: String,
      qrStoragePath: String
    },
    paymentProof: {
      imageUrl: String,
      storagePath: String,
      mimeType: String,
      originalName: String,
      size: Number,
      uploadedAt: Date
    },
    referenceNumber: {
      type: String,
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
    tenantCreditLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantCreditLedger"
    },
    partnerCreditLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PartnerCreditLedger"
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const TenantCreditPurchaseRequest = mongoose.model(
  "TenantCreditPurchaseRequest",
  tenantCreditPurchaseRequestSchema
);
