import assert from "node:assert/strict";
import test from "node:test";

import { ChannelPartner } from "../src/models/ChannelPartner.js";
import {
  buildActiveTenantPincodeFilter,
  DEFAULT_TENANT_ONBOARDING_LIMIT,
  getPartnerTenantOnboardingError,
  isValidPincode,
  isValidTenantOnboardingLimit,
  PARTNER_PINCODE_MISMATCH_ERROR,
  PINCODE_LIMIT_REACHED_ERROR,
  validateTenantPincodeForPartner
} from "../src/services/partnerTenantOnboarding.service.js";

test("new partners default to enabled pincode onboarding with a limit of five", () => {
  const partner = new ChannelPartner({
    name: "Prayagraj Partner",
    type: "independent",
    address: {
      street: "Civil Lines",
      city: "Prayagraj",
      district: "Prayagraj",
      state: "Uttar Pradesh",
      pincode: "211016"
    }
  });

  assert.equal(partner.pincodeRestrictionEnabled, true);
  assert.equal(partner.tenantOnboardingLimit, DEFAULT_TENANT_ONBOARDING_LIMIT);
});

test("legacy partners without the backfilled flag remain disabled during deployment", () => {
  const partner = ChannelPartner.hydrate({
    name: "Legacy Partner",
    type: "independent",
    address: {
      street: "Civil Lines",
      city: "Prayagraj",
      district: "Prayagraj",
      state: "Uttar Pradesh",
      pincode: "211016"
    }
  });

  assert.equal(partner.pincodeRestrictionEnabled, false);
  assert.equal(partner.tenantOnboardingLimit, DEFAULT_TENANT_ONBOARDING_LIMIT);
});

test("pincodes must contain exactly six digits", () => {
  assert.equal(isValidPincode("211016"), true);
  assert.equal(isValidPincode("21101"), false);
  assert.equal(isValidPincode("211A16"), false);
});

test("tenant pincode must match the partner's first three digits", () => {
  assert.equal(validateTenantPincodeForPartner({ partnerPincode: "211016", tenantPincode: "211999" }), true);
  assert.equal(validateTenantPincodeForPartner({ partnerPincode: "211016", tenantPincode: "212001" }), false);
});

test("disabled restrictions skip both pincode and limit validation", () => {
  const error = getPartnerTenantOnboardingError({
    enabled: false,
    partnerPincode: "211016",
    tenantPincode: "999999",
    tenantCount: 50,
    tenantOnboardingLimit: 5
  });

  assert.equal(error, null);
});

test("mismatched pincode returns the required error", () => {
  const error = getPartnerTenantOnboardingError({
    enabled: true,
    partnerPincode: "211016",
    tenantPincode: "212001",
    tenantCount: 0,
    tenantOnboardingLimit: 5
  });

  assert.equal(error, PARTNER_PINCODE_MISMATCH_ERROR);
});

test("the configured active matching tenant limit is enforced", () => {
  assert.equal(
    getPartnerTenantOnboardingError({
      enabled: true,
      partnerPincode: "211016",
      tenantPincode: "211777",
      tenantCount: 5,
      tenantOnboardingLimit: 5
    }),
    PINCODE_LIMIT_REACHED_ERROR
  );
  assert.equal(
    getPartnerTenantOnboardingError({
      enabled: true,
      partnerPincode: "211016",
      tenantPincode: "211777",
      tenantCount: 4,
      tenantOnboardingLimit: 5
    }),
    null
  );
});

test("the count filter includes only active tenants in the partner prefix", () => {
  const filter = buildActiveTenantPincodeFilter({ channelPartnerId: "partner-id", partnerPincode: "211016" });

  assert.equal(filter.channelPartnerId, "partner-id");
  assert.equal(filter.isActive, true);
  assert.equal(filter["address.pincode"].test("211999"), true);
  assert.equal(filter["address.pincode"].test("212000"), false);
});

test("tenant onboarding limits must be positive integers", () => {
  assert.equal(isValidTenantOnboardingLimit(1), true);
  assert.equal(isValidTenantOnboardingLimit("5"), true);
  assert.equal(isValidTenantOnboardingLimit(0), false);
  assert.equal(isValidTenantOnboardingLimit(2.5), false);
});
