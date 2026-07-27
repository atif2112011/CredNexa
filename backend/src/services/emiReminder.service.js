import { isDeviceReleaseState } from "../constants/deviceStates.js";
import { DeviceCommand } from "../models/DeviceCommand.js";

export const EMI_REMINDER_COMMAND_TYPE = "EMI_REMINDER";

export const EMI_REMINDER_TYPES = Object.freeze({
  OVERDUE: "OVERDUE",
  PENDING: "PENDING",
  UPCOMING: "UPCOMING"
});

export const DEFAULT_EMI_REMINDER_MESSAGES = Object.freeze({
  OVERDUE: "Your EMI payment is overdue.",
  PENDING: "Your EMI payment is pending.",
  UPCOMING: "Your EMI payment is due soon."
});

export const buildEmiReminderPayload = ({
  reminderType,
  message,
  amount,
  dueDate,
  installmentNumber,
  totalInstallments
}) => {
  if (!Object.values(EMI_REMINDER_TYPES).includes(reminderType)) {
    throw new Error("reminderType must be OVERDUE, PENDING, or UPCOMING");
  }

  const payload = {
    reminderType,
    message: String(message || DEFAULT_EMI_REMINDER_MESSAGES[reminderType]).trim()
  };

  if (amount !== undefined && amount !== null) payload.amount = Number(amount);
  if (dueDate) payload.dueDate = new Date(dueDate).toISOString();
  if (installmentNumber !== undefined && installmentNumber !== null) {
    payload.installmentNumber = Number(installmentNumber);
  }
  if (totalInstallments !== undefined && totalInstallments !== null) {
    payload.totalInstallments = Number(totalInstallments);
  }

  return payload;
};

export const queueEmiReminder = async ({
  device,
  tenantId,
  triggeredBy,
  triggeredByAccountId,
  payload,
  deduplicateActive = true
}) => {
  if (isDeviceReleaseState(device?.state) || device?.deviceOwnerStatus === "RELEASED") {
    const error = new Error("Device release is pending or complete; EMI reminders are no longer allowed");
    error.statusCode = 409;
    throw error;
  }

  const normalizedPayload = buildEmiReminderPayload(payload);
  if (deduplicateActive) {
    const existingCommand = await DeviceCommand.findOne({
      deviceId: device._id,
      commandType: EMI_REMINDER_COMMAND_TYPE,
      status: { $in: ["pending", "sent"] },
      "payload.reminderType": normalizedPayload.reminderType,
      ...(normalizedPayload.installmentNumber === undefined
        ? {}
        : { "payload.installmentNumber": normalizedPayload.installmentNumber })
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existingCommand) return { command: existingCommand, created: false };
  }

  const command = await DeviceCommand.create({
    deviceId: device._id,
    tenantId: tenantId || device.tenantId,
    commandType: EMI_REMINDER_COMMAND_TYPE,
    triggeredBy,
    triggeredByAccountId,
    payload: normalizedPayload
  });

  return { command, created: true };
};
