import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";
import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { Account } from "../../models/Account.js";
import { AccountPushToken, ACCOUNT_PUSH_PLATFORMS, ACCOUNT_PUSH_TARGET_APPS } from "../../models/AccountPushToken.js";
import { OtpRecord } from "../../models/OtpRecord.js";
import { PasswordResetToken } from "../../models/PasswordResetToken.js";
import {
  PASSWORD_RESET_OTP_PURPOSE,
  resendPasswordResetOtp,
  sendPasswordResetOtp,
  verifyPasswordResetOtp
} from "../../services/passwordResetOtp.service.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import { hashFcmToken } from "../../utils/pushTokens.js";
import { hasRequiredFields } from "../../utils/validators.js";

const SUPPORTED_FORGOT_PASSWORD_ROLES = new Set([ACCOUNT_ROLES.TENANT_ADMIN, ACCOUNT_ROLES.PARTNER_ADMIN]);
const RESET_TOKEN_EXPIRES_IN_SECONDS = 600;

const buildAccountPayload = (account) => ({
  id: account._id.toString(),
  tokenType: "account",
  role: account.role,
  tenantId: account.tenantId?.toString(),
  channelPartnerId: account.channelPartnerId?.toString()
});

const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSecure ? "none" : "lax",
  path: "/api/auth"
});

const signAccessToken = (payload) => {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn
  });
};

const signRefreshToken = (payload) => {
  return jwt.sign(payload, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn
  });
};

const getAllowedTargetAppForRole = (role) => {
  if (role === ACCOUNT_ROLES.TENANT_ADMIN) return ACCOUNT_PUSH_TARGET_APPS.TENANT_APP;
  if (role === ACCOUNT_ROLES.PARTNER_ADMIN) return ACCOUNT_PUSH_TARGET_APPS.PARTNER_APP;
  return null;
};

const getRoleForTargetApp = (targetApp) => {
  if (targetApp === ACCOUNT_PUSH_TARGET_APPS.TENANT_APP) return ACCOUNT_ROLES.TENANT_ADMIN;
  if (targetApp === ACCOUNT_PUSH_TARGET_APPS.PARTNER_APP) return ACCOUNT_ROLES.PARTNER_ADMIN;
  return null;
};

const getLoginRoleFilter = ({ role, targetApp }) => {
  if (role) {
    return Object.values(ACCOUNT_ROLES).includes(role) ? role : "__invalid_role__";
  }

  if (targetApp) {
    return getRoleForTargetApp(String(targetApp).trim());
  }

  return null;
};

const normalizeMobile = (mobile) => {
  const digits = String(mobile || "").trim().replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
};

const isValidIndianMobile = (mobile) => /^\d{10}$/.test(normalizeMobile(mobile));

const isValidPassword = (password) => {
  const value = String(password || "");
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
};

const validateForgotPasswordRole = (role) => {
  const normalizedRole = String(role || "").trim();
  return SUPPORTED_FORGOT_PASSWORD_ROLES.has(normalizedRole) ? normalizedRole : null;
};

const findActiveForgotPasswordAccount = async ({ mobile, role }) => {
  return Account.findOne({
    mobile: normalizeMobile(mobile),
    role,
    isActive: true
  });
};

const findActivePasswordResetOtpRecord = async ({ mobile, role, accountId, verificationSessionId }) => {
  return OtpRecord.findOne({
    mobile: normalizeMobile(mobile),
    purpose: PASSWORD_RESET_OTP_PURPOSE,
    verificationSessionId: String(verificationSessionId || "").trim(),
    verified: false,
    expiresAt: { $gt: new Date() },
    "providerResponse.accountId": accountId.toString(),
    "providerResponse.role": role
  });
};

const createResetToken = () => crypto.randomBytes(32).toString("base64url");

const hashResetToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");

const validatePushTokenRequest = ({ account, targetApp, platform, fcmToken }) => {
  if (!Object.values(ACCOUNT_PUSH_TARGET_APPS).includes(targetApp)) {
    return "Invalid targetApp";
  }

  if (!Object.values(ACCOUNT_PUSH_PLATFORMS).includes(platform)) {
    return "Invalid platform";
  }

  if (!String(fcmToken || "").trim()) {
    return "FCM token is required";
  }

  const allowedTargetApp = getAllowedTargetAppForRole(account.role);
  if (!allowedTargetApp || allowedTargetApp !== targetApp) {
    return "Account role is not allowed to register this app token";
  }

  return null;
};

export const forgotPasswordSendOtp = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["mobile", "role"])) {
      return sendError(res, 400, "mobile and role are required");
    }

    const role = validateForgotPasswordRole(req.body.role);
    if (!role) {
      return sendError(res, 400, "Invalid role");
    }

    if (!isValidIndianMobile(req.body.mobile)) {
      return sendError(res, 400, "Valid mobile number is required");
    }

    const mobile = normalizeMobile(req.body.mobile);
    const account = await findActiveForgotPasswordAccount({ mobile, role });
    if (!account) {
      return sendError(res, 404, "No active account found for this mobile and role");
    }

    const otpSession = await sendPasswordResetOtp({ mobile, account, role });

    return sendSuccess(res, 200, "OTP sent successfully", {
      verificationSessionId: otpSession.verificationSessionId,
      otpSent: true,
      expiresInSeconds: otpSession.expiresInSeconds,
      retryAfterSeconds: otpSession.retryAfterSeconds
    });
  } catch (error) {
    console.error("Forgot password OTP send failed", {
      message: error.message,
      role: req.body?.role
    });

    return sendError(res, 500, error.message || "Unable to send OTP right now");
  }
};

export const forgotPasswordResendOtp = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["mobile", "role", "verificationSessionId"])) {
      return sendError(res, 400, "mobile, role, and verificationSessionId are required");
    }

    const role = validateForgotPasswordRole(req.body.role);
    if (!role) {
      return sendError(res, 400, "Invalid role");
    }

    if (!isValidIndianMobile(req.body.mobile)) {
      return sendError(res, 400, "Valid mobile number is required");
    }

    const mobile = normalizeMobile(req.body.mobile);
    const account = await findActiveForgotPasswordAccount({ mobile, role });
    if (!account) {
      return sendError(res, 404, "No active account found for this mobile and role");
    }

    const otpRecord = await findActivePasswordResetOtpRecord({
      mobile,
      role,
      accountId: account._id,
      verificationSessionId: req.body.verificationSessionId
    });

    if (!otpRecord) {
      return sendError(res, 400, "Invalid or expired OTP session");
    }

    const resendResult = await resendPasswordResetOtp({ otpRecord });

    return sendSuccess(res, 200, "OTP resent successfully", {
      verificationSessionId: otpRecord.verificationSessionId,
      otpSent: true,
      expiresInSeconds: resendResult.expiresInSeconds,
      retryAfterSeconds: resendResult.retryAfterSeconds
    });
  } catch (error) {
    console.error("Forgot password OTP resend failed", {
      message: error.message,
      role: req.body?.role,
      verificationSessionId: req.body?.verificationSessionId
    });

    return sendError(
      res,
      error.statusCode || 500,
      error.message || "Unable to send OTP right now",
      error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : null
    );
  }
};

export const forgotPasswordVerifyOtp = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["mobile", "role", "verificationSessionId", "otp"])) {
      return sendError(res, 400, "mobile, role, verificationSessionId, and otp are required");
    }

    const role = validateForgotPasswordRole(req.body.role);
    if (!role) {
      return sendError(res, 400, "Invalid role");
    }

    if (!isValidIndianMobile(req.body.mobile)) {
      return sendError(res, 400, "Valid mobile number is required");
    }

    const mobile = normalizeMobile(req.body.mobile);
    const account = await findActiveForgotPasswordAccount({ mobile, role });
    if (!account) {
      return sendError(res, 404, "No active account found for this mobile and role");
    }

    const otpRecord = await findActivePasswordResetOtpRecord({
      mobile,
      role,
      accountId: account._id,
      verificationSessionId: req.body.verificationSessionId
    });

    if (!otpRecord) {
      return sendError(res, 400, "Invalid or expired OTP session");
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      return sendError(res, 400, "Maximum OTP verification attempts exceeded");
    }

    otpRecord.attempts += 1;
    const isOtpValid = await verifyPasswordResetOtp({ otpRecord, otp: req.body.otp });

    if (!isOtpValid) {
      await otpRecord.save();
      return sendError(res, 400, "Invalid OTP");
    }

    const now = new Date();
    otpRecord.verified = true;
    otpRecord.consumedAt = now;
    otpRecord.providerResponse = {
      ...(otpRecord.providerResponse || {}),
      status: "OTP_VERIFIED",
      verifiedAt: now
    };
    await otpRecord.save();

    await PasswordResetToken.updateMany(
      {
        accountId: account._id,
        usedAt: null,
        expiresAt: { $gt: now }
      },
      { $set: { usedAt: now } }
    );

    const resetToken = createResetToken();
    await PasswordResetToken.create({
      accountId: account._id,
      role,
      tokenHash: hashResetToken(resetToken),
      expiresAt: new Date(now.getTime() + RESET_TOKEN_EXPIRES_IN_SECONDS * 1000),
      verificationSessionId: otpRecord.verificationSessionId
    });

    return sendSuccess(res, 200, "OTP verified successfully", {
      resetToken,
      expiresInSeconds: RESET_TOKEN_EXPIRES_IN_SECONDS
    });
  } catch (error) {
    console.error("Forgot password OTP verification failed", {
      message: error.message,
      role: req.body?.role,
      verificationSessionId: req.body?.verificationSessionId
    });

    return sendError(res, 500, "Internal server error");
  }
};

export const resetForgotPassword = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["resetToken", "newPassword", "confirmPassword"])) {
      return sendError(res, 400, "resetToken, newPassword, and confirmPassword are required");
    }

    if (req.body.newPassword !== req.body.confirmPassword) {
      return sendError(res, 400, "Password and confirm password must match");
    }

    if (!isValidPassword(req.body.newPassword)) {
      return sendError(res, 400, "Password must be at least 8 characters and include at least one letter and one number");
    }

    const resetToken = await PasswordResetToken.findOne({
      tokenHash: hashResetToken(req.body.resetToken),
      usedAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!resetToken) {
      return sendError(res, 400, "Invalid or expired reset token");
    }

    const account = await Account.findOne({
      _id: resetToken.accountId,
      role: resetToken.role,
      isActive: true
    });

    if (!account) {
      return sendError(res, 400, "Invalid or expired reset token");
    }

    account.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    resetToken.usedAt = new Date();

    await Promise.all([account.save(), resetToken.save()]);

    return sendSuccess(res, 200, "Password reset successfully");
  } catch (error) {
    console.error("Forgot password reset failed", {
      message: error.message
    });

    return sendError(res, 500, "Internal server error");
  }
};

export const loginAccount = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["password"]) || (!req.body.email && !req.body.identifier)) {
      return sendError(res, 400, "Email or identifier and password are required");
    }

    const { email, identifier, password } = req.body;
    const loginIdentifier = String(email || identifier).trim();
    const identifierFilter = loginIdentifier.includes("@")
      ? { email: loginIdentifier.toLowerCase() }
      : { mobile: loginIdentifier };
    const roleFilter = getLoginRoleFilter(req.body);

    if (roleFilter === "__invalid_role__") {
      return sendError(res, 400, "Invalid role");
    }

    if (req.body.targetApp && !getRoleForTargetApp(String(req.body.targetApp).trim())) {
      return sendError(res, 400, "Invalid targetApp");
    }

    const accountFilter = {
      ...identifierFilter,
      isActive: true,
      ...(roleFilter ? { role: roleFilter } : {})
    };
    const accounts = await Account.find(accountFilter).limit(2);

    if (accounts.length > 1) {
      return sendError(res, 409, "Multiple accounts found for this identifier. Provide role or targetApp to continue.");
    }

    const [account] = accounts;

    if (!account) {
      return sendError(res, 401, "Invalid credentials");
    }

    const passwordMatches = await bcrypt.compare(password, account.passwordHash);

    if (!passwordMatches) {
      return sendError(res, 401, "Invalid password");
    }

    const payload = buildAccountPayload(account);
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    account.lastLoginAt = new Date();
    await account.save();

    res.cookie(env.refreshCookieName, refreshToken, getRefreshCookieOptions());

    return sendSuccess(res, 200, "Login successful", {
      accessToken,
      tokenType: "account",
      account: {
        id: account._id,
        name: account.name,
        email: account.email,
        mobile: account.mobile,
        role: account.role,
        tenantId: account.tenantId,
        channelPartnerId: account.channelPartnerId
      }
    });
  } catch (error) {
    console.error("Account login failed", {
      message: error.message
    });

    return sendError(res, 500, "Internal server error");
  }
};

export const refreshAccessToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.[env.refreshCookieName];

    if (!refreshToken) {
      return sendError(res, 401, "Refresh token is required");
    }

    const payload = jwt.verify(refreshToken, env.jwtRefreshSecret);

    if (!payload?.id || payload.tokenType !== "account") {
      return sendError(res, 401, "Invalid refresh token");
    }

    const account = await Account.findById(payload.id).lean();

    if (!account || !account.isActive) {
      return sendError(res, 401, "Invalid refresh token");
    }

    const accessTokenPayload = buildAccountPayload(account);
    const accessToken = signAccessToken(accessTokenPayload);

    return sendSuccess(res, 200, "Access token refreshed successfully", {
      accessToken,
      tokenType: "account"
    });
  } catch (error) {
    res.clearCookie(env.refreshCookieName, getRefreshCookieOptions());
    return sendError(res, 401, "Invalid or expired refresh token");
  }
};

export const getCurrentAccount = async (req, res) => {
  try {
    const account = await Account.findById(req.auth.id)
      .select("-passwordHash")
      .populate("tenantId", "name type")
      .populate("channelPartnerId", "name type")
      .lean();

    if (!account || !account.isActive || req.auth.tokenType !== "account") {
      return sendError(res, 401, "Current account not found");
    }

    return sendSuccess(res, 200, "Current account fetched successfully", {
      account: {
        id: account._id,
        name: account.name,
        email: account.email,
        mobile: account.mobile,
        role: account.role,
        tenantId: account.tenantId,
        channelPartnerId: account.channelPartnerId
      }
    });
  } catch (error) {
    return sendError(res, 500, "Internal server error");
  }
};

/**
 * Register or refresh the current account's app FCM token.
 * Sample body: { "targetApp": "tenant_app", "platform": "android", "fcmToken": "...", "appVersion": "1.0.12" }
 */
export const registerAccountPushToken = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["targetApp", "platform", "fcmToken"])) {
      return sendError(res, 400, "targetApp, platform, and fcmToken are required");
    }

    const account = await Account.findById(req.auth.id).lean();
    if (!account || !account.isActive || req.auth.tokenType !== "account") {
      return sendError(res, 401, "Current account not found");
    }

    const targetApp = String(req.body.targetApp).trim();
    const platform = String(req.body.platform).trim();
    const fcmToken = String(req.body.fcmToken).trim();
    const validationError = validatePushTokenRequest({ account, targetApp, platform, fcmToken });
    if (validationError) {
      return sendError(res, 400, validationError);
    }

    const tokenHash = hashFcmToken(fcmToken);
    const now = new Date();
    const pushToken = await AccountPushToken.findOneAndUpdate(
      {
        accountId: account._id,
        targetApp,
        platform,
        tokenHash
      },
      {
        $set: {
          role: account.role,
          fcmToken,
          appVersion: req.body.appVersion ? String(req.body.appVersion).trim() : undefined,
          lastSeenAt: now,
          isActive: true
        },
        $setOnInsert: {
          accountId: account._id,
          targetApp,
          platform,
          tokenHash
        },
        $unset: {
          deactivatedAt: "",
          deactivationReason: ""
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return sendSuccess(res, 200, "Push token registered successfully", {
      id: pushToken._id,
      targetApp: pushToken.targetApp,
      platform: pushToken.platform,
      tokenHash: pushToken.tokenHash,
      isActive: pushToken.isActive,
      lastSeenAt: pushToken.lastSeenAt
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Deactivate only the current device token for the current account.
 * Sample body: { "targetApp": "tenant_app", "fcmToken": "..." }
 */
export const deactivateAccountPushToken = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["targetApp", "fcmToken"])) {
      return sendError(res, 400, "targetApp and fcmToken are required");
    }

    const account = await Account.findById(req.auth.id).lean();
    if (!account || !account.isActive || req.auth.tokenType !== "account") {
      return sendError(res, 401, "Current account not found");
    }

    const targetApp = String(req.body.targetApp).trim();
    const platform = req.body.platform ? String(req.body.platform).trim() : null;
    const fcmToken = String(req.body.fcmToken).trim();

    if (!Object.values(ACCOUNT_PUSH_TARGET_APPS).includes(targetApp)) {
      return sendError(res, 400, "Invalid targetApp");
    }
    if (platform && !Object.values(ACCOUNT_PUSH_PLATFORMS).includes(platform)) {
      return sendError(res, 400, "Invalid platform");
    }
    if (!fcmToken) {
      return sendError(res, 400, "FCM token is required");
    }
    const allowedTargetApp = getAllowedTargetAppForRole(account.role);
    if (!allowedTargetApp || allowedTargetApp !== targetApp) {
      return sendError(res, 400, "Account role is not allowed to deactivate this app token");
    }

    const filter = {
      accountId: account._id,
      targetApp,
      tokenHash: hashFcmToken(fcmToken)
    };
    if (platform) filter.platform = platform;

    const now = new Date();
    const result = await AccountPushToken.updateMany(filter, {
      $set: {
        isActive: false,
        deactivatedAt: now,
        deactivationReason: "logout"
      }
    });

    return sendSuccess(res, 200, "Push token deactivated successfully", {
      deactivatedCount: result.modifiedCount || 0
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const logoutAccount = async (req, res) => {
  try {
    res.clearCookie(env.refreshCookieName, getRefreshCookieOptions());

    return sendSuccess(res, 200, "Logout successful");
  } catch (error) {
    return sendError(res, 500, "Internal server error");
  }
};
