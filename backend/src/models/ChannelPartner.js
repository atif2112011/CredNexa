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
    adminAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
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
