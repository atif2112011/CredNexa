import { env } from "../../config/env.js";
import { PARTNER_LEAD_TYPES, PartnerLead } from "../../models/PartnerLead.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";

const clean = (value, maxLength) =>
  String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);

const cleanSource = (source = {}) => ({
  page: clean(source.page, 500) || undefined,
  referrer: clean(source.referrer, 500) || undefined,
  utmSource: clean(source.utmSource, 120) || undefined,
  utmMedium: clean(source.utmMedium, 120) || undefined,
  utmCampaign: clean(source.utmCampaign, 120) || undefined
});

const notifyTeam = async (lead) => {
  if (!env.partnerLeadWebhookUrl) return "not_configured";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(env.partnerLeadWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "partner_lead.created",
        lead: {
          id: lead.id,
          name: lead.name,
          mobile: lead.mobile,
          workEmail: lead.workEmail,
          organization: lead.organization,
          city: lead.city,
          partnerType: lead.partnerType,
          source: lead.source,
          createdAt: lead.createdAt
        }
      }),
      signal: controller.signal
    });

    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
};

export const createPartnerLead = async (req, res) => {
  try {
    // Honeypot field: silently accept bot submissions without storing them.
    if (clean(req.body.website, 200)) {
      return sendSuccess(res, 201, "Partnership inquiry received", null);
    }

    const leadData = {
      name: clean(req.body.name, 120),
      mobile: clean(req.body.mobile, 20).replace(/\D/g, ""),
      workEmail: clean(req.body.workEmail, 180).toLowerCase() || undefined,
      organization: clean(req.body.organization, 180),
      city: clean(req.body.city, 100),
      partnerType: clean(req.body.partnerType, 40),
      consent: req.body.consent === true,
      source: cleanSource(req.body.source)
    };

    if (!leadData.name || !leadData.mobile || !leadData.organization || !leadData.city || !leadData.partnerType) {
      return sendError(res, 400, "Name, mobile, organisation, city, and partner type are required");
    }
    if (!/^[6-9]\d{9}$/.test(leadData.mobile)) {
      return sendError(res, 400, "A valid 10 digit Indian mobile number is required");
    }
    if (leadData.workEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadData.workEmail)) {
      return sendError(res, 400, "A valid work email is required");
    }
    if (!PARTNER_LEAD_TYPES.includes(leadData.partnerType)) {
      return sendError(res, 400, "Select a valid organisation type");
    }
    if (!leadData.consent) {
      return sendError(res, 400, "Consent to contact is required");
    }

    const recentLead = await PartnerLead.findOne({
      mobile: leadData.mobile,
      createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) }
    }).lean();

    if (recentLead) {
      return sendSuccess(res, 200, "Partnership inquiry already received", {
        requestId: recentLead._id
      });
    }

    const lead = await PartnerLead.create({
      ...leadData,
      notificationStatus: env.partnerLeadWebhookUrl ? "pending" : "not_configured"
    });

    const notificationStatus = await notifyTeam(lead);
    if (notificationStatus !== lead.notificationStatus) {
      await PartnerLead.updateOne({ _id: lead._id }, { notificationStatus });
    }

    return sendSuccess(res, 201, "Partnership inquiry received", {
      requestId: lead._id
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Unable to submit partnership inquiry");
  }
};
