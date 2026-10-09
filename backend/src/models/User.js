import mongoose from "mongoose";
import { ENROLLMENT_MODES } from "../constants/enrollmentModes.js";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    aadhaarLinkedMobile: {
      type: String,
      trim: true
    },
    aadhaarVerified: {
      type: Boolean,
      default: false
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true
    },
    loanId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    enrollmentMode: {
      type: String,
      enum: Object.values(ENROLLMENT_MODES),
      default: ENROLLMENT_MODES.DEVICE_OWNER_QR,
      index: true
    },
    loanAmount: Number,
    emiAmount: Number,
    tenureMonths: Number,
    disbursementDate: Date,
    consentRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ConsentRecord"
    },
    isDeviceLinked: {
      type: Boolean,
      default: false
    },
    linkedDeviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device"
    },
    deviceLinkedAt: Date,
    isActive: {
      type: Boolean,
      default: true
    },
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
