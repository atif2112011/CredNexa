import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { DEVICE_CONTROL_MODES } from "../constants/tenant.js";
import { TenantPolicy } from "../models/TenantPolicy.js";

const run = async () => {
  await connectDatabase();

  const result = await TenantPolicy.updateMany(
    { "deviceControlRules.mode": { $exists: false } },
    { $set: { "deviceControlRules.mode": DEVICE_CONTROL_MODES.EMI_AUTOMATED } }
  );

  console.log(
    `Tenant device control migration complete. matched=${result.matchedCount} modified=${result.modifiedCount}`
  );
};

run()
  .catch((error) => {
    console.error("Failed to migrate tenant device control mode", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
