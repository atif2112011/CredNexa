import { Device } from '../models/Device.js';
import { DevicePolicy } from '../models/DevicePolicy.js';
import { DeviceCommand } from '../models/DeviceCommand.js';
import { assertRunningCommandAllowed, assertRunningActionCapability } from './runningDevicePolicy.service.js';

export const queueAdminDeviceCommand = async ({
  device,
  accountId,
  commandType,
  targetState,
  policyKey,
  reason,
  triggeredBy = "super_admin",
  durationHours,
  extraPayload = {},
  session
}) => {
  assertRunningCommandAllowed(device, commandType, extraPayload);
  assertRunningActionCapability(device, commandType);
  const tempUnlockExpiresAt = durationHours ? new Date(Date.now() + durationHours * 60 * 60 * 1000) : null;
  const activePolicy = await DevicePolicy.findOne({
    tenantId: device.tenantId,
    policyKey,
    isActive: true
  }).lean();

  if (!activePolicy) {
    throw new Error(`Active ${policyKey} policy not found for tenant`);
  }

  const nextPolicyVersion = Number(device.desiredPolicyVersion || 0) + 1;
  const deviceUpdate = {
    $set: {
      state: targetState,
      stateUpdatedAt: new Date(),
      stateUpdatedBy: accountId,
      currentPolicyKey: policyKey,
      currentPolicyId: activePolicy._id,
      desiredPolicyVersion: nextPolicyVersion
    }
  };

  if (durationHours) {
    deviceUpdate.$set.tempUnlockExpiresAt = tempUnlockExpiresAt;
  } else {
    deviceUpdate.$unset = { tempUnlockExpiresAt: "" };
  }

  const updatedDevice = await Device.findByIdAndUpdate(device._id, deviceUpdate, {
    new: true,
    session
  });

  const command = await DeviceCommand.create(
    [
      {
        deviceId: device._id,
        tenantId: device.tenantId,
        commandType,
        triggeredBy,
        triggeredByAccountId: accountId,
        payload: {
          reason,
          durationHours,
          ...(tempUnlockExpiresAt ? { tempUnlockExpiresAt } : {}),
          policyKey,
          policyVersion: nextPolicyVersion,
          ...extraPayload
        }
      }
    ],
    { session, ordered: true }
  );

  return { device: updatedDevice, command: command[0] };
};

