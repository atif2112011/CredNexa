import mongoose from "mongoose";

const channelPartnerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ["nbfc_group", "retail_chain_group", "independent"],
      required: true
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true
    },
    contactPhone: {
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
      district: {
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
        trim: true,
        match: [/^\d{6}$/, "address.pincode must be a valid 6 digit pincode"]
      }
    },
    adminAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    creditPercentage: {
      type: Number,
      default: 15,
      min: 0,
      max: 100
    },
    pincodeRestrictionEnabled: {
      type: Boolean,
      default: function defaultPincodeRestrictionEnabled() {
        return this.isNew;
      }
    },
    tenantOnboardingLimit: {
      type: Number,
      default: 5,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "tenantOnboardingLimit must be a positive integer"
      }
    },
    tenantOnboardingVersion: {
      type: Number,
      default: 0,
      select: false
    },
    availablePayoutBalance: {
      type: Number,
      default: 0,
      min: 0
    },
    payoutHoldBalance: {
      type: Number,
      default: 0,
      min: 0
    },
    lifetimePayoutEarned: {
      type: Number,
      default: 0,
      min: 0
    },
    lifetimePayoutPaid: {
      type: Number,
      default: 0,
      min: 0
    },
    payoutUpiId: {
      type: String,
      trim: true
    },
    payoutUpiName: {
      type: String,
      trim: true
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

export const ChannelPartner = mongoose.model("ChannelPartner", channelPartnerSchema);
