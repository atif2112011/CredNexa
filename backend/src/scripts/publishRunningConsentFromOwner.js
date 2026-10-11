import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { ENROLLMENT_MODES } from "../constants/enrollmentModes.js";
import { AuditLog } from "../models/AuditLog.js";
import { ConsentVersion } from "../models/ConsentVersion.js";
import { buildRunningConsentFromOwner } from "../services/runningConsentClone.service.js";

const apply = process.argv.includes("--apply");

try {
  await connectDatabase();
  const [owner, currentRunning] = await Promise.all([
    ConsentVersion.findOne({
      enrollmentMode: { $in: [ENROLLMENT_MODES.DEVICE_OWNER_QR, null] },
      isCurrent: true
    }).lean(),
    ConsentVersion.findOne({ enrollmentMode: ENROLLMENT_MODES.RUNNING_APP, isCurrent: true }).lean()
  ]);
  if (!owner) throw new Error("No current Device Owner consent version was found");
  if (currentRunning) {
    console.log(JSON.stringify({ mode: apply ? "skipped" : "dry-run", currentRunningVersion: currentRunning.version }));
  } else {
    const copy = buildRunningConsentFromOwner(owner);
    const collision = await ConsentVersion.exists({ version: copy.version });
    if (collision) throw new Error(`Version ${copy.version} already exists; review before publishing`);
    if (!apply) {
      console.log(JSON.stringify({ mode: "dry-run", sourceVersion: owner.version, proposedVersion: copy.version }));
    } else {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        const [created] = await ConsentVersion.create([{
          ...copy,
          isCurrent: true,
          publishedAt: new Date()
        }], { session, ordered: true });
        await AuditLog.create([{
          eventType: AUDIT_EVENTS.CONSENT_VERSION_PUBLISHED,
          actorCollection: "system",
          reason: "Running-device consent cloned from current owner version with capability corrections",
          metadata: {
            consentVersionId: created._id,
            version: created.version,
            sourceConsentVersionId: owner._id,
            sourceVersion: owner.version,
            enrollmentMode: ENROLLMENT_MODES.RUNNING_APP
          }
        }], { session, ordered: true });
        await session.commitTransaction();
        console.log(JSON.stringify({ mode: "applied", sourceVersion: owner.version, runningVersion: created.version, runningId: String(created._id) }));
      } catch (error) {
        if (session.inTransaction()) await session.abortTransaction();
        throw error;
      } finally {
        await session.endSession();
      }
    }
  }
} catch (error) {
  console.error("Running-consent clone failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
