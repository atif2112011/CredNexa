import { PAYOUT_CONSTANTS_KEY, PayoutConstants } from "../models/PayoutConstants.js";

export const DEFAULT_PARTNER_CREDIT_PERCENTAGE = 15;
export const DEFAULT_MIN_PARTNER_PAYOUT_AMOUNT = 0;
export const DEFAULT_MAX_PARTNER_PAYOUT_AMOUNT = 0;
export const DEFAULT_TENANT_CREDIT_PER_KEY_PRICE = 100;
export const DEFAULT_MIN_TENANT_CREDIT_PURCHASE = 1;
export const DEFAULT_MAX_TENANT_CREDIT_PURCHASE = 500;
export const DEFAULT_ADMIN_CREDIT_PURCHASE_UPI_ID = "test@ybl.in";
export const DEFAULT_ADMIN_CREDIT_PURCHASE_UPI_NAME = "Test Admin";
export const DEFAULT_ADMIN_CREDIT_PURCHASE_QR_IMAGE_URL = "https://placehold.co/600x400";

export const roundRupeeAmount = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const parseRupeeAmount = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return roundRupeeAmount(amount);
};

export const isValidUpiId = (value) => /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(String(value || "").trim());

export const getOrCreatePayoutConstants = async (session) => {
  const query = PayoutConstants.findOneAndUpdate(
    { key: PAYOUT_CONSTANTS_KEY },
    {
      $setOnInsert: {
        key: PAYOUT_CONSTANTS_KEY,
        defaultPartnerCreditPercentage: DEFAULT_PARTNER_CREDIT_PERCENTAGE,
        minPartnerPayoutAmount: DEFAULT_MIN_PARTNER_PAYOUT_AMOUNT,
        maxPartnerPayoutAmount: DEFAULT_MAX_PARTNER_PAYOUT_AMOUNT,
        defaultTenantCreditPerKeyPrice: DEFAULT_TENANT_CREDIT_PER_KEY_PRICE,
        minTenantCreditPurchase: DEFAULT_MIN_TENANT_CREDIT_PURCHASE,
        maxTenantCreditPurchase: DEFAULT_MAX_TENANT_CREDIT_PURCHASE,
        adminCreditPurchaseUpiId: DEFAULT_ADMIN_CREDIT_PURCHASE_UPI_ID,
        adminCreditPurchaseUpiName: DEFAULT_ADMIN_CREDIT_PURCHASE_UPI_NAME,
        adminCreditPurchaseQrImageUrl: DEFAULT_ADMIN_CREDIT_PURCHASE_QR_IMAGE_URL
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (session) query.session(session);
  const payoutConstants = await query;
  const updates = {};

  if (payoutConstants.defaultPartnerCreditPercentage == null) {
    updates.defaultPartnerCreditPercentage = DEFAULT_PARTNER_CREDIT_PERCENTAGE;
  }
  if (payoutConstants.minPartnerPayoutAmount == null) {
    updates.minPartnerPayoutAmount = DEFAULT_MIN_PARTNER_PAYOUT_AMOUNT;
  }
  if (payoutConstants.maxPartnerPayoutAmount == null) {
    updates.maxPartnerPayoutAmount = DEFAULT_MAX_PARTNER_PAYOUT_AMOUNT;
  }
  if (payoutConstants.defaultTenantCreditPerKeyPrice == null) {
    updates.defaultTenantCreditPerKeyPrice = DEFAULT_TENANT_CREDIT_PER_KEY_PRICE;
  }
  if (payoutConstants.minTenantCreditPurchase == null) {
    updates.minTenantCreditPurchase = DEFAULT_MIN_TENANT_CREDIT_PURCHASE;
  }
  if (payoutConstants.maxTenantCreditPurchase == null) {
    updates.maxTenantCreditPurchase = DEFAULT_MAX_TENANT_CREDIT_PURCHASE;
  }
  if (!payoutConstants.adminCreditPurchaseUpiId) {
    updates.adminCreditPurchaseUpiId = DEFAULT_ADMIN_CREDIT_PURCHASE_UPI_ID;
  }
  if (!payoutConstants.adminCreditPurchaseUpiName) {
    updates.adminCreditPurchaseUpiName = DEFAULT_ADMIN_CREDIT_PURCHASE_UPI_NAME;
  }
  if (!payoutConstants.adminCreditPurchaseQrImageUrl) {
    updates.adminCreditPurchaseQrImageUrl = DEFAULT_ADMIN_CREDIT_PURCHASE_QR_IMAGE_URL;
  }

  if (!Object.keys(updates).length) return payoutConstants;

  Object.assign(payoutConstants, updates);
  await payoutConstants.save(session ? { session } : {});
  return payoutConstants;
};

export const getPartnerCreditPercentage = (channelPartner, payoutConstants) => {
  const percentage = Number(channelPartner?.creditPercentage);
  if (Number.isFinite(percentage)) return percentage;

  const defaultPercentage = Number(payoutConstants?.defaultPartnerCreditPercentage);
  if (Number.isFinite(defaultPercentage)) return defaultPercentage;

  return DEFAULT_PARTNER_CREDIT_PERCENTAGE;
};

export const calculatePartnerCreditAmount = ({ purchaseAmount, creditPercentage }) => {
  const amount = parseRupeeAmount(purchaseAmount);
  const percentage = Number(creditPercentage);

  if (amount === null || amount <= 0 || !Number.isFinite(percentage) || percentage <= 0) {
    return 0;
  }

  return roundRupeeAmount((amount * percentage) / 100);
};

export const getPartnerPayoutRange = ({ availableBalance, payoutConstants }) => {
  const available = Math.max(parseRupeeAmount(availableBalance) || 0, 0);
  const min = Math.max(parseRupeeAmount(payoutConstants?.minPartnerPayoutAmount) || 0, 0);
  const configuredMax = Math.max(parseRupeeAmount(payoutConstants?.maxPartnerPayoutAmount) || 0, 0);
  const max = configuredMax > 0 ? Math.min(available, configuredMax) : available;

  return {
    min,
    max: roundRupeeAmount(max),
    available,
    hasMaximumCap: configuredMax > 0
  };
};

export const getEffectiveTenantCreditPerKeyPrice = (tenant, payoutConstants) => {
  const tenantPrice = parseRupeeAmount(tenant?.creditPurchasePerKeyPrice);
  if (tenantPrice !== null) return tenantPrice;

  const defaultPrice = parseRupeeAmount(payoutConstants?.defaultTenantCreditPerKeyPrice);
  if (defaultPrice !== null) return defaultPrice;

  return DEFAULT_TENANT_CREDIT_PER_KEY_PRICE;
};

export const getTenantCreditPurchaseLimits = (payoutConstants) => {
  const min = Number.isInteger(Number(payoutConstants?.minTenantCreditPurchase))
    ? Math.max(Number(payoutConstants.minTenantCreditPurchase), 0)
    : DEFAULT_MIN_TENANT_CREDIT_PURCHASE;
  const max = Number.isInteger(Number(payoutConstants?.maxTenantCreditPurchase))
    ? Math.max(Number(payoutConstants.maxTenantCreditPurchase), 0)
    : DEFAULT_MAX_TENANT_CREDIT_PURCHASE;

  return { min, max, hasMaximumCap: max > 0 };
};
