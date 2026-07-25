import mongoose from "mongoose";

export const EMI_SCHEDULE_STATUSES = Object.freeze({
  ACTIVE: "active",
  SETTLED: "settled"
});

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
    status: {
      type: String,
      enum: Object.values(EMI_SCHEDULE_STATUSES),
      default: EMI_SCHEDULE_STATUSES.ACTIVE
    },
    settlementTime: Date,
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
