import mongoose from "mongoose";

export const COMPANY_SUPPORT_CONTACT_KEY = "global";

const companySupportContactSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: COMPANY_SUPPORT_CONTACT_KEY,
      unique: true
    },
    supportEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: ""
    },
    supportPhone: {
      type: String,
      trim: true,
      default: ""
    },
    supportWhatsapp: {
      type: String,
      trim: true,
      default: ""
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const CompanySupportContact = mongoose.model("CompanySupportContact", companySupportContactSchema);
