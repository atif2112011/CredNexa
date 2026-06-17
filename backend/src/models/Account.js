import mongoose from "mongoose";

import { ACCOUNT_ROLES } from "../constants/roles.js";

const accountSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      lowercase: true,
      trim: true
    },
    mobile: {
      type: String,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true,
      select: true
    },
    role: {
      type: String,
      enum: Object.values(ACCOUNT_ROLES),
      required: true
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner"
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant"
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastLoginAt: {
      type: Date
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

accountSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: "string" } },
    name: "account_email_optional_unique"
  }
);

accountSchema.index({ mobile: 1 }, { name: "account_mobile_lookup" });

export const Account = mongoose.model("Account", accountSchema);
