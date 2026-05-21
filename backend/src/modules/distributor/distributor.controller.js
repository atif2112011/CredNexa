import crypto from "crypto";
import mongoose from "mongoose";

import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { TENANT_CAPABILITIES } from "../../constants/tenant.js";
import { AuditLog } from "../../models/AuditLog.js";
import { Device } from "../../models/Device.js";
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

    const enrollmentTokenValue = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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
      expiresAt: { $gt: new Date() }
    }).lean();

    if (!enrollmentToken) {
      return sendError(res, 400, "Valid enrollment token not found");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.ENROLLMENT_QR_GENERATED,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      userId: enrollmentToken.userId,
      metadata: { enrollmentTokenId: enrollmentToken._id }
    });

    return sendSuccess(res, 200, "Enrollment QR generated successfully", {
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.emishield.app/.AdminReceiver",
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION":
        "https://cdn.emishield.in/releases/shield.apk",
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": "<SHA256_OF_APK_SIGNING_CERT>",
      "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": false,
      "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
        enrollmentToken: enrollmentToken.token
      }
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
