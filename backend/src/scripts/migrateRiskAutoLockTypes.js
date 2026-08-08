import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { DEFAULT_TENANT_POLICY } from "../constants/defaultPolicies.js";
import { TenantPolicy } from "../models/TenantPolicy.js";

const LEGACY_AUTO_LOCK_TYPES_TO_REMOVE = ["APP_SIGNATURE_MISMATCH"];
const CURRENT_DEFAULT_AUTO_LOCK_TYPES = DEFAULT_TENANT_POLICY.riskRules.autoLockTypes;

const run = async () => {
  await connectDatabase();

  const addResult = await TenantPolicy.updateMany(
    {},
    {
      $addToSet: {
        "riskRules.autoLockTypes": { $each: CURRENT_DEFAULT_AUTO_LOCK_TYPES }
      }
    }
  );

  const pullResult = await TenantPolicy.updateMany(
    {},
    {
      $pull: {
        "riskRules.autoLockTypes": { $in: LEGACY_AUTO_LOCK_TYPES_TO_REMOVE }
      }
    }
  );

  console.log(
    `Risk auto-lock type migration complete. addedDefaults matched=${addResult.matchedCount} modified=${addResult.modifiedCount}; removedLegacy matched=${pullResult.matchedCount} modified=${pullResult.modifiedCount}; defaults=${JSON.stringify(
      CURRENT_DEFAULT_AUTO_LOCK_TYPES
    )}; removed=${JSON.stringify(LEGACY_AUTO_LOCK_TYPES_TO_REMOVE)}`
  );
};

run()
  .catch((error) => {
    console.error("Failed to migrate risk auto-lock types", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
