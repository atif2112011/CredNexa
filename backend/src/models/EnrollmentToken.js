import mongoose from "mongoose";

const enrollmentTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
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

export const EnrollmentToken = mongoose.model("EnrollmentToken", enrollmentTokenSchema);
