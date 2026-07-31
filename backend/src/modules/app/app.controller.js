import crypto from "crypto";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import { env } from "../../config/env.js";
import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import {
  normalizeDeviceRestrictionState,
  normalizeDeviceRestrictions
} from "../../constants/deviceRestrictions.js";
import {
  getDeviceSecurityControlByCommandType,
  normalizeDeviceSecurityControlState
} from "../../constants/deviceSecurityControls.js";
import {
  DEVICE_POLICY_KEYS,
  DEVICE_STATES,
  isDeviceReleaseState
} from "../../constants/deviceStates.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ConsentRecord } from "../../models/ConsentRecord.js";
import { ConsentVersion } from "../../models/ConsentVersion.js";
import { Device } from "../../models/Device.js";
import {
  DEVICE_COMMAND_FAILURE_SOURCES,
  DeviceCommand
} from "../../models/DeviceCommand.js";
import { DeviceEvent } from "../../models/DeviceEvent.js";
import { DEVICE_INTEGRITY_ACTIONS, DeviceIntegrityChallenge } from "../../models/DeviceIntegrityChallenge.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { EnrollmentToken } from "../../models/EnrollmentToken.js";
import { EmiSchedule } from "../../models/EmiSchedule.js";
import { Payment } from "../../models/Payment.js";
import { RiskFlag } from "../../models/RiskFlag.js";
import { Tenant } from "../../models/Tenant.js";
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { UnlockRequest } from "../../models/UnlockRequest.js";
import { OtpRecord } from "../../models/OtpRecord.js";
import { User } from "../../models/User.js";
import {
  buildUpdateCheckResponse,
  findPublishedBuild,
  parsePositiveInteger,
  validateAppBuildIdentity
} from "../../services/appUpdate.service.js";
import { getOrCreateCompanySupportContact } from "../../services/companySupportContact.service.js";
import {
  generateManualOverrideTokenForDevice,
  recordManualOverrideTokenUsage
} from "../../services/manualOverrideToken.service.js";
import {
  applyDevicePingTelemetry,
  parseLocationTelemetry,
  sanitizePingEventPayload
} from "../../services/deviceTelemetry.service.js";
import { shouldAdvanceAppliedRestrictionState } from "../../services/deviceRestrictions.service.js";
import {
  buildReleasedDeviceSecurityControlState,
  getExpectedSecurityControlResult,
  parseSecurityControlBlockedValue,
  selectLatestActiveSecurityControlCommands
} from "../../services/deviceSecurityControls.service.js";
import {
  enforceRiskAutoLock,
  recordIntegrityAssessment
} from "../../services/riskManagement.service.js";
import { safeRefreshTenantMetrics } from "../../services/tenantMetrics.service.js";
import { resendOtp, sendOtp, verifyOtpCode } from "../../services/otp.service.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import { uploadImageToFirebase } from "../../utils/firebaseImageUpload.js";
import { NOTIFICATION_AUDIENCES, safeQueueNotification } from "../../utils/appNotifications.js";
import { hasRequiredFields } from "../../utils/validators.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const OPEN_UNLOCK_REQUEST_STATUSES = ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"];
const RESOLVED_UNLOCK_REQUEST_STATUSES = [
  "RESOLVED_TENANT",
  "RESOLVED_PARTNER",
  "RESOLVED_SUPER_ADMIN",
  "CLOSED"
];
const REJECTED_UNLOCK_REQUEST_STATUSES = ["REJECTED_TENANT", "REJECTED_PARTNER", "REJECTED_SUPER_ADMIN"];

let playIntegrityClient = null;

const createAuditLog = async (payload, options = {}) => {
  return AuditLog.create([payload], { ordered: true, ...options }).then((items) => items[0]);
};

const buildUserPayload = (user) => ({
  id: user._id.toString(),
  tokenType: "user",
  tenantId: user.tenantId.toString()
});

const signUserAccessToken = (user) => {
  return jwt.sign(buildUserPayload(user), env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn
  });
};

const signUserRefreshToken = (user) => {
  return jwt.sign(buildUserPayload(user), env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn
  });
};

const getUserRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSecure ? "none" : "lax",
  path: "/api/app"
});

const setUserRefreshCookie = (res, user) => {
  res.cookie(env.refreshCookieName, signUserRefreshToken(user), getUserRefreshCookieOptions());
};

const hashPayload = (payload) => {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};

const createRequestHash = (payload) => {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("base64url");
};

const normalizeName = (name = "") => {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
};

const createCaseId = () => `CASE-${new Date().getFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

/**
 * Check whether the borrower Android app should show no update, optional update,
 * or force update. The endpoint intentionally does not require borrower PII or a
 * user token because it must be callable very early during app startup.
 */
export const checkAppUpdate = async (req, res) => {
  try {
    const input = req.method === "GET" ? req.query : req.body;
    const identity = validateAppBuildIdentity(input);
    if (identity.error) {
      return sendError(res, 400, identity.error);
    }

    const currentVersionCode = parsePositiveInteger(input.currentVersionCode);
    if (!currentVersionCode) {
      return sendError(res, 400, "currentVersionCode must be a positive integer");
    }

    const build = await findPublishedBuild(identity.value);
    if (!build) {
      return sendError(
        res,
        503,
        `Published app build is not configured for ${identity.value.platform}/${identity.value.packageName} on ${identity.value.channel} channel`
      );
    }

    if (!build.apkUrl?.startsWith("https://")) {
      return sendError(res, 503, "Published app build APK URL is not valid");
    }

    const response = buildUpdateCheckResponse({ build, currentVersionCode });
    return sendSuccess(res, 200, "App update check completed", response);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch company support contact details for borrower app help screens.
 * Sample request: GET /app/support-contact
 */
export const getCompanySupportContact = async (req, res) => {
  try {
    const supportContact = await getOrCreateCompanySupportContact();
    return sendSuccess(res, 200, "Company support contact fetched successfully", {
      supportEmail: supportContact.supportEmail,
      supportPhone: supportContact.supportPhone,
      supportWhatsapp: supportContact.supportWhatsapp,
      updatedAt: supportContact.updatedAt
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

const buildMockCashfreeProfile = (user) => ({
  name: user.name,
  dob: "1990-01-01",
  address: "Mock Aadhaar address",
  aadhaarLinkedMobile: user.aadhaarLinkedMobile
});

const buildMobileOtpVerifiedProfile = (user) => ({
  name: user.name,
  mobile: user.mobile,
  email: user.email,
  verificationMethod: "mobile_otp"
});

const buildUserDetails = (user) => ({
  id: user._id,
  name: user.name,
  mobile: user.mobile,
  email: user.email,
  aadhaarVerified: user.aadhaarVerified,
  tenantId: user.tenantId,
  isDeviceLinked: user.isDeviceLinked,
  linkedDeviceId: user.linkedDeviceId
});

const buildLoanDetails = (user, schedule) => ({
  loanId: user.loanId,
  loanAmount: user.loanAmount,
  emiAmount: user.emiAmount,
  tenureMonths: user.tenureMonths,
  disbursementDate: user.disbursementDate,
  emiScheduleId: schedule?._id,
  overdueAmount: schedule?.overdueAmount || 0,
  overdueInstallments: schedule?.overdueInstallments || 0,
  dpd: schedule?.dpd || 0
});

const getInstallmentOutstanding = (installment) => {
  const totalPayable = Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0);
  return Math.max(totalPayable - Number(installment.paidAmount || 0), 0);
};

const isInstallmentUnpaid = (installment) => ["pending", "partial", "overdue"].includes(installment.status);

const addDays = (date, days) => new Date(new Date(date).getTime() + Number(days || 0) * DAY_IN_MS);

const getScheduledLockAt = async (device) => {
  const [schedule, tenantPolicy] = await Promise.all([
    EmiSchedule.findOne({ userId: device.userId, tenantId: device.tenantId }).lean(),
    TenantPolicy.findOne({ tenantId: device.tenantId }).lean()
  ]);

  const lockRules = tenantPolicy?.lockRules || {};
  if (lockRules.lockOnGraceExpiry === false) return null;

  const unpaidInstallment = schedule?.installments
    ?.filter((installment) => isInstallmentUnpaid(installment) && installment.dueDate)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];

  if (!unpaidInstallment) return null;

  const dpd = Number(lockRules.dpd ?? 30);
  const gracePeriodDays = Number(lockRules.gracePeriodDays ?? 7);

  return addDays(unpaidInstallment.dueDate, dpd + gracePeriodDays);
};

const buildInstallmentSummary = (installment) => ({
  installmentId: installment._id,
  installmentNumber: installment.installmentNumber,
  dueDate: installment.dueDate,
  emiAmount: installment.emiAmount,
  penaltyAmount: installment.penaltyAmount || 0,
  paidAmount: installment.paidAmount || 0,
  amountDue: getInstallmentOutstanding(installment),
  status: installment.status,
  paidAt: installment.paidAt,
  paymentId: installment.paymentId
});

const getCurrentDueInstallment = (installments = [], now = new Date()) => {
  const dueCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return installments
    .filter((installment) => ["pending", "partial", "overdue"].includes(installment.status))
    .filter((installment) => installment.dueDate && new Date(installment.dueDate) <= dueCutoff)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
};

const uploadPaymentProofImage = async ({ file, paymentId, userId, tenantId }) =>
  uploadImageToFirebase({
    file,
    folder: "payment-proofs",
    recordId: paymentId,
    userId,
    tenantId,
    metadata: { paymentId: paymentId.toString() },
    purpose: "screenshot"
  });

const uploadUnlockRequestImage = async ({ file, caseId, userId, tenantId }) =>
  uploadImageToFirebase({
    file,
    folder: "unlock-requests",
    recordId: caseId,
    userId,
    tenantId,
    metadata: { caseId: caseId.toString() },
    purpose: "screenshot"
  });

const OTP_PURPOSES = Object.freeze({
  CONSENT: "consent",
  AADHAAR_CONSENT: "aadhaar_consent",
  ONBOARDING_RESUME: "onboarding_resume",
  DEVICE_LOGIN: "device_login"
});

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

const FLOW_TYPES = Object.freeze({
  ONBOARDING_CONSENT: "ONBOARDING_CONSENT",
  ONBOARDING_RESUME: "ONBOARDING_RESUME",
  DEVICE_LOGIN: "DEVICE_LOGIN"
});

const NEXT_STEPS = Object.freeze({
  VERIFY_OTP: "VERIFY_OTP",
  SHOW_CONSENT: "SHOW_CONSENT",
  REGISTER_DEVICE: "REGISTER_DEVICE",
  SYNC_DEVICE: "SYNC_DEVICE"
});

const isMobileMatch = (user, mobile) => {
  return [user.mobile, user.aadhaarLinkedMobile].filter(Boolean).includes(mobile);
};

const maskMobile = (mobile) => `${mobile.slice(0, 2)}****${mobile.slice(-4)}`;

const getPlayIntegrityClient = async () => {
  if (playIntegrityClient) {
    return playIntegrityClient;
  }

  const scopes = ["https://www.googleapis.com/auth/playintegrity"];
  const authOptions = { scopes };

  if (env.playIntegrityServiceAccountJson) {
    const credentials = JSON.parse(env.playIntegrityServiceAccountJson);
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }
    authOptions.credentials = credentials;
  } else if (env.firebaseAdminProjectId && env.firebaseAdminClientEmail && env.firebaseAdminPrivateKey) {
    authOptions.credentials = {
      project_id: env.firebaseAdminProjectId,
      client_email: env.firebaseAdminClientEmail,
      private_key: env.firebaseAdminPrivateKey.replace(/\\n/g, "\n")
    };
  }

  const auth = new google.auth.GoogleAuth(authOptions);
  const authClient = await auth.getClient();
  playIntegrityClient = google.playintegrity({ version: "v1", auth: authClient });

  return playIntegrityClient;
};

const decodePlayIntegrityToken = async ({ integrityToken }) => {
  const client = await getPlayIntegrityClient();
  const response = await client.v1.decodeIntegrityToken({
    packageName: env.playIntegrityPackageName,
    requestBody: { integrityToken }
  });

  return response.data?.tokenPayloadExternal || {};
};

const getPlayIntegritySummary = (verdict = {}) => {
  const requestDetails = verdict.requestDetails || {};
  const appIntegrity = verdict.appIntegrity || {};
  const deviceIntegrity = verdict.deviceIntegrity || {};
  const accountDetails = verdict.accountDetails || {};
  const environmentDetails = verdict.environmentDetails || {};

  return {
    requestHash: requestDetails.requestHash || requestDetails.nonce,
    packageName: requestDetails.requestPackageName,
    timestampMillis: requestDetails.timestampMillis,
    appIntegrity: appIntegrity.appRecognitionVerdict,
    deviceIntegrity: deviceIntegrity.deviceRecognitionVerdict || [],
    appLicensingVerdict: accountDetails.appLicensingVerdict,
    playProtectVerdict: environmentDetails.playProtectVerdict,
    appAccessRiskVerdict: environmentDetails.appAccessRiskVerdict
  };
};

const hasRequiredDeviceIntegrity = (deviceIntegrity = []) => {
  const required = env.playIntegrityRequiredDeviceVerdict || "MEETS_DEVICE_INTEGRITY";
  return deviceIntegrity.includes(required) || deviceIntegrity.includes("MEETS_STRONG_INTEGRITY");
};

const hasHighRiskLocalSignal = (localSignals = {}) => {
  return Boolean(
    localSignals.debuggable ||
      localSignals.isRooted ||
      localSignals.isTampered ||
      localSignals.rootIndicators?.length ||
      localSignals.hookingIndicators?.length
  );
};

const isPlayIntegrityTimestampValid = (timestampMillis) => {
  if (!timestampMillis) return false;
  const timestamp = Number(timestampMillis);
  if (!Number.isFinite(timestamp)) return false;
  const ageMs = Math.abs(Date.now() - timestamp);
  return ageMs <= env.playIntegrityChallengeTtlSeconds * 1000;
};

const evaluatePlayIntegrityVerdict = ({ challenge, summary, localSignals = {} }) => {
  if (summary.requestHash !== challenge.requestHash) {
    return { decision: "block", integrityStatus: "failed", reasonCode: "REQUEST_HASH_MISMATCH" };
  }

  if (summary.packageName !== env.playIntegrityPackageName) {
    return { decision: "block", integrityStatus: "failed", reasonCode: "PACKAGE_NAME_MISMATCH" };
  }

  if (!isPlayIntegrityTimestampValid(summary.timestampMillis)) {
    return { decision: "retry", integrityStatus: "temporary_failure", reasonCode: "TOKEN_TIMESTAMP_INVALID" };
  }

  if (env.playIntegrityRequirePlayRecognizedApp && summary.appIntegrity !== "PLAY_RECOGNIZED") {
    return { decision: "manual_review", integrityStatus: "failed", reasonCode: "APP_INTEGRITY_UNRECOGNIZED" };
  }

  if (!hasRequiredDeviceIntegrity(summary.deviceIntegrity)) {
    return { decision: "block", integrityStatus: "failed", reasonCode: "DEVICE_INTEGRITY_FAILED" };
  }

  if (hasHighRiskLocalSignal(localSignals)) {
    return { decision: "block", integrityStatus: "failed", reasonCode: "HIGH_RISK_LOCAL_SIGNAL" };
  }

  return { decision: "allow", integrityStatus: "passed" };
};

const applyObserveModeDecision = (decision) => {
  // DEVICE_INTEGRITY_MODE=observe records failed verdicts but lets the app continue;
  // DEVICE_INTEGRITY_MODE=enforce returns the real block/retry/manual_review decision.
  if (["enforce", "enforcement"].includes(env.deviceIntegrityMode) || decision.decision === "allow") {
    return decision;
  }

  return {
    decision: "allow",
    integrityStatus: "observed_failure",
    reasonCode: decision.reasonCode,
    observedDecision: decision.decision
  };
};

const sendIntegrityDecision = (res, statusCode, success, message, data) => {
  return res.status(statusCode).json({
    success,
    message,
    data
  });
};

const RISK_INTEGRITY_ACTIONS = new Set([
  DEVICE_INTEGRITY_ACTIONS.APP_STARTUP,
  DEVICE_INTEGRITY_ACTIONS.DAILY_HEARTBEAT,
  DEVICE_INTEGRITY_ACTIONS.BEFORE_POLICY_SYNC,
  DEVICE_INTEGRITY_ACTIONS.BEFORE_UNLOCK,
  DEVICE_INTEGRITY_ACTIONS.SUSPICIOUS_SIGNAL,
  DEVICE_INTEGRITY_ACTIONS.ADMIN_RECHECK,
  DEVICE_INTEGRITY_ACTIONS.APP_FOREGROUND,
  DEVICE_INTEGRITY_ACTIONS.BOOT_COMPLETED,
  DEVICE_INTEGRITY_ACTIONS.REMEDIATION_RECHECK
]);

const RISK_SEVERITIES = ["low", "medium", "high", "critical"];

const getDeviceSyncState = async (device) => {
  const [policy, pendingCommands] = await Promise.all([
    DevicePolicy.findOne({ tenantId: device.tenantId, policyKey: device.currentPolicyKey, isActive: true }).lean(),
    DeviceCommand.find({ deviceId: device._id, status: { $in: ["pending", "sent"] } }).sort({ createdAt: 1 }).lean()
  ]);

  const latestSecurityCommands = selectLatestActiveSecurityControlCommands(
    pendingCommands
  );
  const latestSecurityCommandIds = new Set(
    latestSecurityCommands.map((command) => String(command._id))
  );
  const syncCommands = pendingCommands.filter((command) => {
    if (!getDeviceSecurityControlByCommandType(command.commandType)) return true;
    return latestSecurityCommandIds.has(String(command._id));
  });
  const newlyDeliveredCommandIds = latestSecurityCommands
    .filter((command) => command.status === "pending")
    .map((command) => command._id);
  if (newlyDeliveredCommandIds.length > 0) {
    await DeviceCommand.updateMany(
      { _id: { $in: newlyDeliveredCommandIds }, status: "pending" },
      { $set: { status: "sent", sentAt: new Date() } }
    );
  }

  return {
    deviceState: device.state,
    currentPolicyKey: device.currentPolicyKey,
    desiredPolicyVersion: device.desiredPolicyVersion,
    restrictionState: normalizeDeviceRestrictionState(device.restrictionState),
    securityControlState: normalizeDeviceSecurityControlState(device.securityControlState),
    policy,
    pendingCommands: syncCommands.map((command) => {
      if (getDeviceSecurityControlByCommandType(command.commandType)) {
        return {
          commandId: command._id,
          commandType: command.commandType,
          controlVersion: Number(command.payload?.controlVersion),
          blocked: parseSecurityControlBlockedValue(command.payload?.blocked),
          createdAt: command.createdAt
        };
      }

      return {
        ...command,
        commandId: command._id
      };
    })
  };
};

/**
 * Generate a user-app access token for local testing.
 * Sample body: { "userId": "665f..." } OR { "mobile": "9876543210" } OR { "loanId": "LOAN-001" }
 */
export const generateTestUserAccessToken = async (req, res) => {
  try {
    // if (env.nodeEnv === "production") {
    //   return sendError(res, 404, "Route not found");
    // }

    const { userId, mobile, loanId } = req.body;

    if (!userId && !mobile && !loanId) {
      return sendError(res, 400, "userId, mobile, or loanId is required");
    }

    const filter = userId ? { _id: userId } : mobile ? { mobile } : { loanId };
    const user = await User.findOne(filter).lean();

    if (!user || !user.isActive) {
      return sendError(res, 404, "Active user not found");
    }

    setUserRefreshCookie(res, user);

    return sendSuccess(res, 200, "Test user access token generated successfully", {
      accessToken: signUserAccessToken(user),
      tokenType: "user",
      expiresIn: env.jwtAccessExpiresIn,
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        loanId: user.loanId,
        tenantId: user.tenantId,
        consentRecordId: user.consentRecordId
      }
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const refreshUserAccessToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.[env.refreshCookieName];

    if (!refreshToken) {
      return sendError(res, 401, "Refresh token is required");
    }

    const payload = jwt.verify(refreshToken, env.jwtRefreshSecret);

    if (!payload?.id || payload.tokenType !== "user") {
      return sendError(res, 401, "Invalid refresh token");
    }

    const user = await User.findById(payload.id).lean();

    if (!user || !user.isActive) {
      return sendError(res, 401, "Invalid refresh token");
    }

    return sendSuccess(res, 200, "Access token refreshed successfully", {
      accessToken: signUserAccessToken(user),
      tokenType: "user",
      expiresIn: env.jwtAccessExpiresIn
    });
  } catch (error) {
    res.clearCookie(env.refreshCookieName, getUserRefreshCookieOptions());
    return sendError(res, 401, "Invalid or expired refresh token");
  }
};

/**
 * Fetch current consent terms.
 * Sample request: GET /app/consent/terms
 */
export const getConsentTerms = async (req, res) => {
  try {
    const consentVersion = await ConsentVersion.findOne({ isCurrent: true }).lean();

    if (!consentVersion) {
      return sendError(res, 400, "Active consent version not found");
    }

    return sendSuccess(res, 200, "Consent terms fetched successfully", consentVersion);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Initiate OTP and let the backend decide the caller's onboarding branch.
 * Sample body: { "mobile": "9876543210", "enrollmentToken": "optional" }
 */
export const initiateConsentOtp = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["mobile"])) {
      return sendError(res, 400, "Mobile is required");
    }
    // console.log("[initiateConsentOtp] Request body", { body: req.body });
    const { mobile, enrollmentToken: enrollmentTokenValue } = req.body;
    let enrollmentToken = null;

    if (enrollmentTokenValue) {
      enrollmentToken = await EnrollmentToken.findOne({
        token: enrollmentTokenValue,
        consumedAt: null,
        cancelledAt: null,
        expiresAt: { $gt: new Date() }
      });
    }

    if (enrollmentToken) {
      const user = await User.findById(enrollmentToken.userId);

      if (!user || !user.isActive) {
        return sendError(res, 400, "Active user not found");
      }

      const tenant = await Tenant.findById(user.tenantId).lean();
      const isAdhaarVerificationEnabled = tenant?.isAdhaarVerificationEnabled === true;

      if (!user.consentRecordId) {
        if (isAdhaarVerificationEnabled && !isMobileMatch(user, mobile)) {
          return sendError(res, 400, "Aadhaar Mobile does not match registered borrower");
        }

        if (!isAdhaarVerificationEnabled && mobile !== user.mobile) {
          return sendError(res, 400, "Mobile does not match registered borrower");
        }

        const consentVersion = await ConsentVersion.findOne({ isCurrent: true }).lean();

        if (!consentVersion) {
          return sendError(res, 400, "Active consent version not found");
        }

        const consentOtpPurpose = isAdhaarVerificationEnabled ? OTP_PURPOSES.AADHAAR_CONSENT : OTP_PURPOSES.CONSENT;
        const otp = await sendOtp({
          mobile,
          purpose: consentOtpPurpose,
          user,
          enrollmentToken,
          flowType: FLOW_TYPES.ONBOARDING_CONSENT
        });

        await createAuditLog({
          eventType: AUDIT_EVENTS.CONSENT_OTP_INITIATED,
          actorId: user._id,
          actorCollection: "users",
          tenantId: user.tenantId,
          userId: user._id,
          metadata: {
            verificationSessionId: otp.verificationSessionId,
            providerReferenceId: otp.providerReferenceId,
            flowType: FLOW_TYPES.ONBOARDING_CONSENT,
            isAdhaarVerificationEnabled
          }
        });

        return sendSuccess(res, 200, "OTP sent successfully", {
          verificationSessionId: otp.verificationSessionId,
          otpSent: true,
          flowType: FLOW_TYPES.ONBOARDING_CONSENT,
          nextStep: NEXT_STEPS.VERIFY_OTP,
          maskedMobile: maskMobile(mobile),
          expiresInSeconds: otp.expiresInSeconds,
          retryAfterSeconds: otp.retryAfterSeconds
        });
      }

      if (!user.isDeviceLinked) {
        if (!isMobileMatch(user, mobile)) {
          return sendError(res, 400, "Mobile does not match registered borrower");
        }

        const otp = await sendOtp({
          mobile,
          purpose: OTP_PURPOSES.ONBOARDING_RESUME,
          user,
          enrollmentToken,
          flowType: FLOW_TYPES.ONBOARDING_RESUME
        });

        return sendSuccess(res, 200, "OTP sent successfully", {
          verificationSessionId: otp.verificationSessionId,
          otpSent: true,
          flowType: FLOW_TYPES.ONBOARDING_RESUME,
          nextStep: NEXT_STEPS.VERIFY_OTP,
          maskedMobile: maskMobile(mobile),
          expiresInSeconds: otp.expiresInSeconds,
          retryAfterSeconds: otp.retryAfterSeconds
        });
      }
    }

    const user = await User.findOne({ mobile, isActive: true });
    // console.log("[initiateConsentOtp] User lookup by mobile", { mobile, userId: user?._id,user: user});
    if (!user || !user.isDeviceLinked) {
      return sendError(res, 400, "Valid enrollment token or registered linked device is required");
    }

    const otp = await sendOtp({
      mobile,
      purpose: OTP_PURPOSES.DEVICE_LOGIN,
      user,
      flowType: FLOW_TYPES.DEVICE_LOGIN
    });

    return sendSuccess(res, 200, "OTP sent successfully", {
      verificationSessionId: otp.verificationSessionId,
      otpSent: true,
      flowType: FLOW_TYPES.DEVICE_LOGIN,
      nextStep: NEXT_STEPS.VERIFY_OTP,
      maskedMobile: maskMobile(mobile),
      expiresInSeconds: otp.expiresInSeconds,
      retryAfterSeconds: otp.retryAfterSeconds
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Resend an existing borrower OTP session.
 * Sample body: { "mobile": "9876543210", "verificationSessionId": "otp_..." }
 */
export const resendConsentOtp = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["mobile", "verificationSessionId"])) {
      return sendError(res, 400, "Mobile and verification session are required");
    }

    const otpRecord = await OtpRecord.findOne({
      mobile: req.body.mobile,
      verificationSessionId: req.body.verificationSessionId,
      verified: false,
      purpose: {
        $in: [
          OTP_PURPOSES.CONSENT,
          OTP_PURPOSES.AADHAAR_CONSENT,
          OTP_PURPOSES.ONBOARDING_RESUME,
          OTP_PURPOSES.DEVICE_LOGIN
        ]
      },
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return sendError(res, 400, "Valid OTP session not found");
    }

    const otp = await resendOtp({ otpRecord, retryType: req.body.retryType });

    return sendSuccess(res, 200, "OTP resent successfully", {
      verificationSessionId: otpRecord.verificationSessionId,
      otpSent: true,
      maskedMobile: maskMobile(req.body.mobile),
      expiresInSeconds: otp.expiresInSeconds,
      retryAfterSeconds: otp.retryAfterSeconds
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
      error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : null
    );
  }
};

/**
 * Verify OTP and return the next app step.
 * Sample body: { "mobile": "9876543210", "verificationSessionId": "otp_...", "otp": "123456", "enrollmentToken": "optional" }
 */
export const verifyConsentOtp = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["mobile", "verificationSessionId", "otp"])) {
      return sendError(res, 400, "Mobile, verification session, and OTP are required");
    }

    const otpRecord = await OtpRecord.findOne({
      mobile: req.body.mobile,
      verificationSessionId: req.body.verificationSessionId,
      verified: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return sendError(res, 400, "Valid OTP session not found");
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      return sendError(res, 400, "Maximum OTP attempts exceeded");
    }

    otpRecord.attempts += 1;
    const otpMatches = await verifyOtpCode({ otpRecord, otp: req.body.otp });

    if (!otpMatches) {
      await otpRecord.save();
      return sendError(res, 400, "Invalid OTP");
    }

    const user = await User.findById(otpRecord.userId);

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    if (otpRecord.purpose === OTP_PURPOSES.CONSENT && req.body.mobile !== user.mobile) {
      return sendError(res, 400, "Mobile does not match registered borrower");
    }

    if (otpRecord.purpose !== OTP_PURPOSES.CONSENT && !isMobileMatch(user, req.body.mobile)) {
      return sendError(res, 400, "Mobile does not match registered borrower");
    }

    if ([OTP_PURPOSES.CONSENT, OTP_PURPOSES.AADHAAR_CONSENT, OTP_PURPOSES.ONBOARDING_RESUME].includes(otpRecord.purpose)) {
      const enrollmentToken = await EnrollmentToken.findOne({
        _id: otpRecord.enrollmentTokenId,
        consumedAt: null,
        cancelledAt: null,
        expiresAt: { $gt: new Date() }
      });

      if (!enrollmentToken || enrollmentToken.token !== req.body.enrollmentToken) {
        return sendError(res, 400, "Valid enrollment token not found");
      }
    }

    const verifiedProfile =
      otpRecord.purpose === OTP_PURPOSES.AADHAAR_CONSENT ? buildMockCashfreeProfile(user) : buildMobileOtpVerifiedProfile(user);

    if (otpRecord.purpose === OTP_PURPOSES.AADHAAR_CONSENT && normalizeName(verifiedProfile.name) !== normalizeName(user.name)) {
      return sendError(res, 400, "Aadhaar name does not match registered borrower name");
    }

    otpRecord.verified = true;
    otpRecord.providerResponse = {
      ...(otpRecord.providerResponse || {}),
      status: "VERIFIED",
      verifiedProfile
    };
    await otpRecord.save();

    const accessToken = signUserAccessToken(user);
    setUserRefreshCookie(res, user);
    const userPayload = {
      id: user._id,
      name: user.name,
      mobile: user.mobile,
      tenantId: user.tenantId,
      consentRecordId: user.consentRecordId,
      isDeviceLinked: user.isDeviceLinked,
      linkedDeviceId: user.linkedDeviceId
    };

    if ([OTP_PURPOSES.CONSENT, OTP_PURPOSES.AADHAAR_CONSENT].includes(otpRecord.purpose)) {
      return sendSuccess(res, 200, "OTP verified successfully", {
        accessToken,
        tokenType: "user",
        flowType: FLOW_TYPES.ONBOARDING_CONSENT,
        nextStep: NEXT_STEPS.SHOW_CONSENT,
        user: userPayload
      });
    }

    if (otpRecord.purpose === OTP_PURPOSES.ONBOARDING_RESUME) {
      return sendSuccess(res, 200, "OTP verified successfully", {
        accessToken,
        tokenType: "user",
        flowType: FLOW_TYPES.ONBOARDING_RESUME,
        nextStep: NEXT_STEPS.REGISTER_DEVICE,
        user: userPayload
      });
    }

    if (otpRecord.purpose !== OTP_PURPOSES.DEVICE_LOGIN) {
      return sendError(res, 400, "Unsupported OTP purpose");
    }

    const device = await Device.findOne({ userId: user._id });

    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    device.lastSeenAt = new Date();
    device.lastSyncAt = new Date();
    device.isOnline = true;
    await device.save();

    await DeviceEvent.create({
      deviceId: device._id,
      userId: user._id,
      tenantId: device.tenantId,
      eventType: "sync",
      payload: {
        source: "device_login",
        verificationSessionId: otpRecord.verificationSessionId
      }
    });

    return sendSuccess(res, 200, "OTP verified successfully", {
      accessToken,
      tokenType: "user",
      flowType: FLOW_TYPES.DEVICE_LOGIN,
      nextStep: NEXT_STEPS.SYNC_DEVICE,
      user: userPayload,
      device: {
        deviceId: device._id,
        state: device.state,
        currentPolicyKey: device.currentPolicyKey,
        desiredPolicyVersion: device.desiredPolicyVersion,
        lastAppliedPolicyVersion: device.lastAppliedPolicyVersion,
        tempUnlockExpiresAt: device.tempUnlockExpiresAt
      },
      ...(await getDeviceSyncState(device))
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create a short-lived Play Integrity challenge for the authenticated app session.
 * Sample body: { "action": "ONBOARDING_PRE_REGISTRATION", "enrollmentToken": "optional", "deviceContext": {} }
 */
export const createIntegrityChallenge = async (req, res) => {
  try {
    const action = req.body.action || DEVICE_INTEGRITY_ACTIONS.ONBOARDING_PRE_REGISTRATION;

    if (!Object.values(DEVICE_INTEGRITY_ACTIONS).includes(action)) {
      return sendError(res, 400, "Valid integrity action is required");
    }

    const user = await User.findById(req.auth.id);

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    if (req.body.mobile && !isMobileMatch(user, req.body.mobile)) {
      return sendError(res, 400, "Mobile does not match registered borrower");
    }

    let enrollmentToken = null;
    if (req.body.enrollmentToken) {
      enrollmentToken = await EnrollmentToken.findOne({
        token: req.body.enrollmentToken,
        userId: user._id,
        consumedAt: null,
        cancelledAt: null,
        expiresAt: { $gt: new Date() }
      });

      if (!enrollmentToken) {
        return sendError(res, 400, "Valid enrollment token not found");
      }
    }

    const now = new Date();
    const nonce = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(now.getTime() + env.playIntegrityChallengeTtlSeconds * 1000);
    const requestHash = createRequestHash({
      nonce,
      userId: user._id.toString(),
      tenantId: user.tenantId.toString(),
      enrollmentTokenId: enrollmentToken?._id?.toString() || null,
      action,
      issuedAt: now.toISOString()
    });

    const challenge = await DeviceIntegrityChallenge.create({
      userId: user._id,
      tenantId: user.tenantId,
      enrollmentTokenId: enrollmentToken?._id,
      action,
      requestHash,
      nonce,
      deviceContext: req.body.deviceContext || {},
      expiresAt
    });

    return sendSuccess(res, 200, "Integrity challenge created successfully", {
      challengeId: challenge._id,
      requestHash: challenge.requestHash,
      expiresAt: challenge.expiresAt,
      action: challenge.action
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create a Play Integrity challenge for app-owned recurring risk checks.
 * This endpoint is not for onboarding and never returns an onboarding decision.
 */
export const createRiskIntegrityChallenge = async (req, res) => {
  try {
    const action = req.body.action || DEVICE_INTEGRITY_ACTIONS.APP_STARTUP;

    if (!RISK_INTEGRITY_ACTIONS.has(action)) {
      return sendError(res, 400, "Valid risk integrity action is required");
    }

    const user = await User.findById(req.auth.id);

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    const device = await Device.findOne({ userId: user._id, tenantId: user.tenantId }).lean();
    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const now = new Date();
    const nonce = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(now.getTime() + env.playIntegrityChallengeTtlSeconds * 1000);
    const requestHash = createRequestHash({
      nonce,
      userId: user._id.toString(),
      tenantId: user.tenantId.toString(),
      deviceId: device._id.toString(),
      action,
      flow: "risk_check",
      issuedAt: now.toISOString()
    });

    const challenge = await DeviceIntegrityChallenge.create({
      userId: user._id,
      tenantId: user.tenantId,
      action,
      requestHash,
      nonce,
      deviceContext: {
        ...(req.body.deviceContext || {}),
        deviceId: device._id,
        flow: "risk_check"
      },
      expiresAt
    });

    return sendSuccess(res, 200, "Risk integrity challenge created successfully", {
      status: "challenge_created",
      challengeId: challenge._id,
      requestHash: challenge.requestHash,
      expiresAt: challenge.expiresAt,
      action: challenge.action
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Verify Play Integrity token for a previously issued challenge.
 * Sample body: { "challengeId": "665f...", "integrityToken": "...", "action": "ONBOARDING_PRE_REGISTRATION", "localSignals": {} }
 */
export const verifyIntegrity = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["challengeId", "integrityToken", "action"])) {
      console.error("[verifyIntegrity] Missing required fields", { body: req.body });
      return sendError(res, 400, "Challenge ID, integrity token, and action are required");
    }

    if (!mongoose.isValidObjectId(req.body.challengeId)) {
      console.error("[verifyIntegrity] Invalid challenge ID", { challengeId: req.body.challengeId });
      return sendError(res, 400, "Valid challenge ID is required");
    }

    if (!Object.values(DEVICE_INTEGRITY_ACTIONS).includes(req.body.action)) {
      console.error("[verifyIntegrity] Invalid integrity action", { action: req.body.action });
      return sendError(res, 400, "Valid integrity action is required");
    }

    const challenge = await DeviceIntegrityChallenge.findOne({
      _id: req.body.challengeId,
      userId: req.auth.id,
      action: req.body.action
    });

    if (!challenge) {
      console.error("[verifyIntegrity] Valid integrity challenge not found", { challengeId: req.body.challengeId, userId: req.auth.id, action: req.body.action });
      return sendError(res, 400, "Valid integrity challenge not found");
    }

    if (challenge.deviceContext?.flow === "risk_check") {
      return sendError(res, 400, "Use risk integrity verify for risk-check challenges");
    }

    if (challenge.consumedAt) {
      console.error("[verifyIntegrity] Integrity challenge has already been used", { challengeId: challenge._id });
      return sendError(res, 400, "Integrity challenge has already been used");
    }

    if (new Date(challenge.expiresAt) <= new Date()) {
      challenge.integrityStatus = "temporary_failure";
      challenge.reasonCode = "CHALLENGE_EXPIRED";
      await challenge.save();
      return sendIntegrityDecision(res, 400, false, "Integrity challenge expired. Please retry.", {
        decision: "retry",
        integrityStatus: "temporary_failure",
        reasonCode: "CHALLENGE_EXPIRED",
        retryAfterSeconds: 0
      });
    }

    const localSignals = req.body.localSignals || {};
    const device = await Device.findOne({ userId: req.auth.id });
    const enforcementEnabled = ["enforce", "enforcement"].includes(env.deviceIntegrityMode);
    let verdict;

    try {
      verdict = await decodePlayIntegrityToken({ integrityToken: req.body.integrityToken });
    } catch (error) {
      console.error("Play Integrity verification failed", {
        challengeId: challenge._id,
        userId: challenge.userId,
        action: challenge.action,
        status: error.status,
        code: error.code,
        message: error.message
      });

      const retryDecision = {
        decision: "retry",
        integrityStatus: "temporary_failure",
        reasonCode: "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE"
      };
      const finalDecision = applyObserveModeDecision(retryDecision);

      challenge.decision = finalDecision.decision;
      challenge.integrityStatus = finalDecision.integrityStatus;
      challenge.reasonCode = finalDecision.reasonCode;
      challenge.verifiedAt = new Date();
      challenge.verificationSummary = {
        mode: env.deviceIntegrityMode,
        observedDecision: finalDecision.observedDecision,
        providerError: {
          status: error.status,
          code: error.code,
          message: error.message
        },
        localSignals
      };

      if (!["enforce", "enforcement"].includes(env.deviceIntegrityMode)) {
        challenge.consumedAt = new Date();
        await challenge.save();
        const assessment = await recordIntegrityAssessment({
          challenge,
          device,
          finalDecision,
          localSignals,
          providerError: {
            status: error.status,
            code: error.code,
            message: error.message
          }
        });
        return sendSuccess(res, 200, "Device integrity observed successfully", {
          decision: "allow",
          integrityStatus: finalDecision.integrityStatus,
          reasonCode: finalDecision.reasonCode,
          nextStep: NEXT_STEPS.SHOW_CONSENT,
          integrityCheckId: assessment.integrityCheck._id,
          riskFlagIds: assessment.riskFlags.map((flag) => flag._id)
        });
      }

      await challenge.save();
      const assessment = await recordIntegrityAssessment({
        challenge,
        device,
        finalDecision,
        localSignals,
        providerError: {
          status: error.status,
          code: error.code,
          message: error.message
        }
      });
      return sendIntegrityDecision(res, 503, false, "Unable to verify device security. Please try again.", {
        decision: "retry",
        integrityStatus: "temporary_failure",
        reasonCode: retryDecision.reasonCode,
        retryAfterSeconds: 30,
        integrityCheckId: assessment.integrityCheck._id,
        riskFlagIds: assessment.riskFlags.map((flag) => flag._id)
      });
    }

    const summary = getPlayIntegritySummary(verdict);
    const evaluatedDecision = evaluatePlayIntegrityVerdict({ challenge, summary, localSignals });
    const finalDecision = applyObserveModeDecision(evaluatedDecision);
    const verifiedAt = new Date();

    challenge.consumedAt = verifiedAt;
    challenge.verifiedAt = verifiedAt;
    challenge.decision = finalDecision.decision;
    challenge.integrityStatus = finalDecision.integrityStatus;
    challenge.reasonCode = finalDecision.reasonCode;
    challenge.verificationSummary = {
      mode: env.deviceIntegrityMode,
      observedDecision: finalDecision.observedDecision,
      requiredLevel: env.playIntegrityRequiredDeviceVerdict,
      packageName: summary.packageName,
      requestHashMatched: summary.requestHash === challenge.requestHash,
      appIntegrity: summary.appIntegrity,
      deviceIntegrity: summary.deviceIntegrity,
      appLicensingVerdict: summary.appLicensingVerdict,
      localSignals
    };
    await challenge.save();

    const assessment = await recordIntegrityAssessment({
      challenge,
      device,
      summary,
      finalDecision,
      localSignals,
      rawVerdictSafeSnapshot: {
        requestDetails: verdict.requestDetails,
        appIntegrity: verdict.appIntegrity,
        deviceIntegrity: verdict.deviceIntegrity,
        accountDetails: verdict.accountDetails
      }
    });
    const autoLocks = [];

    if (device && enforcementEnabled) {
      for (const riskFlag of assessment.riskFlags) {
        const autoLock = await enforceRiskAutoLock({
          device,
          riskFlag,
          eventType: riskFlag.type,
          severity: riskFlag.severity,
          enforce: enforcementEnabled
        });
        autoLocks.push({
          riskFlagId: riskFlag._id,
          ...autoLock
        });
      }
    }

    if (finalDecision.decision === "allow") {
      return sendSuccess(res, 200, "Device integrity verified successfully", {
        decision: "allow",
        integrityStatus: finalDecision.integrityStatus,
        reasonCode: finalDecision.reasonCode,
        requiredLevel: env.playIntegrityRequiredDeviceVerdict,
        deviceIntegrity: summary.deviceIntegrity,
        appIntegrity: summary.appIntegrity,
        verifiedAt,
        nextStep: NEXT_STEPS.SHOW_CONSENT,
        integrityCheckId: assessment.integrityCheck._id,
        riskFlagIds: assessment.riskFlags.map((flag) => flag._id),
        autoLocks
      });
    }

    if (finalDecision.decision === "retry") {
      console.error("[verifyIntegrity] Retry decision issued", { challengeId: challenge._id });
      return sendIntegrityDecision(res, 400, false, "Unable to verify device security. Please try again.", {
        decision: "retry",
        integrityStatus: finalDecision.integrityStatus,
        reasonCode: finalDecision.reasonCode,
        retryAfterSeconds: 30,
        integrityCheckId: assessment.integrityCheck._id,
        riskFlagIds: assessment.riskFlags.map((flag) => flag._id),
        autoLocks
      });
    }
    console.error("[verifyIntegrity] Device integrity verification failed", { challengeId: challenge._id });
    return sendIntegrityDecision(res, 400, false, "Device security verification failed. Please contact support.", {
      decision: finalDecision.decision,
      integrityStatus: finalDecision.integrityStatus,
      reasonCode: finalDecision.reasonCode,
      nextStep: "DEVICE_INTEGRITY_FAILED",
      integrityCheckId: assessment.integrityCheck._id,
      riskFlagIds: assessment.riskFlags.map((flag) => flag._id),
      autoLocks
    });
  } catch (error) {
    console.error("[verifyIntegrity] Internal server error", { error });
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Verify Play Integrity for app-owned recurring risk checks.
 * This endpoint records backend risk state and queues commands; the app must act from sync/FCM commands, not this response.
 */
export const verifyRiskIntegrity = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["challengeId", "integrityToken", "action"])) {
      return sendError(res, 400, "Challenge ID, integrity token, and action are required");
    }

    if (!mongoose.isValidObjectId(req.body.challengeId)) {
      return sendError(res, 400, "Valid challenge ID is required");
    }

    if (!RISK_INTEGRITY_ACTIONS.has(req.body.action)) {
      return sendError(res, 400, "Valid risk integrity action is required");
    }

    const challenge = await DeviceIntegrityChallenge.findOne({
      _id: req.body.challengeId,
      userId: req.auth.id,
      action: req.body.action
    });

    if (!challenge) {
      return sendError(res, 400, "Valid risk integrity challenge not found");
    }

    if (challenge.deviceContext?.flow !== "risk_check") {
      return sendError(res, 400, "Risk integrity verify requires a risk-check challenge");
    }

    if (challenge.consumedAt) {
      return sendError(res, 400, "Risk integrity challenge has already been used");
    }

    if (new Date(challenge.expiresAt) <= new Date()) {
      challenge.integrityStatus = "temporary_failure";
      challenge.reasonCode = "CHALLENGE_EXPIRED";
      await challenge.save();
      return sendSuccess(res, 200, "Risk integrity challenge expired. Please retry with a fresh challenge.", {
        status: "retry_required",
        reasonCode: "CHALLENGE_EXPIRED",
        syncRecommended: false,
        commandsQueued: []
      });
    }

    const localSignals = req.body.localSignals || {};
    const device = await Device.findOne({ userId: req.auth.id });
    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const enforcementEnabled = ["enforce", "enforcement"].includes(env.deviceIntegrityMode);
    const verifiedAt = new Date();
    let verdict;

    try {
      verdict = await decodePlayIntegrityToken({ integrityToken: req.body.integrityToken });
    } catch (error) {
      console.error("Risk Play Integrity verification failed", {
        challengeId: challenge._id,
        userId: challenge.userId,
        action: challenge.action,
        status: error.status,
        code: error.code,
        message: error.message
      });

      const retryDecision = {
        decision: "retry",
        integrityStatus: "temporary_failure",
        reasonCode: "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE"
      };
      const finalDecision = applyObserveModeDecision(retryDecision);

      challenge.consumedAt = verifiedAt;
      challenge.verifiedAt = verifiedAt;
      challenge.decision = finalDecision.decision;
      challenge.integrityStatus = finalDecision.integrityStatus;
      challenge.reasonCode = finalDecision.reasonCode;
      challenge.verificationSummary = {
        mode: env.deviceIntegrityMode,
        flow: "risk_check",
        observedDecision: finalDecision.observedDecision,
        providerError: {
          status: error.status,
          code: error.code,
          message: error.message
        },
        localSignals
      };
      await challenge.save();

      const assessment = await recordIntegrityAssessment({
        challenge,
        device,
        finalDecision,
        localSignals,
        providerError: {
          status: error.status,
          code: error.code,
          message: error.message
        }
      });

      return sendSuccess(res, 200, "Risk integrity result recorded", {
        status: "recorded",
        integrityCheckId: assessment.integrityCheck._id,
        riskFlagIds: assessment.riskFlags.map((flag) => flag._id),
        resolvedRiskIds: assessment.integrityCheck.resolvedRiskIds || [],
        commandsQueued: [],
        syncRecommended: true
      });
    }

    const summary = getPlayIntegritySummary(verdict);
    const evaluatedDecision = evaluatePlayIntegrityVerdict({ challenge, summary, localSignals });
    const finalDecision = applyObserveModeDecision(evaluatedDecision);

    challenge.consumedAt = verifiedAt;
    challenge.verifiedAt = verifiedAt;
    challenge.decision = finalDecision.decision;
    challenge.integrityStatus = finalDecision.integrityStatus;
    challenge.reasonCode = finalDecision.reasonCode;
    challenge.verificationSummary = {
      mode: env.deviceIntegrityMode,
      flow: "risk_check",
      observedDecision: finalDecision.observedDecision,
      requiredLevel: env.playIntegrityRequiredDeviceVerdict,
      packageName: summary.packageName,
      requestHashMatched: summary.requestHash === challenge.requestHash,
      appIntegrity: summary.appIntegrity,
      deviceIntegrity: summary.deviceIntegrity,
      appLicensingVerdict: summary.appLicensingVerdict,
      localSignals
    };
    await challenge.save();

    const assessment = await recordIntegrityAssessment({
      challenge,
      device,
      summary,
      finalDecision,
      localSignals,
      rawVerdictSafeSnapshot: {
        requestDetails: verdict.requestDetails,
        appIntegrity: verdict.appIntegrity,
        deviceIntegrity: verdict.deviceIntegrity,
        accountDetails: verdict.accountDetails
      }
    });

    const commandsQueued = [];

    if (enforcementEnabled) {
      for (const riskFlag of assessment.riskFlags) {
        const autoLock = await enforceRiskAutoLock({
          device,
          riskFlag,
          eventType: riskFlag.type,
          severity: riskFlag.severity,
          enforce: enforcementEnabled
        });

        if (autoLock.queued) {
          commandsQueued.push({
            commandType: "LOCK",
            commandId: autoLock.commandId,
            riskFlagId: riskFlag._id,
            source: "risk_auto_lock",
            policyKey: autoLock.policyKey,
            policyVersion: autoLock.policyVersion
          });
        }
      }
    }

    return sendSuccess(res, 200, "Risk integrity result recorded", {
      status: "recorded",
      integrityCheckId: assessment.integrityCheck._id,
      riskFlagIds: assessment.riskFlags.map((flag) => flag._id),
      resolvedRiskIds: assessment.integrityCheck.resolvedRiskIds || [],
      commandsQueued,
      syncRecommended: true
    });
  } catch (error) {
    console.error("[verifyRiskIntegrity] Internal server error", { error });
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Accept consent after OTP verification and consent-screen display.
 * Sample body: { "consentCheckboxAccepted": true, "consentVersion": "1.0" }
 */
export const acceptConsent = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!hasRequiredFields(req.body, ["consentCheckboxAccepted", "consentVersion"])) {
      return sendError(res, 400, "Consent confirmation and consent version are required");
    }

    if (req.body.consentCheckboxAccepted !== true) {
      return sendError(res, 400, "Consent checkbox must be accepted");
    }

    const user = await User.findById(req.auth.id);

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    if (user.consentRecordId) {
      setUserRefreshCookie(res, user);

      return sendSuccess(res, 200, "Consent already accepted", {
        consentRecordId: user.consentRecordId,
        consentAccepted: true,
        accessToken: signUserAccessToken(user),
        tokenType: "user",
        nextStep: user.isDeviceLinked ? NEXT_STEPS.SYNC_DEVICE : NEXT_STEPS.REGISTER_DEVICE,
        user: {
          id: user._id,
          name: user.name,
          tenantId: user.tenantId,
          consentRecordId: user.consentRecordId
        }
      });
    }

    const [consentVersion, otpRecord, enrollmentToken] = await Promise.all([
      ConsentVersion.findOne({ version: req.body.consentVersion, isCurrent: true }),
      OtpRecord.findOne({
        userId: user._id,
        purpose: { $in: [OTP_PURPOSES.CONSENT, OTP_PURPOSES.AADHAAR_CONSENT] },
        verified: true,
        expiresAt: { $gt: new Date() }
      }).sort({ updatedAt: -1 }),
      EnrollmentToken.findOne({
        userId: user._id,
        consumedAt: null,
        cancelledAt: null,
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 })
    ]);

    if (!consentVersion) {
      return sendError(res, 400, "Current consent version does not match request");
    }

    if (!otpRecord) {
      return sendError(res, 400, "Verified OTP session not found");
    }

    if (!enrollmentToken || !otpRecord.enrollmentTokenId?.equals(enrollmentToken._id)) {
      return sendError(res, 400, "Valid enrollment token not found");
    }

    const isAdhaarConsent = otpRecord.purpose === OTP_PURPOSES.AADHAAR_CONSENT;
    const verifiedProfile =
      otpRecord.providerResponse?.verifiedProfile ||
      (isAdhaarConsent ? buildMockCashfreeProfile(user) : buildMobileOtpVerifiedProfile(user));
    const aadhaarVerificationRef = isAdhaarConsent
      ? `cashfree_mock_verified_${crypto.randomBytes(10).toString("hex")}`
      : `mobile_otp_verified_${crypto.randomBytes(10).toString("hex")}`;
    const consentPayload = {
      userId: user._id,
      tenantId: user.tenantId,
      consentVersionId: consentVersion._id,
      consentVersion: consentVersion.version,
      enrollmentTokenId: enrollmentToken._id,
      aadhaarVerificationRef,
      verificationSessionId: otpRecord.verificationSessionId,
      consentCheckboxAccepted: true,
      verifiedProfile
    };

    session.startTransaction();

    const consentRecords = await ConsentRecord.create(
      [
        {
          ...consentPayload,
          ipAddress: req.ip,
          deviceFingerprint: req.headers["x-device-fingerprint"],
          payloadHash: hashPayload(consentPayload)
        }
      ],
      { session, ordered: true }
    );
    const consentRecord = consentRecords[0];

    user.aadhaarVerified = isAdhaarConsent;
    user.consentRecordId = consentRecord._id;
    await user.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.CONSENT_RECORDED,
        actorId: user._id,
        actorCollection: "users",
        tenantId: user.tenantId,
        userId: user._id,
        metadata: {
          consentRecordId: consentRecord._id,
          consentVersion: consentVersion.version,
          aadhaarVerificationRef,
          isAdhaarVerificationEnabled: isAdhaarConsent
        }
      },
      { session }
    );

    await session.commitTransaction();

    setUserRefreshCookie(res, user);

    return sendSuccess(res, 201, "Consent accepted successfully", {
      consentRecordId: consentRecord._id,
      consentAccepted: true,
      accessToken: signUserAccessToken(user),
      tokenType: "user",
      nextStep: NEXT_STEPS.REGISTER_DEVICE,
      user: {
        id: user._id,
        name: user.name,
        tenantId: user.tenantId,
        consentRecordId: consentRecord._id
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
 * Register borrower device after consent.
 * Sample body: { "imei": "123456789012345", "deviceModel": "Samsung A15", "manufacturer": "Samsung", "androidVersion": "14", "appVersion": "1.0.0", "fcmToken": "..." }
 */
export const registerDevice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!hasRequiredFields(req.body, ["imei", "deviceModel", "manufacturer", "androidVersion", "appVersion", "fcmToken"])) {
      return sendError(res, 400, "Device identity and FCM token are required");
    }

    const user = await User.findById(req.auth.id);

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    if (!user.consentRecordId) {
      return sendError(res, 403, "Consent record is required before device registration");
    }

    if (user.isDeviceLinked) {
      return sendError(res, 400, "User is already linked to a device");
    }

    const activePolicy = await DevicePolicy.findOne({
      tenantId: user.tenantId,
      policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      isActive: true
    }).lean();

    if (!activePolicy) {
      return sendError(res, 400, "Active EMI_PAID policy not found for tenant");
    }

    const enrollmentToken = await EnrollmentToken.findOne({
      userId: user._id,
      tenantId: user.tenantId,
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!enrollmentToken) {
      return sendError(res, 400, "Active enrollment token not found for device registration");
    }

    session.startTransaction();

    const devices = await Device.create(
      [
        {
          userId: user._id,
          tenantId: user.tenantId,
          imei: req.body.imei,
          imei2: req.body.imei2,
          deviceModel: req.body.deviceModel,
          manufacturer: req.body.manufacturer,
          androidVersion: req.body.androidVersion,
          appVersion: req.body.appVersion,
          simInfo: req.body.simInfo,
          fcmToken: req.body.fcmToken,
          fcmTokenUpdatedAt: new Date(),
          state: DEVICE_STATES.ACTIVE,
          currentPolicyKey: DEVICE_POLICY_KEYS.EMI_PAID,
          currentPolicyId: activePolicy._id,
          desiredPolicyVersion: activePolicy.version
        }
      ],
      { session, ordered: true }
    );
    const device = devices[0];

    user.isDeviceLinked = true;
    user.linkedDeviceId = device._id;
    user.deviceLinkedAt = new Date();
    await user.save({ session });

    enrollmentToken.consumedAt = new Date();
    await enrollmentToken.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.DEVICE_REGISTERED,
        actorId: user._id,
        actorCollection: "users",
        tenantId: user.tenantId,
        userId: user._id,
        deviceId: device._id,
        metadata: {
          imei: device.imei,
          currentPolicyKey: device.currentPolicyKey,
          enrollmentTokenId: enrollmentToken._id
        }
      },
      { session }
    );

    await session.commitTransaction();

    await safeRefreshTenantMetrics(user.tenantId, { source: "device_registration", deviceId: device._id });

    try {
      await generateManualOverrideTokenForDevice(device, {
        reason: "Device registration emergency QR",
        source: "device_registration",
        supersedeExisting: false,
        metadata: {
          enrollmentTokenId: enrollmentToken._id
        }
      });
    } catch (tokenError) {
      console.error("Manual override token generation failed after device registration", {
        deviceId: device._id,
        message: tokenError.message
      });

      try {
        await createAuditLog({
          eventType: AUDIT_EVENTS.MANUAL_OVERRIDE_TOKEN_GENERATION_FAILED,
          actorId: user._id,
          actorCollection: "users",
          tenantId: user.tenantId,
          userId: user._id,
          deviceId: device._id,
          reason: "Device registration completed without manual override token",
          metadata: {
            enrollmentTokenId: enrollmentToken._id,
            message: tokenError.message
          }
        });
      } catch (auditError) {
        console.error("Manual override token failure audit could not be recorded", {
          deviceId: device._id,
          message: auditError.message
        });
      }
    }

    return sendSuccess(res, 201, "Device registered successfully", {
      deviceId: device._id,
      userId: device.userId,
      tenantId: device.tenantId,
      state: device.state,
      currentPolicyKey: device.currentPolicyKey,
      policy: activePolicy
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
 * Fetch current device policy for authenticated borrower.
 * Sample request: GET /app/device/policy
 */
export const getDevicePolicy = async (req, res) => {
  try {
    const device = await Device.findOne({ userId: req.auth.id }).lean();

    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const policy = await DevicePolicy.findOne({
      tenantId: device.tenantId,
      policyKey: device.currentPolicyKey,
      isActive: true
    }).lean();

    if (!policy) {
      return sendError(res, 400, "Active device policy not found");
    }

    return sendSuccess(res, 200, "Device policy fetched successfully", {
      deviceState: device.state,
      policyKey: policy.policyKey,
      policyVersion: policy.version,
      restrictions: policy.restrictions,
      tempUnlockExpiresAt: device.tempUnlockExpiresAt
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch borrower app dashboard summary.
 * Sample request: GET /app/dashboard
 */
export const getAppDashboard = async (req, res) => {
  try {
    const user = await User.findById(req.auth.id).lean();

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    const [schedule, device] = await Promise.all([
      EmiSchedule.findOne({ userId: user._id, tenantId: user.tenantId }).lean(),
      Device.findOne({ userId: user._id }).lean()
    ]);

    const installments = schedule?.installments || [];
    const currentDueInstallment = getCurrentDueInstallment(installments);
    const recentPaidInstallments = installments
      .filter((installment) => installment.status === "paid")
      .sort((a, b) => new Date(b.paidAt || b.dueDate || 0) - new Date(a.paidAt || a.dueDate || 0))
      .slice(0, 5)
      .map(buildInstallmentSummary);

    const response = {
      userDetails: buildUserDetails(user),
      loanDetails: buildLoanDetails(user, schedule),
      device: device
        ? {
            deviceId: device._id,
            state: device.state,
            currentPolicyKey: device.currentPolicyKey,
            desiredPolicyVersion: device.desiredPolicyVersion,
            lastSeenAt: device.lastSeenAt
          }
        : null,
      recentActivity: {
        paidInstallments: recentPaidInstallments
      }
    };

    if (currentDueInstallment) {
      response.currentEmiDue = buildInstallmentSummary(currentDueInstallment);
    }

    return sendSuccess(res, 200, "Dashboard fetched successfully", response);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch the authenticated borrower's tenant name.
 * Sample request: GET /app/utility/tenant
 */
export const getTenantUtility = async (req, res) => {
  try {
    const user = await User.findById(req.auth.id).lean();

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    const tenant = await Tenant.findById(user.tenantId).lean();

    if (!tenant || !tenant.isActive) {
      return sendError(res, 404, "Active tenant not found");
    }

    return sendSuccess(res, 200, "Tenant fetched successfully", {
      tenantId: tenant._id,
      tenantName: tenant.name
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch all installments for the authenticated borrower's loan.
 * Sample request: GET /app/installments
 */
export const getInstallments = async (req, res) => {
  try {
    const user = await User.findById(req.auth.id).lean();

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    const schedule = await EmiSchedule.findOne({ userId: user._id, tenantId: user.tenantId }).lean();

    if (!schedule) {
      return sendError(res, 404, "EMI schedule not found");
    }

    return sendSuccess(res, 200, "Installments fetched successfully", {
      loanDetails: buildLoanDetails(user, schedule),
      installments: [...schedule.installments]
        .sort((a, b) => Number(b.installmentNumber || 0) - Number(a.installmentNumber || 0))
        .map(buildInstallmentSummary)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch one borrower installment detail.
 * Sample request: GET /app/installments/665f...
 */
export const getInstallmentDetail = async (req, res) => {
  try {
    const user = await User.findById(req.auth.id).lean();

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    const schedule = await EmiSchedule.findOne({ userId: user._id, tenantId: user.tenantId }).lean();

    if (!schedule) {
      return sendError(res, 404, "EMI schedule not found");
    }

    const installment = schedule.installments.find(
      (item) => item._id.toString() === req.params.installmentId
    );

    if (!installment) {
      return sendError(res, 404, "Installment not found");
    }

    const payment = installment.paymentId
      ? await Payment.findOne({ _id: installment.paymentId, userId: user._id }).lean()
      : null;

    return sendSuccess(res, 200, "Installment fetched successfully", {
      installment: buildInstallmentSummary(installment),
      loanDetails: buildLoanDetails(user, schedule),
      payment
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch active tenant QR code for borrower payment.
 * Sample request: GET /app/payment/qr
 */
export const getPaymentQr = async (req, res) => {
  try {
    const device = await Device.findOne({ userId: req.auth.id }).lean();

    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const tenant = await Tenant.findById(device.tenantId).lean();
    const activeQrCode = tenant?.qrCodes?.find((qrCode) => qrCode.isActive);

    if (!activeQrCode) {
      return sendError(res, 404, "Payment QR is not available for this tenant");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.PAYMENT_QR_FETCHED,
      actorId: req.auth.id,
      actorCollection: "users",
      tenantId: device.tenantId,
      userId: req.auth.id,
      deviceId: device._id,
      metadata: { qrCodeId: activeQrCode._id, label: activeQrCode.label }
    });

    return sendSuccess(res, 200, "Payment QR fetched successfully", {
      qrCodeId: activeQrCode._id,
      label: activeQrCode.label,
      imageUrl: activeQrCode.imageUrl
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Submit QR payment for tenant approval.
 * JSON body: { "qrCodeId": "665f6f0b6f0f6f0b6f0f6f0b", "amount": 3500, "reference": "UPI123456" }
 * Multipart fields: qrCodeId, amount, reference, note, proofImage
 */
export const submitPayment = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["qrCodeId", "amount"])) {
      return sendError(res, 400, "QR code ID and amount are required");
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendError(res, 400, "Valid payment amount is required");
    }

    const device = await Device.findOne({ userId: req.auth.id });
    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const tenant = await Tenant.findById(device.tenantId).lean();
    const activeQrCode = tenant?.qrCodes?.find((qrCode) => qrCode._id.toString() === req.body.qrCodeId && qrCode.isActive);
    if (!activeQrCode) {
      return sendError(res, 400, "Active payment QR code not found");
    }

    const existingPendingPayment = await Payment.findOne({
      userId: req.auth.id,
      deviceId: device._id,
      approvalStatus: "pending_approval"
    }).lean();

    if (existingPendingPayment) {
      return sendError(res, 409, "A payment is already pending approval for this device");
    }

    const paymentId = new mongoose.Types.ObjectId();
    const proof = req.file
      ? await uploadPaymentProofImage({
          file: req.file,
          paymentId,
          userId: req.auth.id,
          tenantId: device.tenantId
        })
      : null;

    const payment = await Payment.create({
      _id: paymentId,
      userId: req.auth.id,
      tenantId: device.tenantId,
      deviceId: device._id,
      amount,
      qrCodeId: activeQrCode._id,
      proof,
      metadata: {
        reference: req.body.reference,
        note: req.body.note
      }
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.PAYMENT_SUBMITTED,
      actorId: req.auth.id,
      actorCollection: "users",
      tenantId: device.tenantId,
      userId: req.auth.id,
      deviceId: device._id,
      metadata: { paymentId: payment._id, amount }
    });

    await safeQueueNotification({
      audience: NOTIFICATION_AUDIENCES.TENANT,
      tenantId: device.tenantId,
      title: "New payment approval request",
      text: "A borrower payment has been submitted for review.",
      notificationType: "PAYMENT_SUBMITTED",
      data: {
        paymentId: payment._id,
        tenantId: device.tenantId,
        userId: req.auth.id,
        deviceId: device._id,
        amount,
        reference: payment.metadata?.reference || null
      }
    });

    return sendSuccess(res, 201, "Payment submitted for tenant approval", {
      paymentId: payment._id,
      status: payment.status,
      approvalStatus: payment.approvalStatus,
      proof: payment.proof
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List borrower payment history.
 * Sample request: GET /app/payment/history
 */
export const getPaymentHistory = async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.auth.id }).sort({ createdAt: -1, _id: -1 }).lean();
    return sendSuccess(res, 200, "Payment history fetched successfully", payments);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch one borrower payment.
 * Sample request: GET /app/payment/665f6f0b6f0f6f0b6f0f6f0b
 */
export const getPaymentDetail = async (req, res) => {
  try {
    const payment = await Payment.findOne({ _id: req.params.paymentId, userId: req.auth.id }).lean();

    if (!payment) {
      return sendError(res, 404, "Payment not found");
    }

    return sendSuccess(res, 200, "Payment fetched successfully", payment);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create borrower unlock request.
 * JSON body: { "reason": "Payment made but device is still locked", "reasonCategory": "payment_made", "details": "UPI ref UPI123456", "imageUrl": "https://..." }
 * Multipart fields: reason, reasonCategory, details, image
 */
export const createUnlockRequest = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["reason"])) {
      return sendError(res, 400, "Reason is required");
    }

    const device = await Device.findOne({ userId: req.auth.id }).lean();
    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const openCase = await UnlockRequest.findOne({
      userId: req.auth.id,
      deviceId: device._id,
      status: { $in: OPEN_UNLOCK_REQUEST_STATUSES }
    }).lean();

    if (openCase) {
      return sendError(res, 409, "An unlock request is already open for this device");
    }

    const tenantPolicy = await TenantPolicy.findOne({ tenantId: device.tenantId }).lean();
    const slaHours = tenantPolicy?.escalationRules?.tenantSlaHours || tenantPolicy?.escalationRules?.slaHours || 24;
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);
    const caseId = createCaseId();
    const uploadedImage = req.file
      ? await uploadUnlockRequestImage({
          file: req.file,
          caseId,
          userId: req.auth.id,
          tenantId: device.tenantId
        })
      : null;

    const unlockRequest = await UnlockRequest.create({
      caseId,
      userId: req.auth.id,
      deviceId: device._id,
      tenantId: device.tenantId,
      channelPartnerId: tenantPolicy?.channelPartnerId || (await Tenant.findById(device.tenantId).lean())?.channelPartnerId,
      reason: req.body.reason,
      reasonCategory: req.body.reasonCategory || "other",
      details: req.body.details,
      imageUrl: uploadedImage?.imageUrl || req.body.imageUrl,
      imageStoragePath: uploadedImage?.storagePath,
      imageMimeType: uploadedImage?.mimeType,
      imageSize: uploadedImage?.size,
      imageUploadedAt: uploadedImage?.uploadedAt,
      slaDeadline
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.UNLOCK_REQUEST_CREATED,
      actorId: req.auth.id,
      actorCollection: "users",
      tenantId: device.tenantId,
      userId: req.auth.id,
      deviceId: device._id,
      caseId: unlockRequest.caseId,
      reason: req.body.reason,
      metadata: { reasonCategory: unlockRequest.reasonCategory, slaDeadline }
    });

    await safeQueueNotification({
      audience: NOTIFICATION_AUDIENCES.TENANT,
      tenantId: device.tenantId,
      title: "New unlock request",
      text: `Case ${unlockRequest.caseId} needs review.`,
      notificationType: "UNLOCK_REQUEST_CREATED",
      data: {
        caseId: unlockRequest.caseId,
        unlockRequestId: unlockRequest._id,
        deviceId: device._id,
        userId: req.auth.id,
        tenantId: device.tenantId,
        reasonCategory: unlockRequest.reasonCategory,
        slaDeadline: unlockRequest.slaDeadline
      }
    });

    await safeRefreshTenantMetrics(device.tenantId, { source: "unlock_request_created", caseId: unlockRequest.caseId });

    return sendSuccess(res, 201, "Unlock request created successfully", {
      caseId: unlockRequest.caseId,
      status: unlockRequest.status,
      slaDeadline: unlockRequest.slaDeadline,
      imageUrl: unlockRequest.imageUrl
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch active borrower unlock request.
 * Sample request: GET /app/unlock-request/active
 */
export const getActiveUnlockRequest = async (req, res) => {
  try {
    const unlockRequest = await UnlockRequest.findOne({
      userId: req.auth.id,
      status: { $in: OPEN_UNLOCK_REQUEST_STATUSES }
    })
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, 200, "Active unlock request fetched successfully", unlockRequest);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List borrower unlock requests with pagination, filters, search, and sorting.
 * Sample request: GET /app/unlock-requests?statusGroup=pending&page=1&limit=20&search=CASE&sortBy=createdAt&sortOrder=desc
 */
export const listBorrowerUnlockRequests = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = { userId: req.auth.id };

    if (req.query.status) {
      filter.status = String(req.query.status).trim();
    } else if (req.query.statusGroup) {
      const statusGroup = String(req.query.statusGroup).trim().toLowerCase();
      if (statusGroup === "pending" || statusGroup === "open") {
        filter.status = { $in: OPEN_UNLOCK_REQUEST_STATUSES };
      } else if (statusGroup === "resolved") {
        filter.status = { $in: RESOLVED_UNLOCK_REQUEST_STATUSES };
      } else if (statusGroup === "rejected") {
        filter.status = { $in: REJECTED_UNLOCK_REQUEST_STATUSES };
      }
    }

    if (req.query.search) {
      const search = buildSearchRegex(req.query.search);
      filter.$or = [
        { caseId: search },
        { reason: search },
        { details: search },
        { reasonCategory: search },
        { status: search },
        { resolutionNote: search }
      ];
    }

    const sortField = ["createdAt", "updatedAt", "resolvedAt", "status"].includes(String(req.query.sortBy || ""))
      ? String(req.query.sortBy)
      : "createdAt";
    const sortOrder = String(req.query.sortOrder || "").trim().toLowerCase() === "asc" ? 1 : -1;

    const [items, total] = await Promise.all([
      UnlockRequest.find(filter)
        .sort({ [sortField]: sortOrder, createdAt: -1, _id: -1 })
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
 * Receive device heartbeat.
 * Sample body: { "batteryLevel": 79, "networkType": "wifi", "appVersion": "1.0.1", "fcmToken": "new-token" }
 */
export const pingDevice = async (req, res) => {
  try {
    const device = await Device.findOne({ userId: req.auth.id });
    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const now = new Date();
    device.lastSeenAt = now;
    device.isOnline = true;
    device.batteryLevel = req.body.batteryLevel ?? device.batteryLevel;
    device.networkType = req.body.networkType ?? device.networkType;
    device.appVersion = req.body.appVersion ?? device.appVersion;
    if (req.body.fcmToken && req.body.fcmToken !== device.fcmToken) {
      device.fcmToken = req.body.fcmToken;
      device.fcmTokenUpdatedAt = now;
    }
    const { telemetryWarnings } = applyDevicePingTelemetry({
      device,
      body: req.body,
      now
    });
    await device.save();

    await DeviceEvent.create({
      deviceId: device._id,
      userId: req.auth.id,
      tenantId: device.tenantId,
      eventType: "ping",
      payload: sanitizePingEventPayload(req.body)
    });

    const syncState = await getDeviceSyncState(device);
    return sendSuccess(res, 200, "Device ping received", {
      deviceId: device._id,
      serverTime: now,
      lastAppliedPolicyVersion: device.lastAppliedPolicyVersion,
      telemetryWarnings,
      ...syncState
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Sync device state and fetch pending commands.
 * Sample body: { "lastAppliedPolicyVersion": 3, "state": "ACTIVE", "isRooted": false, "isTampered": false }
 */
export const syncDevice = async (req, res) => {
  try {
    const device = await Device.findOne({ userId: req.auth.id });
    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    device.lastSeenAt = new Date();
    device.lastSyncAt = new Date();
    device.isOnline = true;
    device.lastAppliedPolicyVersion = req.body.lastAppliedPolicyVersion ?? device.lastAppliedPolicyVersion;
    device.isRooted = req.body.isRooted ?? device.isRooted;
    device.isTampered = req.body.isTampered ?? device.isTampered;
    await device.save();

    const syncEvent = await DeviceEvent.create({
      deviceId: device._id,
      userId: req.auth.id,
      tenantId: device.tenantId,
      eventType: "sync",
      payload: sanitizePingEventPayload(req.body)
    });

    if (req.body.manualOverride?.active || req.body.manualOverride?.tokenId) {
      await recordManualOverrideTokenUsage({
        tokenId: req.body.manualOverride?.tokenId,
        device,
        deviceEvent: syncEvent,
        manualOverride: req.body.manualOverride
      });
    }

    const [syncState, scheduledLockAt] = await Promise.all([getDeviceSyncState(device), getScheduledLockAt(device)]);

    return sendSuccess(res, 200, "Device sync completed", {
      serverTime: new Date(),
      scheduledLockAt,
      telemetryWarnings:
        req.body.location !== undefined
          ? [
              {
                field: "location",
                code: "LOCATION_COMMAND_REQUIRED",
                message:
                  "Routine sync location was ignored; location is accepted only for GET_LOCATION acknowledgement"
              }
            ]
          : [],
      ...syncState
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

const securityAckError = (statusCode, code, message, details = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
};

const acknowledgeSecurityControlCommand = async ({ req, res, deviceId, commandId }) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const device = await Device.findById(deviceId).session(session);
    const command = await DeviceCommand.findOne({
      _id: commandId,
      deviceId
    }).session(session);
    if (!device || !command) {
      throw securityAckError(
        404,
        "COMMAND_NOT_FOUND",
        "Security control command was not found"
      );
    }

    const control = getDeviceSecurityControlByCommandType(command.commandType);
    if (!control) {
      throw securityAckError(409, "COMMAND_TYPE_MISMATCH", "Command is not a security control command");
    }
    if (req.body.commandType && req.body.commandType !== command.commandType) {
      throw securityAckError(409, "COMMAND_TYPE_MISMATCH", "Command type does not match the referenced command", {
        expected: { commandType: command.commandType },
        received: { commandType: req.body.commandType }
      });
    }

    const appliedControlVersion = Number(req.body.appliedControlVersion);
    const commandVersion = Number(command.payload?.controlVersion);
    if (
      !Number.isInteger(appliedControlVersion) ||
      appliedControlVersion < 0 ||
      appliedControlVersion !== commandVersion
    ) {
      throw securityAckError(409, "COMMAND_VERSION_MISMATCH", "Applied control version does not match the referenced command", {
        expected: { controlVersion: commandVersion },
        received: { appliedControlVersion: req.body.appliedControlVersion }
      });
    }

    const expectedBlocked = parseSecurityControlBlockedValue(command.payload?.blocked);
    if (expectedBlocked === null) {
      throw securityAckError(500, "INVALID_COMMAND_SNAPSHOT", "Security control command has an invalid stored value");
    }

    const expectedControlResult = getExpectedSecurityControlResult(
      command.commandType,
      expectedBlocked
    );
    if (req.body.status === "acknowledged") {
      if (
        typeof req.body.appliedBlocked !== "boolean" ||
        req.body.appliedBlocked !== expectedBlocked
      ) {
        throw securityAckError(409, "COMMAND_VALUE_MISMATCH", "Applied blocked value does not match the referenced command", {
          expected: { blocked: expectedBlocked },
          received: { appliedBlocked: req.body.appliedBlocked }
        });
      }
      if (req.body.controlResult !== expectedControlResult) {
        throw securityAckError(409, "COMMAND_RESULT_MISMATCH", "Control result does not match the referenced command", {
          expected: { controlResult: expectedControlResult },
          received: { controlResult: req.body.controlResult }
        });
      }
    } else if (!req.body.errorCode || !req.body.failureReason) {
      throw securityAckError(
        400,
        "INVALID_FAILED_ACK",
        "errorCode and failureReason are required for a failed security control acknowledgement"
      );
    }

    const currentState = normalizeDeviceSecurityControlState(device.securityControlState);
    const currentVersion = currentState[control.key].desiredVersion;
    const stale = appliedControlVersion < currentVersion;
    const terminalStatusAlreadyRecorded =
      command.status === "acknowledged" ||
      (command.status === "failed" &&
        command.failureSource === DEVICE_COMMAND_FAILURE_SOURCES.DEVICE_ENFORCEMENT);

    if (terminalStatusAlreadyRecorded) {
      const previousAck = command.ackPayload || {};
      const comparableAckFields = [
        "appliedBlocked",
        "controlResult",
        "errorCode",
        "failureReason"
      ];
      const sameAcknowledgement =
        command.status === req.body.status &&
        Number(previousAck.appliedControlVersion) === appliedControlVersion &&
        comparableAckFields.every(
          (field) => (previousAck[field] ?? null) === (req.body[field] ?? null)
        );

      if (!sameAcknowledgement) {
        throw securityAckError(409, "COMMAND_ACK_CONFLICT", "Security control command already has a conflicting acknowledgement");
      }

      await session.commitTransaction();
      return sendSuccess(res, 200, "Device command acknowledgement already saved", {
        accepted: true,
        idempotent: true,
        stale,
        currentControlVersion: currentVersion,
        commandId: command._id,
        commandType: command.commandType,
        status: command.status,
        appliedControlVersion,
        ...(command.status === "acknowledged"
          ? {
              appliedBlocked: req.body.appliedBlocked,
              controlResult: req.body.controlResult
            }
          : {})
      });
    }

    command.status = req.body.status;
    command.ackPayload = req.body;
    command.failureReason = req.body.failureReason;
    command.failureSource =
      req.body.status === "failed"
        ? DEVICE_COMMAND_FAILURE_SOURCES.DEVICE_ENFORCEMENT
        : undefined;
    command.nextRetryAt = undefined;

    if (req.body.status === "acknowledged") {
      command.acknowledgedAt = new Date();
      if (!stale && appliedControlVersion === currentVersion) {
        device.set(
          `securityControlState.${control.key}.appliedBlocked`,
          req.body.appliedBlocked
        );
        device.set(
          `securityControlState.${control.key}.appliedVersion`,
          appliedControlVersion
        );
        device.set(`securityControlState.${control.key}.appliedAt`, new Date());
        await device.save({ session });
      }
    }

    await command.save({ session });
    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.DEVICE_COMMAND_ACKNOWLEDGED,
        actorId: req.auth.id,
        actorCollection: "users",
        tenantId: device.tenantId,
        userId: req.auth.id,
        deviceId: device._id,
        metadata: {
          commandId: command._id,
          commandType: command.commandType,
          status: command.status,
          stale,
          appliedControlVersion
        }
      },
      { session }
    );

    await session.commitTransaction();
    return sendSuccess(res, 200, "Device command acknowledgement saved", {
      accepted: true,
      idempotent: false,
      stale,
      currentControlVersion: currentVersion,
      commandId: command._id,
      commandType: command.commandType,
      status: command.status,
      appliedControlVersion,
      ...(command.status === "acknowledged"
        ? {
            appliedBlocked: req.body.appliedBlocked,
            controlResult: req.body.controlResult
          }
        : {})
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
      error.code ? { code: error.code, ...error.details } : null
    );
  } finally {
    session.endSession();
  }
};

/**
 * Acknowledge a device command after local policy application.
 * Sample body: { "commandId": "665f6f0b6f0f6f0b6f0f6f0b", "status": "acknowledged", "appliedPolicyVersion": 4 }
 */
export const acknowledgeDeviceCommand = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["commandId", "status"])) {
      return sendError(res, 400, "Command ID and status are required");
    }

    const device = await Device.findOne({ userId: req.auth.id });
    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const command = await DeviceCommand.findOne({ _id: req.body.commandId, deviceId: device._id });
    if (!command) {
      return sendError(res, 404, "Device command not found", {
        code: "COMMAND_NOT_FOUND"
      });
    }

    if (!["acknowledged", "failed"].includes(req.body.status)) {
      return sendError(res, 400, "Status must be acknowledged or failed");
    }

    if (getDeviceSecurityControlByCommandType(command.commandType)) {
      return acknowledgeSecurityControlCommand({
        req,
        res,
        deviceId: device._id,
        commandId: command._id
      });
    }

    if (isDeviceReleaseState(device.state) && command.commandType !== "RELEASE_DEVICE") {
      return sendError(res, 409, "Command was superseded by permanent device release");
    }

    if (
      command.commandType === "RELEASE_DEVICE" &&
      req.body.status === "acknowledged" &&
      req.body.releaseCompleted !== true
    ) {
      return sendError(res, 400, "releaseCompleted must be true for a successful device release");
    }

    const terminalStatusAlreadyRecorded =
      command.status === "acknowledged" ||
      (
        command.status === "failed" &&
        command.failureSource === DEVICE_COMMAND_FAILURE_SOURCES.DEVICE_ENFORCEMENT
      );
    if (terminalStatusAlreadyRecorded) {
      if (command.status !== req.body.status) {
        return sendError(res, 409, "Device command already has a different terminal status");
      }

      return sendSuccess(res, 200, "Device command acknowledgement saved", {
        commandId: command._id,
        status: command.status,
        deviceState: device.state,
        restrictionState: normalizeDeviceRestrictionState(device.restrictionState),
        securityControlState: normalizeDeviceSecurityControlState(device.securityControlState),
        lastLocation: device.lastLocation || null
      });
    }

    command.status = req.body.status;
    command.ackPayload = req.body;
    command.failureReason = req.body.failureReason;
    command.failureSource =
      req.body.status === "failed"
        ? DEVICE_COMMAND_FAILURE_SOURCES.DEVICE_ENFORCEMENT
        : undefined;
    if (req.body.status === "failed") {
      command.nextRetryAt = undefined;
    }
    if (req.body.status === "acknowledged") {
      command.acknowledgedAt = new Date();
      if (command.commandType === "RELEASE_DEVICE") {
        const releasedAt = new Date();
        const clearedRestrictions = normalizeDeviceRestrictions();
        const clearedSecurityControls = buildReleasedDeviceSecurityControlState(
          device.securityControlState,
          releasedAt,
          command.triggeredByAccountId || null
        );
        device.state = DEVICE_STATES.RELEASED;
        device.deviceOwnerStatus = "RELEASED";
        device.releasedAt = releasedAt;
        device.tempUnlockExpiresAt = undefined;
        device.restrictionState.desired = clearedRestrictions;
        device.restrictionState.applied = clearedRestrictions;
        device.restrictionState.updatedAt = releasedAt;
        device.restrictionState.appliedAt = releasedAt;
        device.securityControlState = clearedSecurityControls;
        device.lastPolicyAppliedAt = releasedAt;
        device.stateUpdatedAt = releasedAt;
      } else if (command.commandType === "RESTRICTIONS_UPDATE") {
        const appliedRestrictionsVersion = Number(req.body.appliedRestrictionsVersion);
        const commandVersion = Number(command.payload?.restrictionVersion);
        if (
          !Number.isInteger(appliedRestrictionsVersion) ||
          appliedRestrictionsVersion < 0 ||
          appliedRestrictionsVersion !== commandVersion
        ) {
          return sendError(
            res,
            400,
            "appliedRestrictionsVersion must match the restriction command version"
          );
        }

        const currentRestrictionState = normalizeDeviceRestrictionState(device.restrictionState);
        if (
          shouldAdvanceAppliedRestrictionState({
            currentAppliedVersion: currentRestrictionState.appliedVersion,
            acknowledgedVersion: appliedRestrictionsVersion
          })
        ) {
          device.restrictionState.applied = normalizeDeviceRestrictions(
            req.body.appliedRestrictions || command.payload?.restrictions
          );
          device.restrictionState.appliedVersion = appliedRestrictionsVersion;
          device.restrictionState.appliedAt = new Date();
        }
      } else if (command.commandType === "GET_LOCATION") {
        const locationResult = parseLocationTelemetry({
          location: req.body.location,
          currentLocation: device.lastLocation,
          now: new Date()
        });
        if (!locationResult.value) {
          return sendError(
            res,
            400,
            locationResult.warnings[0]?.message ||
              "A valid location is required to acknowledge GET_LOCATION"
          );
        }
        device.lastLocation = locationResult.value;
      } else if (command.commandType === "EMI_REMINDER") {
        // Reminder acknowledgement is terminal for the command only. It does
        // not represent a policy transition or change device enforcement state.
      } else {
        device.lastAppliedPolicyVersion = req.body.appliedPolicyVersion ?? device.desiredPolicyVersion;
        if (command.commandType === "UNLOCK") device.state = DEVICE_STATES.ACTIVE;
        if (command.commandType === "LOCK") device.state = DEVICE_STATES.LOCKED;
        if (command.commandType === "TEMP_UNLOCK") device.state = DEVICE_STATES.TEMP_UNLOCK;
        if (command.commandType === "WIPE_DEVICE") device.deviceSecurityState = "WIPED_PENDING_REPROVISION";
        if (command.commandType === "INSTALL_UPDATE" && req.body.appVersion) device.appVersion = req.body.appVersion;
        if (command.commandType === "POLICY_UPDATE" && command.payload?.targetState) {
          device.state = command.payload.targetState;
        }
        device.lastPolicyAppliedAt = new Date();
        device.stateUpdatedAt = new Date();
      }
      await device.save();
    }
    await command.save();
    if (command.commandType === "RELEASE_DEVICE" && command.status === "acknowledged") {
      await DeviceCommand.updateMany(
        {
          _id: { $ne: command._id },
          deviceId: device._id,
          commandType: "RELEASE_DEVICE",
          status: { $in: ["pending", "sent"] }
        },
        {
          $set: {
            status: "expired",
            failureReason: "Superseded by acknowledged permanent device release"
          },
          $unset: { nextRetryAt: "" }
        }
      );
    }

    await createAuditLog({
      eventType:
        command.commandType === "RELEASE_DEVICE"
          ? req.body.status === "acknowledged"
            ? AUDIT_EVENTS.DEVICE_RELEASED
            : AUDIT_EVENTS.DEVICE_RELEASE_FAILED
          : AUDIT_EVENTS.DEVICE_COMMAND_ACKNOWLEDGED,
      actorId: req.auth.id,
      actorCollection: "users",
      tenantId: device.tenantId,
      userId: req.auth.id,
      deviceId: device._id,
      metadata: {
        commandId: command._id,
        commandType: command.commandType,
        status: command.status,
        releaseCompleted: req.body.releaseCompleted
      }
    });

    return sendSuccess(res, 200, "Device command acknowledgement saved", {
      commandId: command._id,
      status: command.status,
      deviceState: device.state,
      restrictionState: normalizeDeviceRestrictionState(device.restrictionState),
      securityControlState: normalizeDeviceSecurityControlState(device.securityControlState),
      lastLocation: device.lastLocation || null
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Report device security event.
 * Sample body: { "type": "ROOT_DETECTED", "severity": "high", "message": "su binary found", "metadata": { "path": "/system/xbin/su" } }
 */
export const reportSecurityEvent = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["type", "message"])) {
      return sendError(res, 400, "Security event type and message are required");
    }

    const device = await Device.findOne({ userId: req.auth.id });
    if (!device) {
      return sendError(res, 400, "Registered device not found");
    }

    const severity = req.body.severity || "medium";
    if (!RISK_SEVERITIES.includes(severity)) {
      return sendError(res, 400, "Invalid security event severity");
    }

    if (["ROOT_DETECTED", "TAMPER_DETECTED"].includes(req.body.type)) {
      device.isRooted = req.body.type === "ROOT_DETECTED" ? true : device.isRooted;
      device.isTampered = req.body.type === "TAMPER_DETECTED" ? true : device.isTampered;
      await device.save();
    }

    await DeviceEvent.create({
      deviceId: device._id,
      userId: req.auth.id,
      tenantId: device.tenantId,
      eventType: "security",
      severity,
      payload: req.body
    });

    const riskFlag = await RiskFlag.create({
      type: req.body.type,
      riskType: req.body.type,
      severity,
      source: "app_reported_security_event",
      tenantId: device.tenantId,
      deviceId: device._id,
      userId: req.auth.id,
      message: req.body.message,
      metadata: req.body.metadata || {}
    });

    const autoLock = await enforceRiskAutoLock({
      device,
      riskFlag,
      eventType: req.body.type,
      severity
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.DEVICE_SECURITY_EVENT_RECEIVED,
      actorId: req.auth.id,
      actorCollection: "users",
      tenantId: device.tenantId,
      userId: req.auth.id,
      deviceId: device._id,
      metadata: { riskFlagId: riskFlag._id, type: req.body.type, severity, autoLock }
    });

    return sendSuccess(res, 201, "Security event recorded", {
      riskFlagId: riskFlag._id,
      status: riskFlag.status,
      autoLock
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
