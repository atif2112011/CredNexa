import {
  isDeviceRestrictionKey,
  normalizeDeviceRestrictionState,
  normalizeDeviceRestrictions
} from "../constants/deviceRestrictions.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";

export const DEVICE_RESTRICTIONS_COMMAND_TYPE = "RESTRICTIONS_UPDATE";

export const formatLatestRestrictionCommand = (command) => {
  if (!command) return null;

  return {
    ...command,
    commandId: command._id,
    restrictionResults: command.ackPayload?.restrictionResults ?? null
  };
};

export const validateDeviceRestrictionUpdate = (payload = {}) => {
  const restriction = String(payload.restriction || "").trim();

  if (!isDeviceRestrictionKey(restriction)) {
    return { error: "restriction must be dialer, camera, whatsapp, youtube, or playStore" };
  }

  if (typeof payload.locked !== "boolean") {
    return { error: "locked must be a boolean" };
  }

  return {
    value: {
      restriction,
      locked: payload.locked,
      retry: payload.retry === true
    }
  };
};

export const buildDeviceRestrictionUpdate = ({
  restrictionState,
  restriction,
  locked,
  retry = false
}) => {
  const currentState = normalizeDeviceRestrictionState(restrictionState);
  const desired = normalizeDeviceRestrictions({
    ...currentState.desired,
    [restriction]: locked
  });
  const reuseVersion =
    retry &&
    currentState.desired[restriction] === locked &&
    currentState.appliedVersion < currentState.desiredVersion;

  return {
    desired,
    desiredVersion: reuseVersion
      ? currentState.desiredVersion
      : currentState.desiredVersion + 1,
    reuseVersion
  };
};

export const shouldAdvanceAppliedRestrictionState = ({
  currentAppliedVersion,
  acknowledgedVersion
}) => {
  return Number(acknowledgedVersion) >= Number(currentAppliedVersion || 0);
};

export const validateDeviceRestrictionRetry = ({
  restrictionState,
  restriction,
  locked,
  retry
}) => {
  if (!retry) return null;
  const currentState = normalizeDeviceRestrictionState(restrictionState);
  if (
    currentState.desired[restriction] !== locked ||
    currentState.appliedVersion >= currentState.desiredVersion
  ) {
    return "Restriction retry must match a desired state that is still awaiting application";
  }
  return null;
};

export const queueDeviceRestrictionUpdate = async ({
  device,
  accountId,
  triggeredBy,
  restriction,
  locked,
  retry = false,
  session
}) => {
  const currentState = normalizeDeviceRestrictionState(device.restrictionState);
  const retryError = validateDeviceRestrictionRetry({
    restrictionState: currentState,
    restriction,
    locked,
    retry
  });
  if (retryError) {
    const error = new Error(retryError);
    error.statusCode = 409;
    throw error;
  }

  const now = new Date();
  const update = {
    $set: {
      "restrictionState.updatedAt": now,
      "restrictionState.updatedBy": accountId
    }
  };

  if (!retry) {
    update.$set[`restrictionState.desired.${restriction}`] = locked;
    update.$inc = { "restrictionState.desiredVersion": 1 };
  }

  const updatedDevice = await Device.findOneAndUpdate(
    retry
      ? {
          _id: device._id,
          "restrictionState.desiredVersion": currentState.desiredVersion,
          [`restrictionState.desired.${restriction}`]: locked
        }
      : { _id: device._id },
    update,
    { new: true, session }
  );

  if (!updatedDevice) {
    const error = new Error("Restriction state changed before the retry could be queued");
    error.statusCode = 409;
    throw error;
  }

  const updatedState = normalizeDeviceRestrictionState(updatedDevice.restrictionState);
  const desired = updatedState.desired;
  const desiredVersion = updatedState.desiredVersion;

  await DeviceCommand.updateMany(
    {
      deviceId: device._id,
      commandType: DEVICE_RESTRICTIONS_COMMAND_TYPE,
      status: "pending"
    },
    {
      $set: {
        status: "expired",
        failureReason: "Superseded by a newer restriction state"
      }
    },
    { session }
  );

  const commands = await DeviceCommand.create(
    [
      {
        deviceId: device._id,
        tenantId: device.tenantId,
        commandType: DEVICE_RESTRICTIONS_COMMAND_TYPE,
        triggeredBy,
        triggeredByAccountId: accountId,
        payload: {
          restrictionVersion: desiredVersion,
          restrictions: desired
        }
      }
    ],
    { session, ordered: true }
  );

  return {
    device: updatedDevice,
    restrictionState: normalizeDeviceRestrictionState(updatedDevice.restrictionState),
    command: commands[0]
  };
};
