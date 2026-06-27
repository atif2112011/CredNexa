
import { connectDatabase } from "../config/database.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../constants/deviceStates.js";
import { AuditLog } from "../models/AuditLog.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";
import { DevicePolicy } from "../models/DevicePolicy.js";
import { EmiSchedule } from "../models/EmiSchedule.js";
import { RiskFlag } from "../models/RiskFlag.js";
import { TenantPolicy } from "../models/TenantPolicy.js";
import { UnlockRequest } from "../models/UnlockRequest.js";
import {
  expireManualOverrideTokens,
  renewExpiringManualOverrideTokens
} from "../services/manualOverrideToken.service.js";
import { runAllFcmDeliveryBatches } from "./fcmDeliveryWorker.js";

const createAuditLog = async (payload) => AuditLog.create(payload);

const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Intended production intervals:
// - FCM delivery: every 5 minutes, so queued admin/policy commands do not wait on EMI scans.
// - Temp unlock expiry: every 10 minutes, so expired temporary unlocks are relocked promptly.
// - SLA escalation: every 30 minutes, because SLA windows are hour-based.
// - EMI policy: every 30 minutes, because reminders and lock thresholds are day-based.
export const SCHEDULED_JOB_INTERVALS = Object.freeze({
  fcmDeliveryMs: 5 * 60 * 1000,
  tempUnlockExpiryMs: 10 * 60 * 1000,
  slaEscalationMs: 30 * 60 * 1000,
  emiPolicyMs: 30 * 60 * 1000,
  manualOverrideTokenRenewalMs: 24 * 60 * 60 * 1000
});

export const SCHEDULED_JOB_LIMITS = Object.freeze({
  fcmDelivery: 100,
  tempUnlockExpiry: 200,
  slaEscalation: 200,
  emiPolicy: 500,
  manualOverrideTokenRenewal: 500
});

let scheduledJobTimers = [];
const runningTimedJobs = new Set();

const EMI_CRON_CONFIG = Object.freeze({
  upcomingPaymentNotifications: {
    10: {
      title: "EMI due in 10 days",
      text: "Your EMI is due in 10 days. Please pay on time to avoid restrictions."
    },
    5: {
      title: "EMI due in 5 days",
      text: "Your EMI is due in 5 days. Please complete the payment soon."
    }
  },
  graceReminderIntervalMs: 12 * 60 * 60 * 1000,
  graceReminderNotification: {
    title: "EMI overdue",
    text: "Your EMI is overdue. Please pay before the grace period ends to avoid device restrictions."
  },
  graceReason: "EMI overdue within grace period",
  lockReason: "EMI overdue beyond DPD and grace period"
});

const startOfUtcDay = (date) => {
  const value = new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
};

const addDays = (date, days) => new Date(startOfUtcDay(date).getTime() + Number(days || 0) * DAY_IN_MS);

const getDaysUntilDue = (dueDate, now) => {
  return Math.round((startOfUtcDay(dueDate).getTime() - startOfUtcDay(now).getTime()) / DAY_IN_MS);
};

const getInstallmentOutstanding = (installment) => {
  const totalPayable = Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0);
  return Math.max(totalPayable - Number(installment.paidAmount || 0), 0);
};

const isInstallmentUnpaid = (installment) => ["pending", "overdue", "partial"].includes(installment.status);

const logJobStart = (jobName) => {
  const startedAt = new Date();
  console.info(`${jobName} started`, { jobName, startedAt: startedAt.toISOString() });
  return startedAt;
};

const logJobFinish = (jobName, startedAt, result) => {
  const finishedAt = new Date();
  console.info(`${jobName} finished`, {
    jobName,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    result
  });
};

const logJobFailure = (jobName, startedAt, error) => {
  const finishedAt = new Date();
  console.error(`${jobName} failed`, {
    jobName,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    message: error.message,
    stack: error.stack
  });
};

const runTimedJob = async (jobName, jobFn) => {
  if (runningTimedJobs.has(jobName)) {
    console.warn(`${jobName} skipped because previous run is still active`, { jobName });
    return;
  }

  runningTimedJobs.add(jobName);
  const startedAt = logJobStart(jobName);

  try {
    const result = await jobFn();
    logJobFinish(jobName, startedAt, result);
  } catch (error) {
    logJobFailure(jobName, startedAt, error);
  } finally {
    runningTimedJobs.delete(jobName);
  }
};

export const runSlaEscalationJob = async ({ limit = SCHEDULED_JOB_LIMITS.slaEscalation } = {}) => {
  await connectDatabase();
  const now = new Date();
  const escalated = [];

  const tenantBreaches = await UnlockRequest.find({
    status: "PENDING_TENANT",
    slaDeadline: { $lte: now }
  }).limit(limit);

  for (const unlockRequest of tenantBreaches) {
    const tenantPolicy = await TenantPolicy.findOne({ tenantId: unlockRequest.tenantId }).lean();
    unlockRequest.status = "ESCALATED_PARTNER";
    unlockRequest.escalatedToPartnerAt = now;
    unlockRequest.partnerSlaDeadline = new Date(
      Date.now() + (tenantPolicy?.escalationRules?.partnerEscalationSlaHours || 48) * 60 * 60 * 1000
    );
    await unlockRequest.save();

    await RiskFlag.create({
      type: "TENANT_SLA_BREACH",
      severity: "high",
      tenantId: unlockRequest.tenantId,
      channelPartnerId: unlockRequest.channelPartnerId,
      deviceId: unlockRequest.deviceId,
      userId: unlockRequest.userId,
      caseId: unlockRequest.caseId,
      message: "Tenant unlock request SLA breached",
      metadata: { escalatedTo: "partner" }
    });

    await createAuditLog({
      eventType: "SLA_BREACHED",
      actorCollection: "system",
      tenantId: unlockRequest.tenantId,
      channelPartnerId: unlockRequest.channelPartnerId,
      userId: unlockRequest.userId,
      deviceId: unlockRequest.deviceId,
      caseId: unlockRequest.caseId,
      metadata: { fromStatus: "PENDING_TENANT", toStatus: "ESCALATED_PARTNER" }
    });

    escalated.push(unlockRequest.caseId);
  }

  const partnerBreaches = await UnlockRequest.find({
    status: "ESCALATED_PARTNER",
    partnerSlaDeadline: { $lte: now }
  }).limit(limit);

  for (const unlockRequest of partnerBreaches) {
    unlockRequest.status = "ESCALATED_ADMIN";
    unlockRequest.escalatedToAdminAt = now;
    await unlockRequest.save();

    await RiskFlag.create({
      type: "PARTNER_SLA_BREACH",
      severity: "critical",
      tenantId: unlockRequest.tenantId,
      channelPartnerId: unlockRequest.channelPartnerId,
      deviceId: unlockRequest.deviceId,
      userId: unlockRequest.userId,
      caseId: unlockRequest.caseId,
      message: "Partner unlock request SLA breached",
      metadata: { escalatedTo: "super_admin" }
    });

    await createAuditLog({
      eventType: "SLA_BREACHED",
      actorCollection: "system",
      tenantId: unlockRequest.tenantId,
      channelPartnerId: unlockRequest.channelPartnerId,
      userId: unlockRequest.userId,
      deviceId: unlockRequest.deviceId,
      caseId: unlockRequest.caseId,
      metadata: { fromStatus: "ESCALATED_PARTNER", toStatus: "ESCALATED_ADMIN" }
    });

    escalated.push(unlockRequest.caseId);
  }

  return escalated;
};

export const runTempUnlockExpiryJob = async ({ limit = SCHEDULED_JOB_LIMITS.tempUnlockExpiry } = {}) => {
  await connectDatabase();
  const now = new Date();
  const devices = await Device.find({
    state: DEVICE_STATES.TEMP_UNLOCK,
    tempUnlockExpiresAt: { $lte: now }
  }).limit(limit);
  const relocked = [];

  for (const device of devices) {
    const policy = await DevicePolicy.findOne({
      tenantId: device.tenantId,
      policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
      isActive: true
    }).lean();

    if (!policy) continue;

    const nextPolicyVersion = Number(device.desiredPolicyVersion || 0) + 1;
    device.state = DEVICE_STATES.LOCKED;
    device.currentPolicyKey = DEVICE_POLICY_KEYS.EMI_LOCKED;
    device.currentPolicyId = policy._id;
    device.desiredPolicyVersion = nextPolicyVersion;
    device.stateUpdatedAt = now;
    device.tempUnlockExpiresAt = undefined;
    await device.save();

    const command = await DeviceCommand.create({
      deviceId: device._id,
      tenantId: device.tenantId,
      commandType: "LOCK",
      triggeredBy: "temp_unlock_expiry",
      payload: {
        policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
        policyVersion: nextPolicyVersion,
        reason: "Temporary unlock expired"
      }
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.MANUAL_LOCK_TRIGGERED,
      actorCollection: "system",
      tenantId: device.tenantId,
      userId: device.userId,
      deviceId: device._id,
      metadata: { commandId: command._id, reason: "Temporary unlock expired" }
    });

    relocked.push(device._id);
  }

  return relocked;
};

export const runManualOverrideTokenRenewalJob = async ({
  limit = SCHEDULED_JOB_LIMITS.manualOverrideTokenRenewal
} = {}) => {
  await connectDatabase();
  const expired = await expireManualOverrideTokens();
  const renewal = await renewExpiringManualOverrideTokens({
    limit,
    source: "scheduled_renewal_job"
  });

  return {
    expired,
    ...renewal
  };
};

export const runEmiPolicyJob = async ({ limit = SCHEDULED_JOB_LIMITS.emiPolicy } = {}) => {
  await connectDatabase();
  const now = new Date();
  const reminderDays = Object.keys(EMI_CRON_CONFIG.upcomingPaymentNotifications).map(Number);
  const maxReminderDays = Math.max(...reminderDays);
  const queryDueDate = addDays(now, maxReminderDays);
  const schedules = await EmiSchedule.find({
    installments: {
      $elemMatch: {
        status: { $in: ["pending", "overdue", "partial"] },
        dueDate: { $lte: queryDueDate }
      }
    }
  }).limit(limit);

  const result = {
    scannedSchedules: schedules.length,
    remindersQueued: [],
    gracePolicyCommandsQueued: [],
    graceRemindersQueued: [],
    devicesLocked: [],
    skippedTempUnlock: [],
    skippedAlreadyLocked: []
  };

  for (const schedule of schedules) {
    const [tenantPolicy, device] = await Promise.all([
      TenantPolicy.findOne({ tenantId: schedule.tenantId }).lean(),
      Device.findOne({ userId: schedule.userId, tenantId: schedule.tenantId })
    ]);

    if (!device) continue;

    const lockRules = tenantPolicy?.lockRules || {};
    const dpd = Number(lockRules.dpd ?? 30);
    const gracePeriodDays = Number(lockRules.gracePeriodDays ?? 7);
    const lockOnGraceExpiry = lockRules.lockOnGraceExpiry !== false;

    let scheduleChanged = false;

    const unpaidInstallments = schedule.installments
      .filter(isInstallmentUnpaid)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    for (const installment of unpaidInstallments) {
      const daysUntilDue = getDaysUntilDue(installment.dueDate, now);
      const notificationConfig = EMI_CRON_CONFIG.upcomingPaymentNotifications[daysUntilDue];

      if (notificationConfig && device.fcmToken) {
        const existingReminder = await DeviceCommand.findOne({
          deviceId: device._id,
          commandType: "NOTIFICATION",
          "payload.notificationType": "UPCOMING_EMI",
          "payload.installmentId": installment._id.toString(),
          "payload.reminderDays": daysUntilDue
        }).lean();

        if (!existingReminder) {
          const command = await DeviceCommand.create({
            deviceId: device._id,
            tenantId: device.tenantId,
            commandType: "NOTIFICATION",
            triggeredBy: "auto_policy",
            payload: {
              notificationType: "UPCOMING_EMI",
              title: notificationConfig.title,
              text: notificationConfig.text,
              installmentId: installment._id.toString(),
              installmentNumber: installment.installmentNumber,
              dueDate: installment.dueDate,
              reminderDays: daysUntilDue,
              outstandingAmount: getInstallmentOutstanding(installment)
            }
          });

          result.remindersQueued.push({
            deviceId: device._id,
            commandId: command._id,
            installmentId: installment._id,
            reminderDays: daysUntilDue
          });
        }
      }

      if (installment.status === "pending" && new Date(installment.dueDate) < startOfUtcDay(now)) {
        installment.status = "overdue";
        scheduleChanged = true;
      }
    }

    const overdueInstallments = schedule.installments.filter((installment) =>
      ["overdue", "partial"].includes(installment.status)
    );

    schedule.overdueInstallments = overdueInstallments.length;
    schedule.overdueAmount = overdueInstallments.reduce((sum, installment) => sum + getInstallmentOutstanding(installment), 0);
    schedule.dpd = overdueInstallments.reduce((maxDpd, installment) => {
      const dpdForInstallment = Math.max(
        Math.floor((startOfUtcDay(now).getTime() - startOfUtcDay(installment.dueDate).getTime()) / DAY_IN_MS),
        0
      );
      return Math.max(maxDpd, dpdForInstallment);
    }, 0);

    if (scheduleChanged || schedule.isModified()) {
      await schedule.save();
    }

    const isLocked = device.state === DEVICE_STATES.LOCKED;
    const hasActiveTempUnlock =
      device.state === DEVICE_STATES.TEMP_UNLOCK && device.tempUnlockExpiresAt && new Date(device.tempUnlockExpiresAt) > now;

    if (!isLocked && !hasActiveTempUnlock && gracePeriodDays > 0) {
      const graceInstallment = unpaidInstallments.find((installment) => {
        const graceStartedAt = addDays(installment.dueDate, dpd);
        const graceExpiresAt = addDays(installment.dueDate, dpd + gracePeriodDays);
        return graceStartedAt <= now && graceExpiresAt > now;
      });

      if (graceInstallment) {
        const graceStartedAt = addDays(graceInstallment.dueDate, dpd);
        const graceExpiresAt = addDays(graceInstallment.dueDate, dpd + gracePeriodDays);
        let activeDevice = device;

        if (device.state !== DEVICE_STATES.GRACE_PERIOD || device.currentPolicyKey !== DEVICE_POLICY_KEYS.EMI_GRACE) {
          const gracePolicy = await DevicePolicy.findOne({
            tenantId: device.tenantId,
            policyKey: DEVICE_POLICY_KEYS.EMI_GRACE,
            isActive: true
          }).lean();

          if (gracePolicy) {
            const updatedGraceDevice = await Device.findOneAndUpdate(
              {
                _id: device._id,
                state: { $ne: DEVICE_STATES.LOCKED },
                $or: [
                  { state: { $ne: DEVICE_STATES.TEMP_UNLOCK } },
                  { tempUnlockExpiresAt: { $lte: now } },
                  { tempUnlockExpiresAt: null }
                ]
              },
              {
                $set: {
                  state: DEVICE_STATES.GRACE_PERIOD,
                  currentPolicyKey: DEVICE_POLICY_KEYS.EMI_GRACE,
                  currentPolicyId: gracePolicy._id,
                  stateUpdatedAt: now
                },
                $inc: { desiredPolicyVersion: 1 }
              },
              { new: true }
            );

            if (updatedGraceDevice) {
              activeDevice = updatedGraceDevice;
              const existingGracePolicyCommand = await DeviceCommand.findOne({
                deviceId: updatedGraceDevice._id,
                commandType: "POLICY_UPDATE",
                status: { $in: ["pending", "sent"] },
                "payload.policyKey": DEVICE_POLICY_KEYS.EMI_GRACE,
                "payload.installmentId": graceInstallment._id.toString()
              }).lean();

              if (!existingGracePolicyCommand) {
                const graceCommand = await DeviceCommand.create({
                  deviceId: updatedGraceDevice._id,
                  tenantId: updatedGraceDevice.tenantId,
                  commandType: "POLICY_UPDATE",
                  triggeredBy: "auto_policy",
                  payload: {
                    targetState: DEVICE_STATES.GRACE_PERIOD,
                    policyKey: DEVICE_POLICY_KEYS.EMI_GRACE,
                    policyVersion: updatedGraceDevice.desiredPolicyVersion,
                    reason: EMI_CRON_CONFIG.graceReason,
                    installmentId: graceInstallment._id.toString(),
                    installmentNumber: graceInstallment.installmentNumber,
                    dueDate: graceInstallment.dueDate,
                    graceStartedAt,
                    graceExpiresAt,
                    dpd,
                    gracePeriodDays
                  }
                });

                result.gracePolicyCommandsQueued.push({
                  deviceId: updatedGraceDevice._id,
                  commandId: graceCommand._id,
                  installmentId: graceInstallment._id
                });
              }
            }
          }
        }

        const lastGraceReminder = activeDevice.graceReminderHistory
          ?.filter((item) => item.installmentId?.toString() === graceInstallment._id.toString())
          .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0))[0];
        const reminderDue =
          !lastGraceReminder ||
          new Date(lastGraceReminder.sentAt).getTime() <= now.getTime() - EMI_CRON_CONFIG.graceReminderIntervalMs;

        if (reminderDue && activeDevice.fcmToken) {
          const reminderCommand = await DeviceCommand.create({
            deviceId: activeDevice._id,
            tenantId: activeDevice.tenantId,
            commandType: "NOTIFICATION",
            triggeredBy: "auto_policy",
            payload: {
              notificationType: "GRACE_PERIOD_REMINDER",
              title: EMI_CRON_CONFIG.graceReminderNotification.title,
              text: EMI_CRON_CONFIG.graceReminderNotification.text,
              installmentId: graceInstallment._id.toString(),
              installmentNumber: graceInstallment.installmentNumber,
              dueDate: graceInstallment.dueDate,
              graceStartedAt,
              graceExpiresAt,
              outstandingAmount: getInstallmentOutstanding(graceInstallment)
            }
          });

          await Device.updateOne(
            { _id: activeDevice._id },
            {
              $push: {
                graceReminderHistory: {
                  installmentId: graceInstallment._id,
                  sentAt: now,
                  graceStartedAt,
                  graceExpiresAt,
                  commandId: reminderCommand._id
                }
              }
            }
          );

          result.graceRemindersQueued.push({
            deviceId: activeDevice._id,
            commandId: reminderCommand._id,
            installmentId: graceInstallment._id,
            graceExpiresAt
          });
        }
      }
    }

    if (!lockOnGraceExpiry) continue;
    if (device.state === DEVICE_STATES.LOCKED) {
      result.skippedAlreadyLocked.push(device._id);
      continue;
    }

    if (device.state === DEVICE_STATES.TEMP_UNLOCK && device.tempUnlockExpiresAt && new Date(device.tempUnlockExpiresAt) > now) {
      result.skippedTempUnlock.push(device._id);
      continue;
    }

    const lockableInstallment = unpaidInstallments.find((installment) => {
      const lockAt = addDays(installment.dueDate, dpd + gracePeriodDays);
      return lockAt < now;
    });

    if (!lockableInstallment) continue;

    const policy = await DevicePolicy.findOne({
      tenantId: device.tenantId,
      policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
      isActive: true
    }).lean();

    if (!policy) continue;

    const existingLockCommand = await DeviceCommand.findOne({
      deviceId: device._id,
      commandType: "LOCK",
      status: { $in: ["pending", "sent"] },
      "payload.reason": EMI_CRON_CONFIG.lockReason
    }).lean();

    if (existingLockCommand) continue;

    const lockedDevice = await Device.findOneAndUpdate(
      {
        _id: device._id,
        state: { $ne: DEVICE_STATES.LOCKED },
        $or: [
          { state: { $ne: DEVICE_STATES.TEMP_UNLOCK } },
          { tempUnlockExpiresAt: { $lte: now } },
          { tempUnlockExpiresAt: null }
        ]
      },
      {
        $set: {
          state: DEVICE_STATES.LOCKED,
          currentPolicyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
          currentPolicyId: policy._id,
          stateUpdatedAt: now
        },
        $inc: { desiredPolicyVersion: 1 },
        $unset: { tempUnlockExpiresAt: "" }
      },
      { new: true }
    );

    if (!lockedDevice) {
      continue;
    }

    const command = await DeviceCommand.create({
      deviceId: lockedDevice._id,
      tenantId: lockedDevice.tenantId,
      commandType: "LOCK",
      triggeredBy: "auto_policy",
      payload: {
        policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
        policyVersion: lockedDevice.desiredPolicyVersion,
        reason: EMI_CRON_CONFIG.lockReason,
        installmentId: lockableInstallment._id.toString(),
        installmentNumber: lockableInstallment.installmentNumber,
        dueDate: lockableInstallment.dueDate,
        dpd,
        gracePeriodDays
      }
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.MANUAL_LOCK_TRIGGERED,
      actorCollection: "system",
      tenantId: lockedDevice.tenantId,
      userId: lockedDevice.userId,
      deviceId: lockedDevice._id,
      reason: EMI_CRON_CONFIG.lockReason,
      metadata: {
        commandId: command._id,
        source: "emi_policy_cron",
        installmentId: lockableInstallment._id,
        dpd,
        gracePeriodDays
      }
    });

    result.devicesLocked.push({
      deviceId: lockedDevice._id,
      commandId: command._id,
      installmentId: lockableInstallment._id
    });
  }

  return result;
};

export const runScheduledJobs = async () => {
  const slaEscalations = await runSlaEscalationJob({ limit: SCHEDULED_JOB_LIMITS.slaEscalation });
  const relockedDevices = await runTempUnlockExpiryJob({ limit: SCHEDULED_JOB_LIMITS.tempUnlockExpiry });
  const manualOverrideTokens = await runManualOverrideTokenRenewalJob({
    limit: SCHEDULED_JOB_LIMITS.manualOverrideTokenRenewal
  });
  const emiPolicy = await runEmiPolicyJob({ limit: SCHEDULED_JOB_LIMITS.emiPolicy });
  const fcmDeliveries = await runAllFcmDeliveryBatches({ limit: SCHEDULED_JOB_LIMITS.fcmDelivery });

  return { slaEscalations, relockedDevices, manualOverrideTokens, emiPolicy, fcmDeliveries };
};

export const startScheduledJobTimers = ({ runImmediately = false } = {}) => {
  if (scheduledJobTimers.length) {
    console.info("Scheduled job timers already started", {
      timerCount: scheduledJobTimers.length,
      recommendedIntervals: SCHEDULED_JOB_INTERVALS,
      batchLimits: SCHEDULED_JOB_LIMITS
    });
    return scheduledJobTimers;
  }

  const jobs = [
    {
      name: "fcmDeliveryJob",
      intervalMs: SCHEDULED_JOB_INTERVALS.fcmDeliveryMs,
      run: () => runAllFcmDeliveryBatches({ limit: SCHEDULED_JOB_LIMITS.fcmDelivery })
    },
    {
      name: "tempUnlockExpiryJob",
      intervalMs: SCHEDULED_JOB_INTERVALS.tempUnlockExpiryMs,
      run: () => runTempUnlockExpiryJob({ limit: SCHEDULED_JOB_LIMITS.tempUnlockExpiry })
    },
    {
      name: "slaEscalationJob",
      intervalMs: SCHEDULED_JOB_INTERVALS.slaEscalationMs,
      run: () => runSlaEscalationJob({ limit: SCHEDULED_JOB_LIMITS.slaEscalation })
    },
    {
      name: "emiPolicyJob",
      intervalMs: SCHEDULED_JOB_INTERVALS.emiPolicyMs,
      run: () => runEmiPolicyJob({ limit: SCHEDULED_JOB_LIMITS.emiPolicy })
    },
    {
      name: "manualOverrideTokenRenewalJob",
      intervalMs: SCHEDULED_JOB_INTERVALS.manualOverrideTokenRenewalMs,
      run: () => runManualOverrideTokenRenewalJob({ limit: SCHEDULED_JOB_LIMITS.manualOverrideTokenRenewal })
    }
  ];

  scheduledJobTimers = jobs.map((job) => {
    console.info(`${job.name} timer started`, {
      jobName: job.name,
      intervalMs: job.intervalMs,
      batchLimits: SCHEDULED_JOB_LIMITS
    });

    if (runImmediately) {
      void runTimedJob(job.name, job.run);
    }

    return setInterval(() => {
      void runTimedJob(job.name, job.run);
    }, job.intervalMs);
  });

  return scheduledJobTimers;
};

export const stopScheduledJobTimers = () => {
  for (const timer of scheduledJobTimers) {
    clearInterval(timer);
  }

  const stoppedCount = scheduledJobTimers.length;
  scheduledJobTimers = [];
  console.info("Scheduled job timers stopped", { stoppedCount });
  return stoppedCount;
};

if (process.argv[1]?.endsWith("scheduledJobs.js")) {
  runScheduledJobs()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
