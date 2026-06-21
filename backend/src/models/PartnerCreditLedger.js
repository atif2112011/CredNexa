import mongoose from "mongoose";

export const PARTNER_CREDIT_LEDGER_TYPES = Object.freeze({
  TENANT_KEY_PURCHASE_COMMISSION: "TENANT_KEY_PURCHASE_COMMISSION",
  PAYOUT_REQUEST_HOLD: "PAYOUT_REQUEST_HOLD",
  PAYOUT_REJECTED_RELEASE: "PAYOUT_REJECTED_RELEASE",
  PAYOUT_APPROVED_PAID: "PAYOUT_APPROVED_PAID",
  ADMIN_ADJUSTMENT: "ADMIN_ADJUSTMENT"
});

export const PARTNER_CREDIT_BALANCE_TYPES = Object.freeze({
  AVAILABLE: "AVAILABLE",
  HOLD: "HOLD"
});

const partnerCreditLedgerSchema = new mongoose.Schema(
  {
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner",
      required: true,
      index: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant"
    },
    tenantCreditLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantCreditLedger"
    },
    payoutRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PartnerPayoutRequest"
    },
    type: {
      type: String,
      enum: Object.values(PARTNER_CREDIT_LEDGER_TYPES),
      required: true
    },
    balanceType: {
      type: String,
      enum: Object.values(PARTNER_CREDIT_BALANCE_TYPES),
      default: PARTNER_CREDIT_BALANCE_TYPES.AVAILABLE
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
    keysPurchased: {
      type: Number,
      min: 0
    },
    perKeyPrice: {
      type: Number,
      min: 0
    },
    purchaseAmount: {
      type: Number,
      min: 0
    },
    creditPercentage: {
      type: Number,
      min: 0,
      max: 100
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId
    },
    actorCollection: {
      type: String,
      enum: ["accounts", "users", "system"],
      default: "accounts"
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

export const PartnerCreditLedger = mongoose.model("PartnerCreditLedger", partnerCreditLedgerSchema);
