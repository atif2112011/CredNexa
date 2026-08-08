import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { PAYOUT_CONSTANTS_KEY, PayoutConstants } from "../models/PayoutConstants.js";
import { Tenant } from "../models/Tenant.js";
import {
  cloneDefaultTenantCreditDiscountSlabs,
  normalizeTenantCreditDiscountSlabs
} from "../utils/tenantCreditDiscount.js";

const LEGACY_MAX_TENANT_CREDIT_PURCHASE = 500;
const DEFAULT_MAX_TENANT_CREDIT_PURCHASE = 2000;
const dryRun = process.argv.includes("--dry-run");

const run = async () => {
  await connectDatabase();

  const summary = {
    examinedTenants: 0,
    updatedTenants: 0,
    preservedTenants: 0,
    affectedPartners: new Set(),
    payoutConstantsAction: "preserved"
  };

  const tenants = Tenant.find({})
    .select("_id channelPartnerId creditPurchaseDiscountSlabs creditPurchaseDiscountVersion")
    .lean()
    .cursor();

  for await (const tenant of tenants) {
    summary.examinedTenants += 1;
    let slabsAreValid = true;
    try {
      normalizeTenantCreditDiscountSlabs(tenant.creditPurchaseDiscountSlabs);
    } catch {
      slabsAreValid = false;
    }

    const updates = {};
    if (!slabsAreValid) updates.creditPurchaseDiscountSlabs = cloneDefaultTenantCreditDiscountSlabs();
    if (!Number.isInteger(tenant.creditPurchaseDiscountVersion) || tenant.creditPurchaseDiscountVersion < 1) {
      updates.creditPurchaseDiscountVersion = 1;
    }

    if (!Object.keys(updates).length) {
      summary.preservedTenants += 1;
      continue;
    }

    summary.updatedTenants += 1;
    if (tenant.channelPartnerId) summary.affectedPartners.add(String(tenant.channelPartnerId));
    if (!dryRun) await Tenant.updateOne({ _id: tenant._id }, { $set: updates });
  }

  const payoutConstants = await PayoutConstants.findOne({ key: PAYOUT_CONSTANTS_KEY }).lean();
  if (!payoutConstants) {
    summary.payoutConstantsAction = "created_with_2000_max";
    if (!dryRun) await PayoutConstants.create({ key: PAYOUT_CONSTANTS_KEY, maxTenantCreditPurchase: DEFAULT_MAX_TENANT_CREDIT_PURCHASE });
  } else if (
    payoutConstants.maxTenantCreditPurchase === undefined ||
    payoutConstants.maxTenantCreditPurchase === null ||
    Number(payoutConstants.maxTenantCreditPurchase) === LEGACY_MAX_TENANT_CREDIT_PURCHASE
  ) {
    summary.payoutConstantsAction = "updated_to_2000_max";
    if (!dryRun) {
      await PayoutConstants.updateOne(
        { _id: payoutConstants._id },
        { $set: { maxTenantCreditPurchase: DEFAULT_MAX_TENANT_CREDIT_PURCHASE } }
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        examinedTenants: summary.examinedTenants,
        updatedTenants: summary.updatedTenants,
        preservedTenants: summary.preservedTenants,
        affectedPartners: summary.affectedPartners.size,
        payoutConstantsAction: summary.payoutConstantsAction
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error("Failed to backfill tenant credit discounts", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
