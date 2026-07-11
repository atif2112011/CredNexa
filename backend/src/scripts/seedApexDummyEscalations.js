import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../constants/deviceStates.js";
import { AuditLog } from "../models/AuditLog.js";
import { Device } from "../models/Device.js";
import { Tenant } from "../models/Tenant.js";
import { UnlockRequest } from "../models/UnlockRequest.js";
import { User } from "../models/User.js";
import { refreshTenantMetricsForMany } from "../services/tenantMetrics.service.js";

const PARTNER_ID = "6a40d28094c9b128b68568c3";
const REASON_CATEGORY = "payment_made";
const CASE_PREFIX = "CASE-2026-APEX-DUMMY-";
const USER_MOBILE_START = 9033302001;
const DEVICE_IMEI_START = 864200000000001;

const statuses = [
  "PENDING_TENANT",
  "ESCALATED_PARTNER",
  "ESCALATED_ADMIN",
  "UNDER_REVIEW",
  "RESOLVED_TENANT",
  "RESOLVED_PARTNER",
  "RESOLVED_SUPER_ADMIN",
  "REJECTED_TENANT",
  "REJECTED_PARTNER",
  "REJECTED_SUPER_ADMIN",
  "CLOSED",
  "ESCALATED_PARTNER",
  "ESCALATED_ADMIN",
  "UNDER_REVIEW",
  "PENDING_TENANT",
  "RESOLVED_TENANT",
  "RESOLVED_PARTNER",
  "ESCALATED_ADMIN",
  "REJECTED_TENANT",
  "CLOSED",
  "ESCALATED_PARTNER",
  "UNDER_REVIEW",
  "RESOLVED_SUPER_ADMIN",
  "REJECTED_PARTNER",
  "PENDING_TENANT"
];

const reasons = [
  "Payment completed through UPI",
  "Payment already made at store",
  "EMI debited but device still locked",
  "Cash payment collected by branch",
  "Payment receipt uploaded for review",
  "Customer says dues are cleared",
  "Bank transfer completed",
  "Payment mismatch reported",
  "Receipt shared for paid EMI",
  "Auto-debit successful",
  "Manual payment confirmation needed",
  "Dealer confirmed payment",
  "Borrower paid overdue EMI",
  "Paid but unlock pending",
  "Collection agent marked paid",
  "Payment settled in branch",
  "UPI reference available",
  "Customer requests unlock after payment",
  "Paid via QR code",
  "Payment confirmation from tenant",
  "EMI payment done today",
  "Payment made before lock",
  "Receipt verification requested",
  "Payment proof submitted",
  "Payment cleared but app not updated"
];

const getStatusTimestamps = (status, createdAt) => {
  const slaDeadline = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  const escalatedToPartnerAt = ["ESCALATED_PARTNER", "ESCALATED_ADMIN", "RESOLVED_PARTNER", "RESOLVED_SUPER_ADMIN", "REJECTED_PARTNER", "REJECTED_SUPER_ADMIN"].includes(status)
    ? new Date(createdAt.getTime() + 3 * 60 * 60 * 1000)
    : undefined;
  const partnerSlaDeadline = escalatedToPartnerAt ? new Date(escalatedToPartnerAt.getTime() + 48 * 60 * 60 * 1000) : undefined;
  const escalatedToAdminAt = ["ESCALATED_ADMIN", "RESOLVED_SUPER_ADMIN", "REJECTED_SUPER_ADMIN"].includes(status)
    ? new Date(createdAt.getTime() + 8 * 60 * 60 * 1000)
    : undefined;
  const isResolved = status.startsWith("RESOLVED") || status.startsWith("REJECTED") || status === "CLOSED";
  const isRejected = status.startsWith("REJECTED");

  return {
    slaDeadline,
    ...(escalatedToPartnerAt ? { escalatedToPartnerAt, partnerSlaDeadline } : {}),
    ...(escalatedToAdminAt ? { escalatedToAdminAt } : {}),
    ...(isResolved
      ? {
          resolvedAt: new Date(createdAt.getTime() + 10 * 60 * 60 * 1000),
          resolutionAction: isRejected ? "rejected" : status === "CLOSED" ? "waived" : "temp_unlocked",
          resolutionNote: isRejected ? "Dummy case rejected for testing" : "Dummy payment proof accepted for testing",
          tempUnlockDurationHours: isRejected ? undefined : 24
        }
      : {
          resolutionAction: null
        })
  };
};

const run = async () => {
  await connectDatabase();

  const tenants = await Tenant.find({ channelPartnerId: PARTNER_ID, name: /^Apex Test/ }).sort({ name: 1 }).limit(25).lean();
  if (tenants.length < 25) {
    throw new Error(`Expected at least 25 Apex test tenants, found ${tenants.length}`);
  }

  const caseIds = statuses.map((_, index) => `${CASE_PREFIX}${String(index + 1).padStart(2, "0")}`);
  const userMobiles = statuses.map((_, index) => String(USER_MOBILE_START + index));
  const loanIds = statuses.map((_, index) => `APEX-DUMMY-LOAN-${String(index + 1).padStart(2, "0")}`);
  const imeis = statuses.map((_, index) => String(DEVICE_IMEI_START + index));

  const [existingCases, existingUsers, existingDevices] = await Promise.all([
    UnlockRequest.find({ caseId: { $in: caseIds } }).select("caseId").lean(),
    User.find({ $or: [{ mobile: { $in: userMobiles } }, { loanId: { $in: loanIds } }] }).select("mobile loanId").lean(),
    Device.find({ imei: { $in: imeis } }).select("imei").lean()
  ]);

  if (existingCases.length || existingUsers.length || existingDevices.length) {
    throw new Error(
      `Seed data conflict. Existing cases: ${JSON.stringify(existingCases)} Existing users: ${JSON.stringify(existingUsers)} Existing devices: ${JSON.stringify(existingDevices)}`
    );
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const createdCases = [];
    const touchedTenantIds = new Set();

    for (const [index, status] of statuses.entries()) {
      const tenant = tenants[index % tenants.length];
      const now = new Date();
      const createdAt = new Date(now.getTime() - (index + 1) * 2 * 60 * 60 * 1000);
      const userName = `Apex Dummy Borrower ${String(index + 1).padStart(2, "0")}`;

      const [user] = await User.create(
        [
          {
            name: userName,
            mobile: userMobiles[index],
            email: `apex.dummy.borrower${String(index + 1).padStart(2, "0")}@example.com`,
            aadhaarLinkedMobile: userMobiles[index],
            aadhaarVerified: index % 2 === 0,
            tenantId: tenant._id,
            loanId: loanIds[index],
            loanAmount: 25000 + index * 3500,
            emiAmount: 1800 + index * 125,
            tenureMonths: 6 + (index % 7),
            disbursementDate: new Date(now.getTime() - (40 + index) * 24 * 60 * 60 * 1000),
            isDeviceLinked: false,
            registeredBy: tenant.adminAccountId
          }
        ],
        { session, ordered: true }
      );

      const [device] = await Device.create(
        [
          {
            userId: user._id,
            tenantId: tenant._id,
            imei: imeis[index],
            imei2: String(DEVICE_IMEI_START + 1000 + index),
            deviceModel: ["Galaxy A14", "Redmi 12", "Moto G54", "Realme Narzo", "Vivo Y28"][index % 5],
            manufacturer: ["Samsung", "Xiaomi", "Motorola", "Realme", "Vivo"][index % 5],
            androidVersion: String(11 + (index % 4)),
            appVersion: `1.${index % 5}.${index + 1}`,
            simInfo: {
              simOperator: ["Jio", "Airtel", "Vi", "BSNL"][index % 4],
              simSerial: `SIM-APEX-${String(index + 1).padStart(2, "0")}`,
              phoneNumber: userMobiles[index]
            },
            state: ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"].includes(status)
              ? DEVICE_STATES.LOCKED
              : DEVICE_STATES.TEMP_UNLOCK,
            stateUpdatedAt: createdAt,
            currentPolicyKey: ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"].includes(status)
              ? DEVICE_POLICY_KEYS.EMI_LOCKED
              : DEVICE_POLICY_KEYS.TEMP_UNLOCKED,
            lastSeenAt: new Date(now.getTime() - index * 35 * 60 * 1000),
            lastSyncAt: new Date(now.getTime() - index * 30 * 60 * 1000),
            batteryLevel: 35 + (index % 60),
            networkType: ["4G", "5G", "WiFi"][index % 3],
            isOnline: index % 3 !== 0,
            deviceOwnerStatus: "CONFIRMED",
            deviceSecurityState: "HEALTHY"
          }
        ],
        { session, ordered: true }
      );

      user.isDeviceLinked = true;
      user.linkedDeviceId = device._id;
      user.deviceLinkedAt = createdAt;
      await user.save({ session });

      const [unlockRequest] = await UnlockRequest.create(
        [
          {
            caseId: caseIds[index],
            userId: user._id,
            deviceId: device._id,
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            status,
            reason: reasons[index],
            reasonCategory: REASON_CATEGORY,
            details: `Dummy escalation ${index + 1}: UPI ref APEXTEST${100000 + index}. Used for partner escalation testing.`,
            imageUrl: `https://example.com/dummy-unlock-proof/apex-${String(index + 1).padStart(2, "0")}.jpg`,
            imageStoragePath: `dummy-unlock-requests/${tenant._id}/${user._id}/${caseIds[index]}.jpg`,
            imageMimeType: "image/jpeg",
            imageSize: 180000 + index * 7500,
            imageUploadedAt: createdAt,
            ...getStatusTimestamps(status, createdAt)
          }
        ],
        { session, ordered: true }
      );

      await AuditLog.create(
        [
          {
            eventType: AUDIT_EVENTS.UNLOCK_REQUEST_CREATED,
            actorId: user._id,
            actorCollection: "users",
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            userId: user._id,
            deviceId: device._id,
            caseId: unlockRequest.caseId,
            metadata: {
              reasonCategory: REASON_CATEGORY,
              status,
              source: "seed_apex_dummy_escalations"
            }
          }
        ],
        { session, ordered: true }
      );

      touchedTenantIds.add(tenant._id.toString());
      createdCases.push(unlockRequest);
    }

    await session.commitTransaction();
    await refreshTenantMetricsForMany([...touchedTenantIds]);

    console.log(
      JSON.stringify(
        {
          channelPartnerId: PARTNER_ID,
          createdCases: createdCases.length,
          reasonCategory: REASON_CATEGORY,
          cases: createdCases.map((unlockRequest) => ({
            caseId: unlockRequest.caseId,
            status: unlockRequest.status,
            tenantId: unlockRequest.tenantId,
            userId: unlockRequest.userId,
            deviceId: unlockRequest.deviceId
          }))
        },
        null,
        2
      )
    );
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
