import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { ChannelPartner } from "../models/ChannelPartner.js";

const run = async () => {
  await connectDatabase();

  const result = await ChannelPartner.updateMany(
    {
      $or: [
        { pincodeRestrictionEnabled: { $exists: false } },
        { tenantOnboardingLimit: { $exists: false } },
        { tenantOnboardingVersion: { $exists: false } }
      ]
    },
    [
      {
        $set: {
          pincodeRestrictionEnabled: { $ifNull: ["$pincodeRestrictionEnabled", false] },
          tenantOnboardingLimit: { $ifNull: ["$tenantOnboardingLimit", 5] },
          tenantOnboardingVersion: { $ifNull: ["$tenantOnboardingVersion", 0] }
        }
      }
    ]
  );

  console.log(`Backfilled ${result.modifiedCount} channel partner(s).`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
