import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { ENROLLMENT_MODES } from "../constants/enrollmentModes.js";
import { AuditLog } from "../models/AuditLog.js";
import { ConsentVersion } from "../models/ConsentVersion.js";
import { Tenant } from "../models/Tenant.js";
import { TenantPolicy } from "../models/TenantPolicy.js";

const apply = process.argv.includes("--apply");

try {
  await connectDatabase();

  const [tenantCount, policyCount, disabledCount, currentRunningConsent] = await Promise.all([
    Tenant.countDocuments({}),
    TenantPolicy.countDocuments({}),
    TenantPolicy.countDocuments({ runningEnrollmentEnabled: { $ne: true } }),
    ConsentVersion.findOne({ enrollmentMode: ENROLLMENT_MODES.RUNNING_APP, isCurrent: true })
      .select("_id version").lean()
  ]);

  if (tenantCount !== policyCount) {
    throw new Error(`Tenant/policy count mismatch (${tenantCount} tenants, ${policyCount} policies); inspect before backfill`);
  }

  if (apply && !currentRunningConsent) {
    throw new Error("Publish a running-app consent version before enabling all dealers");
  }

  let result = null;
  if (apply && disabledCount > 0) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      result = await TenantPolicy.updateMany(
        { runningEnrollmentEnabled: { $ne: true } },
        { $set: { runningEnrollmentEnabled: true } },
        { session }
      );
      await AuditLog.create([{
        eventType: AUDIT_EVENTS.RUNNING_ENROLLMENT_BACKFILLED,
        actorCollection: "system",
        reason: "Enable running enrollment for all existing dealers",
        metadata: { matched: result.matchedCount, modified: result.modifiedCount }
      }], { session, ordered: true });
      await session.commitTransaction();
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
  const remainingDisabled = await TenantPolicy.countDocuments({ runningEnrollmentEnabled: { $ne: true } });

  console.log(JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    tenantCount,
    policyCount,
    beforeDisabled: disabledCount,
    matched: result?.matchedCount ?? 0,
    modified: result?.modifiedCount ?? 0,
    remainingDisabled,
    currentRunningConsentVersion: currentRunningConsent?.version || null
  }));

  if (apply && remainingDisabled !== 0) process.exitCode = 1;
} catch (error) {
  console.error("Running-enrollment backfill failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
