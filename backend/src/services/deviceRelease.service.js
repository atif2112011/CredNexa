import { DEVICE_STATES } from "../constants/deviceStates.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";
import { EMI_SCHEDULE_STATUSES } from "../models/EmiSchedule.js";

export const RELEASE_COMMAND_TYPE = "RELEASE_DEVICE";
export const COMPLETED_INSTALLMENT_STATUSES = Object.freeze(["paid", "waived"]);
export const ACTIVE_DEVICE_COMMAND_STATUSES = Object.freeze(["pending", "sent"]);

export const areInstallmentsCompleted = (installments = []) =>
  installments.length > 0 &&
  installments.every((installment) => COMPLETED_INSTALLMENT_STATUSES.includes(installment.status));

export const settleCompletedSchedule = (schedule, now = new Date()) => {
  const completed = areInstallmentsCompleted(schedule?.installments || []);
  const newlySettled = completed && schedule.status !== EMI_SCHEDULE_STATUSES.SETTLED;

  if (newlySettled) {
    schedule.status = EMI_SCHEDULE_STATUSES.SETTLED;
    schedule.settlementTime = now;
  }

  return { completed, newlySettled };
};

export const getDeviceReleaseSummary = ({ schedule, device, latestReleaseCommand } = {}) => {
  const completedInstallments = (schedule?.installments || []).filter((installment) =>
    COMPLETED_INSTALLMENT_STATUSES.includes(installment.status)
  ).length;
  const totalInstallments = schedule?.installments?.length || 0;
  const settled = schedule?.status === EMI_SCHEDULE_STATUSES.SETTLED;
  const released = device?.state === DEVICE_STATES.RELEASED;
  const activeCommand = ACTIVE_DEVICE_COMMAND_STATUSES.includes(latestReleaseCommand?.status);

  return {
    eligible: settled && areInstallmentsCompleted(schedule?.installments || []) && !released,
    settled,
    completedInstallments,
    totalInstallments,
    deviceState: device?.state || null,
    latestCommand: latestReleaseCommand || null,
    canQueue: settled && !released && !activeCommand
  };
};

const createConflict = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
};

export const queueDeviceRelease = async ({
  device,
  schedule,
  accountId,
  triggeredBy,
  reason,
  session
}) => {
  if (
    schedule?.status !== EMI_SCHEDULE_STATUSES.SETTLED ||
    !areInstallmentsCompleted(schedule?.installments || [])
  ) {
    const error = new Error("All EMI installments must be paid or waived before device release");
    error.statusCode = 400;
    throw error;
  }

  if (device.state === DEVICE_STATES.RELEASED) {
    throw createConflict("Device has already been released");
  }

  const activeReleaseCommand = await DeviceCommand.findOne({
    deviceId: device._id,
    commandType: RELEASE_COMMAND_TYPE,
    status: { $in: ACTIVE_DEVICE_COMMAND_STATUSES }
  }).session(session || null);

  if (activeReleaseCommand) {
    throw createConflict("A device release command is already active");
  }

  const now = new Date();
  await DeviceCommand.updateMany(
    {
      deviceId: device._id,
      commandType: { $ne: RELEASE_COMMAND_TYPE },
      status: { $in: ACTIVE_DEVICE_COMMAND_STATUSES }
    },
    {
      $set: {
        status: "expired",
        failureReason: "Superseded by permanent device release"
      },
      $unset: { nextRetryAt: "" }
    },
    { session }
  );

  const commands = await DeviceCommand.create(
    [
      {
        deviceId: device._id,
        tenantId: device.tenantId,
        commandType: RELEASE_COMMAND_TYPE,
        triggeredBy,
        triggeredByAccountId: accountId,
        payload: {
          reason,
          settlementTime:
            schedule.settlementTime instanceof Date
              ? schedule.settlementTime.toISOString()
              : schedule.settlementTime,
          emiScheduleId: schedule._id.toString()
        }
      }
    ],
    { session, ordered: true }
  );

  const command = commands[0];
  const updatedDevice = await Device.findByIdAndUpdate(
    device._id,
    {
      $set: {
        state: DEVICE_STATES.RELEASE_PENDING,
        stateUpdatedAt: now,
        stateUpdatedBy: accountId,
        releaseRequestedAt: now,
        releaseCommandId: command._id
      },
      $unset: { tempUnlockExpiresAt: "" }
    },
    { new: true, session }
  );

  return { device: updatedDevice, command };
};
