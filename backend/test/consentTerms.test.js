import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConsentPlaceholderValues,
  hashRenderedConsent,
  renderConsentTerms
} from "../src/services/consentTerms.service.js";

const consent = {
  version: "1.1",
  title: "Agreement for [USER NAME]",
  borrowerAgreementText: "[USER NAME] purchased from [SELLER NAME]. Contact [SELLER SUPPORT].",
  deviceControlConsentText: "Control ends within [DE-ENROLMENT TIME] for [USER NAME].",
  privacyPolicyText: "[SELLER NAME] protects [USER NAME].",
  tripartiteAckText: "[USER NAME], [SELLER NAME], and CredNexa agree."
};

const user = { name: "Ramesh Kumar" };
const tenant = {
  name: "ABC Finance",
  supportPhone: "+91 90000 00000",
  supportEmail: "help@example.com",
  supportWhatsapp: "+91 91111 11111"
};

test("populates every supported active-consent placeholder without mutating the template", () => {
  const result = renderConsentTerms({ consent, user, tenant });

  assert.equal(result.consent.title, "Agreement for Ramesh Kumar");
  assert.equal(result.consent.borrowerAgreementText, "Ramesh Kumar purchased from ABC Finance. Contact +91 90000 00000.");
  assert.equal(result.consent.deviceControlConsentText, "Control ends within 24 hours for Ramesh Kumar.");
  assert.equal(result.consent.privacyPolicyText, "ABC Finance protects Ramesh Kumar.");
  assert.equal(consent.title, "Agreement for [USER NAME]");
  assert.match(result.renderedConsentHash, /^[a-f0-9]{64}$/);
});

test("uses tenant support contacts in phone, email, then WhatsApp order", () => {
  assert.equal(buildConsentPlaceholderValues({ user, tenant })["[SELLER SUPPORT]"], tenant.supportPhone);
  assert.equal(
    buildConsentPlaceholderValues({ user, tenant: { ...tenant, supportPhone: "" } })["[SELLER SUPPORT]"],
    tenant.supportEmail
  );
  assert.equal(
    buildConsentPlaceholderValues({ user, tenant: { ...tenant, supportPhone: "", supportEmail: "" } })["[SELLER SUPPORT]"],
    tenant.supportWhatsapp
  );
});

test("rejects unsupported placeholders and missing tenant support", () => {
  assert.throws(
    () => renderConsentTerms({ consent: { ...consent, title: "Hello [UNKNOWN VALUE]" }, user, tenant }),
    /Unsupported active consent placeholder/
  );
  assert.throws(
    () => buildConsentPlaceholderValues({ user, tenant: { name: "ABC Finance" } }),
    /Tenant support contact is required/
  );
});

test("produces a deterministic hash from the rendered consent fields", () => {
  const first = renderConsentTerms({ consent, user, tenant });
  const second = renderConsentTerms({ consent: { ...consent, unrelated: "ignored" }, user, tenant });

  assert.equal(first.renderedConsentHash, second.renderedConsentHash);
  assert.equal(hashRenderedConsent(first.snapshot), first.renderedConsentHash);
});
