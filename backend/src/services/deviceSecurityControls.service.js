import {
  DEVICE_SECURITY_CONTROLS,
  getDeviceSecurityControl,
  normalizeDeviceSecurityControlEntry,
  normalizeDeviceSecurityControlState
} from "../constants/deviceSecurityControls.js";
import { DEVICE_STATES } from "../constants/deviceStates.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";

export const validateDeviceSecurityControlUpdate = (payload = {}) => {
  if (typeof payload.blocked !== "boolean") {
    return { error: "blocked must be a boolean" };
  }

  return {
    value: {
      blocked: payload.blocked,
      retry: payload.retry === true
    }
  };
};

export const validateDeviceSecurityControlRetry = ({
  entry,
  blocked,
  retry
}) => {
  if (!retry) return null;
  const current = normalizeDeviceSecurityControlEntry(entry);
  if (
    current.desiredBlocked !== blocked ||
    current.appliedVersion >= current.desiredVersion
  ) {
    return "Security control retry must match a desired state that is still awaiting application";
  }
  return null;
};

export const shouldAdvanceAppliedSecurityControlState = ({
  currentAppliedVersion,
  acknowledgedVersion
}) => Number(acknowledgedVersion) >= Number(currentAppliedVersion || 0);

export const buildReleasedDeviceSecurityControlState = (
  state,
  releasedAt = new Date(),
  updatedBy = null
) => {
  const current = normalizeDeviceSecurityControlState(state);
  return Object.entries(current).reduce((released, [controlKey, entry]) => {
    const releasedVersion =
      Math.max(entry.desiredVersion, entry.appliedVersion) + 1;
    released[controlKey] = {
      desiredBlocked: false,
      appliedBlocked: false,
      desiredVersion: releasedVersion,
      appliedVersion: releasedVersion,
      updatedAt: releasedAt,
      appliedAt: releasedAt,
      updatedBy
    };
    return released;
  }, {});
};

export const formatLatestSecurityControlCommand = (command) => {
  if (!command) return null;
  return {
    ...command,
    commandId: command._id,
    controlResult: command.ackPayload?.controlResult ?? null
  };
};

export const formatLatestSecurityControlCommands = (commands = []) =>
  Object.values(DEVICE_SECURITY_CONTROLS).reduce((result, control) => {
    result[control.key] = formatLatestSecurityControlCommand(
      commands.find((command) => command?.commandType === control.commandType)
    );
    return result;
  }, {});

export const buildPendingSecurityControlSupersessionFilter = ({
  deviceId,
  commandType
}) => ({
  deviceId,
  commandType,
  status: "pending"
});

export const queueDeviceSecurityControlUpdate = async ({
  device,
  controlKey,
  accountId,
  triggeredBy,
  blocked,
  retry = false,
  session
}) => {
  const control = getDeviceSecurityControl(controlKey);
  if (!control) {
    const error = new Error("Unsupported device security control");
    error.statusCode = 400;
    throw error;
  }
  if ([DEVICE_STATES.RELEASE_PENDING, DEVICE_STATES.RELEASED].includes(device.state)) {
    const error = new Error("Security controls cannot be changed after device release begins");
    error.statusCode = 409;
    throw error;
  }

  const currentState = normalizeDeviceSecurityControlState(device.securityControlState);
  const currentEntry = currentState[controlKey];
  const retryError = validateDeviceSecurityControlRetry({
    entry: currentEntry,
    blocked,
    retry
  });
  if (retryError) {
    const error = new Error(retryError);
    error.statusCode = 409;
    throw error;
  }

  const now = new Date();
  const path = `securityControlState.${controlKey}`;
  const update = {
    $set: {
      [`${path}.updatedAt`]: now,
      [`${path}.updatedBy`]: accountId
    }
  };
  if (!retry) {
    update.$set[`${path}.desiredBlocked`] = blocked;
    update.$inc = { [`${path}.desiredVersion`]: 1 };
  }

  const updatedDevice = await Device.findOneAndUpdate(
    retry
      ? {
          _id: device._id,
          [`${path}.desiredVersion`]: currentEntry.desiredVersion,
          [`${path}.desiredBlocked`]: blocked
        }
      : { _id: device._id },
    update,
    { new: true, session }
  );
  if (!updatedDevice) {
    const error = new Error("Security control state changed before the retry could be queued");
    error.statusCode = 409;
    throw error;
  }

  const updatedState = normalizeDeviceSecurityControlState(
    updatedDevice.securityControlState
  );
  const updatedEntry = updatedState[controlKey];

  await DeviceCommand.updateMany(
    buildPendingSecurityControlSupersessionFilter({
      deviceId: device._id,
      commandType: control.commandType
    }),
    {
      $set: {
        status: "expired",
        failureReason: "Superseded by a newer security control state"
      }
    },
    { session }
  );

  const commands = await DeviceCommand.create(
    [
      {
        deviceId: device._id,
        tenantId: device.tenantId,
        commandType: control.commandType,
        triggeredBy,
        triggeredByAccountId: accountId,
        payload: {
          blocked: updatedEntry.desiredBlocked,
          controlVersion: updatedEntry.desiredVersion
        }
      }
    ],
    { session, ordered: true }
  );

  return {
    device: updatedDevice,
    controlKey,
    controlState: updatedEntry,
    securityControlState: updatedState,
    command: commands[0]
  };
};
