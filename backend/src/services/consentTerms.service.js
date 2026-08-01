import crypto from "crypto";

export const CONSENT_TEXT_FIELDS = Object.freeze([
  "title",
  "borrowerAgreementText",
  "deviceControlConsentText",
  "privacyPolicyText",
  "tripartiteAckText"
]);

const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z0-9 _-]*\]/g;
const DE_ENROLMENT_TIME = "24 hours";

const createConsentError = (message, statusCode = 422) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const buildConsentPlaceholderValues = ({ user, tenant }) => {
  const sellerSupport = tenant?.supportPhone || tenant?.supportEmail || tenant?.supportWhatsapp;
  if (!sellerSupport) {
    throw createConsentError("Tenant support contact is required to populate the active consent");
  }

  return {
    "[USER NAME]": String(user?.name || "").trim(),
    "[SELLER NAME]": String(tenant?.name || "").trim(),
    "[SELLER SUPPORT]": String(sellerSupport).trim(),
    "[DE-ENROLMENT TIME]": DE_ENROLMENT_TIME
  };
};

export const buildRenderedConsentSnapshot = (consent = {}) =>
  Object.fromEntries(CONSENT_TEXT_FIELDS.map((field) => [field, String(consent[field] || "")]));

export const hashRenderedConsent = (snapshot) =>
  crypto.createHash("sha256").update(JSON.stringify(buildRenderedConsentSnapshot(snapshot))).digest("hex");

export const renderConsentTerms = ({ consent, user, tenant }) => {
  const placeholderValues = buildConsentPlaceholderValues({ user, tenant });
  const snapshot = buildRenderedConsentSnapshot(consent);
  const placeholders = new Set(
    CONSENT_TEXT_FIELDS.flatMap((field) => snapshot[field].match(PLACEHOLDER_PATTERN) || [])
  );
  const unsupportedPlaceholders = [...placeholders].filter(
    (placeholder) => placeholderValues[placeholder] === undefined
  );

  if (unsupportedPlaceholders.length) {
    throw createConsentError(
      `Unsupported active consent placeholder${unsupportedPlaceholders.length === 1 ? "" : "s"}: ${unsupportedPlaceholders.join(", ")}`
    );
  }

  for (const field of CONSENT_TEXT_FIELDS) {
    for (const placeholder of placeholders) {
      snapshot[field] = snapshot[field].split(placeholder).join(placeholderValues[placeholder]);
    }
  }

  return {
    consent: { ...consent, ...snapshot },
    snapshot,
    renderedConsentHash: hashRenderedConsent(snapshot)
  };
};
