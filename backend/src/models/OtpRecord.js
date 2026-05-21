import mongoose from "mongoose";

const otpRecordSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      trim: true
    },
    otpHash: {
      type: String,
      required: true
    },
    purpose: {
      type: String,
      enum: ["login", "consent", "aadhaar_consent"],
      required: true
    },
    verificationSessionId: {
      type: String,
      required: true,
      trim: true
    },
    enrollmentTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnrollmentToken"
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    provider: {
      type: String,
      default: "cashfree_mock"
    },
    providerReferenceId: String,
    verified: {
      type: Boolean,
      default: false
    },
    attempts: {
      type: Number,
      default: 0
    },
    maxAttempts: {
      type: Number,
      default: 3
    },
    expiresAt: {
      type: Date,
      required: true
    },
    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const OtpRecord = mongoose.model("OtpRecord", otpRecordSchema);
