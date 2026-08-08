import { roundRupeeAmount } from "./payout.js";

export const DEFAULT_TENANT_CREDIT_DISCOUNT_SLABS = Object.freeze([
  Object.freeze({ minKeys: 0, maxKeys: 25, discountPercentage: 0 }),
  Object.freeze({ minKeys: 26, maxKeys: 75, discountPercentage: 10 }),
  Object.freeze({ minKeys: 76, maxKeys: 150, discountPercentage: 15 }),
  Object.freeze({ minKeys: 151, maxKeys: 250, discountPercentage: 20 }),
  Object.freeze({ minKeys: 251, maxKeys: 450, discountPercentage: 25 }),
  Object.freeze({ minKeys: 451, maxKeys: 750, discountPercentage: 30 }),
  Object.freeze({ minKeys: 751, maxKeys: null, discountPercentage: 35 })
]);

export const cloneDefaultTenantCreditDiscountSlabs = () =>
  DEFAULT_TENANT_CREDIT_DISCOUNT_SLABS.map((slab) => ({ ...slab }));

const hasSameRange = (slab, expected) =>
  Number(slab?.minKeys) === expected.minKeys &&
  (slab?.maxKeys === null || slab?.maxKeys === undefined
    ? expected.maxKeys === null
    : Number(slab.maxKeys) === expected.maxKeys);

export const normalizeTenantCreditDiscountSlabs = (slabs) => {
  if (!Array.isArray(slabs) || slabs.length !== DEFAULT_TENANT_CREDIT_DISCOUNT_SLABS.length) {
    throw new Error(`Exactly ${DEFAULT_TENANT_CREDIT_DISCOUNT_SLABS.length} discount slabs are required`);
  }

  return slabs.map((slab, index) => {
    const expected = DEFAULT_TENANT_CREDIT_DISCOUNT_SLABS[index];
    if (!hasSameRange(slab, expected)) {
      throw new Error(`Discount slab ${index + 1} must keep the ${expected.minKeys}-${expected.maxKeys ?? "unlimited"} key range`);
    }

    const discountPercentage = Number(slab?.discountPercentage);
    if (!Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 50) {
      throw new Error(`Discount for ${expected.minKeys}-${expected.maxKeys ?? "unlimited"} keys must be between 0 and 50`);
    }

    if (index === 0 && discountPercentage !== 0) {
      throw new Error("The 0-25 key discount slab is fixed at 0%");
    }

    return {
      minKeys: expected.minKeys,
      maxKeys: expected.maxKeys,
      discountPercentage: roundRupeeAmount(discountPercentage)
    };
  });
};

export const getEffectiveTenantCreditDiscountSlabs = (tenant) => {
  try {
    return normalizeTenantCreditDiscountSlabs(tenant?.creditPurchaseDiscountSlabs);
  } catch {
    return cloneDefaultTenantCreditDiscountSlabs();
  }
};

export const calculateTenantCreditPurchasePricing = ({ requestedCredits, perKeyPrice, discountSlabs }) => {
  const quantity = Number(requestedCredits);
  const price = Number(perKeyPrice);

  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("requestedCredits must be a positive integer");
  if (!Number.isFinite(price) || price < 0) throw new Error("perKeyPrice must be a non-negative amount");

  const slabs = normalizeTenantCreditDiscountSlabs(discountSlabs);
  const matchedSlab = slabs.find(
    (slab) => quantity >= slab.minKeys && (slab.maxKeys === null || quantity <= slab.maxKeys)
  );
  if (!matchedSlab) throw new Error("No discount slab is configured for the requested quantity");

  const grossPurchaseAmount = roundRupeeAmount(quantity * price);
  const discountAmount = roundRupeeAmount((grossPurchaseAmount * matchedSlab.discountPercentage) / 100);
  const purchaseAmount = roundRupeeAmount(grossPurchaseAmount - discountAmount);

  return {
    grossPurchaseAmount,
    discountPercentage: matchedSlab.discountPercentage,
    discountAmount,
    purchaseAmount,
    discountSlabSnapshot: { ...matchedSlab }
  };
};
