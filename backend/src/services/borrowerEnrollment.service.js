import crypto from "crypto";
import mongoose from "mongoose";
import QRCode from "qrcode";
import { ACCOUNT_ROLES } from "../constants/roles.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { ENROLLMENT_MODES, getEnrollmentMode, isRunningDevice } from "../constants/enrollmentModes.js";
import { AuditLog } from "../models/AuditLog.js";
import { Device } from "../models/Device.js";
import { EmiSchedule } from "../models/EmiSchedule.js";
import { EnrollmentToken } from "../models/EnrollmentToken.js";
import { ProvisioningDetails } from "../models/ProvisioningDetails.js";
import { Tenant } from "../models/Tenant.js";
import { TenantPolicy } from "../models/TenantPolicy.js";
import { TenantCreditLedger, TENANT_CREDIT_LEDGER_TYPES } from "../models/TenantCreditLedger.js";
import { User } from "../models/User.js";
import { hasRequiredFields } from "../utils/validators.js";
import { assertRunningEnrollmentConfigured, buildRunningQrText, createRunningTokenFields, decryptRunningSecret } from "./runningEnrollment.service.js";
import { isTestOtpMobile } from "./otp.service.js";
import { isTestBorrowerName } from "../constants/testBorrowers.js";
import { safeRefreshTenantMetrics } from "./tenantMetrics.service.js";

export const enrollmentError = (statusCode, message, data) => Object.assign(new Error(message), { statusCode, data });
const result = (statusCode, message, data) => ({ statusCode, message, data });
const createAuditLog = (payload, options = {}) => AuditLog.create([payload], { ordered: true, ...options }).then((items) => items[0]);

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

export const buildQrResponse = async (enrollmentToken) => {
  if (isRunningDevice(enrollmentToken)) {
    const secret = decryptRunningSecret(enrollmentToken.runningTokenCiphertext);
    const qrText = buildRunningQrText(secret);
    return {
      enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
      qrType: "RUNNING_APP_LINK",
      qrText,
      qrCodeDataUrl: await QRCode.toDataURL(qrText, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 512
      }),
      qrCodeMimeType: "image/png",
      tokenExpiresAt: enrollmentToken.expiresAt
    };
  }
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

export const createBorrowerEnrollment = async ({ tenant, actor, body, freeTest = false }) => {
  if (freeTest && (actor.role !== ACCOUNT_ROLES.SUPER_ADMIN || !isTestBorrowerName(body.name) || !isTestOtpMobile(body.mobile))) {
    throw enrollmentError(403, "Free test creation requires a super admin and generated test identity");
  }
  const session = await mongoose.startSession();

  try {
    const requiredFields = [
      "name",
      "mobile",
      "aadhaarLinkedMobile",
      "loanAmount",
      "emiAmount",
      "tenureMonths",
      "disbursementDate"
    ];

    if (!hasRequiredFields(body, requiredFields)) {
      throw enrollmentError(400, "Borrower and EMI details are required");
    }

    const enrollmentMode = body.enrollmentMode === undefined
      ? ENROLLMENT_MODES.DEVICE_OWNER_QR
      : body.enrollmentMode;
    if (!Object.values(ENROLLMENT_MODES).includes(enrollmentMode)) {
      throw enrollmentError(400, "Invalid enrollmentMode");
    }
    if (enrollmentMode === ENROLLMENT_MODES.RUNNING_APP) {
      const tenantPolicy = await TenantPolicy.findOne({ tenantId: tenant._id }).lean();
      if (tenantPolicy?.runningEnrollmentEnabled !== true) {
        throw enrollmentError(409, "Running enrollment is not enabled for this dealer", {
          code: "RUNNING_ENROLLMENT_DISABLED"
        });
      }
      try {
        assertRunningEnrollmentConfigured();
      } catch (error) {
        throw enrollmentError(409, error.message, { code: "RUNNING_ENROLLMENT_NOT_CONFIGURED" });
      }
    }

    const loanAmount = Number(body.loanAmount);
    const emiAmount = Number(body.emiAmount);
    const tenureMonths = Number(body.tenureMonths);

    if (!Number.isFinite(tenureMonths) || tenureMonths <= 0) {
      throw enrollmentError(400, "Tenure months must be greater than 0");
    }
    if (!Number.isFinite(loanAmount) || loanAmount <= 0) {
      throw enrollmentError(400, "Loan amount must be greater than 0");
    }
    if (!Number.isFinite(emiAmount) || emiAmount <= 0) {
      throw enrollmentError(400, "EMI amount must be greater than 0");
    }
    if (emiAmount > loanAmount) {
      throw enrollmentError(400, "EMI amount cannot be greater than loan amount");
    }

    const expectedTenureMonths = Math.ceil(loanAmount / emiAmount);
    if (tenureMonths !== expectedTenureMonths) {
      throw enrollmentError(400, "Tenure months does not match loan amount and EMI amount");
    }

    const disbursementDate = new Date(body.disbursementDate);
    const previousDayStart = new Date();
    previousDayStart.setHours(0, 0, 0, 0);
    previousDayStart.setDate(previousDayStart.getDate() - 1);

    if (disbursementDate < previousDayStart) {
      throw enrollmentError(400, "Disbursement date cannot be earlier than previous day");
    }

    const existingUser = await User.findOne({ mobile: body.mobile }).lean();

    if (existingUser) {
      throw enrollmentError(400, "User mobile already exists");
    }

    const loanId = await generateUniqueBorrowerUid();

    session.startTransaction();

    // Normal dealer registration always charges one key. Only the admin service
    // selects freeTest; a borrower name or HTTP body flag cannot waive the charge.
    const creditedTenant = freeTest ? tenant : await Tenant.findOneAndUpdate(
      { _id: tenant._id, creditBalance: { $gte: 1 } },
      { $inc: { creditBalance: -1 } },
      { new: false, session }
    );
    if (!creditedTenant) throw enrollmentError(402, "Insufficient credits to create borrower");
    const balanceBefore = Number(creditedTenant.creditBalance || 0);
    const balanceAfter = balanceBefore - (freeTest ? 0 : 1);

    const users = await User.create(
      [
        {
          name: body.name,
          mobile: body.mobile,
          email: body.email,
          aadhaarLinkedMobile: body.aadhaarLinkedMobile,
          tenantId: tenant._id,
          loanId,
          enrollmentMode,
          loanAmount,
          emiAmount,
          tenureMonths,
          disbursementDate: body.disbursementDate,
          registeredBy: actor.id
        }
      ],
      { session, ordered: true }
    );

    const user = users[0];

    if (!freeTest) {
      await TenantCreditLedger.create(
        [
          {
            tenantId: tenant._id,
            type: TENANT_CREDIT_LEDGER_TYPES.BORROWER_CREATION,
            delta: -1,
            balanceBefore,
            balanceAfter,
            actorId: actor.id,
            actorCollection: "accounts",
            userId: user._id,
            reason: "Borrower created",
            metadata: { loanId: user.loanId }
          }
        ],
        { session, ordered: true }
      );
    }

    const installments = generateInstallments({ emiAmount, tenureMonths, disbursementDate: body.disbursementDate });

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

    const runningTokenFields = enrollmentMode === ENROLLMENT_MODES.RUNNING_APP
      ? createRunningTokenFields()
      : null;
    const enrollmentTokenValue = runningTokenFields?.token || createEnrollmentTokenValue();
    const expiresAt = getEnrollmentTokenExpiry();
    const enrollmentTokens = await EnrollmentToken.create(
      [
        {
          token: enrollmentTokenValue,
          enrollmentMode,
          ...(runningTokenFields || {}),
          userId: user._id,
          tenantId: tenant._id,
          expiresAt,
          createdBy: actor.id
        }
      ],
      { session, ordered: true }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.USER_REGISTERED,
        actorId: actor.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: user._id,
        metadata: { loanId: user.loanId, tenureMonths: user.tenureMonths, ...(freeTest ? { origin: "DEV_TOOLS", creditsCharged: 0, enrollmentMode } : {}) }
      },
      { session }
    );

    if (!freeTest) {
      await createAuditLog(
        {
          eventType: AUDIT_EVENTS.TENANT_CREDIT_CONSUMED,
          actorId: actor.id,
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
    } else {
      await createAuditLog({ eventType: AUDIT_EVENTS.ADMIN_TEST_BORROWER_CREATED, actorId: actor.id,
        tenantId: tenant._id, channelPartnerId: tenant.channelPartnerId, userId: user._id,
        metadata: { creditsCharged: 0, enrollmentMode, loanId: user.loanId } }, { session });
    }

    await session.commitTransaction();

    await safeRefreshTenantMetrics(tenant._id, { source: "borrower_registration" });

    return result(201, "Borrower registered successfully", {
      userId: user._id,
      tenantId: user.tenantId,
      tenant: {
        id: tenant._id,
        name: tenant.name
      },
      loanId: user.loanId,
      emiScheduleId: schedules[0]._id,
      emiScheduleTenantId: schedules[0].tenantId,
      ...(enrollmentMode === ENROLLMENT_MODES.RUNNING_APP
        ? { enrollmentMode, enrollmentId: enrollmentTokens[0]._id }
        : { enrollmentToken: enrollmentTokens[0].token }),
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
    throw error;
  } finally {
    session.endSession();
  }
};

export const getBorrowerEnrollmentQr = async ({ tenant, actor, userId, body = {} }) => {
  const session = await mongoose.startSession();

  try {
    if (!mongoose.isValidObjectId(userId)) {
      throw enrollmentError(400, "Valid user ID is required");
    }

    const user = await User.findOne({ _id: userId, tenantId: tenant._id }).lean();

    if (!user || !user.isActive) {
      throw enrollmentError(404, "Active borrower not found");
    }

    const savedMode = getEnrollmentMode(user);
    if (savedMode === ENROLLMENT_MODES.RUNNING_APP) {
      const runningPolicy = await TenantPolicy.findOne({ tenantId: tenant._id })
        .select("runningEnrollmentEnabled").lean();
      if (runningPolicy?.runningEnrollmentEnabled !== true) {
        throw enrollmentError(409, "Running enrollment is disabled for this dealer", {
          code: "RUNNING_ENROLLMENT_DISABLED"
        });
      }
    }
    if (body.enrollmentMode !== undefined && body.enrollmentMode !== savedMode) {
      throw enrollmentError(409, "Enrollment mode does not match borrower", {
        code: "ENROLLMENT_MODE_MISMATCH"
      });
    }
    // Older dealer builds omit mode and must never render a running claim as an owner QR.
    if (savedMode === ENROLLMENT_MODES.RUNNING_APP && body.enrollmentMode !== savedMode) {
      throw enrollmentError(409, "Dealer app upgrade required for running enrollment", {
        code: "DEALER_APP_UPGRADE_REQUIRED"
      });
    }

    const existingDevice = await Device.findOne({ userId: user._id, tenantId: tenant._id }).lean();
    // The list hides Generate QR for linked borrowers. Enforce that saved link state here too,
    // including an inconsistent record whose linked Device document is temporarily missing.
    if (user.isDeviceLinked === true || existingDevice) {
      throw enrollmentError(400, "Device is already registered for this borrower");
    }

    const now = new Date();
    const validEnrollmentToken = await EnrollmentToken.findOne({
      userId: user._id,
      tenantId: tenant._id,
      enrollmentMode: savedMode === ENROLLMENT_MODES.RUNNING_APP
        ? ENROLLMENT_MODES.RUNNING_APP
        : { $in: [ENROLLMENT_MODES.DEVICE_OWNER_QR, null] },
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: now }
    }).select("+runningTokenCiphertext").sort({ createdAt: -1 });

    if (validEnrollmentToken && body.rotate !== true) {
      validEnrollmentToken.lastQrGeneratedAt = now;
      await validEnrollmentToken.save();

      await createAuditLog({
        eventType: AUDIT_EVENTS.ENROLLMENT_QR_GENERATED,
        actorId: actor.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        userId: user._id,
        metadata: { enrollmentTokenId: validEnrollmentToken._id, reused: true }
      });

      const qrResponse = await buildQrResponse(validEnrollmentToken);

      return result(200, "Enrollment QR generated successfully", {
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
      enrollmentMode: savedMode === ENROLLMENT_MODES.RUNNING_APP
        ? ENROLLMENT_MODES.RUNNING_APP
        : { $in: [ENROLLMENT_MODES.DEVICE_OWNER_QR, null] },
      consumedAt: null,
      cancelledAt: null
    })
      .sort({ createdAt: -1 })
      .session(session);

    if (oldEnrollmentToken) {
      oldEnrollmentToken.cancelledAt = now;
      await oldEnrollmentToken.save({ session });
    }

    if (savedMode === ENROLLMENT_MODES.RUNNING_APP && user.consentRecordId) {
      // A rotated QR is a new claim. Keep the old consent record immutable but require
      // fresh OTP and acceptance bound to the new claim before activation.
      await User.updateOne(
        { _id: user._id, tenantId: tenant._id, isDeviceLinked: false },
        { $set: { consentRecordId: null } },
        { session }
      );
    }

    const runningTokenFields = savedMode === ENROLLMENT_MODES.RUNNING_APP
      ? createRunningTokenFields()
      : null;
    const newEnrollmentTokens = await EnrollmentToken.create(
      [
        {
          token: runningTokenFields?.token || createEnrollmentTokenValue(),
          enrollmentMode: savedMode,
          ...(runningTokenFields || {}),
          userId: user._id,
          tenantId: tenant._id,
          expiresAt: getEnrollmentTokenExpiry(),
          lastQrGeneratedAt: now,
          regeneratedFrom: oldEnrollmentToken?._id,
          createdBy: actor.id
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
        actorId: actor.id,
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

    return result(201, "Enrollment QR regenerated successfully", {
      reusedExistingToken: false,
      ...(savedMode === ENROLLMENT_MODES.DEVICE_OWNER_QR
        ? { oldEnrollmentToken: oldEnrollmentToken?.token }
        : {}),
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
    throw error;
  } finally {
    session.endSession();
  }
};

