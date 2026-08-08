import { ChannelPartner } from "../models/ChannelPartner.js";
import { Tenant } from "../models/Tenant.js";

export const DEFAULT_TENANT_ONBOARDING_LIMIT = 5;
export const PARTNER_PINCODE_MISMATCH_ERROR = "dealers pincode dont match the partner";
export const PINCODE_LIMIT_REACHED_ERROR = "Pincode limit reached";

export class PartnerTenantOnboardingError extends Error {
  constructor(message) {
    super(message);
    this.name = "PartnerTenantOnboardingError";
    this.statusCode = 400;
  }
}

export const isValidPincode = (value) => /^\d{6}$/.test(String(value || "").trim());

export const isValidTenantOnboardingLimit = (value) => {
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1;
};

export const getPincodePrefix = (value) => String(value || "").trim().slice(0, 3);

export const validateTenantPincodeForPartner = ({ partnerPincode, tenantPincode }) => {
  if (!isValidPincode(partnerPincode) || !isValidPincode(tenantPincode)) {
    return false;
  }

  return getPincodePrefix(partnerPincode) === getPincodePrefix(tenantPincode);
};

export const buildActiveTenantPincodeFilter = ({ channelPartnerId, partnerPincode }) => ({
  channelPartnerId,
  isActive: true,
  "address.pincode": new RegExp(`^${getPincodePrefix(partnerPincode)}\\d{3}$`)
});

export const getPartnerTenantOnboardingError = ({
  enabled,
  partnerPincode,
  tenantPincode,
  tenantCount,
  tenantOnboardingLimit
}) => {
  if (enabled !== true) return null;
  if (!validateTenantPincodeForPartner({ partnerPincode, tenantPincode })) {
    return PARTNER_PINCODE_MISMATCH_ERROR;
  }
  if (tenantCount >= tenantOnboardingLimit) return PINCODE_LIMIT_REACHED_ERROR;
  return null;
};

/**
 * Serializes capacity checks on the partner document inside the tenant creation
 * transaction, preventing concurrent requests from consuming the same final slot.
 */
export const enforcePartnerTenantOnboarding = async ({ channelPartner, tenantPincode, session }) => {
  if (channelPartner?.pincodeRestrictionEnabled !== true) return;

  const lockedPartner = await ChannelPartner.findOneAndUpdate(
    { _id: channelPartner._id, isActive: true, pincodeRestrictionEnabled: true },
    { $inc: { tenantOnboardingVersion: 1 } },
    { new: true, session }
  ).select("+tenantOnboardingVersion");

  if (!lockedPartner) return;

  const partnerPincode = lockedPartner.address?.pincode;

  const tenantCount = await Tenant.countDocuments(
    buildActiveTenantPincodeFilter({ channelPartnerId: lockedPartner._id, partnerPincode })
  ).session(session);

  const validationError = getPartnerTenantOnboardingError({
    enabled: lockedPartner.pincodeRestrictionEnabled,
    partnerPincode,
    tenantPincode,
    tenantCount,
    tenantOnboardingLimit: lockedPartner.tenantOnboardingLimit
  });
  if (validationError) {
    throw new PartnerTenantOnboardingError(validationError);
  }
};
