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
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { EnrollmentToken } from "../../models/EnrollmentToken.js";
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
