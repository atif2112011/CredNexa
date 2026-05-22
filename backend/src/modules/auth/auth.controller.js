import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";
import { Account } from "../../models/Account.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
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
  path: "/api/v1/auth"
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

export const loginAccount = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["email", "password"])) {
      return sendError(res, 400, "Email and password are required");
    }

    const { email, password } = req.body;
    const account = await Account.findOne({ email: email.toLowerCase(), isActive: true });

    if (!account) {
      return sendError(res, 401, "Invalid email or password");
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
        role: account.role,
        tenantId: account.tenantId,
        channelPartnerId: account.channelPartnerId
      }
    });
  } catch (error) {
    return sendError(res, 500, "Internal server error");
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
