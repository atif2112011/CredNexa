import mongoose from "mongoose";

export const PAYOUT_CONSTANTS_KEY = "global";

const payoutConstantsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: PAYOUT_CONSTANTS_KEY,
      unique: true
    },
    defaultPartnerCreditPercentage: {
      type: Number,
      default: 15,
      min: 0,
      max: 100
    },
    minPartnerPayoutAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    maxPartnerPayoutAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    defaultTenantCreditPerKeyPrice: {
      type: Number,
      default: 100,
      min: 0
    },
    minTenantCreditPurchase: {
      type: Number,
      default: 1,
      min: 0
    },
    maxTenantCreditPurchase: {
      type: Number,
      default: 2000,
      min: 0
    },
    adminCreditPurchaseUpiId: {
      type: String,
      default: "test@ybl.in",
      trim: true
    },
    adminCreditPurchaseUpiName: {
      type: String,
      default: "Test Admin",
      trim: true
    },
    adminCreditPurchaseQrImageUrl: {
      type: String,
      default: "https://placehold.co/600x400",
      trim: true
    },
    adminCreditPurchaseQrStoragePath: {
      type: String,
      trim: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const PayoutConstants = mongoose.model("PayoutConstants", payoutConstantsSchema);
