import mongoose from "mongoose";
import { ENROLLMENT_MODES } from "../constants/enrollmentModes.js";

const consentVersionSchema = new mongoose.Schema(
  {
    version: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    enrollmentMode: {
      type: String,
      enum: Object.values(ENROLLMENT_MODES),
      default: ENROLLMENT_MODES.DEVICE_OWNER_QR
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
