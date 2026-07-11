import mongoose from "mongoose";

import { ACCOUNT_ROLES } from "../constants/roles.js";

const passwordResetTokenSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: Object.values(ACCOUNT_ROLES),
      required: true
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    usedAt: {
      type: Date
    },
    verificationSessionId: {
      type: String,
      required: true,
      trim: true
    }
  },
  { timestamps: true }
);

passwordResetTokenSchema.index({ accountId: 1, usedAt: 1, expiresAt: 1 }, { name: "password_reset_account_status_lookup" });

export const PasswordResetToken = mongoose.model("PasswordResetToken", passwordResetTokenSchema);
