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
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { Tenant } from "../../models/Tenant.js";
import { UnlockRequest } from "../../models/UnlockRequest.js";
import { User } from "../../models/User.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../../constants/deviceStates.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import { hasRequiredFields } from "../../utils/validators.js";

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

const buildQrPayload = (enrollmentToken) => ({
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.emishield.app/.AdminReceiver",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION":
    "https://cdn.emishield.in/releases/shield.apk",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": "<SHA256_OF_APK_SIGNING_CERT>",
  "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": false,
  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
    enrollmentToken
  }
});

const buildQrResponse = async (enrollmentToken) => {
  const qrPayload = buildQrPayload(enrollmentToken.token);
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
 * Sample body: { "name": "Ramesh Kumar", "mobile": "9876543210", "aadhaarLinkedMobile": "9876543210", "loanId": "LOAN-001", "loanAmount": 18000, "emiAmount": 3000, "tenureMonths": 6, "disbursementDate": "2026-05-21" }
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
      "loanId",
      "loanAmount",
      "emiAmount",
      "tenureMonths",
      "disbursementDate"
    ];

    if (!hasRequiredFields(req.body, requiredFields)) {
      return sendError(res, 400, "Borrower and EMI details are required");
    }

    const existingUser = await User.findOne({
      $or: [{ mobile: req.body.mobile }, { loanId: req.body.loanId }]
    }).lean();

    if (existingUser) {
      return sendError(res, 400, "User mobile or loan ID already exists");
    }

    session.startTransaction();

    const users = await User.create(
      [
        {
          name: req.body.name,
          mobile: req.body.mobile,
          email: req.body.email,
          aadhaarLinkedMobile: req.body.aadhaarLinkedMobile,
          tenantId: tenant._id,
          loanId: req.body.loanId,
          loanAmount: req.body.loanAmount,
          emiAmount: req.body.emiAmount,
          tenureMonths: req.body.tenureMonths,
          disbursementDate: req.body.disbursementDate,
          registeredBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );

    const user = users[0];
    const installments = generateInstallments(req.body);

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

    await session.commitTransaction();

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
      tokenExpiresAt: enrollmentTokens[0].expiresAt
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
      recentEnrollments: recentEnrollmentRows
    });
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
 * List users under tenant.
 * Sample query: /distributor/users?page=1&limit=20
 */
export const getDistributorUsers = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const users = await User.find({ tenantId: tenant._id }).sort({ createdAt: -1 }).lean();
    return sendSuccess(res, 200, "Users fetched successfully", users);
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
 * List devices under tenant.
 * Sample query: /distributor/devices
 */
export const getDistributorDevices = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const devices = await Device.find({ tenantId: tenant._id }).sort({ createdAt: -1 }).lean();
    return sendSuccess(res, 200, "Devices fetched successfully", devices);
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

    const policy = device.currentPolicyId
      ? await DevicePolicy.findOne({
          _id: device.currentPolicyId,
          tenantId: tenant._id,
          isActive: true
        }).lean()
      : await DevicePolicy.findOne({
          tenantId: tenant._id,
          policyKey: device.currentPolicyKey,
          isActive: true
        }).lean();

    return sendSuccess(res, 200, "Device detail fetched successfully", {
      device,
      borrower: device.userId,
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
 * Cancel an old enrollment token and create a fresh QR for the same borrower.
 * Sample request: POST /distributor/enrollment/abcdef/regenerate
 */
export const regenerateEnrollmentQr = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const oldEnrollmentToken = await EnrollmentToken.findOne({
      token: req.params.token,
      tenantId: tenant._id
    });

    if (!oldEnrollmentToken) {
      return sendError(res, 404, "Enrollment token not found");
    }

    const [user, existingDevice] = await Promise.all([
      User.findOne({ _id: oldEnrollmentToken.userId, tenantId: tenant._id }).lean(),
      Device.findOne({ userId: oldEnrollmentToken.userId, tenantId: tenant._id }).lean()
    ]);

    if (!user) {
      return sendError(res, 404, "Borrower not found for enrollment token");
    }

    if (existingDevice) {
      return sendError(res, 400, "Device is already registered for this borrower");
    }

    if (oldEnrollmentToken.consumedAt) {
      return sendError(res, 400, "Enrollment token is already consumed");
    }

    if (oldEnrollmentToken.regeneratedTo) {
      return sendError(res, 400, "This enrollment token has already been regenerated");
    }

    session.startTransaction();

    oldEnrollmentToken.cancelledAt = new Date();
    await oldEnrollmentToken.save({ session });

    const newEnrollmentTokens = await EnrollmentToken.create(
      [
        {
          token: createEnrollmentTokenValue(),
          userId: oldEnrollmentToken.userId,
          tenantId: oldEnrollmentToken.tenantId,
          expiresAt: getEnrollmentTokenExpiry(),
          lastQrGeneratedAt: new Date(),
          regeneratedFrom: oldEnrollmentToken._id,
          createdBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );

    oldEnrollmentToken.regeneratedTo = newEnrollmentTokens[0]._id;
    await oldEnrollmentToken.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.ENROLLMENT_QR_REGENERATED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: oldEnrollmentToken.userId,
        metadata: {
          oldEnrollmentTokenId: oldEnrollmentToken._id,
          newEnrollmentTokenId: newEnrollmentTokens[0]._id
        }
      },
      { session }
    );

    await session.commitTransaction();

    const qrResponse = await buildQrResponse(newEnrollmentTokens[0]);

    return sendSuccess(res, 201, "Enrollment QR regenerated successfully", {
      oldEnrollmentToken: oldEnrollmentToken.token,
      oldEnrollmentTokenId: oldEnrollmentToken._id,
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
 * Sample body: { "label": "PhonePe Business QR", "imageUrl": "https://storage.example.com/qr.png", "activate": true }
 */
export const addQrCode = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    if (!hasRequiredFields(req.body, ["label", "imageUrl"])) {
      return sendError(res, 400, "QR label and imageUrl are required");
    }

    const shouldActivate = req.body.activate === true || !tenant.qrCodes?.length;
    const tenantDocument = await Tenant.findById(tenant._id);

    if (shouldActivate) {
      tenantDocument.qrCodes.forEach((qrCode) => {
        qrCode.isActive = false;
      });
    }

    tenantDocument.qrCodes.push({
      label: req.body.label,
      imageUrl: req.body.imageUrl,
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
 * Sample request: GET /distributor/unlock-requests?status=PENDING_TENANT
 */
export const listTenantUnlockRequests = async (req, res) => {
  try {
    const tenant = await ensureDistributorAccess(req, res);
    if (!tenant) return null;

    const filter = { tenantId: tenant._id };
    if (req.query.status) filter.status = req.query.status;

    const unlockRequests = await UnlockRequest.find(filter)
      .populate("userId", "name mobile loanId")
      .populate("deviceId", "imei deviceModel manufacturer state")
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, 200, "Unlock requests fetched successfully", unlockRequests);
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

    unlockRequest.status = "REJECTED";
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

    return sendSuccess(res, 200, "Unlock request rejected successfully", unlockRequest);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
