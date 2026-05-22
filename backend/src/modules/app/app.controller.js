import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import { env } from "../../config/env.js";
import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../../constants/deviceStates.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ConsentRecord } from "../../models/ConsentRecord.js";
import { ConsentVersion } from "../../models/ConsentVersion.js";
import { Device } from "../../models/Device.js";
import { DeviceCommand } from "../../models/DeviceCommand.js";
import { DeviceEvent } from "../../models/DeviceEvent.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { EnrollmentToken } from "../../models/EnrollmentToken.js";
import { Payment } from "../../models/Payment.js";
import { RiskFlag } from "../../models/RiskFlag.js";
import { Tenant } from "../../models/Tenant.js";
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { UnlockRequest } from "../../models/UnlockRequest.js";
import { OtpRecord } from "../../models/OtpRecord.js";
import { User } from "../../models/User.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import { hasRequiredFields } from "../../utils/validators.js";

const MOCK_CASHFREE_OTP = "123456";

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

const hashPayload = (payload) => {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};

const normalizeName = (name = "") => {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
};

const createCaseId = () => `CASE-${new Date().getFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

const buildMockCashfreeProfile = (user) => ({
  name: user.name,
  dob: "1990-01-01",
  address: "Mock Aadhaar address",
  aadhaarLinkedMobile: user.aadhaarLinkedMobile
});

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
 * Initiate mocked Cashfree Aadhaar OTP.
 * Sample body: { "enrollmentToken": "...", "aadhaarLinkedMobile": "9876543210" }
 */
export const initiateConsentOtp = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["enrollmentToken", "aadhaarLinkedMobile"])) {
      return sendError(res, 400, "Enrollment token and Aadhaar-linked mobile are required");
    }

    const enrollmentToken = await EnrollmentToken.findOne({
      token: req.body.enrollmentToken,
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!enrollmentToken) {
      return sendError(res, 400, "Valid enrollment token not found");
    }

    const user = await User.findById(enrollmentToken.userId);

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    if (user.aadhaarLinkedMobile !== req.body.aadhaarLinkedMobile) {
      return sendError(res, 400, "Aadhaar-linked mobile does not match registered borrower mobile");
    }

    const consentVersion = await ConsentVersion.findOne({ isCurrent: true }).lean();

    if (!consentVersion) {
      return sendError(res, 400, "Active consent version not found");
    }

    const verificationSessionId = `cf_mock_${crypto.randomBytes(12).toString("hex")}`;
    const otpHash = await bcrypt.hash(MOCK_CASHFREE_OTP, 12);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const providerReferenceId = `cashfree_mock_ref_${crypto.randomBytes(8).toString("hex")}`;

    await OtpRecord.create({
      mobile: req.body.aadhaarLinkedMobile,
      otpHash,
      purpose: "aadhaar_consent",
      verificationSessionId,
      enrollmentTokenId: enrollmentToken._id,
      userId: user._id,
      providerReferenceId,
      expiresAt,
      providerResponse: {
        provider: "cashfree",
        mode: "mock",
        status: "OTP_SENT"
      }
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.CONSENT_OTP_INITIATED,
      actorId: user._id,
      actorCollection: "users",
      tenantId: user.tenantId,
      userId: user._id,
      metadata: { verificationSessionId, providerReferenceId }
    });

    return sendSuccess(res, 200, "Aadhaar OTP sent successfully", {
      verificationSessionId,
      otpSent: true,
      maskedMobile: `${req.body.aadhaarLinkedMobile.slice(0, 2)}****${req.body.aadhaarLinkedMobile.slice(-4)}`,
      expiresInSeconds: 600,
      mockOtp: MOCK_CASHFREE_OTP
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Confirm mocked Cashfree Aadhaar OTP and create immutable consent record.
 * Sample body: { "enrollmentToken": "...", "verificationSessionId": "cf_mock_...", "otp": "123456", "consentCheckboxAccepted": true, "consentVersion": "1.0" }
 */
export const confirmConsentOtp = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const requiredFields = [
      "enrollmentToken",
      "verificationSessionId",
      "otp",
      "consentCheckboxAccepted",
      "consentVersion"
    ];

    if (!hasRequiredFields(req.body, requiredFields)) {
      return sendError(res, 400, "Enrollment token, verification session, OTP, and consent confirmation are required");
    }

    if (req.body.consentCheckboxAccepted !== true) {
      return sendError(res, 400, "Consent checkbox must be accepted");
    }

    const enrollmentToken = await EnrollmentToken.findOne({
      token: req.body.enrollmentToken,
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!enrollmentToken) {
      return sendError(res, 400, "Valid enrollment token not found");
    }

    const [user, consentVersion, otpRecord] = await Promise.all([
      User.findById(enrollmentToken.userId),
      ConsentVersion.findOne({ version: req.body.consentVersion, isCurrent: true }),
      OtpRecord.findOne({
        verificationSessionId: req.body.verificationSessionId,
        enrollmentTokenId: enrollmentToken._id,
        purpose: "aadhaar_consent",
        verified: false,
        expiresAt: { $gt: new Date() }
      })
    ]);

    if (!user || !user.isActive) {
      return sendError(res, 400, "Active user not found");
    }

    if (!consentVersion) {
      return sendError(res, 400, "Current consent version does not match request");
    }

    if (!otpRecord) {
      return sendError(res, 400, "Valid OTP session not found");
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      return sendError(res, 400, "Maximum OTP attempts exceeded");
    }

    otpRecord.attempts += 1;
    const otpMatches = await bcrypt.compare(req.body.otp, otpRecord.otpHash);

    if (!otpMatches) {
      await otpRecord.save();
      return sendError(res, 400, "Invalid OTP");
    }

    const verifiedProfile = buildMockCashfreeProfile(user);

    if (normalizeName(verifiedProfile.name) !== normalizeName(user.name)) {
      return sendError(res, 400, "Aadhaar name does not match registered borrower name");
    }

    session.startTransaction();

    otpRecord.verified = true;
    otpRecord.providerResponse = {
      provider: "cashfree",
      mode: "mock",
      status: "VERIFIED",
      verifiedProfile
    };
    await otpRecord.save({ session });

    const aadhaarVerificationRef = `cashfree_mock_verified_${crypto.randomBytes(10).toString("hex")}`;
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

    user.aadhaarVerified = true;
    user.consentRecordId = consentRecord._id;
    await user.save({ session });

    enrollmentToken.consumedAt = new Date();
    await enrollmentToken.save({ session });

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
          aadhaarVerificationRef
        }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 201, "Consent confirmed successfully", {
      consentRecordId: consentRecord._id,
      consentAccepted: true,
      accessToken: signUserAccessToken(user),
      tokenType: "user",
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

    const existingDevice = await Device.findOne({ imei: req.body.imei }).lean();

    if (existingDevice) {
      return sendError(res, 400, "IMEI is already registered");
    }

    const activePolicy = await DevicePolicy.findOne({
      tenantId: user.tenantId,
      policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      isActive: true
    }).lean();

    if (!activePolicy) {
      return sendError(res, 400, "Active EMI_PAID policy not found for tenant");
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

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.DEVICE_REGISTERED,
        actorId: user._id,
        actorCollection: "users",
        tenantId: user.tenantId,
        userId: user._id,
        deviceId: device._id,
        metadata: { imei: device.imei, currentPolicyKey: device.currentPolicyKey }
      },
      { session }
    );

    await session.commitTransaction();

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
 * Sample body: { "qrCodeId": "665f6f0b6f0f6f0b6f0f6f0b", "amount": 3500, "reference": "UPI123456" }
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

    const payment = await Payment.create({
      userId: req.auth.id,
      tenantId: device.tenantId,
      deviceId: device._id,
      amount,
      qrCodeId: activeQrCode._id,
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

    return sendSuccess(res, 201, "Payment submitted for tenant approval", {
      paymentId: payment._id,
      status: payment.status,
      approvalStatus: payment.approvalStatus
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
    const payments = await Payment.find({ userId: req.auth.id }).sort({ createdAt: -1 }).lean();
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
 * Sample body: { "reason": "Payment made but device is still locked", "reasonCategory": "payment_made", "details": "UPI ref UPI123456", "imageUrl": "https://..." }
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
      status: { $in: ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"] }
    }).lean();

    if (openCase) {
      return sendError(res, 409, "An unlock request is already open for this device");
    }

    const tenantPolicy = await TenantPolicy.findOne({ tenantId: device.tenantId }).lean();
    const slaHours = tenantPolicy?.escalationRules?.tenantSlaHours || tenantPolicy?.escalationRules?.slaHours || 24;
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);

    const unlockRequest = await UnlockRequest.create({
      caseId: createCaseId(),
      userId: req.auth.id,
      deviceId: device._id,
      tenantId: device.tenantId,
      channelPartnerId: tenantPolicy?.channelPartnerId || (await Tenant.findById(device.tenantId).lean())?.channelPartnerId,
      reason: req.body.reason,
      reasonCategory: req.body.reasonCategory || "other",
      details: req.body.details,
      imageUrl: req.body.imageUrl,
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

    return sendSuccess(res, 201, "Unlock request created successfully", {
      caseId: unlockRequest.caseId,
      status: unlockRequest.status,
      slaDeadline: unlockRequest.slaDeadline
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
      status: { $in: ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"] }
    })
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, 200, "Active unlock request fetched successfully", unlockRequest);
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

    device.lastSeenAt = new Date();
    device.isOnline = true;
    device.batteryLevel = req.body.batteryLevel ?? device.batteryLevel;
    device.networkType = req.body.networkType ?? device.networkType;
    device.appVersion = req.body.appVersion ?? device.appVersion;
    if (req.body.fcmToken && req.body.fcmToken !== device.fcmToken) {
      device.fcmToken = req.body.fcmToken;
      device.fcmTokenUpdatedAt = new Date();
    }
    await device.save();

    await DeviceEvent.create({
      deviceId: device._id,
      userId: req.auth.id,
      tenantId: device.tenantId,
      eventType: "ping",
      payload: req.body
    });

    return sendSuccess(res, 200, "Device ping received", {
      deviceId: device._id,
      serverTime: new Date(),
      desiredPolicyVersion: device.desiredPolicyVersion,
      lastAppliedPolicyVersion: device.lastAppliedPolicyVersion
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

    await DeviceEvent.create({
      deviceId: device._id,
      userId: req.auth.id,
      tenantId: device.tenantId,
      eventType: "sync",
      payload: req.body
    });

    const [policy, pendingCommands] = await Promise.all([
      DevicePolicy.findOne({ tenantId: device.tenantId, policyKey: device.currentPolicyKey, isActive: true }).lean(),
      DeviceCommand.find({ deviceId: device._id, status: { $in: ["pending", "sent"] } }).sort({ createdAt: 1 }).lean()
    ]);

    return sendSuccess(res, 200, "Device sync completed", {
      deviceState: device.state,
      currentPolicyKey: device.currentPolicyKey,
      desiredPolicyVersion: device.desiredPolicyVersion,
      policy,
      pendingCommands
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
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
      return sendError(res, 404, "Device command not found");
    }

    if (!["acknowledged", "failed"].includes(req.body.status)) {
      return sendError(res, 400, "Status must be acknowledged or failed");
    }

    command.status = req.body.status;
    command.ackPayload = req.body;
    command.failureReason = req.body.failureReason;
    if (req.body.status === "acknowledged") {
      command.acknowledgedAt = new Date();
      device.lastAppliedPolicyVersion = req.body.appliedPolicyVersion ?? device.desiredPolicyVersion;
      if (command.commandType === "UNLOCK") device.state = DEVICE_STATES.ACTIVE;
      if (command.commandType === "LOCK") device.state = DEVICE_STATES.LOCKED;
      if (command.commandType === "TEMP_UNLOCK") device.state = DEVICE_STATES.TEMP_UNLOCK;
      device.lastPolicyAppliedAt = new Date();
      device.stateUpdatedAt = new Date();
      await device.save();
    }
    await command.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.DEVICE_COMMAND_ACKNOWLEDGED,
      actorId: req.auth.id,
      actorCollection: "users",
      tenantId: device.tenantId,
      userId: req.auth.id,
      deviceId: device._id,
      metadata: { commandId: command._id, status: command.status }
    });

    return sendSuccess(res, 200, "Device command acknowledgement saved", {
      commandId: command._id,
      status: command.status,
      deviceState: device.state
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
      severity,
      tenantId: device.tenantId,
      deviceId: device._id,
      userId: req.auth.id,
      message: req.body.message,
      metadata: req.body.metadata || {}
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.DEVICE_SECURITY_EVENT_RECEIVED,
      actorId: req.auth.id,
      actorCollection: "users",
      tenantId: device.tenantId,
      userId: req.auth.id,
      deviceId: device._id,
      metadata: { riskFlagId: riskFlag._id, type: req.body.type, severity }
    });

    return sendSuccess(res, 201, "Security event recorded", {
      riskFlagId: riskFlag._id,
      status: riskFlag.status
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
