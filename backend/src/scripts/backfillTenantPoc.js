import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { Tenant } from "../models/Tenant.js";

const PSEUDO_POC = Object.freeze({
  pocDesignation: "owner",
  pocPhone: "7379598912",
  pocName: "Test POC"
});

const run = async () => {
  await connectDatabase();

  const result = await Tenant.updateMany({}, { $set: PSEUDO_POC });

  console.log(
    `Tenant POC backfill complete. matched=${result.matchedCount} modified=${result.modifiedCount} values=${JSON.stringify(
      PSEUDO_POC
    )}`
  );
};

run()
  .catch((error) => {
    console.error("Failed to backfill tenant POC fields", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
