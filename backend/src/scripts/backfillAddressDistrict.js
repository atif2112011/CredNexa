import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { ChannelPartner } from "../models/ChannelPartner.js";
import { Tenant } from "../models/Tenant.js";

const missingDistrictFilter = {
  "address.city": { $exists: true, $ne: "" },
  $or: [
    { "address.district": { $exists: false } },
    { "address.district": null },
    { "address.district": "" }
  ]
};

const backfillCollection = async (Model, label) => {
  const result = await Model.updateMany(missingDistrictFilter, [
    {
      $set: {
        "address.district": "$address.city"
      }
    }
  ]);

  console.log(`${label} district backfill complete. matched=${result.matchedCount} modified=${result.modifiedCount}`);
};

const run = async () => {
  await connectDatabase();

  await backfillCollection(ChannelPartner, "ChannelPartner");
  await backfillCollection(Tenant, "Tenant");
};

run()
  .catch((error) => {
    console.error("Failed to backfill address district", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
