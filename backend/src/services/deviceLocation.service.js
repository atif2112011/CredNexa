import { DEVICE_STATES } from "../constants/deviceStates.js";
import { DeviceCommand } from "../models/DeviceCommand.js";

export const GET_LOCATION_COMMAND_TYPE = "GET_LOCATION";
const ACTIVE_COMMAND_STATUSES = ["pending", "sent"];

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

  const existingCommand = await DeviceCommand.findOne({
    deviceId: device._id,
    commandType: GET_LOCATION_COMMAND_TYPE,
    status: { $in: ACTIVE_COMMAND_STATUSES }
  }).session(session || null);

  if (existingCommand) {
    const error = new Error("A location request is already active for this device");
    error.statusCode = 409;
    throw error;
  }

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

