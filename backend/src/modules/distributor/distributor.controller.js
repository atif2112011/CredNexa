import crypto from "crypto";
import mongoose from "mongoose";
import QRCode from "qrcode";

import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { TENANT_CAPABILITIES } from "../../constants/tenant.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ConsentRecord } from "../../models/ConsentRecord.js";
import { Device } from "../../models/Device.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { EmiSchedule } from "../../models/EmiSchedule.js";
import { EnrollmentToken } from "../../models/EnrollmentToken.js";
import { Tenant } from "../../models/Tenant.js";
import { User } from "../../models/User.js";
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
