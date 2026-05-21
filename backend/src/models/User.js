import mongoose from "mongoose";

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
    loanAmount: Number,
    emiAmount: Number,
    tenureMonths: Number,
    disbursementDate: Date,
    consentRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ConsentRecord"
    },
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

userSchema.index({ mobile: 1 }, { unique: true });
userSchema.index({ loanId: 1 }, { unique: true });
userSchema.index({ tenantId: 1 });

export const User = mongoose.model("User", userSchema);
