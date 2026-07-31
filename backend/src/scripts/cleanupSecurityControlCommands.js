import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { DEVICE_SECURITY_CONTROL_COMMAND_TYPES } from "../constants/deviceSecurityControls.js";
import { DeviceCommand } from "../models/DeviceCommand.js";

const ACTIVE_STATUSES = new Set(["pending", "sent"]);
const BATCH_SIZE = 500;

const flushOperations = async (operations) => {
  if (operations.length === 0) return 0;
  const result = await DeviceCommand.bulkWrite(operations, { ordered: false });
  operations.length = 0;
  return result.modifiedCount || 0;
};

const run = async () => {
  await connectDatabase();

  const cursor = DeviceCommand.find({
    commandType: { $in: DEVICE_SECURITY_CONTROL_COMMAND_TYPES }
  })
    .select("_id deviceId commandType status payload.controlVersion createdAt")
    .sort({
      deviceId: 1,
      commandType: 1,
      "payload.controlVersion": -1,
      createdAt: -1,
      _id: -1
    })
    .lean()
    .cursor();

  let currentGroup = null;
  let isLatestInGroup = true;
  let modifiedCount = 0;
  const operations = [];

  for await (const command of cursor) {
    const group = `${command.deviceId}:${command.commandType}`;
    if (group !== currentGroup) {
      currentGroup = group;
      isLatestInGroup = true;
    } else {
      isLatestInGroup = false;
    }

    if (!isLatestInGroup && ACTIVE_STATUSES.has(command.status)) {
      operations.push({
        updateOne: {
          filter: { _id: command._id, status: { $in: [...ACTIVE_STATUSES] } },
          update: {
            $set: {
              status: "expired",
              failureReason: "Superseded by a newer security control command"
            },
            $unset: { nextRetryAt: "" }
          }
        }
      });
    }

    if (operations.length >= BATCH_SIZE) {
      modifiedCount += await flushOperations(operations);
    }
  }

  modifiedCount += await flushOperations(operations);
  console.log(`Security control cleanup completed; ${modifiedCount} historical active commands expired`);
};

run()
  .catch((error) => {
    console.error("Security control cleanup failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
