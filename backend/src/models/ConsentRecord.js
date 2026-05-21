import mongoose from "mongoose";

const consentRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true
    },
    consentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ConsentVersion",
      required: true
    },
    consentVersion: {
      type: String,
      required: true
    },
    enrollmentTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnrollmentToken",
      required: true
    },
    aadhaarVerificationRef: {
      type: String,
      required: true
    },
    verificationSessionId: {
      type: String,
      required: true
    },
    consentCheckboxAccepted: {
      type: Boolean,
      required: true
    },
    acceptedAt: {
      type: Date,
      default: Date.now
    },
    ipAddress: String,
    deviceFingerprint: String,
    verifiedProfile: {
      name: String,
      dob: String,
      address: String,
      aadhaarLinkedMobile: String
    },
    payloadHash: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

export const ConsentRecord = mongoose.model("ConsentRecord", consentRecordSchema);
