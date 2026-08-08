import {
  COMPANY_SUPPORT_CONTACT_KEY,
  CompanySupportContact
} from "../models/CompanySupportContact.js";

export const DEFAULT_COMPANY_SUPPORT_CONTACT = Object.freeze({
  supportEmail: "",
  supportPhone: "",
  supportWhatsapp: ""
});

export const getOrCreateCompanySupportContact = async (session) => {
  const query = CompanySupportContact.findOneAndUpdate(
    { key: COMPANY_SUPPORT_CONTACT_KEY },
    {
      $setOnInsert: {
        key: COMPANY_SUPPORT_CONTACT_KEY,
        ...DEFAULT_COMPANY_SUPPORT_CONTACT
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (session) query.session(session);
  return query;
};

export const validateCompanySupportContactPayload = (payload = {}) => {
  const updates = {};

  if (payload.supportEmail !== undefined) {
    const supportEmail = String(payload.supportEmail || "").trim().toLowerCase();
    if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
      return { error: "supportEmail must be a valid email address" };
    }
    updates.supportEmail = supportEmail;
  }

  if (payload.supportPhone !== undefined) {
    const supportPhone = String(payload.supportPhone || "").trim();
    if (supportPhone && !/^\+?[0-9][0-9\s().-]{6,19}$/.test(supportPhone)) {
      return { error: "supportPhone must be a valid phone number" };
    }
    updates.supportPhone = supportPhone;
  }

  if (payload.supportWhatsapp !== undefined) {
    const supportWhatsapp = String(payload.supportWhatsapp || "").trim();
    if (supportWhatsapp && !/^\+?[0-9][0-9\s().-]{6,19}$/.test(supportWhatsapp)) {
      return { error: "supportWhatsapp must be a valid phone number" };
    }
    updates.supportWhatsapp = supportWhatsapp;
  }

  if (!Object.keys(updates).length) {
    return { error: "At least one support contact field is required" };
  }

  return { value: updates };
};
