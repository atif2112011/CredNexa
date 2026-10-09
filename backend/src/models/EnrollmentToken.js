import mongoose from "mongoose";
import { ENROLLMENT_MODES } from "../constants/enrollmentModes.js";

const enrollmentTokenSchema = new mongoose.Schema(
  {
    token: {
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
    // Running QR secrets are hashed for lookup and encrypted only for authorized re-display.
    runningTokenHash: { type: String, select: false },
    runningTokenCiphertext: { type: String, select: false },
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
    expiresAt: {
      type: Date,
      required: true
    },
    consumedAt: {
      type: Date
    },
    cancelledAt: {
      type: Date
    },
    lastQrGeneratedAt: {
      type: Date
    },
    regeneratedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnrollmentToken"
    },
    regeneratedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnrollmentToken"
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true
    }
  },
  { timestamps: true }
);

enrollmentTokenSchema.index({ runningTokenHash: 1 }, { unique: true, sparse: true });
enrollmentTokenSchema.index({ userId: 1, tenantId: 1, enrollmentMode: 1, createdAt: -1 });

export const EnrollmentToken = mongoose.model("EnrollmentToken", enrollmentTokenSchema);
