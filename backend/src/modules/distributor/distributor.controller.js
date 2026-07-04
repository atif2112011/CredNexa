import crypto from "crypto";
import mongoose from "mongoose";
import QRCode from "qrcode";

import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { TENANT_CAPABILITIES } from "../../constants/tenant.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ConsentRecord } from "../../models/ConsentRecord.js";
import { Device } from "../../models/Device.js";
import { DeviceCommand } from "../../models/DeviceCommand.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { EmiSchedule } from "../../models/EmiSchedule.js";
import { EnrollmentToken } from "../../models/EnrollmentToken.js";
import { Payment } from "../../models/Payment.js";
import { TENANT_CREDIT_PURCHASE_STATUSES, TenantCreditPurchaseRequest } from "../../models/TenantCreditPurchaseRequest.js";
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { Tenant } from "../../models/Tenant.js";
import { TenantCreditLedger, TENANT_CREDIT_LEDGER_TYPES } from "../../models/TenantCreditLedger.js";
import { UnlockRequest } from "../../models/UnlockRequest.js";
import {ProvisioningDetails} from "../../models/ProvisioningDetails.js";
import { User } from "../../models/User.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../../constants/deviceStates.js";
import { NOTIFICATION_AUDIENCES, queueNotification, safeQueueNotification } from "../../utils/appNotifications.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import { uploadImageToFirebase } from "../../utils/firebaseImageUpload.js";
import { safeRefreshTenantMetrics } from "../../services/tenantMetrics.service.js";
import {
  getEffectiveTenantCreditPerKeyPrice,
  getOrCreatePayoutConstants,
  getTenantCreditPurchaseLimits,
  parseRupeeAmount,
  roundRupeeAmount
} from "../../utils/payout.js";
import { hasRequiredFields, isValidObjectId } from "../../utils/validators.js";

const addMonths = (date, months) => {
  const dueDate = new Date(date);
  dueDate.setMonth(dueDate.getMonth() + months);
  return dueDate;
};

const generateInstallments = ({ emiAmount, tenureMonths, disbursementDate }) => {
  const startDate = new Date(disbursementDate);

  return Array.from({ length: Number(tenureMonths) }, (_, index) => ({
    installmentNumber: index + 1,
    dueDate: addMonths(startDate, index + 1),
    emiAmount: Number(emiAmount),
    status: "pending"
  }));
};

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const buildPagination = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit) || 1
});

const buildSearchRegex = (value) => new RegExp(String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

const DEFAULT_PENDING_EMI_ALERT_DAYS = 10;

const buildSeenFilter = (seenAt) => (seenAt ? { updatedAt: { $gt: seenAt } } : {});

const formatDashboardAlert = (alert = {}) => ({
  count: Math.max(Number(alert.count || 0), 0),
  seenAt: alert.seenAt || null
});

const formatDashboardAlerts = (dashboardAlerts = {}) => ({
  pendingEmis: formatDashboardAlert(dashboardAlerts.pendingEmis),
  overdueEmis: formatDashboardAlert(dashboardAlerts.overdueEmis),
  approvePayments: formatDashboardAlert(dashboardAlerts.approvePayments),
  unlockRequests: formatDashboardAlert(dashboardAlerts.unlockRequests)
});

const getDashboardAlertCounts = async ({ tenant, now = new Date() }) => {
  const dueUntil = new Date(now.getTime() + DEFAULT_PENDING_EMI_ALERT_DAYS * 24 * 60 * 60 * 1000);
  const alerts = tenant.dashboardAlerts || {};

  const [pendingEmis, overdueEmis, approvePayments, unlockRequests] = await Promise.all([
    EmiSchedule.countDocuments({
      tenantId: tenant._id,
      ...buildSeenFilter(alerts.pendingEmis?.seenAt),
      installments: {
        $elemMatch: {
          status: { $in: ["pending", "partial"] },
          dueDate: { $gte: now, $lte: dueUntil }
        }
      }
    }),
    EmiSchedule.countDocuments({
      tenantId: tenant._id,
      ...buildSeenFilter(alerts.overdueEmis?.seenAt),
      installments: {
        $elemMatch: {
          $or: [{ status: "overdue" }, { status: "partial", dueDate: { $lt: now } }, { status: "pending", dueDate: { $lt: now } }]
        }
      }
    }),
    Payment.countDocuments({
      tenantId: tenant._id,
      approvalStatus: "pending_approval",
      ...(alerts.approvePayments?.seenAt ? { submittedAt: { $gt: alerts.approvePayments.seenAt } } : {})
    }),
    UnlockRequest.countDocuments({
      tenantId: tenant._id,
      status: "PENDING_TENANT",
      ...buildSeenFilter(alerts.unlockRequests?.seenAt)
    })
  ]);

  return { pendingEmis, overdueEmis, approvePayments, unlockRequests };
};

const saveDashboardAlertCounts = async ({ tenantId, counts }) => {
  await Tenant.updateOne(
    { _id: tenantId },
    {
      $set: {
        "dashboardAlerts.pendingEmis.count": counts.pendingEmis,
        "dashboardAlerts.overdueEmis.count": counts.overdueEmis,
        "dashboardAlerts.approvePayments.count": counts.approvePayments,
        "dashboardAlerts.unlockRequests.count": counts.unlockRequests
      }
    }
  );
};

const clearDashboardAlert = async ({ tenantId, alertKey, now = new Date() }) => {
  await Tenant.updateOne(
    { _id: tenantId },
    {
      $set: {
        [`dashboardAlerts.${alertKey}.count`]: 0,
        [`dashboardAlerts.${alertKey}.seenAt`]: now
      }
    }
  );
};

const ensureDistributorAccess = async (req, res) => {
  if (req.auth.role !== ACCOUNT_ROLES.TENANT_ADMIN) {
    sendError(res, 403, "tenant_admin role is required");
    return null;
  }

  if (!req.auth.tenantId) {
    sendError(res, 403, "Tenant scope is required");
    return null;
  }

  const tenant = await Tenant.findById(req.auth.tenantId).lean();

  if (!tenant || !tenant.isActive) {
    sendError(res, 403, "Active tenant not found");
    return null;
  }

  if (!tenant.capabilities.includes(TENANT_CAPABILITIES.DISTRIBUTE)) {
    sendError(res, 403, "Tenant does not have distribute capability");
    return null;
  }

  return tenant;
};

const createAuditLog = async (payload, options = {}) => {
  return AuditLog.create([payload], { ordered: true, ...options }).then((items) => items[0]);
};

/**
 * Enable or disable borrower Aadhaar verification for the authenticated tenant.
 * Sample body: { "isAdhaarVerificationEnabled": true, "reason": "Tenant requires Aadhaar consent flow" }
 */
export const updateTenantAdhaarVerification = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (typeof req.body.isAdhaarVerificationEnabled !== "boolean") {
      return sendError(res, 400, "isAdhaarVerificationEnabled boolean is required");
    }

    const updatedTenant = await Tenant.findByIdAndUpdate(
      tenant._id,
      { isAdhaarVerificationEnabled: req.body.isAdhaarVerificationEnabled },
      { new: true }
    );

    await createAuditLog({
      eventType: AUDIT_EVENTS.TENANT_ADHAAR_VERIFICATION_UPDATED,
      actorId: req.auth.id,
      actorCollection: "accounts",
      tenantId: updatedTenant._id,
      channelPartnerId: updatedTenant.channelPartnerId,
      reason: req.body.reason,
      metadata: { isAdhaarVerificationEnabled: updatedTenant.isAdhaarVerificationEnabled }
    });

    return sendSuccess(res, 200, "Tenant Aadhaar verification setting updated successfully", {
      tenantId: updatedTenant._id,
      isAdhaarVerificationEnabled: updatedTenant.isAdhaarVerificationEnabled
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

const buildCreditPurchaseProof = async ({ req, requestId, tenant }) => {
  if (req.file) {
    return uploadImageToFirebase({
      file: req.file,
      folder: "tenant-credit-purchase-proofs",
      recordId: requestId,
      userId: req.auth.id,
      tenantId: tenant._id,
      metadata: {
        tenantId: tenant._id.toString(),
        creditPurchaseRequestId: requestId.toString()
      },
      purpose: "screenshot"
    });
  }

  const imageUrl = String(req.body.paymentProofImageUrl || "").trim();
  if (!imageUrl) return null;

  return {
    imageUrl,
    uploadedAt: new Date()
  };
};

const queueTenantDeviceCommand = async ({ device, commandType, triggeredBy, accountId, payload = {}, session }) => {
  const policyKey =
    commandType === "LOCK"
      ? DEVICE_POLICY_KEYS.EMI_LOCKED
      : commandType === "TEMP_UNLOCK"
        ? DEVICE_POLICY_KEYS.TEMP_UNLOCKED
        : DEVICE_POLICY_KEYS.EMI_PAID;
  const state =
    commandType === "LOCK"
      ? DEVICE_STATES.LOCKED
      : commandType === "TEMP_UNLOCK"
        ? DEVICE_STATES.TEMP_UNLOCK
        : DEVICE_STATES.UNLOCK_PENDING;
  const policy = await DevicePolicy.findOne({
    tenantId: device.tenantId,
    policyKey,
    isActive: true
  }).lean();

  if (!policy) {
    throw new Error(`Active ${policyKey} policy not found for tenant`);
  }

  const nextPolicyVersion = Number(device.desiredPolicyVersion || 0) + 1;
  const update = {
    $set: {
      state,
      stateUpdatedAt: new Date(),
      stateUpdatedBy: accountId,
      currentPolicyKey: policyKey,
      currentPolicyId: policy._id,
      desiredPolicyVersion: nextPolicyVersion
    }
  };

  if (commandType === "TEMP_UNLOCK") {
    update.$set.tempUnlockExpiresAt = payload.tempUnlockExpiresAt;
  } else {
    update.$unset = { tempUnlockExpiresAt: "" };
  }

  const updatedDevice = await Device.findByIdAndUpdate(device._id, update, {
    new: true,
    session
  });

  const commands = await DeviceCommand.create(
    [
      {
        deviceId: device._id,
        tenantId: device.tenantId,
        commandType,
        triggeredBy,
        triggeredByAccountId: accountId,
        payload: {
          policyKey,
          policyVersion: nextPolicyVersion,
          ...payload
        }
      }
    ],
    { session, ordered: true }
  );

  return { device: updatedDevice, command: commands[0] };
};

const applyPaymentToEmiSchedule = async ({ payment, accountId, session }) => {
  const schedule = await EmiSchedule.findOne({ userId: payment.userId, tenantId: payment.tenantId }).session(session);
  if (!schedule) return [];

  let remainingAmount = Number(payment.amount);
  const matchedInstallments = [];
  const paidInstallmentIds = [];

  for (const installment of schedule.installments) {
    if (remainingAmount <= 0) break;
    if (["paid", "waived"].includes(installment.status)) continue;

    const outstanding = Math.max(Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0) - Number(installment.paidAmount || 0), 0);
    if (!outstanding) continue;

    const amountApplied = Math.min(remainingAmount, outstanding);
    installment.paidAmount = Number(installment.paidAmount || 0) + amountApplied;
    installment.paymentId = payment._id;

    if (installment.paidAmount >= Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0)) {
      installment.status = "paid";
      installment.paidAt = new Date();
      paidInstallmentIds.push(installment._id);
    } else {
      installment.status = "partial";
    }

    matchedInstallments.push({ installmentId: installment._id, amountApplied });
    remainingAmount -= amountApplied;
  }

  const overdueInstallments = schedule.installments.filter((installment) => ["overdue", "partial"].includes(installment.status));
  schedule.overdueInstallments = overdueInstallments.length;
  schedule.overdueAmount = overdueInstallments.reduce((sum, installment) => {
    const total = Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0);
    return sum + Math.max(total - Number(installment.paidAmount || 0), 0);
  }, 0);

  await schedule.save({ session });
  if (paidInstallmentIds.length) {
    await Device.updateOne(
      { userId: payment.userId, tenantId: payment.tenantId },
      { $pull: { graceReminderHistory: { installmentId: { $in: paidInstallmentIds } } } },
      { session }
    );
  }
  payment.emiScheduleId = schedule._id;
  payment.matchedInstallments = matchedInstallments;
  payment.metadata = {
    ...(payment.metadata || {}),
    emiUpdatedBy: accountId
  };

  return matchedInstallments;
};

const createEnrollmentTokenValue = () => crypto.randomBytes(24).toString("hex");

const getEnrollmentTokenExpiry = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const createBorrowerUid = () => `BRW-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

const generateUniqueBorrowerUid = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loanId = createBorrowerUid();
    const existingUser = await User.exists({ loanId });
    if (!existingUser) return loanId;
  }

  throw new Error("Unable to generate borrower UID");
};

const buildQrPayload = (enrollmentToken, provisioningDetails) => (
  {
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": provisioningDetails?.adminComponentName,
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": provisioningDetails?.adminPackageDownloadUrl,
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM": provisioningDetails?.adminSignatureChecksum,
  "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": provisioningDetails?.skipEncryption || false,
  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
    enrollmentToken
  }
});

const buildQrResponse = async (enrollmentToken) => {
  const provisioningDetails = await ProvisioningDetails.findOne({}).lean();
  const qrPayload = buildQrPayload(enrollmentToken.token, provisioningDetails);
  const qrCodeDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512
  });

  return {
    qrPayload,
    qrCodeDataUrl,
    qrCodeMimeType: "image/png",
    enrollmentToken: enrollmentToken.token,
    tokenExpiresAt: enrollmentToken.expiresAt
  };
};

const getEnrollmentStatus = ({ enrollmentToken, user, device, now = new Date() }) => {
  if (enrollmentToken.cancelledAt) return "TOKEN_CANCELLED";
  if (!enrollmentToken.consumedAt && enrollmentToken.expiresAt <= now) return "TOKEN_EXPIRED";
  if (device) return "ACTIVATION_COMPLETE";
  if (user?.consentRecordId) return "CONSENT_COMPLETED";
  if (enrollmentToken.consumedAt) return "TOKEN_CONSUMED";
  if (enrollmentToken.lastQrGeneratedAt) return "QR_GENERATED";
  return "USER_REGISTERED";
};

/**
 * Register borrower and generate EMI schedule + enrollment token.
 * Sample body: { "name": "Ramesh Kumar", "mobile": "9876543210", "aadhaarLinkedMobile": "9876543210", "loanAmount": 18000, "emiAmount": 3000, "tenureMonths": 6, "disbursementDate": "2026-05-21" }
 */
export const registerBorrower = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const requiredFields = [
      "name",
      "mobile",
      "aadhaarLinkedMobile",
      "loanAmount",
      "emiAmount",
      "tenureMonths",
      "disbursementDate"
    ];

    if (!hasRequiredFields(req.body, requiredFields)) {
      return sendError(res, 400, "Borrower and EMI details are required");
    }

    const loanAmount = Number(req.body.loanAmount);
    const emiAmount = Number(req.body.emiAmount);
    const tenureMonths = Number(req.body.tenureMonths);

    if (!Number.isFinite(tenureMonths) || tenureMonths <= 0) {
      return sendError(res, 400, "Tenure months must be greater than 0");
    }
    if (!Number.isFinite(loanAmount) || loanAmount <= 0) {
      return sendError(res, 400, "Loan amount must be greater than 0");
    }
    if (!Number.isFinite(emiAmount) || emiAmount <= 0) {
      return sendError(res, 400, "EMI amount must be greater than 0");
    }
    if (emiAmount > loanAmount) {
      return sendError(res, 400, "EMI amount cannot be greater than loan amount");
    }

    const expectedTenureMonths = Math.ceil(loanAmount / emiAmount);
    if (tenureMonths !== expectedTenureMonths) {
      return sendError(res, 400, "Tenure months does not match loan amount and EMI amount");
    }

    const disbursementDate = new Date(req.body.disbursementDate);
    const previousDayStart = new Date();
    previousDayStart.setHours(0, 0, 0, 0);
    previousDayStart.setDate(previousDayStart.getDate() - 1);

    if (disbursementDate < previousDayStart) {
      return sendError(res, 400, "Disbursement date cannot be earlier than previous day");
    }

    const existingUser = await User.findOne({ mobile: req.body.mobile }).lean();

    if (existingUser) {
      return sendError(res, 400, "User mobile already exists");
    }

    const loanId = await generateUniqueBorrowerUid();

    session.startTransaction();

    const creditedTenant = await Tenant.findOneAndUpdate(
      { _id: tenant._id, creditBalance: { $gte: 1 } },
      { $inc: { creditBalance: -1 } },
      { new: false, session }
    );

    if (!creditedTenant) {
      await session.abortTransaction();
      return sendError(res, 402, "Insufficient credits to create borrower");
    }

    const balanceBefore = Number(creditedTenant.creditBalance || 0);
    const balanceAfter = balanceBefore - 1;

    const users = await User.create(
      [
        {
          name: req.body.name,
          mobile: req.body.mobile,
          email: req.body.email,
          aadhaarLinkedMobile: req.body.aadhaarLinkedMobile,
          tenantId: tenant._id,
          loanId,
          loanAmount,
          emiAmount,
          tenureMonths,
          disbursementDate: req.body.disbursementDate,
          registeredBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );

    const user = users[0];

    await TenantCreditLedger.create(
      [
        {
          tenantId: tenant._id,
          type: TENANT_CREDIT_LEDGER_TYPES.BORROWER_CREATION,
          delta: -1,
          balanceBefore,
          balanceAfter,
          actorId: req.auth.id,
          actorCollection: "accounts",
          userId: user._id,
          reason: "Borrower created",
          metadata: { loanId: user.loanId }
        }
      ],
      { session, ordered: true }
    );

    const installments = generateInstallments({ emiAmount, tenureMonths, disbursementDate: req.body.disbursementDate });

    const schedules = await EmiSchedule.create(
      [
        {
          userId: user._id,
          tenantId: tenant._id,
          loanId: user.loanId,
          installments
        }
      ],
      { session, ordered: true }
    );

    const enrollmentTokenValue = createEnrollmentTokenValue();
    const expiresAt = getEnrollmentTokenExpiry();
    const enrollmentTokens = await EnrollmentToken.create(
      [
        {
          token: enrollmentTokenValue,
          userId: user._id,
          tenantId: tenant._id,
          expiresAt,
          createdBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.USER_REGISTERED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: user._id,
        metadata: { loanId: user.loanId, tenureMonths: user.tenureMonths }
      },
      { session }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TENANT_CREDIT_CONSUMED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: user._id,
        reason: "Borrower created",
        metadata: {
          loanId: user.loanId,
          delta: -1,
          balanceBefore,
          balanceAfter
        }
      },
      { session }
    );

    await session.commitTransaction();

    await safeRefreshTenantMetrics(tenant._id, { source: "borrower_registration" });

    return sendSuccess(res, 201, "Borrower registered successfully", {
      userId: user._id,
      tenantId: user.tenantId,
      tenant: {
        id: tenant._id,
        name: tenant.name
      },
      loanId: user.loanId,
      emiScheduleId: schedules[0]._id,
      emiScheduleTenantId: schedules[0].tenantId,
      enrollmentToken: enrollmentTokens[0].token,
      enrollmentTokenTenantId: enrollmentTokens[0].tenantId,
      tokenExpiresAt: enrollmentTokens[0].expiresAt,
      credits: {
        remaining: balanceAfter
      }
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Generate Android Device Owner provisioning QR payload.
 * Sample body: { "enrollmentToken": "TEMP_TOKEN_OR_RANDOM_HEX" }
 */
export const generateEnrollmentQr = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!req.body.enrollmentToken) {
      return sendError(res, 400, "Enrollment token is required");
    }

    const enrollmentToken = await EnrollmentToken.findOne({
      token: req.body.enrollmentToken,
      tenantId: tenant._id,
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!enrollmentToken) {
      return sendError(res, 400, "Valid enrollment token not found");
    }

    enrollmentToken.lastQrGeneratedAt = new Date();
    await enrollmentToken.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.ENROLLMENT_QR_GENERATED,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      userId: enrollmentToken.userId,
      metadata: { enrollmentTokenId: enrollmentToken._id }
    });

    const qrResponse = await buildQrResponse(enrollmentToken);

    return sendSuccess(res, 200, "Enrollment QR generated successfully", qrResponse);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch tenant app dashboard metrics.
 * Sample request: GET /distributor/dashboard
 */
export const getDashboard = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const now = new Date();

    const [
      totalBorrowers,
      borrowersRegisteredToday,
      devicesActivated,
      activeEnrollmentTokens,
      consumedEnrollmentTokens,
      expiredEnrollmentTokens,
      cancelledEnrollmentTokens,
      devicesByState,
      recentEnrollments
    ] = await Promise.all([
      User.countDocuments({ tenantId: tenant._id }),
      User.countDocuments({ tenantId: tenant._id, createdAt: { $gte: todayStart } }),
      Device.countDocuments({ tenantId: tenant._id }),
      EnrollmentToken.countDocuments({
        tenantId: tenant._id,
        consumedAt: null,
        cancelledAt: null,
        expiresAt: { $gt: now }
      }),
      EnrollmentToken.countDocuments({ tenantId: tenant._id, consumedAt: { $ne: null } }),
      EnrollmentToken.countDocuments({
        tenantId: tenant._id,
        consumedAt: null,
        cancelledAt: null,
        expiresAt: { $lte: now }
      }),
      EnrollmentToken.countDocuments({ tenantId: tenant._id, cancelledAt: { $ne: null } }),
      Device.aggregate([
        { $match: { tenantId: tenant._id } },
        { $group: { _id: "$state", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      EnrollmentToken.find({ tenantId: tenant._id })
        .sort({ createdAt: -1 })
        .limit(8)
        .populate("userId", "name mobile loanId consentRecordId")
        .lean()
    ]);
    const alerts = formatDashboardAlerts(tenant.dashboardAlerts);

    const recentEnrollmentRows = await Promise.all(
      recentEnrollments.map(async (enrollmentToken) => {
        const device = enrollmentToken.userId?._id
          ? await Device.findOne({
              tenantId: tenant._id,
              userId: enrollmentToken.userId._id
            }).lean()
          : null;

        return {
          enrollmentToken: enrollmentToken.token,
          status: getEnrollmentStatus({
            enrollmentToken,
            user: enrollmentToken.userId,
            device,
            now
          }),
          tokenExpiresAt: enrollmentToken.expiresAt,
          borrower: enrollmentToken.userId
            ? {
                id: enrollmentToken.userId._id,
                name: enrollmentToken.userId.name,
                mobile: enrollmentToken.userId.mobile,
                loanId: enrollmentToken.userId.loanId
              }
            : null
        };
      })
    );

    return sendSuccess(res, 200, "Dashboard fetched successfully", {
      totalBorrowers,
      borrowersRegisteredToday,
      credits: {
        available: Number(tenant.creditBalance || 0)
      },
      enrollmentTokens: {
        active: activeEnrollmentTokens,
        consumed: consumedEnrollmentTokens,
        expired: expiredEnrollmentTokens,
        cancelled: cancelledEnrollmentTokens
      },
      devices: {
        activated: devicesActivated,
        pendingActivation: Math.max(totalBorrowers - devicesActivated, 0),
        byState: devicesByState.reduce((result, item) => {
          result[item._id] = item.count;
          return result;
        }, {})
      },
      alerts,
      recentEnrollments: recentEnrollmentRows
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch tenant credit purchase options.
 * Sample request: GET /tenant/credits/purchase/options
 */
export const getCreditPurchaseOptions = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const payoutConstants = await getOrCreatePayoutConstants();
    const perKeyPrice = getEffectiveTenantCreditPerKeyPrice(tenant, payoutConstants);
    const limits = getTenantCreditPurchaseLimits(payoutConstants);

    return sendSuccess(res, 200, "Credit purchase options fetched successfully", {
      credits: {
        available: Number(tenant.creditBalance || 0),
        totalPurchased: Number(tenant.totalCreditsPurchased || 0),
        lifetimePurchaseAmount: roundRupeeAmount(tenant.lifetimeCreditPurchaseAmount || 0)
      },
      pricing: {
        currency: "INR",
        perKeyPrice,
        source: tenant.creditPurchasePerKeyPrice !== undefined && tenant.creditPurchasePerKeyPrice !== null ? "tenant_override" : "default"
      },
      limits: {
        minCredits: limits.min,
        maxCredits: limits.max,
        hasMaximumCap: limits.hasMaximumCap
      },
      adminPayment: {
        upiId: payoutConstants.adminCreditPurchaseUpiId,
        upiName: payoutConstants.adminCreditPurchaseUpiName,
        qrImageUrl: payoutConstants.adminCreditPurchaseQrImageUrl
      }
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Submit tenant credit purchase request for admin approval.
 * Multipart fields: requestedCredits, referenceNumber, proofImage
 * JSON fallback: { "requestedCredits": 10, "referenceNumber": "UTR123", "paymentProofImageUrl": "https://..." }
 */
export const submitCreditPurchaseRequest = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const requestedCredits = Number(req.body.requestedCredits);
    if (!Number.isInteger(requestedCredits) || requestedCredits <= 0) {
      return sendError(res, 400, "requestedCredits must be a positive integer");
    }

    if (!req.file && !req.body.paymentProofImageUrl) {
      return sendError(res, 400, "Payment proof image is required");
    }

    const existingPendingRequest = await TenantCreditPurchaseRequest.findOne({
      tenantId: tenant._id,
      status: TENANT_CREDIT_PURCHASE_STATUSES.PENDING
    }).lean();

    if (existingPendingRequest) {
      return sendError(res, 409, "A credit purchase request is already pending approval");
    }

    const payoutConstants = await getOrCreatePayoutConstants();
    const limits = getTenantCreditPurchaseLimits(payoutConstants);

    if (requestedCredits < limits.min) {
      return sendError(res, 400, `Minimum credit purchase is ${limits.min}`);
    }

    if (limits.hasMaximumCap && requestedCredits > limits.max) {
      return sendError(res, 400, `Maximum credit purchase is ${limits.max}`);
    }

    const perKeyPrice = getEffectiveTenantCreditPerKeyPrice(tenant, payoutConstants);
    const purchaseAmount = roundRupeeAmount(requestedCredits * perKeyPrice);
    const submittedAmount =
      req.body.purchaseAmount !== undefined
        ? parseRupeeAmount(req.body.purchaseAmount)
        : req.body.amount !== undefined
          ? parseRupeeAmount(req.body.amount)
          : null;

    if (submittedAmount !== null && submittedAmount !== purchaseAmount) {
      return sendError(res, 400, "purchaseAmount must equal requestedCredits * perKeyPrice");
    }

    const requestId = new mongoose.Types.ObjectId();
    const paymentProof = await buildCreditPurchaseProof({ req, requestId, tenant });

    const creditPurchaseRequest = await TenantCreditPurchaseRequest.create({
      _id: requestId,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      requestedCredits,
      perKeyPrice,
      purchaseAmount,
      adminPaymentSnapshot: {
        upiId: payoutConstants.adminCreditPurchaseUpiId,
        upiName: payoutConstants.adminCreditPurchaseUpiName,
        qrImageUrl: payoutConstants.adminCreditPurchaseQrImageUrl,
        qrStoragePath: payoutConstants.adminCreditPurchaseQrStoragePath
      },
      paymentProof,
      referenceNumber: req.body.referenceNumber,
      requestedBy: req.auth.id,
      metadata: {
        amountFormula: "requestedCredits * perKeyPrice"
      }
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.TENANT_CREDIT_PURCHASE_REQUESTED,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      metadata: {
        creditPurchaseRequestId: creditPurchaseRequest._id,
        requestedCredits,
        perKeyPrice,
        purchaseAmount
      }
    });

    return sendSuccess(res, 201, "Credit purchase request submitted successfully", {
      creditPurchaseRequest
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List tenant credit purchase requests.
 * Sample request: GET /tenant/credits/purchase/requests?status=PENDING&page=1&limit=20
 */
export const listCreditPurchaseRequests = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const { page, limit, skip } = getPagination(req.query);
    const filter = { tenantId: tenant._id };

    if (req.query.status) {
      if (!Object.values(TENANT_CREDIT_PURCHASE_STATUSES).includes(req.query.status)) {
        return sendError(res, 400, "Invalid credit purchase status");
      }
      filter.status = req.query.status;
    }

    const [items, total] = await Promise.all([
      TenantCreditPurchaseRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      TenantCreditPurchaseRequest.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Credit purchase requests fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch one tenant credit purchase request.
 * Sample request: GET /tenant/credits/purchase/requests/665f...
 */
export const getCreditPurchaseRequestById = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!isValidObjectId(req.params.requestId)) {
      return sendError(res, 400, "Invalid credit purchase request ID");
    }

    const creditPurchaseRequest = await TenantCreditPurchaseRequest.findOne({
      _id: req.params.requestId,
      tenantId: tenant._id
    }).lean();

    if (!creditPurchaseRequest) {
      return sendError(res, 404, "Credit purchase request not found");
    }

    return sendSuccess(res, 200, "Credit purchase request fetched successfully", creditPurchaseRequest);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Track enrollment status for one token.
 * Sample request: GET /distributor/enrollments/abcdef/status
 */
export const getEnrollmentStatusByToken = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const enrollmentToken = await EnrollmentToken.findOne({
      token: req.params.token,
      tenantId: tenant._id
    }).lean();

    if (!enrollmentToken) {
      return sendError(res, 404, "Enrollment token not found");
    }

    const [user, device, consentRecord] = await Promise.all([
      User.findOne({ _id: enrollmentToken.userId, tenantId: tenant._id }).lean(),
      Device.findOne({ userId: enrollmentToken.userId, tenantId: tenant._id }).lean(),
      ConsentRecord.findOne({ enrollmentTokenId: enrollmentToken._id, tenantId: tenant._id }).lean()
    ]);

    if (!user) {
      return sendError(res, 404, "Borrower not found for enrollment token");
    }

    return sendSuccess(res, 200, "Enrollment status fetched successfully", {
      enrollmentToken: enrollmentToken.token,
      enrollmentTokenId: enrollmentToken._id,
      status: getEnrollmentStatus({ enrollmentToken, user, device }),
      tokenExpiresAt: enrollmentToken.expiresAt,
      consumedAt: enrollmentToken.consumedAt,
      cancelledAt: enrollmentToken.cancelledAt,
      lastQrGeneratedAt: enrollmentToken.lastQrGeneratedAt,
      borrower: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        loanId: user.loanId,
        aadhaarVerified: user.aadhaarVerified,
        consentRecordId: user.consentRecordId
      },
      consent: consentRecord
        ? {
            id: consentRecord._id,
            consentVersion: consentRecord.consentVersion,
            acceptedAt: consentRecord.acceptedAt
          }
        : null,
      device: device
        ? {
            id: device._id,
            imei: device.imei,
            deviceModel: device.deviceModel,
            manufacturer: device.manufacturer,
            state: device.state,
            currentPolicyKey: device.currentPolicyKey
          }
        : null
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List borrowers under tenant with pagination and search.
 * Sample query: /distributor/users?page=1&limit=20&search=ramesh
 */
export const getDistributorUsers = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const { page, limit, skip } = getPagination(req.query);
    const filter = { tenantId: tenant._id };

    if (req.query.search) {
      const search = buildSearchRegex(req.query.search);
      filter.$or = [{ name: search }, { mobile: search }, { email: search }, { loanId: search }];
    }

    if (req.query.onboardingStatus === "onboarded") filter.isDeviceLinked = true;
    if (req.query.onboardingStatus === "pending") filter.isDeviceLinked = { $ne: true };

    const [items, total] = await Promise.all([
      User.find(filter)
        .populate("linkedDeviceId", "imei deviceModel manufacturer state lastSeenAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Users fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

const filterSchedulesByBorrowerSearch = (schedules, searchValue) => {
  const search = searchValue ? buildSearchRegex(searchValue) : null;
  if (!search) return schedules;

  return schedules.filter((schedule) => {
    const user = schedule.userId || {};
    return [user.name, user.mobile, user.email, user.loanId].some((value) => value && search.test(String(value)));
  });
};

const formatScheduleInstallmentSummary = ({ schedule, installments, installmentKey }) => ({
  borrower: schedule.userId,
  emiScheduleId: schedule._id,
  loanId: schedule.loanId,
  [installmentKey]: installments,
  installmentCount: installments.length,
  totalAmount: installments.reduce((sum, item) => {
    const total = Number(item.emiAmount || 0) + Number(item.penaltyAmount || 0);
    return sum + Math.max(total - Number(item.paidAmount || 0), 0);
  }, 0),
  overdueAmount: schedule.overdueAmount,
  overdueInstallments: schedule.overdueInstallments,
  dpd: schedule.dpd
});

const getInstallmentOutstanding = (installment) => {
  const total = Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0);
  return Math.max(total - Number(installment.paidAmount || 0), 0);
};

const getOverdueInstallments = (schedule, now = new Date()) =>
  (schedule?.installments || []).filter(
    (item) => item.status === "overdue" || (["pending", "partial"].includes(item.status) && new Date(item.dueDate) < now)
  );

const queueOverdueEmiReminderForUser = async ({ tenant, userId, accountId, note }) => {
  if (!mongoose.isValidObjectId(userId)) {
    return { status: "failed", reason: "INVALID_USER_ID", userId };
  }

  const user = await User.findOne({ _id: userId, tenantId: tenant._id }).lean();
  if (!user) {
    return { status: "failed", reason: "BORROWER_NOT_FOUND", userId };
  }

  const schedule = await EmiSchedule.findOne({ userId: user._id, tenantId: tenant._id }).lean();
  const overdueInstallments = getOverdueInstallments(schedule);

  if (!overdueInstallments.length) {
    return { status: "skippedNoOverdue", userId: user._id };
  }

  const device = await Device.findOne({ userId: user._id, tenantId: tenant._id }).lean();
  if (!device?.fcmToken) {
    return {
      status: "skippedNoDevice",
      userId: user._id,
      deviceId: device?._id
    };
  }

  const totalOutstandingAmount = overdueInstallments.reduce((sum, installment) => sum + getInstallmentOutstanding(installment), 0);
  const reminderText = String(note || "").trim() || "Please clear your overdue EMI to avoid device restrictions.";
  const commands = await queueNotification({
    audience: NOTIFICATION_AUDIENCES.BORROWER,
    tenantId: tenant._id,
    deviceId: device._id,
    title: "EMI overdue",
    text: reminderText,
    notificationType: "OVERDUE_EMI_REMINDER",
    triggeredBy: "manual_tenant",
    triggeredByAccountId: accountId,
    data: {
      userId: user._id,
      deviceId: device._id,
      overdueInstallmentCount: overdueInstallments.length,
      totalOutstandingAmount,
      installmentIds: overdueInstallments.map((installment) => installment._id),
      note: reminderText
    }
  });
  const command = commands[0];

  await createAuditLog({
    eventType: AUDIT_EVENTS.DEVICE_COMMAND_CREATED,
    actorId: accountId,
    tenantId: tenant._id,
    channelPartnerId: tenant.channelPartnerId,
    userId: user._id,
    deviceId: device._id,
    reason: reminderText,
    metadata: {
      commandId: command?._id,
      commandType: "NOTIFICATION",
      notificationType: "OVERDUE_EMI_REMINDER",
      overdueInstallmentCount: overdueInstallments.length,
      totalOutstandingAmount
    }
  });

  return {
    status: "queued",
    queued: true,
    commandId: command?._id,
    userId: user._id,
    deviceId: device._id,
    overdueInstallmentCount: overdueInstallments.length,
    totalOutstandingAmount
  };
};

/**
 * List borrowers with upcoming unpaid EMI installments due in the next x days.
 * Sample query: /distributor/users/pending-emis?days=10&page=1&limit=20&search=ramesh
 */
export const getBorrowersWithPendingEmis = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;
    await clearDashboardAlert({ tenantId: tenant._id, alertKey: "pendingEmis" });

    const { page, limit, skip } = getPagination(req.query);
    const days = Math.min(Math.max(Number(req.query.days) || 10, 1), 365);
    const now = new Date();
    const dueUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const scheduleFilter = {
      tenantId: tenant._id,
      installments: {
        $elemMatch: {
          status: { $in: ["pending", "partial"] },
          dueDate: { $gte: now, $lte: dueUntil }
        }
      }
    };

    const schedules = await EmiSchedule.find(scheduleFilter)
      .populate("userId", "name mobile email loanId loanAmount emiAmount tenureMonths isDeviceLinked linkedDeviceId")
      .sort({ "installments.dueDate": 1 })
      .lean();

    const filteredSchedules = filterSchedulesByBorrowerSearch(schedules, req.query.search);

    const items = filteredSchedules.slice(skip, skip + limit).map((schedule) => {
      const upcomingInstallments = schedule.installments.filter(
        (item) => ["pending", "partial"].includes(item.status) && item.dueDate >= now && item.dueDate <= dueUntil
      );
      return formatScheduleInstallmentSummary({
        schedule,
        installments: upcomingInstallments,
        installmentKey: "upcomingInstallments"
      });
    });

    return sendSuccess(res, 200, "Borrowers with upcoming EMIs fetched successfully", {
      items,
      days,
      dueUntil,
      pagination: buildPagination(page, limit, filteredSchedules.length)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List borrowers with overdue EMI installments under tenant.
 * Sample query: /distributor/users/overdue-emis?page=1&limit=20&search=ramesh
 */
export const getBorrowersWithOverdueEmis = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;
    await clearDashboardAlert({ tenantId: tenant._id, alertKey: "overdueEmis" });

    const { page, limit, skip } = getPagination(req.query);
    const now = new Date();
    const scheduleFilter = {
      tenantId: tenant._id,
      installments: {
        $elemMatch: {
          $or: [{ status: "overdue" }, { status: "partial", dueDate: { $lt: now } }, { status: "pending", dueDate: { $lt: now } }]
        }
      }
    };

    const schedules = await EmiSchedule.find(scheduleFilter)
      .populate("userId", "name mobile email loanId loanAmount emiAmount tenureMonths isDeviceLinked linkedDeviceId")
      .sort({ updatedAt: -1 })
      .lean();

    const filteredSchedules = filterSchedulesByBorrowerSearch(schedules, req.query.search);

    const items = filteredSchedules.slice(skip, skip + limit).map((schedule) => {
      const overdueInstallments = schedule.installments.filter(
        (item) => item.status === "overdue" || (["pending", "partial"].includes(item.status) && item.dueDate < now)
      );
      return formatScheduleInstallmentSummary({
        schedule,
        installments: overdueInstallments,
        installmentKey: "overdueEmiInstallments"
      });
    });

    return sendSuccess(res, 200, "Borrowers with overdue EMIs fetched successfully", {
      items,
      pagination: buildPagination(page, limit, filteredSchedules.length)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Queue an overdue EMI reminder notification for one borrower.
 * Sample body: { "note": "Please clear your overdue EMI to avoid device restrictions." }
 */
export const sendOverdueEmiReminder = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const result = await queueOverdueEmiReminderForUser({
      tenant,
      userId: req.params.userId,
      accountId: req.auth.id,
      note: req.body.note
    });

    if (result.status === "failed") {
      return sendError(res, result.reason === "INVALID_USER_ID" ? 400 : 404, result.reason);
    }

    if (result.status === "skippedNoOverdue") {
      return sendSuccess(res, 200, "No overdue EMI found for borrower", {
        queued: false,
        reason: "NO_OVERDUE_EMI",
        userId: result.userId
      });
    }

    if (result.status === "skippedNoDevice") {
      return sendSuccess(res, 200, "Device is not reachable for reminder", {
        queued: false,
        reason: "DEVICE_NOT_REACHABLE",
        userId: result.userId,
        deviceId: result.deviceId
      });
    }

    return sendSuccess(res, 201, "Overdue EMI reminder queued successfully", {
      queued: true,
      commandId: result.commandId,
      userId: result.userId,
      deviceId: result.deviceId,
      overdueInstallmentCount: result.overdueInstallmentCount,
      totalOutstandingAmount: result.totalOutstandingAmount
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Queue overdue EMI reminder notifications for multiple borrowers.
 * Sample body: { "userIds": ["665f..."], "limit": 100, "note": "Payment reminder" }
 */
export const sendBulkOverdueEmiReminders = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const limit = Math.min(Math.max(Number(req.body.limit || 100), 1), 500);
    let userIds = Array.isArray(req.body.userIds) ? req.body.userIds.filter(Boolean) : [];

    if (!userIds.length) {
      const now = new Date();
      const schedules = await EmiSchedule.find({
        tenantId: tenant._id,
        installments: {
          $elemMatch: {
            $or: [{ status: "overdue" }, { status: "partial", dueDate: { $lt: now } }, { status: "pending", dueDate: { $lt: now } }]
          }
        }
      })
        .select("userId")
        .limit(limit)
        .lean();
      userIds = schedules.map((schedule) => schedule.userId);
    }

    const limitedUserIds = [...new Set(userIds.map((userId) => userId.toString()))].slice(0, limit);
    const results = [];
    const counts = {
      scanned: limitedUserIds.length,
      queued: 0,
      skippedNoOverdue: 0,
      skippedNoDevice: 0,
      failed: 0
    };

    for (const userId of limitedUserIds) {
      try {
        const result = await queueOverdueEmiReminderForUser({
          tenant,
          userId,
          accountId: req.auth.id,
          note: req.body.note
        });
        results.push(result);

        if (result.status === "queued") counts.queued += 1;
        else if (result.status === "skippedNoOverdue") counts.skippedNoOverdue += 1;
        else if (result.status === "skippedNoDevice") counts.skippedNoDevice += 1;
        else counts.failed += 1;
      } catch (error) {
        counts.failed += 1;
        results.push({ status: "failed", userId, reason: error.message });
      }
    }

    return sendSuccess(res, 200, "Overdue EMI reminders processed successfully", {
      counts,
      results
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch all EMI installments for one borrower.
 * Sample request: GET /distributor/users/665f.../emi-installments
 */
export const getUserEmiInstallments = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Valid user ID is required");
    }

    const [user, schedule] = await Promise.all([
      User.findOne({ _id: req.params.id, tenantId: tenant._id }).lean(),
      EmiSchedule.findOne({ userId: req.params.id, tenantId: tenant._id }).lean()
    ]);

    if (!user) {
      return sendError(res, 404, "Borrower not found");
    }

    if (!schedule) {
      return sendError(res, 404, "EMI schedule not found");
    }

    return sendSuccess(res, 200, "EMI installments fetched successfully", {
      borrower: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        email: user.email,
        loanId: user.loanId
      },
      emiScheduleId: schedule._id,
      installments: schedule.installments,
      overdueAmount: schedule.overdueAmount,
      overdueInstallments: schedule.overdueInstallments,
      dpd: schedule.dpd
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch borrower detail with EMI, consent, enrollment, and linked device data.
 * Sample request: GET /distributor/users/665f6f0b6f0f6f0b6f0f6f0b
 */
export const getDistributorUserById = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Valid user ID is required");
    }

    const user = await User.findOne({ _id: req.params.id, tenantId: tenant._id }).lean();

    if (!user) {
      return sendError(res, 404, "Borrower not found");
    }

    const [emiSchedule, enrollmentToken, device, consentRecord] = await Promise.all([
      EmiSchedule.findOne({ userId: user._id, tenantId: tenant._id }).lean(),
      EnrollmentToken.findOne({ userId: user._id, tenantId: tenant._id }).sort({ createdAt: -1 }).lean(),
      Device.findOne({ userId: user._id, tenantId: tenant._id }).lean(),
      user.consentRecordId ? ConsentRecord.findById(user.consentRecordId).lean() : null
    ]);

    return sendSuccess(res, 200, "Borrower detail fetched successfully", {
      borrower: user,
      activationStatus: enrollmentToken
        ? getEnrollmentStatus({ enrollmentToken, user, device })
        : device
          ? "ACTIVATION_COMPLETE"
          : user.consentRecordId
            ? "CONSENT_COMPLETED"
            : "USER_REGISTERED",
      emiSchedule,
      enrollment: enrollmentToken
        ? {
            enrollmentTokenId: enrollmentToken._id,
            enrollmentToken: enrollmentToken.token,
            tokenExpiresAt: enrollmentToken.expiresAt,
            consumedAt: enrollmentToken.consumedAt,
            cancelledAt: enrollmentToken.cancelledAt,
            lastQrGeneratedAt: enrollmentToken.lastQrGeneratedAt
          }
        : null,
      consent: consentRecord
        ? {
            id: consentRecord._id,
            consentVersion: consentRecord.consentVersion,
            acceptedAt: consentRecord.acceptedAt,
            verifiedProfile: consentRecord.verifiedProfile
          }
        : null,
      device
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List devices under tenant with borrower details, pagination, filters, and search.
 * Sample query: /distributor/devices?page=1&limit=20&search=ramesh&state=ACTIVE
 */
export const getDistributorDevices = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const { page, limit, skip } = getPagination(req.query);
    const filter = { tenantId: tenant._id };

    if (req.query.state) filter.state = req.query.state;
    if (req.query.policyKey) filter.currentPolicyKey = req.query.policyKey;
    if (req.query.imei) filter.imei = buildSearchRegex(req.query.imei);

    if (req.query.search) {
      const search = buildSearchRegex(req.query.search);
      const users = await User.find({
        tenantId: tenant._id,
        $or: [{ name: search }, { mobile: search }, { email: search }, { loanId: search }]
      })
        .select("_id")
        .lean();

      filter.$or = [
        { imei: search },
        { imei2: search },
        { deviceModel: search },
        { manufacturer: search },
        { userId: { $in: users.map((user) => user._id) } }
      ];
    }

    const [items, total] = await Promise.all([
      Device.find(filter)
        .populate("userId", "name mobile email loanId loanAmount emiAmount tenureMonths isDeviceLinked")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Device.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Devices fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch one device detail with linked borrower and current policy.
 * Sample request: GET /distributor/devices/665f6f0b6f0f6f0b6f0f6f0b
 */
export const getDistributorDeviceById = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Valid device ID is required");
    }

    const device = await Device.findOne({ _id: req.params.id, tenantId: tenant._id })
      .populate("userId", "name mobile email loanId loanAmount emiAmount tenureMonths consentRecordId aadhaarVerified")
      .lean();

    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    const [policy, emiSchedule] = await Promise.all([
      device.currentPolicyId
        ? DevicePolicy.findOne({
            _id: device.currentPolicyId,
            tenantId: tenant._id,
            isActive: true
          }).lean()
        : DevicePolicy.findOne({
            tenantId: tenant._id,
            policyKey: device.currentPolicyKey,
            isActive: true
          }).lean(),
      EmiSchedule.findOne({ userId: device.userId?._id || device.userId, tenantId: tenant._id }).lean()
    ]);

    return sendSuccess(res, 200, "Device detail fetched successfully", {
      device,
      borrower: device.userId,
      emiSchedule,
      currentPolicy: policy
        ? {
            id: policy._id,
            policyKey: policy.policyKey,
            version: policy.version,
            restrictions: policy.restrictions
          }
        : null
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Queue an upcoming payment reminder command for a device when a due EMI is coming up.
 * Sample body: { "windowDays": 7, "note": "Reminder before due date" }
 */
export const sendUpcomingPaymentCommand = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Valid device ID is required");
    }

    const device = await Device.findOne({ _id: req.params.id, tenantId: tenant._id }).lean();
    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    const windowDays = Math.min(Math.max(Number(req.body.windowDays || req.query.windowDays || 7), 1), 30);
    const now = new Date();
    const windowEnd = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);
    const schedule = await EmiSchedule.findOne({ userId: device.userId, tenantId: tenant._id }).lean();
    const upcomingInstallment = schedule?.installments
      ?.filter((item) => ["pending", "partial"].includes(item.status))
      .filter((item) => item.dueDate >= now && item.dueDate <= windowEnd)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];

    if (!upcomingInstallment) {
      return sendSuccess(res, 200, "No upcoming payment found for device", {
        queued: false,
        deviceId: device._id,
        windowDays
      });
    }

    const commands = await DeviceCommand.create([
      {
        deviceId: device._id,
        tenantId: tenant._id,
        commandType: "UPCOMING_PAYMENT",
        triggeredBy: "manual_tenant",
        triggeredByAccountId: req.auth.id,
        payload: {
          note: req.body.note,
          windowDays,
          emiScheduleId: schedule._id,
          installmentId: upcomingInstallment._id,
          installmentNumber: upcomingInstallment.installmentNumber,
          dueDate: upcomingInstallment.dueDate,
          emiAmount: upcomingInstallment.emiAmount,
          penaltyAmount: upcomingInstallment.penaltyAmount || 0,
          outstandingAmount: Math.max(
            Number(upcomingInstallment.emiAmount || 0) +
              Number(upcomingInstallment.penaltyAmount || 0) -
              Number(upcomingInstallment.paidAmount || 0),
            0
          )
        }
      }
    ]);

    await createAuditLog({
      eventType: AUDIT_EVENTS.DEVICE_COMMAND_CREATED,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      userId: device.userId,
      deviceId: device._id,
      reason: req.body.note,
      metadata: { commandId: commands[0]._id, commandType: "UPCOMING_PAYMENT", installmentId: upcomingInstallment._id }
    });

    return sendSuccess(res, 201, "Upcoming payment reminder command queued successfully", {
      queued: true,
      command: commands[0],
      upcomingInstallment
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Generate or reuse an enrollment QR for one borrower.
 * Sample request: POST /distributor/users/665f.../enrollment/qr
 */
export const regenerateEnrollmentQr = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!mongoose.isValidObjectId(req.params.userId)) {
      return sendError(res, 400, "Valid user ID is required");
    }

    const user = await User.findOne({ _id: req.params.userId, tenantId: tenant._id }).lean();

    if (!user || !user.isActive) {
      return sendError(res, 404, "Active borrower not found");
    }

    const existingDevice = await Device.findOne({ userId: user._id, tenantId: tenant._id }).lean();
    if (existingDevice) {
      return sendError(res, 400, "Device is already registered for this borrower");
    }

    const now = new Date();
    const validEnrollmentToken = await EnrollmentToken.findOne({
      userId: user._id,
      tenantId: tenant._id,
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: now }
    }).sort({ createdAt: -1 });

    if (validEnrollmentToken) {
      validEnrollmentToken.lastQrGeneratedAt = now;
      await validEnrollmentToken.save();

      await createAuditLog({
        eventType: AUDIT_EVENTS.ENROLLMENT_QR_GENERATED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: user._id,
        metadata: { enrollmentTokenId: validEnrollmentToken._id, reused: true }
      });

      const qrResponse = await buildQrResponse(validEnrollmentToken);

      return sendSuccess(res, 200, "Enrollment QR generated successfully", {
        reusedExistingToken: true,
        borrower: {
          id: user._id,
          name: user.name,
          mobile: user.mobile,
          loanId: user.loanId
        },
        ...qrResponse
      });
    }

    session.startTransaction();

    const oldEnrollmentToken = await EnrollmentToken.findOne({
      userId: user._id,
      tenantId: tenant._id,
      consumedAt: null,
      cancelledAt: null
    })
      .sort({ createdAt: -1 })
      .session(session);

    if (oldEnrollmentToken) {
      oldEnrollmentToken.cancelledAt = now;
      await oldEnrollmentToken.save({ session });
    }

    const newEnrollmentTokens = await EnrollmentToken.create(
      [
        {
          token: createEnrollmentTokenValue(),
          userId: user._id,
          tenantId: tenant._id,
          expiresAt: getEnrollmentTokenExpiry(),
          lastQrGeneratedAt: now,
          regeneratedFrom: oldEnrollmentToken?._id,
          createdBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );

    if (oldEnrollmentToken) {
      oldEnrollmentToken.regeneratedTo = newEnrollmentTokens[0]._id;
      await oldEnrollmentToken.save({ session });
    }

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.ENROLLMENT_QR_REGENERATED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: user._id,
        metadata: {
          oldEnrollmentTokenId: oldEnrollmentToken?._id,
          newEnrollmentTokenId: newEnrollmentTokens[0]._id
        }
      },
      { session }
    );

    await session.commitTransaction();

    const qrResponse = await buildQrResponse(newEnrollmentTokens[0]);

    return sendSuccess(res, 201, "Enrollment QR regenerated successfully", {
      reusedExistingToken: false,
      oldEnrollmentToken: oldEnrollmentToken?.token,
      oldEnrollmentTokenId: oldEnrollmentToken?._id,
      borrower: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        loanId: user.loanId
      },
      ...qrResponse
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * List tenant payment QR codes.
 * Sample request: GET /distributor/qr-codes
 */
export const listQrCodes = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    return sendSuccess(res, 200, "QR codes fetched successfully", tenant.qrCodes || []);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Add tenant payment QR code.
 * Multipart fields: label, activate, qrImage
 * JSON fallback: { "label": "PhonePe Business QR", "imageUrl": "https://storage.example.com/qr.png", "activate": true }
 */
export const addQrCode = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!hasRequiredFields(req.body, ["label"]) || (!req.file && !req.body.imageUrl)) {
      return sendError(res, 400, "QR label and qrImage are required");
    }

    const shouldActivate = req.body.activate === true || req.body.activate === "true" || !tenant.qrCodes?.length;
    const tenantDocument = await Tenant.findById(tenant._id);
    const qrCodeId = new mongoose.Types.ObjectId();
    const uploadedImage = req.file
      ? await uploadImageToFirebase({
          file: req.file,
          folder: "tenant-payment-qr-codes",
          recordId: qrCodeId,
          userId: req.auth.id,
          tenantId: tenant._id,
          metadata: { qrCodeId: qrCodeId.toString() },
          purpose: "qr-code"
        })
      : null;

    if (shouldActivate) {
      tenantDocument.qrCodes.forEach((qrCode) => {
        qrCode.isActive = false;
      });
    }

    tenantDocument.qrCodes.push({
      _id: qrCodeId,
      label: req.body.label,
      imageUrl: uploadedImage?.imageUrl || req.body.imageUrl,
      imageStoragePath: uploadedImage?.storagePath,
      imageMimeType: uploadedImage?.mimeType,
      imageSize: uploadedImage?.size,
      imageUploadedAt: uploadedImage?.uploadedAt,
      isActive: shouldActivate,
      uploadedBy: req.auth.id
    });
    await tenantDocument.save();

    return sendSuccess(res, 201, "QR code added successfully", tenantDocument.qrCodes.at(-1));
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Activate one tenant payment QR code.
 * Sample request: PATCH /distributor/qr-codes/665f6f0b6f0f6f0b6f0f6f0b/activate
 */
export const activateQrCode = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const tenantDocument = await Tenant.findById(tenant._id);
    const targetQrCode = tenantDocument.qrCodes.id(req.params.qrId);

    if (!targetQrCode) {
      return sendError(res, 404, "QR code not found");
    }

    tenantDocument.qrCodes.forEach((qrCode) => {
      qrCode.isActive = qrCode._id.toString() === req.params.qrId;
    });
    await tenantDocument.save();

    return sendSuccess(res, 200, "QR code activated successfully", targetQrCode);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Delete an inactive tenant payment QR code.
 * Sample request: DELETE /distributor/qr-codes/665f6f0b6f0f6f0b6f0f6f0b
 */
export const deleteQrCode = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const tenantDocument = await Tenant.findById(tenant._id);
    const targetQrCode = tenantDocument.qrCodes.id(req.params.qrId);

    if (!targetQrCode) {
      return sendError(res, 404, "QR code not found");
    }

    if (targetQrCode.isActive) {
      return sendError(res, 400, "Cannot delete the active QR code");
    }

    targetQrCode.deleteOne();
    await tenantDocument.save();

    return sendSuccess(res, 200, "QR code deleted successfully");
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List tenant payments pending approval.
 * Sample request: GET /distributor/payments/pending-approval
 */
export const listPendingPayments = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;
    await clearDashboardAlert({ tenantId: tenant._id, alertKey: "approvePayments" });

    const payments = await Payment.find({ tenantId: tenant._id, approvalStatus: "pending_approval" })
      .populate("userId", "name mobile loanId")
      .populate("deviceId", "imei deviceModel manufacturer state")
      .sort({ submittedAt: -1 })
      .lean();

    return sendSuccess(res, 200, "Pending payments fetched successfully", payments);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List tenant payment approval requests with pagination and search.
 * Sample request: GET /distributor/payments/approval-requests?status=pending_approval&search=ramesh&page=1&limit=20
 */
export const listPaymentApprovalRequests = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;
    if (!req.query.status || req.query.status === "pending_approval") {
      await clearDashboardAlert({ tenantId: tenant._id, alertKey: "approvePayments" });
    }

    const { page, limit, skip } = getPagination(req.query);
    const filter = { tenantId: tenant._id };

    if (req.query.status && req.query.status !== "all") filter.approvalStatus = req.query.status;

    if (req.query.search) {
      const search = buildSearchRegex(req.query.search);
      const users = await User.find({
        tenantId: tenant._id,
        $or: [{ name: search }, { mobile: search }, { email: search }, { loanId: search }]
      })
        .select("_id")
        .lean();
      filter.$or = [{ "metadata.reference": search }, { userId: { $in: users.map((user) => user._id) } }];
    }

    const [items, total] = await Promise.all([
      Payment.find(filter)
        .populate("userId", "name mobile email loanId")
        .populate("deviceId", "imei deviceModel manufacturer state")
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Payment approval requests fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch tenant payment detail.
 * Sample request: GET /distributor/payments/665f6f0b6f0f6f0b6f0f6f0b
 */
export const getPaymentById = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const payment = await Payment.findOne({ _id: req.params.paymentId, tenantId: tenant._id })
      .populate("userId", "name mobile loanId")
      .populate("deviceId", "imei deviceModel manufacturer state")
      .lean();

    if (!payment) {
      return sendError(res, 404, "Payment not found");
    }

    return sendSuccess(res, 200, "Payment fetched successfully", payment);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Approve borrower QR payment and queue device unlock.
 * Sample body: { "note": "Verified UPI credit in bank statement" }
 */
export const approvePayment = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const payment = await Payment.findOne({ _id: req.params.paymentId, tenantId: tenant._id }).session(session);
    if (!payment) {
      return sendError(res, 404, "Payment not found");
    }

    if (payment.approvalStatus !== "pending_approval") {
      return sendError(res, 400, "Payment is already resolved");
    }

    const device = await Device.findOne({ _id: payment.deviceId, tenantId: tenant._id }).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found for payment");
    }

    session.startTransaction();

    const matchedInstallments = await applyPaymentToEmiSchedule({ payment, accountId: req.auth.id, session });
    payment.status = "success";
    payment.approvalStatus = "approved";
    payment.approvedBy = req.auth.id;
    payment.approvedAt = new Date();
    payment.completedAt = new Date();
    payment.metadata = { ...(payment.metadata || {}), approvalNote: req.body.note };
    await payment.save({ session });

    const { command } = await queueTenantDeviceCommand({
      device,
      commandType: "UNLOCK",
      triggeredBy: "payment_unlock",
      accountId: req.auth.id,
      payload: { paymentId: payment._id },
      session
    });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.PAYMENT_APPROVED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: payment.userId,
        deviceId: payment.deviceId,
        metadata: { paymentId: payment._id, commandId: command._id, matchedInstallments }
      },
      { session }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: payment.userId,
        deviceId: payment.deviceId,
        metadata: { paymentId: payment._id, commandId: command._id, triggeredBy: "payment_unlock" }
      },
      { session }
    );

    await session.commitTransaction();

    await safeQueueNotification({
      audience: NOTIFICATION_AUDIENCES.BORROWER,
      tenantId: tenant._id,
      deviceId: payment.deviceId,
      userId: payment.userId,
      title: "Payment approved",
      text: "Your payment has been approved and your device unlock is being processed.",
      notificationType: "PAYMENT_APPROVED",
      triggeredBy: "manual_tenant",
      triggeredByAccountId: req.auth.id,
      data: {
        paymentId: payment._id,
        deviceId: payment.deviceId,
        userId: payment.userId,
        matchedInstallments,
        unlockCommandId: command._id
      }
    });

    return sendSuccess(res, 200, "Payment approved and unlock queued successfully", {
      paymentId: payment._id,
      unlockCommandId: command._id,
      matchedInstallments
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Reject borrower QR payment.
 * Sample body: { "reason": "No matching credit found in bank statement" }
 */
export const rejectPayment = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!hasRequiredFields(req.body, ["reason"])) {
      return sendError(res, 400, "Rejection reason is required");
    }

    const payment = await Payment.findOne({ _id: req.params.paymentId, tenantId: tenant._id });
    if (!payment) {
      return sendError(res, 404, "Payment not found");
    }

    if (payment.approvalStatus !== "pending_approval") {
      return sendError(res, 400, "Payment is already resolved");
    }

    payment.status = "rejected";
    payment.approvalStatus = "rejected";
    payment.rejectedBy = req.auth.id;
    payment.rejectedAt = new Date();
    payment.rejectionReason = req.body.reason;
    await payment.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.PAYMENT_REJECTED,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      userId: payment.userId,
      deviceId: payment.deviceId,
      reason: req.body.reason,
      metadata: { paymentId: payment._id }
    });

    await safeQueueNotification({
      audience: NOTIFICATION_AUDIENCES.BORROWER,
      tenantId: tenant._id,
      deviceId: payment.deviceId,
      userId: payment.userId,
      title: "Payment rejected",
      text: "Your payment was rejected. Please review the reason and submit again if needed.",
      notificationType: "PAYMENT_REJECTED",
      triggeredBy: "manual_tenant",
      triggeredByAccountId: req.auth.id,
      data: {
        paymentId: payment._id,
        deviceId: payment.deviceId,
        userId: payment.userId,
        rejectionReason: req.body.reason
      }
    });

    return sendSuccess(res, 200, "Payment rejected successfully", payment);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Manually lock a tenant device.
 * Sample body: { "reason": "EMI grace period expired" }
 */
export const lockTenantDevice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!hasRequiredFields(req.body, ["reason"])) {
      return sendError(res, 400, "Reason is required");
    }

    const device = await Device.findOne({ _id: req.params.id, tenantId: tenant._id }).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    session.startTransaction();
    const result = await queueTenantDeviceCommand({
      device,
      commandType: "LOCK",
      triggeredBy: "manual_tenant",
      accountId: req.auth.id,
      payload: { reason: req.body.reason },
      session
    });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.MANUAL_LOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: device.userId,
        deviceId: device._id,
        reason: req.body.reason,
        metadata: { commandId: result.command._id }
      },
      { session }
    );

    await session.commitTransaction();
    return sendSuccess(res, 200, "Device lock queued successfully", result);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Manually unlock a tenant device.
 * Sample body: { "reason": "Manual payment verified" }
 */
export const unlockTenantDevice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!hasRequiredFields(req.body, ["reason"])) {
      return sendError(res, 400, "Reason is required");
    }

    const device = await Device.findOne({ _id: req.params.id, tenantId: tenant._id }).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    session.startTransaction();
    const result = await queueTenantDeviceCommand({
      device,
      commandType: "UNLOCK",
      triggeredBy: "manual_tenant",
      accountId: req.auth.id,
      payload: { reason: req.body.reason },
      session
    });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.MANUAL_UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: device.userId,
        deviceId: device._id,
        reason: req.body.reason,
        metadata: { commandId: result.command._id, action: "unlock" }
      },
      { session }
    );

    await session.commitTransaction();
    return sendSuccess(res, 200, "Device unlock queued successfully", result);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Manually temporary unlock a tenant device.
 * Sample body: { "durationHours": 24, "reason": "Emergency access approved" }
 */
export const tempUnlockTenantDevice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!hasRequiredFields(req.body, ["durationHours", "reason"])) {
      return sendError(res, 400, "Duration and reason are required");
    }

    const tenantPolicy = await TenantPolicy.findOne({ tenantId: tenant._id }).lean();
    const maxDurationHours = tenantPolicy?.tempUnlockRules?.maxDurationHours || 72;
    const durationHours = Number(req.body.durationHours);

    if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > maxDurationHours) {
      return sendError(res, 400, `Duration must be between 1 and ${maxDurationHours} hours`);
    }

    const device = await Device.findOne({ _id: req.params.id, tenantId: tenant._id }).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    const tempUnlockExpiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

    session.startTransaction();
    const result = await queueTenantDeviceCommand({
      device,
      commandType: "TEMP_UNLOCK",
      triggeredBy: "manual_tenant",
      accountId: req.auth.id,
      payload: { reason: req.body.reason, durationHours, tempUnlockExpiresAt },
      session
    });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TEMP_UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: device.userId,
        deviceId: device._id,
        reason: req.body.reason,
        metadata: { commandId: result.command._id, durationHours, tempUnlockExpiresAt }
      },
      { session }
    );

    await session.commitTransaction();
    return sendSuccess(res, 200, "Temporary unlock queued successfully", result);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * List tenant borrower unlock requests.
 * Sample request: GET /distributor/unlock-requests?status=PENDING_TENANT&page=1&limit=20
 */
export const listTenantUnlockRequests = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    await clearDashboardAlert({ tenantId: tenant._id, alertKey: "unlockRequests" });

    const { page, limit, skip } = getPagination(req.query);
    const filter = { tenantId: tenant._id };
    if (req.query.status) filter.status = req.query.status;

    if (req.query.search) {
      const search = buildSearchRegex(req.query.search);
      const users = await User.find({
        tenantId: tenant._id,
        $or: [{ name: search }, { mobile: search }, { email: search }, { loanId: search }]
      })
        .select("_id")
        .lean();
      filter.$or = [{ caseId: search }, { reason: search }, { userId: { $in: users.map((user) => user._id) } }];
    }

    const [items, total] = await Promise.all([
      UnlockRequest.find(filter)
        .populate("userId", "name mobile email loanId")
        .populate("deviceId", "imei deviceModel manufacturer state")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UnlockRequest.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Unlock requests fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch tenant borrower unlock request detail.
 * Sample request: GET /distributor/unlock-requests/CASE-2026-ABCDE
 */
export const getTenantUnlockRequestByCaseId = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId, tenantId: tenant._id })
      .populate("userId", "name mobile loanId loanAmount emiAmount")
      .populate("deviceId", "imei deviceModel manufacturer state currentPolicyKey")
      .lean();

    if (!unlockRequest) {
      return sendError(res, 404, "Unlock request not found");
    }

    const [emiSchedule, commands, auditLogs] = await Promise.all([
      EmiSchedule.findOne({ userId: unlockRequest.userId?._id || unlockRequest.userId, tenantId: tenant._id }).lean(),
      DeviceCommand.find({ deviceId: unlockRequest.deviceId?._id || unlockRequest.deviceId }).sort({ createdAt: -1 }).lean(),
      AuditLog.find({ caseId: unlockRequest.caseId }).sort({ timestamp: -1 }).lean()
    ]);

    return sendSuccess(res, 200, "Unlock request detail fetched successfully", {
      unlockRequest,
      emiSchedule,
      commands,
      auditLogs
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Approve borrower unlock request as tenant admin.
 * Sample body: { "note": "Payment proof verified", "emiAction": "none" }
 */
export const approveTenantUnlockRequest = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId, tenantId: tenant._id }).session(session);
    if (!unlockRequest) {
      return sendError(res, 404, "Unlock request not found");
    }

    if (unlockRequest.status !== "PENDING_TENANT") {
      return sendError(res, 400, "Only PENDING_TENANT requests can be approved by tenant admin");
    }

    const device = await Device.findOne({ _id: unlockRequest.deviceId, tenantId: tenant._id }).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    session.startTransaction();

    if (req.body.emiAction === "waive") {
      const schedule = await EmiSchedule.findOne({ userId: unlockRequest.userId, tenantId: tenant._id }).session(session);
      const installment = schedule?.installments?.find((item) => ["overdue", "partial", "pending"].includes(item.status));
      if (installment) {
        installment.status = "waived";
        installment.waivedBy = req.auth.id;
        installment.waivedAt = new Date();
        installment.waiveReason = unlockRequest.caseId;
        await schedule.save({ session });
        await Device.updateOne(
          { _id: device._id },
          { $pull: { graceReminderHistory: { installmentId: installment._id } } },
          { session }
        );
      }
    }

    const { command } = await queueTenantDeviceCommand({
      device,
      commandType: "UNLOCK",
      triggeredBy: "manual_tenant",
      accountId: req.auth.id,
      payload: { caseId: unlockRequest.caseId, note: req.body.note },
      session
    });

    unlockRequest.status = "RESOLVED_TENANT";
    unlockRequest.resolutionAction = req.body.emiAction === "waive" ? "waived" : "unlocked";
    unlockRequest.resolutionNote = req.body.note;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: unlockRequest.userId,
        deviceId: unlockRequest.deviceId,
        caseId: unlockRequest.caseId,
        metadata: { commandId: command._id, emiAction: req.body.emiAction || "none" }
      },
      { session }
    );

    await session.commitTransaction();

    await safeRefreshTenantMetrics(tenant._id, { source: "tenant_unlock_request_approved", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Unlock request approved successfully", {
      unlockRequest,
      command
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Temporary unlock a borrower request as tenant admin.
 * Sample body: { "durationHours": 24, "note": "Emergency access approved" }
 */
export const tempUnlockTenantUnlockRequest = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!hasRequiredFields(req.body, ["durationHours", "note"])) {
      return sendError(res, 400, "Duration and note are required");
    }

    const tenantPolicy = await TenantPolicy.findOne({ tenantId: tenant._id }).lean();
    const maxDurationHours = tenantPolicy?.tempUnlockRules?.maxDurationHours || 72;
    const durationHours = Number(req.body.durationHours);

    if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > maxDurationHours) {
      return sendError(res, 400, `Duration must be between 1 and ${maxDurationHours} hours`);
    }

    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId, tenantId: tenant._id }).session(session);
    if (!unlockRequest) {
      return sendError(res, 404, "Unlock request not found");
    }

    if (unlockRequest.status !== "PENDING_TENANT") {
      return sendError(res, 400, "Only PENDING_TENANT requests can be resolved by tenant admin");
    }

    const device = await Device.findOne({ _id: unlockRequest.deviceId, tenantId: tenant._id }).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    const tempUnlockExpiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
    session.startTransaction();

    const { command } = await queueTenantDeviceCommand({
      device,
      commandType: "TEMP_UNLOCK",
      triggeredBy: "manual_tenant",
      accountId: req.auth.id,
      payload: { caseId: unlockRequest.caseId, durationHours, tempUnlockExpiresAt, note: req.body.note },
      session
    });

    unlockRequest.status = "RESOLVED_TENANT";
    unlockRequest.resolutionAction = "temp_unlocked";
    unlockRequest.resolutionNote = req.body.note;
    unlockRequest.tempUnlockDurationHours = durationHours;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TEMP_UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: unlockRequest.userId,
        deviceId: unlockRequest.deviceId,
        caseId: unlockRequest.caseId,
        metadata: { commandId: command._id, durationHours, tempUnlockExpiresAt }
      },
      { session }
    );

    await session.commitTransaction();

    await safeRefreshTenantMetrics(tenant._id, { source: "tenant_unlock_request_temp_unlocked", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Temporary unlock request approved successfully", {
      unlockRequest,
      command
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Reject borrower unlock request as tenant admin.
 * Sample body: { "note": "No matching payment found" }
 */
export const rejectTenantUnlockRequest = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!hasRequiredFields(req.body, ["note"])) {
      return sendError(res, 400, "Note is required");
    }

    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId, tenantId: tenant._id });
    if (!unlockRequest) {
      return sendError(res, 404, "Unlock request not found");
    }

    if (unlockRequest.status !== "PENDING_TENANT") {
      return sendError(res, 400, "Only PENDING_TENANT requests can be rejected by tenant admin");
    }

    unlockRequest.status = "REJECTED_TENANT";
    unlockRequest.resolutionAction = "rejected";
    unlockRequest.resolutionNote = req.body.note;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.CASE_REJECTED_BY_TENANT,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      userId: unlockRequest.userId,
      deviceId: unlockRequest.deviceId,
      caseId: unlockRequest.caseId,
      reason: req.body.note,
      metadata: { rejectedBy: "tenant_admin" }
    });

    await safeRefreshTenantMetrics(tenant._id, { source: "tenant_unlock_request_rejected", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Unlock request rejected successfully", unlockRequest);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
