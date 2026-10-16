import mongoose from "mongoose";

import { ENROLLMENT_MODES, getEnrollmentMode } from "../../constants/enrollmentModes.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../../constants/deviceStates.js";
import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ConsentRecord } from "../../models/ConsentRecord.js";
import { Device } from "../../models/Device.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { EnrollmentToken } from "../../models/EnrollmentToken.js";
import { Tenant } from "../../models/Tenant.js";
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { User } from "../../models/User.js";
import {
  findEnrollmentTokenBySecret,
  isValidActivationRequestId,
  isValidImei,
  normalizeImei,
  RUNNING_REQUIREMENTS_VERSION,
  validateRunningCapabilities
} from "../../services/runningEnrollment.service.js";
import { getBorrowerAppConfig } from "../../services/tenantDeviceControl.service.js";
import { safeRefreshTenantMetrics } from "../../services/tenantMetrics.service.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";

const getActiveRunningClaim = (secret, extra = {}) => findEnrollmentTokenBySecret(secret, {
  consumedAt: null,
  cancelledAt: null,
  expiresAt: { $gt: new Date() },
  enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
  ...extra
});

const errorResponse = (res, status, code, message) => sendError(res, status, message, { code });

/** Preview never consumes the QR claim or returns its secret in response data. */
export const previewRunningEnrollment = async (req, res) => {
  try {
    const query = getActiveRunningClaim(req.body?.enrollmentToken);
    const token = query ? await query.lean() : null;
    if (!token) return errorResponse(res, 400, "INVALID_ENROLLMENT_TOKEN", "Valid running enrollment token not found");
    const [user, tenant, tenantPolicy] = await Promise.all([
      User.findOne({ _id: token.userId, tenantId: token.tenantId, isActive: true }).lean(),
      Tenant.findOne({ _id: token.tenantId, isActive: true }).lean(),
      TenantPolicy.findOne({ tenantId: token.tenantId }).select("runningEnrollmentEnabled").lean()
    ]);
    if (!user || !tenant || tenantPolicy?.runningEnrollmentEnabled !== true ||
      getEnrollmentMode(user) !== ENROLLMENT_MODES.RUNNING_APP || user.isDeviceLinked) {
      return errorResponse(res, 400, "INVALID_ENROLLMENT_TOKEN", "Valid running enrollment token not found");
    }
    res.set("Cache-Control", "no-store");
    return sendSuccess(res, 200, "Running enrollment preview fetched", {
      enrollmentId: token._id,
      enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
      lenderName: tenant.name,
      borrowerName: user.name,
      emiAmount: user.emiAmount ?? null,
      tenureMonths: user.tenureMonths ?? null,
      totalAmount: user.loanAmount ?? null,
      loanIdSuffix: String(user.loanId || "").slice(-4),
      expiresAt: token.expiresAt,
      requirementsVersion: RUNNING_REQUIREMENTS_VERSION,
      requiredCapabilities: ["notificationsAllowed", "overlayAllowed"],
      assurance: "APP_OVERLAY_LOWER_ASSURANCE"
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/** Final OK is the only place that consumes the QR and creates a running Device. */
export const registerRunningDevice = async (req, res, user) => {
  const session = await mongoose.startSession();
  try {
    const activationRequestId = req.body.activationRequestId;
    if (!isValidActivationRequestId(activationRequestId)) {
      return sendError(res, 400, "Valid activationRequestId is required");
    }
    const existing = await Device.findOne({ userId: user._id, tenantId: user.tenantId }).lean();
    if (existing) {
      if (getEnrollmentMode(existing) === ENROLLMENT_MODES.RUNNING_APP &&
        existing.activationIdempotencyKey === activationRequestId) {
        return sendSuccess(res, 200, "Running device already registered", {
          deviceId: existing._id,
          userId: user._id,
          tenantId: user.tenantId,
          state: existing.state,
          enrollmentMode: ENROLLMENT_MODES.RUNNING_APP
        });
      }
      return errorResponse(res, 409, "DEVICE_ALREADY_LINKED", "Borrower is already linked to a device");
    }
    if (user.isDeviceLinked || !user.consentRecordId) {
      return errorResponse(res, 409, "ENROLLMENT_NOT_READY", "Borrower consent and an unlinked account are required");
    }
    if (req.body.requirementsVersion !== RUNNING_REQUIREMENTS_VERSION) {
      return errorResponse(res, 409, "REQUIREMENTS_CHANGED", "Refresh running app enrollment requirements");
    }
    const capabilityError = validateRunningCapabilities(req.body.capabilities);
    if (capabilityError) return errorResponse(res, 409, "CAPABILITY_UNAVAILABLE", capabilityError);
    const imei = normalizeImei(req.body.imei);
    const imei2 = normalizeImei(req.body.imei2);
    if (!isValidImei(imei) ||
      (req.body.singleImeiDevice === true ? Boolean(imei2) : !isValidImei(imei2) || imei === imei2)) {
      return sendError(res, 400, "Valid distinct IMEI 1 and IMEI 2 are required, except on a declared single-IMEI phone");
    }
    const duplicateImei = await Device.exists({
      $or: [{ imei: { $in: [imei, imei2].filter(Boolean) } }, { imei2: { $in: [imei, imei2].filter(Boolean) } }],
      state: { $ne: DEVICE_STATES.RELEASED }
    });
    if (duplicateImei) return errorResponse(res, 409, "IMEI_REVIEW_REQUIRED", "IMEI is already linked to an active device");
    const token = await getActiveRunningClaim(req.body.enrollmentToken, {
      userId: user._id,
      tenantId: user.tenantId
    });
    if (!token) return errorResponse(res, 400, "INVALID_ENROLLMENT_TOKEN", "Valid running enrollment token not found");
    const consent = await ConsentRecord.findOne({
      _id: user.consentRecordId,
      enrollmentTokenId: token._id,
      tenantId: user.tenantId,
      enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
      consentCheckboxAccepted: true
    }).lean();
    if (!consent) return errorResponse(res, 403, "CONSENT_REQUIRED", "Running-app consent is required");
    const [activePolicy, tenantPolicy] = await Promise.all([
      DevicePolicy.findOne({ tenantId: user.tenantId, policyKey: DEVICE_POLICY_KEYS.EMI_PAID, isActive: true }).lean(),
      TenantPolicy.findOne({ tenantId: user.tenantId }).lean()
    ]);
    if (tenantPolicy?.runningEnrollmentEnabled !== true) {
      return errorResponse(res, 409, "RUNNING_ENROLLMENT_DISABLED", "Running enrollment is disabled for this dealer");
    }
    if (!activePolicy) return sendError(res, 400, "Active EMI_PAID policy not found for tenant");
    if (typeof req.body.fcmToken !== "string" || !req.body.fcmToken.trim()) {
      return sendError(res, 400, "FCM token is required");
    }
    const now = new Date();
    session.startTransaction();
    const tokenClaim = await EnrollmentToken.updateOne(
      { _id: token._id, consumedAt: null, cancelledAt: null, expiresAt: { $gt: now } },
      { $set: { consumedAt: now } },
      { session }
    );
    if (tokenClaim.modifiedCount !== 1) {
      throw Object.assign(new Error("Enrollment token was already claimed"), { statusCode: 409, code: "TOKEN_ALREADY_CLAIMED" });
    }
    const userLink = await User.updateOne(
      { _id: user._id, isDeviceLinked: false },
      { $set: { isDeviceLinked: true, deviceLinkedAt: now } },
      { session }
    );
    if (userLink.modifiedCount !== 1) {
      throw Object.assign(new Error("Borrower was already linked"), { statusCode: 409, code: "DEVICE_ALREADY_LINKED" });
    }
    const devices = await Device.create([{
      userId: user._id,
      tenantId: user.tenantId,
      enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
      identifierSource: "BORROWER_ENTERED",
      imei,
      imei2: imei2 || undefined,
      activationIdempotencyKey: activationRequestId,
      capabilities: req.body.capabilities,
      capabilitiesObservedAt: new Date(req.body.capabilities.observedAt),
      capabilitiesReceivedAt: now,
      locationConsentAccepted: consent.locationConsentAccepted === true,
      deviceModel: String(req.body.deviceModel || "").slice(0, 120),
      manufacturer: String(req.body.manufacturer || "").slice(0, 120),
      androidVersion: String(req.body.androidVersion || "").slice(0, 40),
      appVersion: String(req.body.appVersion || "").slice(0, 40),
      fcmToken: req.body.fcmToken,
      fcmTokenUpdatedAt: now,
      state: DEVICE_STATES.ACTIVE,
      currentPolicyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      currentPolicyId: activePolicy._id,
      desiredPolicyVersion: activePolicy.version,
      deviceOwnerStatus: "UNKNOWN"
    }], { session, ordered: true });
    const device = devices[0];
    await User.updateOne({ _id: user._id }, { $set: { linkedDeviceId: device._id } }, { session });
    await AuditLog.create([{
      eventType: AUDIT_EVENTS.DEVICE_REGISTERED,
      actorId: user._id,
      actorCollection: "users",
      tenantId: user.tenantId,
      userId: user._id,
      deviceId: device._id,
      metadata: { enrollmentMode: ENROLLMENT_MODES.RUNNING_APP, enrollmentTokenId: token._id, activationRequestId }
    }], { session, ordered: true });
    await session.commitTransaction();
    await safeRefreshTenantMetrics(user.tenantId, { source: "running_device_registration", deviceId: device._id });
    return sendSuccess(res, 201, "Running device registered successfully", {
      deviceId: device._id,
      userId: user._id,
      tenantId: user.tenantId,
      enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
      state: device.state,
      currentPolicyKey: device.currentPolicyKey,
      appConfig: getBorrowerAppConfig(tenantPolicy),
      policy: { ...activePolicy, restrictions: {} }
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return errorResponse(res, error.statusCode || 500, error.code || "RUNNING_ENROLLMENT_FAILED", error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/** Permission revocation is reported after enrollment; it never rewrites enrollment history. */
export const reportRunningCapabilities = async (req, res) => {
  try {
    if (!req.runningDevice) {
      return errorResponse(res, 409, "UNSUPPORTED_FOR_ENROLLMENT_MODE", "Capability reports are for running devices");
    }
    const capabilities = req.body?.capabilities;
    const observedAt = new Date(capabilities?.observedAt);
    if (!capabilities || typeof capabilities !== "object" ||
      !Number.isFinite(observedAt.getTime()) || Math.abs(Date.now() - observedAt.getTime()) > 5 * 60 * 1000 ||
      ["notificationsAllowed", "overlayAllowed"].some((key) => typeof capabilities[key] !== "boolean")) {
      return sendError(res, 400, "Fresh named capability values are required");
    }
    const updates = {
      capabilities,
      capabilitiesObservedAt: observedAt,
      capabilitiesReceivedAt: new Date()
    };
    if (typeof req.body.fcmToken === "string" && req.body.fcmToken.trim()) {
      updates.fcmToken = req.body.fcmToken.trim();
      updates.fcmTokenUpdatedAt = new Date();
    }
    if (typeof req.body.appVersion === "string") updates.appVersion = req.body.appVersion.slice(0, 40);
    const device = await Device.findOneAndUpdate({ _id: req.runningDevice._id }, { $set: updates }, { new: true });
    return sendSuccess(res, 200, "Running capabilities updated", {
      deviceId: device._id,
      capabilitiesObservedAt: device.capabilitiesObservedAt,
      capabilitiesReceivedAt: device.capabilitiesReceivedAt
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
