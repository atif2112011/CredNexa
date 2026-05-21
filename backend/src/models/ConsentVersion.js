import mongoose from "mongoose";

const consentVersionSchema = new mongoose.Schema(
  {
    version: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    borrowerAgreementText: {
      type: String,
      required: true
    },
    deviceControlConsentText: {
      type: String,
      required: true
    },
    privacyPolicyText: {
      type: String,
      required: true
    },
    tripartiteAckText: {
      type: String
    },
    isCurrent: {
      type: Boolean,
      default: false
    },
    publishedAt: {
      type: Date
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

export const ConsentVersion = mongoose.model("ConsentVersion", consentVersionSchema);
