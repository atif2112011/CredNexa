import mongoose from "mongoose";

const installmentSchema = new mongoose.Schema(
  {
    installmentNumber: {
      type: Number,
      required: true
    },
    dueDate: {
      type: Date,
      required: true
    },
    principalAmount: Number,
    interestAmount: Number,
    emiAmount: {
      type: Number,
      required: true
    },
    penaltyAmount: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ["pending", "paid", "overdue", "partial", "waived"],
      default: "pending"
    },
    paidAmount: {
      type: Number,
      default: 0
    },
    paidAt: Date,
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment"
    },
    waivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    waivedAt: Date,
    waiveReason: String
  },
  { _id: true }
);

const emiScheduleSchema = new mongoose.Schema(
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
    loanId: {
      type: String,
      required: true,
      trim: true
    },
    installments: [installmentSchema],
    overdueAmount: {
      type: Number,
      default: 0
    },
    overdueInstallments: {
      type: Number,
      default: 0
    },
    dpd: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

export const EmiSchedule = mongoose.model("EmiSchedule", emiScheduleSchema);
