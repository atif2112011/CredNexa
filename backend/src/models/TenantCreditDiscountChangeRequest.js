import mongoose from "mongoose";

export const TENANT_CREDIT_DISCOUNT_CHANGE_STATUSES = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED"
});

const discountSlabSchema = new mongoose.Schema(
  {
    minKeys: { type: Number, required: true, min: 0 },
    maxKeys: { type: Number, default: null, min: 0 },
    discountPercentage: { type: Number, required: true, min: 0, max: 50 }
  },
  { _id: false }
);

const tenantCreditDiscountChangeRequestSchema = new mongoose.Schema(
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
    baseConfigVersion: {
      type: Number,
      required: true,
      min: 1
    },
    currentSlabs: {
      type: [discountSlabSchema],
      required: true
    },
    requestedSlabs: {
      type: [discountSlabSchema],
      required: true
    },
    status: {
      type: String,
      enum: Object.values(TENANT_CREDIT_DISCOUNT_CHANGE_STATUSES),
      default: TENANT_CREDIT_DISCOUNT_CHANGE_STATUSES.PENDING,
      index: true
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
    appliedConfigVersion: {
      type: Number,
      min: 1
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    rejectedAt: Date,
    rejectionReason: {
      type: String,
      trim: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

tenantCreditDiscountChangeRequestSchema.index(
  { tenantId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: TENANT_CREDIT_DISCOUNT_CHANGE_STATUSES.PENDING },
    name: "one_pending_tenant_credit_discount_change_per_tenant"
  }
);

export const TenantCreditDiscountChangeRequest = mongoose.model(
  "TenantCreditDiscountChangeRequest",
  tenantCreditDiscountChangeRequestSchema
);
