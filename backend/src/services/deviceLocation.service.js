import { DEVICE_STATES } from "../constants/deviceStates.js";
import { DeviceCommand } from "../models/DeviceCommand.js";

export const GET_LOCATION_COMMAND_TYPE = "GET_LOCATION";
const ACTIVE_COMMAND_STATUSES = ["pending", "sent"];

export const buildActiveLocationCommandFilter = (deviceId) => ({
  deviceId,
  commandType: GET_LOCATION_COMMAND_TYPE,
  status: { $in: ACTIVE_COMMAND_STATUSES }
});

export const isExpiredLocationCommand = (command) =>
  command?.commandType === GET_LOCATION_COMMAND_TYPE && command?.status === "expired";

export const queueGetLocationCommand = async ({
  device,
  accountId,
  triggeredBy,
  session
}) => {
  if ([DEVICE_STATES.RELEASE_PENDING, DEVICE_STATES.RELEASED].includes(device.state)) {
    const error = new Error("Location cannot be requested after device release begins");
    error.statusCode = 409;
    throw error;
  }

  await DeviceCommand.updateMany(buildActiveLocationCommandFilter(device._id), {
    $set: {
      status: "expired",
      failureReason: "Superseded by a newer location request"
    },
    $unset: { nextRetryAt: 1 }
  }).session(session || null);

  const commands = await DeviceCommand.create(
    [
      {
        deviceId: device._id,
        tenantId: device.tenantId,
        commandType: GET_LOCATION_COMMAND_TYPE,
        triggeredBy,
        triggeredByAccountId: accountId,
        payload: {
          requestedAt: new Date().toISOString()
        }
      }
    ],
    { session, ordered: true }
  );

  return { command: commands[0] };
};
