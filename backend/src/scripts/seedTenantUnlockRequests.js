import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../constants/deviceStates.js";
import { Account } from "../models/Account.js";
import { AuditLog } from "../models/AuditLog.js";
import { Device } from "../models/Device.js";
import { Tenant } from "../models/Tenant.js";
import { UnlockRequest } from "../models/UnlockRequest.js";
import { User } from "../models/User.js";
import { refreshTenantMetrics } from "../services/tenantMetrics.service.js";

const TENANT_ADMIN_ACCOUNT_ID = "6a414cd37073f7567e2d2d9c";
const REQUEST_COUNT = 25;
const CASE_PREFIX = "CASE-2026-APEX-TENANT-";
const USER_MOBILE_START = 9044403001;
const DEVICE_IMEI_START = 865300000000001;

const statuses = [
  "PENDING_TENANT",
  "ESCALATED_PARTNER",
  "ESCALATED_ADMIN",
  "UNDER_REVIEW",
  "RESOLVED_TENANT",
  "RESOLVED_PARTNER",
  "RESOLVED_SUPER_ADMIN",
  "PENDING_TENANT",
  "ESCALATED_PARTNER",
  "ESCALATED_ADMIN",
  "UNDER_REVIEW",
  "RESOLVED_TENANT",
  "PENDING_TENANT",
  "ESCALATED_PARTNER",
  "ESCALATED_ADMIN",
  "RESOLVED_PARTNER",
  "PENDING_TENANT",
  "ESCALATED_PARTNER",
  "UNDER_REVIEW",
  "RESOLVED_SUPER_ADMIN",
  "PENDING_TENANT",
  "ESCALATED_ADMIN",
  "PENDING_TENANT",
  "ESCALATED_PARTNER",
  "PENDING_TENANT"
];

const getLifecycleFields = (status, createdAt, tenantAdminAccountId) => {
  const slaDeadline = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  const partnerStatuses = ["ESCALATED_PARTNER", "ESCALATED_ADMIN", "RESOLVED_PARTNER", "RESOLVED_SUPER_ADMIN"];
  const adminStatuses = ["ESCALATED_ADMIN", "RESOLVED_SUPER_ADMIN"];
  const resolvedStatuses = ["RESOLVED_TENANT", "RESOLVED_PARTNER", "RESOLVED_SUPER_ADMIN"];
  const escalatedToPartnerAt = partnerStatuses.includes(status) ? new Date(createdAt.getTime() + 4 * 60 * 60 * 1000) : undefined;
  const escalatedToAdminAt = adminStatuses.includes(status) ? new Date(createdAt.getTime() + 10 * 60 * 60 * 1000) : undefined;
  const resolvedAt = resolvedStatuses.includes(status) ? new Date(createdAt.getTime() + 14 * 60 * 60 * 1000) : undefined;

  return {
    slaDeadline,
    ...(escalatedToPartnerAt
      ? {
          escalatedToPartnerAt,
          partnerSlaDeadline: new Date(escalatedToPartnerAt.getTime() + 48 * 60 * 60 * 1000)
        }
      : {}),
    ...(escalatedToAdminAt ? { escalatedToAdminAt } : {}),
    ...(resolvedAt
      ? {
          resolvedAt,
          resolutionAction: "temp_unlocked",
          resolutionNote: "Emergency unlock approved for testing",
          tempUnlockDurationHours: 24,
          ...(status === "RESOLVED_TENANT" ? { resolvedBy: tenantAdminAccountId } : {})
        }
      : { resolutionAction: null })
  };
};

const run = async () => {
  await connectDatabase();

  const account = await Account.findById(TENANT_ADMIN_ACCOUNT_ID).select("_id name role tenantId channelPartnerId isActive").lean();
  if (!account || account.role !== "tenant_admin" || !account.tenantId) {
    throw new Error("The supplied ID is not a tenant admin account linked to a tenant");
  }

  const tenant = await Tenant.findOne({ _id: account.tenantId, adminAccountId: account._id }).lean();
  if (!tenant) {
    throw new Error("Linked tenant was not found for the supplied tenant admin account");
  }

  const caseIds = Array.from({ length: REQUEST_COUNT }, (_, index) => `${CASE_PREFIX}${String(index + 1).padStart(2, "0")}`);
  const mobiles = Array.from({ length: REQUEST_COUNT }, (_, index) => String(USER_MOBILE_START + index));
  const loanIds = Array.from({ length: REQUEST_COUNT }, (_, index) => `APEX-TENANT-UNLOCK-${String(index + 1).padStart(2, "0")}`);
  const imeis = Array.from({ length: REQUEST_COUNT }, (_, index) => String(DEVICE_IMEI_START + index));

  const [existingCases, existingUsers, existingDevices] = await Promise.all([
    UnlockRequest.find({ caseId: { $in: caseIds } }).select("caseId").lean(),
    User.find({ $or: [{ mobile: { $in: mobiles } }, { loanId: { $in: loanIds } }] }).select("mobile loanId").lean(),
    Device.find({ imei: { $in: imeis } }).select("imei").lean()
  ]);

  if (existingCases.length || existingUsers.length || existingDevices.length) {
    throw new Error("Tenant unlock request seed data already exists; no records were added");
  }

  const session = await mongoose.startSession();
  const createdCases = [];

  try {
    session.startTransaction();

    for (let index = 0; index < REQUEST_COUNT; index += 1) {
      const now = new Date();
      const createdAt = new Date(now.getTime() - (index + 1) * 75 * 60 * 1000);
      const status = statuses[index];
      const borrowerNumber = String(index + 1).padStart(2, "0");

      const [user] = await User.create(
        [
          {
            name: `Apex Tenant Borrower ${borrowerNumber}`,
            mobile: mobiles[index],
            email: `apex.tenant.borrower${borrowerNumber}@example.com`,
            aadhaarLinkedMobile: mobiles[index],
            aadhaarVerified: index % 3 !== 0,
            tenantId: tenant._id,
            loanId: loanIds[index],
            loanAmount: 30000 + index * 4250,
            emiAmount: 2100 + index * 135,
            tenureMonths: 6 + (index % 13),
            disbursementDate: new Date(now.getTime() - (35 + index * 2) * 24 * 60 * 60 * 1000),
            isDeviceLinked: false,
            registeredBy: account._id
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
            deviceModel: ["Galaxy M14", "Redmi Note 13", "Moto G64", "Realme C67", "Vivo Y28"][index % 5],
            manufacturer: ["Samsung", "Xiaomi", "Motorola", "Realme", "Vivo"][index % 5],
            androidVersion: String(12 + (index % 3)),
            appVersion: `1.${2 + (index % 4)}.${index + 1}`,
            simInfo: {
              simOperator: ["Jio", "Airtel", "Vi", "BSNL"][index % 4],
              simSerial: `SIM-APEX-TENANT-${borrowerNumber}`,
              phoneNumber: mobiles[index]
            },
            state: DEVICE_STATES.LOCKED,
            stateUpdatedAt: createdAt,
            currentPolicyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
            lastSeenAt: new Date(now.getTime() - index * 20 * 60 * 1000),
            lastSyncAt: new Date(now.getTime() - index * 25 * 60 * 1000),
            batteryLevel: 25 + (index * 7) % 70,
            networkType: ["4G", "5G", "WiFi"][index % 3],
            isOnline: index % 4 !== 0,
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
            channelPartnerId: tenant.channelPartnerId,
            status,
            reason: "Emergency unlock",
            reasonCategory: "temporary_emergency",
            details: `Emergency unlock requested for test scenario ${index + 1}. Test reference APT${200000 + index}.`,
            imageUrl: `https://example.com/dummy-unlock-proof/apex-tenant-${borrowerNumber}.jpg`,
            imageStoragePath: `dummy-unlock-requests/${tenant._id}/${user._id}/${caseIds[index]}.jpg`,
            imageMimeType: "image/jpeg",
            imageSize: 145000 + index * 6200,
            imageUploadedAt: createdAt,
            ...getLifecycleFields(status, createdAt, account._id)
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
            channelPartnerId: tenant.channelPartnerId,
            userId: user._id,
            deviceId: device._id,
            caseId: unlockRequest.caseId,
            metadata: {
              reasonCategory: "temporary_emergency",
              status,
              source: "seed_tenant_unlock_requests"
            }
          }
        ],
        { session, ordered: true }
      );

      createdCases.push({ caseId: unlockRequest.caseId, status });
    }

    await session.commitTransaction();
    const metrics = await refreshTenantMetrics(tenant._id);

    console.log(
      JSON.stringify(
        {
          suppliedAccountId: TENANT_ADMIN_ACCOUNT_ID,
          tenantId: tenant._id,
          tenantName: tenant.name,
          channelPartnerId: tenant.channelPartnerId,
          created: createdCases.length,
          statusCounts: statuses.reduce((counts, status) => ({ ...counts, [status]: (counts[status] || 0) + 1 }), {}),
          caseIds: createdCases,
          metrics
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
