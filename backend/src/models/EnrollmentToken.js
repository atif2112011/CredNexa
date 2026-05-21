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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true
    }
  },
  { timestamps: true }
);

export const EnrollmentToken = mongoose.model("EnrollmentToken", enrollmentTokenSchema);
