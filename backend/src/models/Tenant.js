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
    imageStoragePath: {
      type: String,
      trim: true
    },
    imageMimeType: {
      type: String,
      trim: true
    },
    imageSize: {
      type: Number,
      min: 0
    },
    imageUploadedAt: Date,
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
      street: {
        type: String,
        required: true,
        trim: true
      },
      city: {
        type: String,
        required: true,
        trim: true
      },
      state: {
        type: String,
        required: true,
        trim: true
      },
      pincode: {
        type: String,
        required: true,
        trim: true
      }
    },
    pocName: {
      type: String,
      required: true,
      trim: true
    },
    pocPhone: {
      type: String,
      required: true,
      trim: true
    },
    pocDesignation: {
      type: String,
      required: true,
      trim: true
    },
    qrCodes: [qrCodeSchema],
    creditBalance: {
      type: Number,
      default: 0,
      min: 0
    },
    creditPurchasePerKeyPrice: {
      type: Number,
      min: 0
    },
    totalCreditsPurchased: {
      type: Number,
      default: 0,
      min: 0
    },
    lifetimeCreditPurchaseAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    lastCreditPurchasedAt: Date,
    dashboardAlerts: {
      pendingEmis: {
        count: {
          type: Number,
          default: 0,
          min: 0
        },
        seenAt: Date
      },
      overdueEmis: {
        count: {
          type: Number,
          default: 0,
          min: 0
        },
        seenAt: Date
      },
      approvePayments: {
        count: {
          type: Number,
          default: 0,
          min: 0
        },
        seenAt: Date
      },
      unlockRequests: {
        count: {
          type: Number,
          default: 0,
          min: 0
        },
        seenAt: Date
      }
    },
    metrics: {
      borrowers: {
        total: {
          type: Number,
          default: 0,
          min: 0
        }
      },
      devices: {
        total: {
          type: Number,
          default: 0,
          min: 0
        }
      },
      cases: {
        open: {
          type: Number,
          default: 0,
          min: 0
        },
        escalatedToPartner: {
          type: Number,
          default: 0,
          min: 0
        }
      },
      updatedAt: Date
    },
    isAdhaarVerificationEnabled: {
      type: Boolean,
      default: false
    },
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

export const Tenant = mongoose.model("Tenant", tenantSchema);
