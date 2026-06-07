
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
import { runFcmDeliveryBatch } from "./fcmDeliveryWorker.js";

const createAuditLog = async (payload) => AuditLog.create(payload);

const DAY_IN_MS = 24 * 60 * 60 * 1000;

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

export const runSlaEscalationJob = async () => {
  await connectDatabase();
  const now = new Date();
  const escalated = [];

  const tenantBreaches = await UnlockRequest.find({
    status: "PENDING_TENANT",
    slaDeadline: { $lte: now }
  });

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
  });

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

export const runTempUnlockExpiryJob = async () => {
  await connectDatabase();
  const now = new Date();
  const devices = await Device.find({
    state: DEVICE_STATES.TEMP_UNLOCK,
    tempUnlockExpiresAt: { $lte: now }
  });
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

export const runEmiPolicyJob = async () => {
  await connectDatabase();
  const now = new Date();
  const schedules = await EmiSchedule.find({
    "installments.status": { $in: ["pending", "overdue", "partial"] }
  });

  const result = {
    remindersQueued: [],
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
      triggeredBy: "auto_policy",
      payload: {
        policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
        policyVersion: nextPolicyVersion,
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
      tenantId: device.tenantId,
      userId: device.userId,
      deviceId: device._id,
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
      deviceId: device._id,
      commandId: command._id,
      installmentId: lockableInstallment._id
    });
  }

  return result;
};

export const runScheduledJobs = async () => {
  const [slaEscalations, relockedDevices] = await Promise.all([runSlaEscalationJob(), runTempUnlockExpiryJob()]);
  const emiPolicy = await runEmiPolicyJob();
  const fcmDeliveries = await runFcmDeliveryBatch();

  return { slaEscalations, relockedDevices, emiPolicy, fcmDeliveries };
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
