import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";
import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { Account } from "../../models/Account.js";
import { AccountPushToken, ACCOUNT_PUSH_PLATFORMS, ACCOUNT_PUSH_TARGET_APPS } from "../../models/AccountPushToken.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import { hashFcmToken } from "../../utils/pushTokens.js";
import { hasRequiredFields } from "../../utils/validators.js";

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
    const account = await Account.findOne({ ...identifierFilter, isActive: true });

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
