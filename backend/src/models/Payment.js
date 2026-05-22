import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
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
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true
    },
    emiScheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmiSchedule"
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: "INR"
    },
    paymentMethod: {
      type: String,
      enum: ["qr"],
      default: "qr"
    },
    qrCodeId: {
      type: mongoose.Schema.Types.ObjectId
    },
    status: {
      type: String,
      enum: ["approval_pending", "success", "rejected"],
      default: "approval_pending"
    },
    approvalStatus: {
      type: String,
      enum: ["pending_approval", "approved", "rejected"],
      default: "pending_approval"
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    approvedAt: Date,
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    rejectedAt: Date,
    rejectionReason: String,
    completedAt: Date,
    matchedInstallments: [
      {
        installmentId: mongoose.Schema.Types.ObjectId,
        amountApplied: Number
      }
    ],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const Payment = mongoose.model("Payment", paymentSchema);
