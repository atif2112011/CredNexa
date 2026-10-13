import mongoose from "mongoose";

import { DEVICE_POLICY_KEYS, DEVICE_STATES, isDeviceReleaseState } from "../constants/deviceStates.js";
import { runEmiPolicyJob, runTempUnlockExpiryJob } from "../jobs/scheduledJobs.js";
import { isRunningDevice } from "../constants/enrollmentModes.js";
import { getRunningAllowedActions, formatControlResult } from "./runningDevicePolicy.service.js";
import { queueAdminDeviceCommand } from "./adminDeviceCommand.service.js";
import { queueGetLocationCommand } from "./deviceLocation.service.js";
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
import { markEmiInstallmentPaid, shouldUnlockDeviceAfterInstallmentPayment } from "./emiInstallment.service.js";
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
  MANUAL_SET_UPCOMING: "manual-set-upcoming",
  MANUAL_SET_OVERDUE: "manual-set-overdue",
  MANUAL_SET_GRACE: "manual-set-grace",
  MANUAL_SET_PAID: "manual-set-paid",
  SIMULATE_LOCK: "simulate-lock",
  SIMULATE_UNLOCK: "simulate-unlock",
  SIMULATE_TEMP_UNLOCK: "simulate-temp-unlock",
  SIMULATE_TEMP_UNLOCK_EXPIRY: "simulate-temp-unlock-expiry",
  REQUEST_LOCATION: "request-location"
});

export const TEST_TEMP_UNLOCK_DURATIONS = Object.freeze([6, 12, 24, 48, 60, 72, 168]);

const ACTION_DEFINITIONS = [
  { action: "send-upcoming-reminder", label: "Send Upcoming Reminder", description: "Queue a reminder for the next future unpaid installment.", group: "Reminders", capability: "reminder", schedule: true, upcoming: true },
  { action: "send-overdue-reminder", label: "Send Overdue Reminder", description: "Make the next unpaid installment overdue if needed and queue its reminder.", group: "Reminders", capability: "reminder", schedule: true },
  { action: "simulate-upcoming-emi", label: "Simulate Upcoming EMI Cron", description: "Make the next unpaid installment due in five days and run its reminder cron.", group: "EMI simulations", capability: "reminder", schedule: true },
  { action: "simulate-device-grace", label: "Simulate EMI Grace", description: "Move an unpaid installment into grace and queue the grace policy and reminder.", group: "EMI simulations", mode: "automatic", capability: "reminder", schedule: true, policies: ["EMI_PAID", "EMI_GRACE"] },
  { action: "simulate-auto-lock", label: "Simulate EMI Auto-lock", description: "Move an unpaid installment beyond grace and run its automatic lock cron.", group: "EMI simulations", mode: "automatic", capability: "lock", schedule: true, policies: ["EMI_PAID", "EMI_LOCKED"] },
  ...["upcoming", "overdue", "grace", "paid"].map((state) => ({ action: `manual-set-${state}`, label: `Set Installment ${state === "upcoming" ? "Due in 6 Days" : state[0].toUpperCase() + state.slice(1)}`, description: "Change the latest unpaid installment only; no device command is queued.", group: "Manual schedule simulations", mode: "manual", schedule: true })),
  { action: "simulate-lock", label: "Test Lock", description: "Queue a lock command without changing EMI records.", group: "Device controls", capability: "lock", policies: ["EMI_LOCKED"] },
  { action: "simulate-unlock", label: "Test Full Unlock", description: "Queue a full unlock and cancel the temporary-unlock deadline without changing EMI records.", group: "Device controls", capability: "unlock", policies: ["EMI_PAID"] },
  { action: "simulate-temp-unlock", label: "Test Temporary Unlock", description: "Queue temporary access for the selected duration.", group: "Device controls", capability: "tempUnlock", policies: ["TEMP_UNLOCKED"] },
  { action: "simulate-temp-unlock-expiry", label: "Force Temporary Unlock Expiry", description: "Expire this device's active temporary unlock and run its relock processing immediately.", group: "Device controls", capability: "lock", policies: ["EMI_LOCKED"] },
  { action: "simulate-payment-unlock", label: "Record Payment & Test Outcome", description: "Pay the next unpaid installment; unlock when required, or release after the final payment.", group: "Payment and release", schedule: true, policies: ["EMI_PAID"] },
  { action: "simulate-release", label: "Settle & Release Device", description: "Pay every remaining installment and queue permanent device release.", group: "Payment and release", schedule: true, destructive: true },
  { action: "request-location", label: "Test Location Request", description: "Queue a location request and inspect its acknowledgement in command history.", group: "Device controls", capability: "location" }
];

// One eligibility source for both page rendering and POST validation.
export const getAdminDeviceTestingActions = ({ device, schedule, tenantPolicy, policyKeys = [] }) => {
  const manual = isManualDeviceControl(tenantPolicy);
  const running = isRunningDevice(device);
  const capabilities = getRunningAllowedActions(device, { locationEnabled: tenantPolicy?.runningLocationEnabled === true });
  return ACTION_DEFINITIONS.filter((item) => !item.mode || item.mode === (manual ? "manual" : "automatic")).map((item) => {
    let reason = null;
    if (isDeviceReleaseState(device.state) || device.deviceOwnerStatus === "RELEASED") reason = "Device release has started.";
    else if (!tenantPolicy) reason = "Dealer policy is missing.";
    else if (item.schedule && !schedule) reason = "EMI schedule is missing.";
    else if (item.schedule && item.action !== "simulate-release" && !findNextUnpaidInstallment(schedule)) reason = "No unpaid installment is available.";
    else if (item.action === "simulate-release" && !schedule?.installments?.length) reason = "No installments are available to settle.";
    else if (item.upcoming && !schedule?.installments?.some((i) => ["pending", "partial"].includes(i.status) && new Date(i.dueDate) > new Date())) reason = "No future unpaid installment is available.";
    else if (item.action === "simulate-auto-lock" && tenantPolicy?.lockRules?.lockOnGraceExpiry === false) reason = "Automatic EMI locking is disabled.";
    else if (["simulate-device-grace", "manual-set-grace"].includes(item.action) && Number(tenantPolicy?.lockRules?.gracePeriodDays ?? 7) <= 0) reason = "Dealer grace period is disabled.";
    else if (item.action === "simulate-temp-unlock-expiry" && (device.state !== "TEMP_UNLOCK" || !device.tempUnlockExpiresAt)) reason = "No active temporary unlock is available.";
    else if (running && item.capability && !capabilities[item.capability]?.enabled) reason = { OVERLAY_UNAVAILABLE: "A current overlay permission report is required.", NOTIFICATIONS_UNAVAILABLE: "A current notification permission report is required.", LOCATION_NOT_AVAILABLE: "Location requires dealer enablement, borrower consent, and a current permission report." }[capabilities[item.capability]?.reason] || "Required device permission is unavailable.";
    else if (item.policies?.some((key) => !policyKeys.includes(key))) reason = "A required active device policy is missing.";
    const { capability, schedule: needsSchedule, upcoming, policies, mode, ...visible } = item;
    return { ...visible, label: running && ["simulate-lock", "simulate-unlock", "simulate-temp-unlock"].includes(item.action) ? visible.label.replace("Test ", "Test Overlay ") : visible.label, enabled: !reason, reason };
  });
};

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

  const [schedule, tenantPolicy, policies] = await Promise.all([
    EmiSchedule.findOne({ userId: device.userId, tenantId: device.tenantId }),
    TenantPolicy.findOne({ tenantId: device.tenantId }).lean(),
    DevicePolicy.find({ tenantId: device.tenantId, isActive: true }).select("policyKey").lean()
  ]);

  return { device, schedule, tenantPolicy, policyKeys: policies.map((p) => p.policyKey) };
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
  if (mode !== "upcoming") assertAutomaticEmiControl(tenantPolicy);

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
    mode !== "upcoming" ? resetDeviceForEmiCron({ device, actorId }) : Promise.resolve(),
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
  const installment = findNextUnpaidInstallment(schedule);
  if (!installment) throw createActionError("No unpaid EMI installment is available to mark paid", 409);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const transactionalDevice = await Device.findById(device._id).session(session);
    const transactionalSchedule = await EmiSchedule.findById(schedule._id).session(session);
    assertCommandAllowed(transactionalDevice);
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

    let outcome = { device: transactionalDevice, command: null };
    if (paymentResult.newlySettled) {
      outcome = await queueDeviceRelease({ device: transactionalDevice, schedule: transactionalSchedule,
        accountId: actorId, triggeredBy: "payment_settlement", reason: "Admin testing panel final payment", session });
    } else if (shouldUnlockDeviceAfterInstallmentPayment({ deviceState: transactionalDevice.state, newlySettled: false })) {
      outcome = await queueAdminDeviceCommand({ device: transactionalDevice, accountId: actorId,
        triggeredBy: "payment_unlock",
        commandType: "UNLOCK", targetState: DEVICE_STATES.UNLOCK_PENDING, policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
        reason: "Admin testing panel payment simulation", extraPayload: { installmentId: installment._id.toString() }, session });
      if (!isRunningDevice(transactionalDevice)) {
        outcome.restrictionCommand = (await queueDeviceRestrictionClear({ device: outcome.device,
          accountId: actorId, triggeredBy: "payment_unlock", session })).command;
      }
    }
    await Device.updateOne({ _id: device._id }, { $pull: { graceReminderHistory: { installmentId: installment._id } } }, { session });
    await session.commitTransaction();
    return { installment: paymentResult.installment, scheduleStatus: transactionalSchedule.status, ...outcome };

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

  const dueDate = state === "upcoming" ? addDays(now, 6) : state === "overdue" ? addDays(now, -2) : addDays(now, -dpd);
  if (state === "upcoming") {
    resetInstallmentForSimulation(installment, dueDate);
  } else {
    installment.status = "overdue";
    installment.dueDate = dueDate;
    installment.paidAt = undefined;
    installment.markedPaidBy = undefined;
    installment.markPaidReason = undefined;
    installment.markPaidReference = undefined;
    installment.paymentId = undefined;
  }
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

const simulateControl = async ({ context, actorId, action, durationHours }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const device = await Device.findById(context.device._id).session(session);
    assertCommandAllowed(device);
    const commandType = action === "simulate-lock" ? "LOCK" : action === "simulate-unlock" ? "UNLOCK" : "TEMP_UNLOCK";
    const result = await queueAdminDeviceCommand({ device, accountId: actorId, commandType,
      targetState: commandType === "LOCK" ? DEVICE_STATES.LOCKED : commandType === "UNLOCK" ? DEVICE_STATES.UNLOCK_PENDING : DEVICE_STATES.TEMP_UNLOCK,
      policyKey: commandType === "LOCK" ? DEVICE_POLICY_KEYS.EMI_LOCKED : commandType === "UNLOCK" ? DEVICE_POLICY_KEYS.EMI_PAID : DEVICE_POLICY_KEYS.TEMP_UNLOCKED,
      reason: "Admin testing panel device control", ...(commandType === "TEMP_UNLOCK" ? { durationHours } : {}), session });
    await session.commitTransaction();
    return formatControlResult(result, { maskImei: false });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally { await session.endSession(); }
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
    assertCommandAllowed(transactionalDevice);
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

export const runAdminDeviceTestAction = async ({ deviceId, action, actorId, durationHours = 6 }) => {
  if (!Object.values(ADMIN_DEVICE_TEST_ACTIONS).includes(action)) {
    throw createActionError("Unsupported device testing action", 400);
  }

  const context = await loadTestingContext(deviceId);
  const eligibility = getAdminDeviceTestingActions(context).find((item) => item.action === action);
  if (!eligibility?.enabled) throw createActionError(eligibility?.reason || "Testing action is unavailable for this dealer mode", 409, "TEST_ACTION_UNAVAILABLE");
  if (action === "simulate-temp-unlock" && !TEST_TEMP_UNLOCK_DURATIONS.includes(Number(durationHours))) {
    throw createActionError("Select a supported temporary-unlock duration", 400);
  }

  switch (action) {
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_LOCK:
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_UNLOCK:
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_TEMP_UNLOCK:
      return simulateControl({ context, actorId, action, durationHours: Number(durationHours) });
    case ADMIN_DEVICE_TEST_ACTIONS.SIMULATE_TEMP_UNLOCK_EXPIRY: {
      const expired = await Device.findOneAndUpdate({ _id: deviceId, state: DEVICE_STATES.TEMP_UNLOCK,
        tempUnlockExpiresAt: context.device.tempUnlockExpiresAt }, { $set: { tempUnlockExpiresAt: new Date() } });
      if (!expired) throw createActionError("Temporary unlock was superseded", 409);
      await runTempUnlockExpiryJob({ deviceId, limit: 1 });
      return { device: await Device.findById(deviceId).lean(), command: await DeviceCommand.findOne({ deviceId,
        commandType: "LOCK", triggeredBy: "temp_unlock_expiry" }).sort({ createdAt: -1 }).lean() };
    }
    case ADMIN_DEVICE_TEST_ACTIONS.REQUEST_LOCATION:
      return queueGetLocationCommand({ device: context.device, accountId: actorId, triggeredBy: "super_admin" });
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
    case ADMIN_DEVICE_TEST_ACTIONS.MANUAL_SET_UPCOMING:
      return simulateManualInstallmentState({ context, actorId, state: "upcoming" });
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
