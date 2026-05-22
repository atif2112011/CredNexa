
import { connectDatabase } from "../config/database.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../constants/deviceStates.js";
import { AuditLog } from "../models/AuditLog.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";
import { DevicePolicy } from "../models/DevicePolicy.js";
import { RiskFlag } from "../models/RiskFlag.js";
import { TenantPolicy } from "../models/TenantPolicy.js";
import { UnlockRequest } from "../models/UnlockRequest.js";
import { runFcmDeliveryBatch } from "./fcmDeliveryWorker.js";

const createAuditLog = async (payload) => AuditLog.create(payload);

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

export const runScheduledJobs = async () => {
  const [slaEscalations, relockedDevices, fcmDeliveries] = await Promise.all([
    runSlaEscalationJob(),
    runTempUnlockExpiryJob(),
    runFcmDeliveryBatch()
  ]);

  return { slaEscalations, relockedDevices, fcmDeliveries };
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
