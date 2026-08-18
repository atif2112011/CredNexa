import mongoose from "mongoose";

import { DEVICE_POLICY_KEYS, DEVICE_STATES, isDeviceReleaseState } from "../constants/deviceStates.js";
import { runEmiPolicyJob } from "../jobs/scheduledJobs.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";
import { DevicePolicy } from "../models/DevicePolicy.js";
import { EmiSchedule } from "../models/EmiSchedule.js";
import { TenantPolicy } from "../models/TenantPolicy.js";
import { queueDeviceRelease, settleCompletedSchedule } from "./deviceRelease.service.js";
import { queueDeviceRestrictionClear } from "./deviceRestrictions.service.js";
import {
  DEFAULT_EMI_REMINDER_MESSAGES,
  EMI_REMINDER_TYPES,
  queueEmiReminder
} from "./emiReminder.service.js";
import { markEmiInstallmentPaid } from "./emiInstallment.service.js";
import { isManualDeviceControl } from "./tenantDeviceControl.service.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const ADMIN_DEVICE_TEST_ACTIONS = Object.freeze({
  SEND_OVERDUE_REMINDER: "send-overdue-reminder",
  SEND_UPCOMING_REMINDER: "send-upcoming-reminder",
  SIMULATE_AUTO_LOCK: "simulate-auto-lock",
  SIMULATE_PAYMENT_UNLOCK: "simulate-payment-unlock",
  SIMULATE_DEVICE_GRACE: "simulate-device-grace",
  SIMULATE_UPCOMING_EMI: "simulate-upcoming-emi",
  SIMULATE_RELEASE: "simulate-release",
  MANUAL_SET_OVERDUE: "manual-set-overdue",
  MANUAL_SET_GRACE: "manual-set-grace",
  MANUAL_SET_PAID: "manual-set-paid"
});

const createActionError = (message, statusCode = 400, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const startOfUtcDay = (date = new Date()) => {
  const value = new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
};

const addDays = (date, days) => new Date(startOfUtcDay(date).getTime() + Number(days) * DAY_IN_MS);

const getOutstandingAmount = (installment) =>
  Math.max(
    Number(installment.emiAmount || 0) +
      Number(installment.penaltyAmount || 0) -
      Number(installment.paidAmount || 0),
    0
  );

const findNextUnpaidInstallment = (schedule) =>
  [...(schedule.installments || [])]
    .filter((installment) => ["pending", "overdue", "partial"].includes(installment.status))
    .sort((left, right) => new Date(left.dueDate) - new Date(right.dueDate))[0] || null;

const findMostRecentOverdueInstallment = (schedule, now = new Date()) =>
  [...(schedule.installments || [])]
    .filter(
      (installment) =>
        ["overdue", "partial"].includes(installment.status) ||
        (installment.status === "pending" && new Date(installment.dueDate) < startOfUtcDay(now))
    )
    .sort((left, right) => new Date(right.dueDate) - new Date(left.dueDate))[0] || null;

const findLatestUnpaidInstallment = (schedule, now = new Date()) => {
  const unpaidInstallments = [...(schedule.installments || [])]
    .filter((installment) => ["pending", "overdue", "partial"].includes(installment.status))
    .sort((left, right) => new Date(left.dueDate) - new Date(right.dueDate));
  const alreadyDue = unpaidInstallments.filter(
    (installment) => new Date(installment.dueDate) <= startOfUtcDay(now)
  );

  return alreadyDue.at(-1) || unpaidInstallments[0] || null;
};

const loadTestingContext = async (deviceId) => {
  const device = await Device.findById(deviceId);
  if (!device) throw createActionError("Device not found", 404);

  const [schedule, tenantPolicy] = await Promise.all([
    EmiSchedule.findOne({ userId: device.userId, tenantId: device.tenantId }),
    TenantPolicy.findOne({ tenantId: device.tenantId }).lean()
  ]);

  if (!schedule) throw createActionError("EMI schedule not found for device", 404);
  if (!tenantPolicy) throw createActionError("Tenant policy not found for device", 409);

  return { device, schedule, tenantPolicy };
};

const assertCommandAllowed = (device) => {
  if (isDeviceReleaseState(device.state) || device.deviceOwnerStatus === "RELEASED") {
    throw createActionError("Testing commands are not allowed after device release begins", 409);
  }
};

const assertAutomaticEmiControl = (tenantPolicy) => {
  if (isManualDeviceControl(tenantPolicy)) {
    throw createActionError(
      "EMI cron simulations require the tenant to use automatic device control",
      409,
      "AUTOMATIC_DEVICE_CONTROL_REQUIRED"
    );
  }
};

const assertManualEmiControl = (tenantPolicy) => {
  if (!isManualDeviceControl(tenantPolicy)) {
    throw createActionError(
      "Manual-mode installment simulations require the tenant to use manual device control",
      409,
      "MANUAL_DEVICE_CONTROL_REQUIRED"
    );
  }
};

const recalculateScheduleOverdueState = (schedule, now = new Date()) => {
  const overdueInstallments = schedule.installments.filter((installment) =>
    ["overdue", "partial"].includes(installment.status)
  );
  schedule.overdueInstallments = overdueInstallments.length;
  schedule.overdueAmount = overdueInstallments.reduce(
    (total, installment) => total + getOutstandingAmount(installment),
    0
  );
  schedule.dpd = overdueInstallments.reduce((maximumDpd, installment) => {
    const installmentDpd = Math.max(
      Math.floor(
        (startOfUtcDay(now).getTime() - startOfUtcDay(installment.dueDate).getTime()) / DAY_IN_MS
      ),
      0
    );
    return Math.max(maximumDpd, installmentDpd);
  }, 0);
};

const resetInstallmentForSimulation = (installment, dueDate) => {
  installment.status = "pending";
  installment.dueDate = dueDate;
  installment.paidAmount = 0;
  installment.paidAt = undefined;
  installment.markedPaidBy = undefined;
  installment.markPaidReason = undefined;
  installment.markPaidReference = undefined;
  installment.paymentId = undefined;
  installment.waivedBy = undefined;
  installment.waivedAt = undefined;
  installment.waiveReason = undefined;
};

const resetScheduleForSimulation = (schedule) => {
  schedule.status = "active";
  schedule.settlementTime = undefined;
};

const resetDeviceForEmiCron = async ({ device, actorId }) => {
  const paidPolicy = await DevicePolicy.findOne({
    tenantId: device.tenantId,
    policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
    isActive: true
  }).lean();

  if (!paidPolicy) throw createActionError("Active EMI_PAID policy not found for tenant", 409);

  await Device.findByIdAndUpdate(device._id, {
    $set: {
      state: DEVICE_STATES.ACTIVE,
      currentPolicyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      currentPolicyId: paidPolicy._id,
      stateUpdatedAt: new Date(),
      stateUpdatedBy: actorId
    },
    $unset: { tempUnlockExpiresAt: "" }
  });
};

const prepareCronSimulation = async ({ context, actorId, mode }) => {
  const { device, schedule, tenantPolicy } = context;
  assertCommandAllowed(device);
  assertAutomaticEmiControl(tenantPolicy);

  const installment = findNextUnpaidInstallment(schedule);
  if (!installment) throw createActionError("No unpaid EMI installment is available for simulation", 409);

  const lockRules = tenantPolicy.lockRules || {};
  const dpd = Math.max(Number(lockRules.dpd ?? 30), 0);
  const gracePeriodDays = Math.max(Number(lockRules.gracePeriodDays ?? 7), 0);
  const now = new Date();
  let dueDate;

  if (mode === "auto-lock") {
    if (lockRules.lockOnGraceExpiry === false) {
      throw createActionError("Auto-lock on grace expiry is disabled for this tenant", 409);
    }
    dueDate = addDays(now, -(dpd + gracePeriodDays + 1));
  } else if (mode === "grace") {
    if (gracePeriodDays <= 0) {
      throw createActionError("Tenant grace period must be greater than zero", 409);
    }
    dueDate = addDays(now, -dpd);
  } else {
    dueDate = addDays(now, 5);
  }

  resetInstallmentForSimulation(installment, dueDate);
  resetScheduleForSimulation(schedule);
  await schedule.save();

  await Promise.all([
    resetDeviceForEmiCron({ device, actorId }),
    Device.updateOne(
      { _id: device._id },
      { $pull: { graceReminderHistory: { installmentId: installment._id } } }
    ),
    mode === "auto-lock"
      ? DeviceCommand.updateMany(
          {
            deviceId: device._id,
            commandType: "LOCK",
            triggeredBy: "auto_policy",
            status: { $in: ["pending", "sent"] }
          },
          {
            $set: {
              status: "expired",
              failureReason: "Superseded by a newer admin EMI simulation"
            },
            $unset: { nextRetryAt: "" }
          }
        )
      : mode === "grace"
        ? DeviceCommand.updateMany(
            {
              deviceId: device._id,
              commandType: "POLICY_UPDATE",
              triggeredBy: "auto_policy",
              status: { $in: ["pending", "sent"] },
              "payload.policyKey": DEVICE_POLICY_KEYS.EMI_GRACE
            },
            {
              $set: {
                status: "expired",
                failureReason: "Superseded by a newer admin EMI simulation"
              },
              $unset: { nextRetryAt: "" }
            }
          )
        : Promise.resolve()
  ]);

  const cronResult = await runEmiPolicyJob({
    scheduleId: schedule._id,
    limit: 1,
    forceReminders: mode !== "auto-lock"
  });

  const updatedDevice = await Device.findById(device._id).lean();
  return {
    installment: {
      installmentId: installment._id,
      installmentNumber: installment.installmentNumber,
      dueDate
    },
    deviceState: updatedDevice?.state,
    cronResult
  };
};

const queueManualReminder = async ({ context, actorId, reminderType }) => {
  const { device, schedule } = context;
  assertCommandAllowed(device);

  const installment = reminderType === EMI_REMINDER_TYPES.OVERDUE
    ? findNextUnpaidInstallment(schedule)
    : [...(schedule.installments || [])]
          .filter(
            (item) =>
              ["pending", "partial"].includes(item.status) && new Date(item.dueDate) >= new Date()
          )
          .sort((left, right) => new Date(left.dueDate) - new Date(right.dueDate))[0] || null;

  if (!installment) {
    throw createActionError(
      reminderType === EMI_REMINDER_TYPES.OVERDUE
        ? "No overdue EMI installment is available"
        : "No upcoming unpaid EMI installment is available",
      409
    );
  }

  if (reminderType === EMI_REMINDER_TYPES.OVERDUE) {
    const now = new Date();
    if (
      !["overdue", "partial"].includes(installment.status) ||
      new Date(installment.dueDate) >= startOfUtcDay(now)
    ) {
      installment.status = "overdue";
      installment.dueDate = addDays(now, -1);
    }

    const overdueInstallments = schedule.installments.filter((item) =>
      ["overdue", "partial"].includes(item.status)
    );
    schedule.status = "active";
    schedule.settlementTime = undefined;
    schedule.overdueInstallments = overdueInstallments.length;
    schedule.overdueAmount = overdueInstallments.reduce(
      (total, item) => total + getOutstandingAmount(item),
      0
    );
    schedule.dpd = overdueInstallments.reduce((maximumDpd, item) => {
      const installmentDpd = Math.max(
        Math.floor(
          (startOfUtcDay(now).getTime() - startOfUtcDay(item.dueDate).getTime()) / DAY_IN_MS
        ),
        0
      );
      return Math.max(maximumDpd, installmentDpd);
    }, 0);
    await schedule.save();
  }

  const result = await queueEmiReminder({
    device,
    tenantId: device.tenantId,
    triggeredBy: "super_admin",
    triggeredByAccountId: actorId,
    deduplicateActive: false,
    payload: {
      reminderType,
      message: DEFAULT_EMI_REMINDER_MESSAGES[reminderType],
      amount: getOutstandingAmount(installment),
      dueDate: installment.dueDate,
      installmentNumber: installment.installmentNumber,
      totalInstallments: schedule.installments.length
    }
  });

  return {
    command: result.command,
    installment: {
      installmentId: installment._id,
      installmentNumber: installment.installmentNumber,
      dueDate: installment.dueDate
    }
  };
};

const simulatePaymentUnlock = async ({ context, actorId }) => {
  const { device, schedule } = context;
  assertCommandAllowed(device);
  const installment = findMostRecentOverdueInstallment(schedule);
  if (!installment) throw createActionError("No overdue EMI installment is available to mark paid", 409);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const transactionalDevice = await Device.findById(device._id).session(session);
    const transactionalSchedule = await EmiSchedule.findById(schedule._id).session(session);
    const paymentResult = markEmiInstallmentPaid({
      schedule: transactionalSchedule,
      installmentId: installment._id,
      accountId: actorId,
      reason: "Admin testing panel payment simulation",
      reference: `ADMIN-TEST-${Date.now()}`,
      paidAt: new Date(),
      now: new Date()
    });
    await transactionalSchedule.save({ session });

    const paidPolicy = await DevicePolicy.findOne({
      tenantId: transactionalDevice.tenantId,
      policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      isActive: true
    }).lean();
    if (!paidPolicy) throw createActionError("Active EMI_PAID policy not found for tenant", 409);

    const nextPolicyVersion = Number(transactionalDevice.desiredPolicyVersion || 0) + 1;
    const updatedDevice = await Device.findByIdAndUpdate(
      transactionalDevice._id,
      {
        $set: {
          state: DEVICE_STATES.UNLOCK_PENDING,
          currentPolicyKey: DEVICE_POLICY_KEYS.EMI_PAID,
          currentPolicyId: paidPolicy._id,
          desiredPolicyVersion: nextPolicyVersion,
          stateUpdatedAt: new Date(),
          stateUpdatedBy: actorId
        },
        $pull: { graceReminderHistory: { installmentId: installment._id } },
        $unset: { tempUnlockExpiresAt: "" }
      },
      { new: true, session }
    );

    const commands = await DeviceCommand.create(
      [
        {
          deviceId: transactionalDevice._id,
          tenantId: transactionalDevice.tenantId,
          commandType: "UNLOCK",
          triggeredBy: "payment_unlock",
          triggeredByAccountId: actorId,
          payload: {
            reason: "Admin testing panel payment simulation",
            installmentId: installment._id.toString(),
            policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
            policyVersion: nextPolicyVersion
          }
        }
      ],
      { session, ordered: true }
    );

    const restrictionClearResult = await queueDeviceRestrictionClear({
      device: updatedDevice,
      accountId: actorId,
      triggeredBy: "payment_unlock",
      session
    });

    await session.commitTransaction();
    return {
      installment: paymentResult.installment,
      scheduleStatus: transactionalSchedule.status,
      device: updatedDevice,
      command: commands[0],
      restrictionCommand: restrictionClearResult.command
    };
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const simulateManualInstallmentState = async ({ context, actorId, state }) => {
  const { device, schedule, tenantPolicy } = context;
  assertCommandAllowed(device);
  assertManualEmiControl(tenantPolicy);

  const installment = findLatestUnpaidInstallment(schedule);
  if (!installment) {
    throw createActionError("No unpaid EMI installment is available for manual-mode simulation", 409);
  }

  const now = new Date();
  if (state === "paid") {
    const paymentResult = markEmiInstallmentPaid({
      schedule,
      installmentId: installment._id,
      accountId: actorId,
      reason: "Admin testing panel manual-mode payment simulation",
      reference: `ADMIN-TEST-MANUAL-${Date.now()}`,
      paidAt: now,
      now
    });
    await schedule.save();
    await Device.updateOne(
      { _id: device._id },
      { $pull: { graceReminderHistory: { installmentId: installment._id } } }
    );

    return {
      simulationState: state,
      installment: paymentResult.installment,
      scheduleStatus: schedule.status,
      overdueInstallments: schedule.overdueInstallments,
      overdueAmount: schedule.overdueAmount,
      dpd: schedule.dpd
    };
  }

  const lockRules = tenantPolicy.lockRules || {};
  const dpd = Math.max(Number(lockRules.dpd ?? 30), 0);
  const gracePeriodDays = Math.max(Number(lockRules.gracePeriodDays ?? 7), 0);
  if (state === "grace" && gracePeriodDays <= 0) {
    throw createActionError("Tenant grace period must be greater than zero", 409);
  }

  const dueDate = state === "overdue" ? addDays(now, -2) : addDays(now, -dpd);
  installment.status = "overdue";
  installment.dueDate = dueDate;
  installment.paidAt = undefined;
  installment.markedPaidBy = undefined;
  installment.markPaidReason = undefined;
  installment.markPaidReference = undefined;
  installment.paymentId = undefined;
  resetScheduleForSimulation(schedule);
  recalculateScheduleOverdueState(schedule, now);
  await schedule.save();
  await Device.updateOne(
    { _id: device._id },
    { $pull: { graceReminderHistory: { installmentId: installment._id } } }
  );

  return {
    simulationState: state,
    installment: {
      installmentId: installment._id,
      installmentNumber: installment.installmentNumber,
      status: installment.status,
      dueDate: installment.dueDate
    },
    scheduleStatus: schedule.status,
    overdueInstallments: schedule.overdueInstallments,
    overdueAmount: schedule.overdueAmount,
    dpd: schedule.dpd,
    ...(state === "grace"
      ? {
          graceStartedAt: addDays(dueDate, dpd),
          graceExpiresAt: addDays(dueDate, dpd + gracePeriodDays)
        }
      : {})
  };
};

const simulateRelease = async ({ context, actorId }) => {
  const { device, schedule } = context;
  if (device.state === DEVICE_STATES.RELEASED) {
    throw createActionError("Device has already been released", 409);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const transactionalDevice = await Device.findById(device._id).session(session);
    const transactionalSchedule = await EmiSchedule.findById(schedule._id).session(session);
    const now = new Date();
    const updatedInstallmentIds = [];

    for (const installment of transactionalSchedule.installments) {
      if (["paid", "waived"].includes(installment.status)) continue;
      installment.status = "paid";
      installment.paidAmount = Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0);
      installment.paidAt = now;
      installment.markedPaidBy = actorId;
      installment.markPaidReason = "Admin testing panel release simulation";
      installment.markPaidReference = `ADMIN-TEST-RELEASE-${Date.now()}`;
      updatedInstallmentIds.push(installment._id);
    }

    transactionalSchedule.overdueAmount = 0;
    transactionalSchedule.overdueInstallments = 0;
    transactionalSchedule.dpd = 0;
    settleCompletedSchedule(transactionalSchedule, now);
    await transactionalSchedule.save({ session });

    await Device.updateOne(
      { _id: transactionalDevice._id },
      { $set: { graceReminderHistory: [] } },
      { session }
    );

    const releaseResult = await queueDeviceRelease({
      device: transactionalDevice,
      schedule: transactionalSchedule,
      accountId: actorId,
      triggeredBy: "payment_settlement",
      reason: "Admin testing panel settled all installments",
      session
    });

    await session.commitTransaction();
    return { ...releaseResult, schedule: transactionalSchedule, updatedInstallmentIds };
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const runAdminDeviceTestAction = async ({ deviceId, action, actorId }) => {
  if (!Object.values(ADMIN_DEVICE_TEST_ACTIONS).includes(action)) {
    throw createActionError("Unsupported device testing action", 400);
  }

  const context = await loadTestingContext(deviceId);

  switch (action) {
    case ADMIN_DEVICE_TEST_ACTIONS.SEND_OVERDUE_REMINDER:
      return queueManualReminder({ context, actorId, reminderType: EMI_REMINDER_TYPES.OVERDUE });
    case ADMIN_DEVICE_TEST_ACTIONS.SEND_UPCOMING_REMINDER:
      return queueManualReminder({ context, actorId, reminderType: EMI_REMINDER_TYPES.UPCOMING });
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_AUTO_LOCK:
      return prepareCronSimulation({ context, actorId, mode: "auto-lock" });
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_PAYMENT_UNLOCK:
      return simulatePaymentUnlock({ context, actorId });
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_DEVICE_GRACE:
      return prepareCronSimulation({ context, actorId, mode: "grace" });
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_UPCOMING_EMI:
      return prepareCronSimulation({ context, actorId, mode: "upcoming" });
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_RELEASE:
      return simulateRelease({ context, actorId });
    case ADMIN_DEVICE_TEST_ACTIONS.MANUAL_SET_OVERDUE:
      return simulateManualInstallmentState({ context, actorId, state: "overdue" });
    case ADMIN_DEVICE_TEST_ACTIONS.MANUAL_SET_GRACE:
      return simulateManualInstallmentState({ context, actorId, state: "grace" });
    case ADMIN_DEVICE_TEST_ACTIONS.MANUAL_SET_PAID:
      return simulateManualInstallmentState({ context, actorId, state: "paid" });
    default:
      throw createActionError("Unsupported device testing action", 400);
  }
};
