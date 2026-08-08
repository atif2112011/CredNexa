import mongoose from "mongoose";

export const PARTNER_LEAD_TYPES = [
  "retail_network",
  "nbfc_lender",
  "independent",
  "other"
];

const partnerLeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    mobile: { type: String, required: true, trim: true, index: true },
    workEmail: { type: String, trim: true, lowercase: true, maxlength: 180 },
    organization: { type: String, required: true, trim: true, maxlength: 180 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    partnerType: { type: String, enum: PARTNER_LEAD_TYPES, required: true },
    consent: { type: Boolean, required: true },
    source: {
      page: { type: String, trim: true, maxlength: 500 },
      referrer: { type: String, trim: true, maxlength: 500 },
      utmSource: { type: String, trim: true, maxlength: 120 },
      utmMedium: { type: String, trim: true, maxlength: 120 },
      utmCampaign: { type: String, trim: true, maxlength: 120 }
    },
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "not_a_fit", "converted"],
      default: "new",
      index: true
    },
    notificationStatus: {
      type: String,
      enum: ["not_configured", "pending", "sent", "failed"],
      default: "not_configured"
    }
  },
  { timestamps: true }
);

partnerLeadSchema.index({ createdAt: -1 });

export const PartnerLead = mongoose.model("PartnerLead", partnerLeadSchema);
