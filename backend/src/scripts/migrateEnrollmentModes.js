import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { ENROLLMENT_MODES } from "../constants/enrollmentModes.js";
import { ConsentRecord } from "../models/ConsentRecord.js";
import { ConsentVersion } from "../models/ConsentVersion.js";
import { Device } from "../models/Device.js";
import { EnrollmentToken } from "../models/EnrollmentToken.js";
import { User } from "../models/User.js";

const migrationTargets = [
  [User, "enrollmentMode", ENROLLMENT_MODES.DEVICE_OWNER_QR],
  [EnrollmentToken, "enrollmentMode", ENROLLMENT_MODES.DEVICE_OWNER_QR],
  [Device, "enrollmentMode", ENROLLMENT_MODES.DEVICE_OWNER_QR],
  [Device, "identifierSource", "DEVICE_REPORTED"],
  [ConsentVersion, "enrollmentMode", ENROLLMENT_MODES.DEVICE_OWNER_QR],
  [ConsentRecord, "enrollmentMode", ENROLLMENT_MODES.DEVICE_OWNER_QR]
];
const BATCH_SIZE = 500;

const backfillInBatches = async (model, field, value) => {
  let modified = 0;
  let cursor = null;
  while (true) {
    const rows = await model.find({
      [field]: { $exists: false },
      ...(cursor ? { _id: { $gt: cursor } } : {})
    }).select("_id").sort({ _id: 1 }).limit(BATCH_SIZE).lean();
    if (!rows.length) break;
    cursor = rows[rows.length - 1]._id;
    const result = await model.updateMany(
      { _id: { $in: rows.map((row) => row._id) }, [field]: { $exists: false } },
      { $set: { [field]: value } }
    );
    modified += result.modifiedCount;
  }
  return modified;
};

const run = async () => {
  await connectDatabase();
  const apply = process.argv.includes("--apply");

  for (const [model, field, value] of migrationTargets) {
    const filter = { [field]: { $exists: false } };
    const count = await model.countDocuments(filter);
    console.log(`${model.modelName}.${field}: ${count} legacy rows${apply ? " to update" : " (dry run)"}`);
    if (apply && count) {
      console.log(`  modified=${await backfillInBatches(model, field, value)}`);
    }
  }

  // Audit duplicate linked devices before a future unique index. Do not silently delete history.
  const duplicates = await Device.aggregate([
    { $group: { _id: { userId: "$userId", tenantId: "$tenantId" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 }
  ]);
  console.log(`Duplicate borrower/device groups (first 20): ${JSON.stringify(duplicates)}`);
  const duplicateClaims = await EnrollmentToken.aggregate([
    { $match: { consumedAt: null, cancelledAt: null } },
    { $group: { _id: { userId: "$userId", tenantId: "$tenantId" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 }
  ]);
  console.log(`Duplicate unconsumed borrower claims (first 20): ${JSON.stringify(duplicateClaims)}`);
};

run()
  .catch((error) => {
    console.error("Enrollment-mode migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.connection.close());
