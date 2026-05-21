import mongoose from "mongoose";

import { TENANT_CAPABILITIES, TENANT_TYPES } from "../constants/tenant.js";

const qrCodeSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: false
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: Object.values(TENANT_TYPES),
      required: true
    },
    capabilities: {
      type: [String],
      enum: Object.values(TENANT_CAPABILITIES),
      required: true
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner",
      required: true
    },
    parentTenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null
    },
    adminAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    supportPhone: {
      type: String,
      trim: true
    },
    supportEmail: {
      type: String,
      trim: true,
      lowercase: true
    },
    supportWhatsapp: {
      type: String,
      trim: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String
    },
    qrCodes: [qrCodeSchema],
    isActive: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

tenantSchema.index({ channelPartnerId: 1 });
tenantSchema.index({ parentTenantId: 1 });

export const Tenant = mongoose.model("Tenant", tenantSchema);
