import {
  DEVICE_SECURITY_CONTROLS,
  getDeviceSecurityControl,
  getDeviceSecurityControlByCommandType,
  normalizeDeviceSecurityControlEntry,
  normalizeDeviceSecurityControlState
} from "../constants/deviceSecurityControls.js";
import { DEVICE_STATES } from "../constants/deviceStates.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";

const SECURITY_CONTROL_RESULTS = Object.freeze({
  SET_FACTORY_RESET_BLOCKED: Object.freeze({
    true: "factory_reset_disallowed",
    false: "factory_reset_allowed"
  }),
  SET_USB_DEBUGGING_BLOCKED: Object.freeze({
    true: "usb_debugging_disallowed",
    false: "usb_debugging_allowed"
  }),
  SET_UNKNOWN_APP_INSTALL_BLOCKED: Object.freeze({
    true: "unknown_app_installs_disallowed",
    false: "unknown_app_installs_allowed"
  })
});

export const parseSecurityControlBlockedValue = (value) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

export const getExpectedSecurityControlResult = (commandType, blocked) => {
  const normalizedBlocked = parseSecurityControlBlockedValue(blocked);
  if (normalizedBlocked === null) return null;
  return SECURITY_CONTROL_RESULTS[commandType]?.[String(normalizedBlocked)] || null;
};

export const selectLatestActiveSecurityControlCommands = (commands = []) => {
  const latestByType = new Map();

  for (const command of commands) {
    if (!getDeviceSecurityControlByCommandType(command?.commandType)) continue;
    const existing = latestByType.get(command.commandType);
    const version = Number(command.payload?.controlVersion || 0);
    const existingVersion = Number(existing?.payload?.controlVersion || 0);
    const isNewerVersion = !existing || version > existingVersion;
    const isNewerRecord =
      version === existingVersion &&
      new Date(command.createdAt || 0).getTime() >
        new Date(existing?.createdAt || 0).getTime();

    if (isNewerVersion || isNewerRecord) {
      latestByType.set(command.commandType, command);
    }
  }

  return [...latestByType.values()];
};

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

export const buildSecurityControlConfirmations = ({ state, commands = [] }) => {
  const normalizedState = normalizeDeviceSecurityControlState(state);

  return Object.values(DEVICE_SECURITY_CONTROLS).reduce((result, control) => {
    const command = commands.find(
      (entry) => entry?.commandType === control.commandType
    );
    const entry = normalizedState[control.key];
    const desiredBlocked = command
      ? parseSecurityControlBlockedValue(command.payload?.blocked)
      : entry.desiredBlocked;
    const desiredControlVersion = command
      ? Number(command.payload?.controlVersion)
      : entry.desiredVersion;
    let confirmationStatus = "queued";

    if (command?.status === "sent") confirmationStatus = "awaiting_device";
    if (command?.status === "failed") confirmationStatus = "failed";
    if (
      command?.status === "acknowledged" &&
      Number(command.ackPayload?.appliedControlVersion) === desiredControlVersion &&
      command.ackPayload?.appliedBlocked === desiredBlocked
    ) {
      confirmationStatus = "applied";
    }
    if (!command && entry.appliedVersion === entry.desiredVersion) {
      confirmationStatus = "applied";
    }

    result[control.key] = {
      commandType: control.commandType,
      desiredBlocked,
      desiredControlVersion,
      appliedBlocked: entry.appliedBlocked,
      appliedControlVersion: entry.appliedVersion,
      confirmationStatus,
      latestCommandId: command?._id || null,
      lastErrorCode: command?.ackPayload?.errorCode || null
    };
    return result;
  }, {});
};

export const buildPendingSecurityControlSupersessionFilter = ({
  deviceId,
  commandType
}) => ({
  deviceId,
  commandType,
  status: { $in: ["pending", "sent"] }
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
