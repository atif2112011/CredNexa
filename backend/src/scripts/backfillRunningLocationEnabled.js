import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { AuditLog } from "../models/AuditLog.js";
import { TenantPolicy } from "../models/TenantPolicy.js";

const apply = process.argv.includes("--apply");
const filter = { runningLocationEnabled: { $ne: true } };

try {
  await connectDatabase();
  const policyCount = await TenantPolicy.countDocuments({});
  const beforeDisabled = await TenantPolicy.countDocuments(filter);
  let result = null;

  if (apply && beforeDisabled > 0) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        result = await TenantPolicy.updateMany(
          filter,
          { $set: { runningLocationEnabled: true } },
          { session }
        );
        await AuditLog.create([{
          eventType: AUDIT_EVENTS.RUNNING_LOCATION_BACKFILLED,
          actorCollection: "system",
          reason: "Enable running location for all existing dealer policies",
          metadata: { matched: result.matchedCount, modified: result.modifiedCount }
        }], { session, ordered: true });
      });
    } finally {
      await session.endSession();
    }
  }

  const remainingDisabled = await TenantPolicy.countDocuments(filter);
  console.log(JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    policyCount,
    beforeDisabled,
    matched: result?.matchedCount ?? 0,
    modified: result?.modifiedCount ?? 0,
    remainingDisabled
  }));
  if (apply && remainingDisabled !== 0) process.exitCode = 1;
} catch (error) {
  console.error("Running-location backfill failed:", error.name);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
