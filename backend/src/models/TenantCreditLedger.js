import mongoose from "mongoose";

export const TENANT_CREDIT_LEDGER_TYPES = Object.freeze({
  ADMIN_ADJUSTMENT: "ADMIN_ADJUSTMENT",
  TENANT_CREDIT_PURCHASE: "TENANT_CREDIT_PURCHASE",
  BORROWER_CREATION: "BORROWER_CREATION"
});

const tenantCreditLedgerSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: Object.values(TENANT_CREDIT_LEDGER_TYPES),
      required: true
    },
    delta: {
      type: Number,
      required: true
    },
    balanceBefore: {
      type: Number,
      required: true,
      min: 0
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId
    },
    actorCollection: {
      type: String,
      enum: ["accounts", "users", "system"],
      default: "accounts"
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    reason: {
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

export const TenantCreditLedger = mongoose.model("TenantCreditLedger", tenantCreditLedgerSchema);
