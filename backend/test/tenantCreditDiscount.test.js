import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTenantCreditPurchasePricing,
  cloneDefaultTenantCreditDiscountSlabs,
  normalizeTenantCreditDiscountSlabs
} from "../src/utils/tenantCreditDiscount.js";
import { PayoutConstants } from "../src/models/PayoutConstants.js";
import { Tenant } from "../src/models/Tenant.js";
import {
  TENANT_CREDIT_DISCOUNT_CHANGE_STATUSES,
  TenantCreditDiscountChangeRequest
} from "../src/models/TenantCreditDiscountChangeRequest.js";
import { DEFAULT_MAX_TENANT_CREDIT_PURCHASE } from "../src/utils/payout.js";

test("default discount slab boundaries select the expected percentage", () => {
  const slabs = cloneDefaultTenantCreditDiscountSlabs();
  const cases = [
    [1, 0], [25, 0], [26, 10], [75, 10], [76, 15], [150, 15], [151, 20],
    [250, 20], [251, 25], [450, 25], [451, 30], [750, 30], [751, 35], [2000, 35]
  ];

  for (const [requestedCredits, expectedDiscount] of cases) {
    const pricing = calculateTenantCreditPurchasePricing({ requestedCredits, perKeyPrice: 100, discountSlabs: slabs });
    assert.equal(pricing.discountPercentage, expectedDiscount);
  }
});

test("pricing returns gross, discount, and net rupee snapshots", () => {
  const pricing = calculateTenantCreditPurchasePricing({
    requestedCredits: 100,
    perKeyPrice: 99.99,
    discountSlabs: cloneDefaultTenantCreditDiscountSlabs()
  });

  assert.deepEqual(pricing, {
    grossPurchaseAmount: 9999,
    discountPercentage: 15,
    discountAmount: 1499.85,
    purchaseAmount: 8499.15,
    discountSlabSnapshot: { minKeys: 76, maxKeys: 150, discountPercentage: 15 }
  });
});

test("50 percent is accepted and values above 50 are rejected", () => {
  const slabs = cloneDefaultTenantCreditDiscountSlabs();
  slabs[1].discountPercentage = 50;
  assert.equal(normalizeTenantCreditDiscountSlabs(slabs)[1].discountPercentage, 50);

  slabs[1].discountPercentage = 50.01;
  assert.throws(() => normalizeTenantCreditDiscountSlabs(slabs), /between 0 and 50/);
});

test("the first slab and every quantity range are fixed", () => {
  const changedFirstSlab = cloneDefaultTenantCreditDiscountSlabs();
  changedFirstSlab[0].discountPercentage = 1;
  assert.throws(() => normalizeTenantCreditDiscountSlabs(changedFirstSlab), /fixed at 0%/);

  const changedRange = cloneDefaultTenantCreditDiscountSlabs();
  changedRange[2].minKeys = 77;
  assert.throws(() => normalizeTenantCreditDiscountSlabs(changedRange), /must keep/);
});

test("new tenants receive slabs and the default maximum purchase is 2000", () => {
  const tenant = new Tenant();
  const payoutConstants = new PayoutConstants();

  assert.deepEqual(
    tenant.creditPurchaseDiscountSlabs.map((slab) => slab.toObject()),
    cloneDefaultTenantCreditDiscountSlabs()
  );
  assert.equal(tenant.creditPurchaseDiscountVersion, 1);
  assert.equal(DEFAULT_MAX_TENANT_CREDIT_PURCHASE, 2000);
  assert.equal(payoutConstants.maxTenantCreditPurchase, 2000);
});

test("discount change requests preserve current and requested slab snapshots", () => {
  const currentSlabs = cloneDefaultTenantCreditDiscountSlabs();
  const requestedSlabs = cloneDefaultTenantCreditDiscountSlabs();
  requestedSlabs[1].discountPercentage = 12;

  const request = new TenantCreditDiscountChangeRequest({
    tenantId: "64b000000000000000000001",
    channelPartnerId: "64b000000000000000000002",
    baseConfigVersion: 3,
    currentSlabs,
    requestedSlabs,
    requestedBy: "64b000000000000000000003"
  });

  assert.equal(request.status, TENANT_CREDIT_DISCOUNT_CHANGE_STATUSES.PENDING);
  assert.equal(request.baseConfigVersion, 3);
  assert.equal(request.currentSlabs[1].discountPercentage, 10);
  assert.equal(request.requestedSlabs[1].discountPercentage, 12);
});

test("discount change requests enforce one pending request per tenant at the index level", () => {
  const pendingIndex = TenantCreditDiscountChangeRequest.schema.indexes().find(
    ([fields, options]) => fields.tenantId === 1 && options?.partialFilterExpression?.status === "PENDING"
  );

  assert.ok(pendingIndex);
  assert.equal(pendingIndex[1].unique, true);
});
