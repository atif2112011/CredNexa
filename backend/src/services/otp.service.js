import bcrypt from "bcryptjs";
import crypto from "crypto";

import { env } from "../config/env.js";
import { OtpRecord } from "../models/OtpRecord.js";

export const MOCK_OTP = "123456";
export const OTP_EXPIRES_IN_SECONDS = Number.isFinite(env.otpExpiresInSeconds) && env.otpExpiresInSeconds > 0 ? env.otpExpiresInSeconds : 900;
export const OTP_RESEND_COOLDOWN_SECONDS =
  Number.isFinite(env.otpResendCooldownSeconds) && env.otpResendCooldownSeconds > 0 ? env.otpResendCooldownSeconds : 30;
export const OTP_DELIVERY_ERROR_MESSAGE = "Unable to send OTP right now";

export const OTP_PROVIDERS = Object.freeze({
  MOCK: "mock",
  MSG91: "msg91"
});

const MSG91_OTP_BASE_URL = "https://control.msg91.com/api/v5/otp";

const getMsg91Config = () => {
  if (!env.msg91AuthKey || !env.msg91OtpTemplateId) {
    throw new Error("MSG91 OTP configuration is missing");
  }

  return {
    authKey: env.msg91AuthKey,
    templateId: env.msg91OtpTemplateId,
    defaultCountryCode: env.msg91DefaultCountryCode || "91",
    resendRetryType: env.msg91ResendRetryType || "text"
  };
};

export const normalizeMobileForMsg91 = (mobile) => {
  const digits = String(mobile || "").trim().replace(/\D/g, "").replace(/^0+/, "");
  const countryCode = String(env.msg91DefaultCountryCode || "91").replace(/\D/g, "") || "91";

  if (digits.startsWith(countryCode) && digits.length > 10) {
    return digits;
  }

  return `${countryCode}${digits}`;
};

const createVerificationSessionId = () => `otp_${crypto.randomBytes(12).toString("hex")}`;
const generateOtpCode = () => String(crypto.randomInt(100000, 1000000));
const getOtpExpiryMinutes = () => Math.ceil(OTP_EXPIRES_IN_SECONDS / 60);

const getRemainingSeconds = (date) => Math.max(Math.ceil((date.getTime() - Date.now()) / 1000), 0);

const getLastOtpSentAt = (otpRecord) => {
  const timestamp = otpRecord.providerResponse?.lastResentAt || otpRecord.providerResponse?.lastSentAt || otpRecord.createdAt;
  const date = timestamp ? new Date(timestamp) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const assertResendCooldownElapsed = (otpRecord) => {
  const lastOtpSentAt = getLastOtpSentAt(otpRecord);
  if (!lastOtpSentAt) return;

  const elapsedSeconds = Math.floor((Date.now() - lastOtpSentAt.getTime()) / 1000);
  const retryAfterSeconds = OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds;
  if (retryAfterSeconds > 0) {
    const error = new Error(`Please wait ${retryAfterSeconds} seconds before requesting OTP again`);
    error.statusCode = 429;
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
};

const parseProviderResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const assertMsg91Success = ({ response, body, action }) => {
  const responseType = String(body?.type || body?.status || "").trim().toLowerCase();
  const failed =
    !response.ok ||
    ["error", "failure", "failed"].includes(responseType) ||
    body?.success === false ||
    body?.status === false;

  if (failed) {
    const error = new Error(`MSG91 OTP ${action} failed`);
    error.providerResponse = body;
    error.status = response.status;
    throw error;
  }
};

const logOtpProviderError = ({ action, provider, error, mobile, normalizedMobile, purpose, flowType, otpRecord }) => {
  console.error(`OTP provider ${action} failed`, {
    provider,
    mobile,
    normalizedMobile,
    purpose,
    flowType,
    verificationSessionId: otpRecord?.verificationSessionId,
    status: error.status,
    message: error.message,
    providerResponse: error.providerResponse
  });
};

const callMsg91 = async ({ url, action, mobile, normalizedMobile, purpose, flowType, otpRecord }) => {
  let response;
  let body;

  try {
    response = await fetch(url);
    body = await parseProviderResponse(response);
    assertMsg91Success({ response, body, action });
    return body;
  } catch (error) {
    logOtpProviderError({
      action,
      provider: OTP_PROVIDERS.MSG91,
      error,
      mobile,
      normalizedMobile,
      purpose,
      flowType,
      otpRecord
    });
    throw new Error(OTP_DELIVERY_ERROR_MESSAGE);
  }
};

const sendMockOtp = async ({ mobile, purpose, user, enrollmentToken, flowType, metadata = {} }) => {
  const verificationSessionId = createVerificationSessionId();
  const otpHash = await bcrypt.hash(MOCK_OTP, 12);
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_IN_SECONDS * 1000);
  const providerReferenceId = `mock_otp_ref_${crypto.randomBytes(8).toString("hex")}`;

  await OtpRecord.create({
    mobile,
    otpHash,
    purpose,
    verificationSessionId,
    enrollmentTokenId: enrollmentToken?._id,
    userId: user?._id,
    provider: OTP_PROVIDERS.MOCK,
    providerReferenceId,
    maxAttempts: 3,
    expiresAt,
    providerResponse: {
      provider: OTP_PROVIDERS.MOCK,
      mode: "mock",
      status: "OTP_SENT",
      flowType,
      otpLength: 6,
      expiresInSeconds: OTP_EXPIRES_IN_SECONDS,
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      lastSentAt: new Date(),
      ...metadata
    }
  });

  return {
    verificationSessionId,
    providerReferenceId,
    expiresInSeconds: OTP_EXPIRES_IN_SECONDS,
    retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS
  };
};

const sendMsg91Otp = async ({ mobile, purpose, user, enrollmentToken, flowType, metadata = {} }) => {
  const config = getMsg91Config();
  const verificationSessionId = createVerificationSessionId();
  const otp = generateOtpCode();
  const otpHash = await bcrypt.hash(otp, 12);
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_IN_SECONDS * 1000);
  const normalizedMobile = normalizeMobileForMsg91(mobile);
  const url = new URL(MSG91_OTP_BASE_URL);

  url.searchParams.set("template_id", config.templateId);
  url.searchParams.set("mobile", normalizedMobile);
  url.searchParams.set("authkey", config.authKey);
  url.searchParams.set("otp", otp);
  url.searchParams.set("otp_expiry", String(getOtpExpiryMinutes()));
  url.searchParams.set("otp_length", "6");

  const body = await callMsg91({
    url,
    action: "send",
    mobile,
    normalizedMobile,
    purpose,
    flowType
  });
  const providerReferenceId = body.request_id || body.message || `msg91_${crypto.randomBytes(8).toString("hex")}`;

  await OtpRecord.create({
    mobile,
    otpHash,
    purpose,
    verificationSessionId,
    enrollmentTokenId: enrollmentToken?._id,
    userId: user?._id,
    provider: OTP_PROVIDERS.MSG91,
    providerReferenceId,
    maxAttempts: 3,
    expiresAt,
    providerResponse: {
      provider: OTP_PROVIDERS.MSG91,
      status: "OTP_SENT",
      to: normalizedMobile,
      flowType,
      otpLength: 6,
      expiresInSeconds: OTP_EXPIRES_IN_SECONDS,
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      lastSentAt: new Date(),
      response: body,
      ...metadata
    }
  });

  return {
    verificationSessionId,
    providerReferenceId,
    expiresInSeconds: OTP_EXPIRES_IN_SECONDS,
    retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS
  };
};

export const sendOtp = async (payload) => {
  if (env.otpProvider === OTP_PROVIDERS.MSG91) {
    return sendMsg91Otp(payload);
  }

  return sendMockOtp(payload);
};

export const verifyOtpCode = async ({ otpRecord, otp }) => {
  if (otpRecord.provider === OTP_PROVIDERS.MSG91) {
    const config = getMsg91Config();
    const normalizedMobile = otpRecord.providerResponse?.to || normalizeMobileForMsg91(otpRecord.mobile);
    const url = new URL(`${MSG91_OTP_BASE_URL}/verify`);

    url.searchParams.set("mobile", normalizedMobile);
    url.searchParams.set("otp", String(otp));
    url.searchParams.set("authkey", config.authKey);

    let response;
    let body;

    try {
      response = await fetch(url);
      body = await parseProviderResponse(response);
      if (!response.ok) {
        const error = new Error("MSG91 OTP verify failed");
        error.providerResponse = body;
        error.status = response.status;
        throw error;
      }
    } catch (error) {
      logOtpProviderError({
        action: "verify",
        provider: OTP_PROVIDERS.MSG91,
        error,
        mobile: otpRecord.mobile,
        normalizedMobile,
        purpose: otpRecord.purpose,
        otpRecord
      });
      throw new Error(OTP_DELIVERY_ERROR_MESSAGE);
    }

    otpRecord.providerResponse = {
      ...(otpRecord.providerResponse || {}),
      verifyResponse: body,
      checkedAt: new Date()
    };

    const responseType = String(body?.type || body?.status || "").trim().toLowerCase();
    return response.ok && (responseType === "success" || body?.success === true);
  }

  if (!otpRecord.otpHash) {
    return false;
  }

  return bcrypt.compare(String(otp), otpRecord.otpHash);
};

export const resendOtp = async ({ otpRecord, retryType } = {}) => {
  if (!otpRecord) {
    throw new Error("OTP record is required");
  }

  assertResendCooldownElapsed(otpRecord);

  if (otpRecord.provider === OTP_PROVIDERS.MSG91) {
    const config = getMsg91Config();
    const normalizedMobile = otpRecord.providerResponse?.to || normalizeMobileForMsg91(otpRecord.mobile);
    const url = new URL(`${MSG91_OTP_BASE_URL}/retry`);

    url.searchParams.set("mobile", normalizedMobile);
    url.searchParams.set("authkey", config.authKey);
    url.searchParams.set("retrytype", retryType || config.resendRetryType);

    const body = await callMsg91({
      url,
      action: "resend",
      mobile: otpRecord.mobile,
      normalizedMobile,
      purpose: otpRecord.purpose,
      otpRecord
    });

    otpRecord.providerResponse = {
      ...(otpRecord.providerResponse || {}),
      status: "OTP_RESENT",
      resendCount: Number(otpRecord.providerResponse?.resendCount || 0) + 1,
      lastResentAt: new Date(),
      lastResendResponse: body
    };
    await otpRecord.save();

    return {
      providerReferenceId: otpRecord.providerReferenceId,
      expiresInSeconds: getRemainingSeconds(otpRecord.expiresAt),
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS
    };
  }

  otpRecord.providerResponse = {
    ...(otpRecord.providerResponse || {}),
    status: "OTP_RESENT",
    resendCount: Number(otpRecord.providerResponse?.resendCount || 0) + 1,
    lastResentAt: new Date()
  };
  await otpRecord.save();

  return {
    providerReferenceId: otpRecord.providerReferenceId,
    expiresInSeconds: getRemainingSeconds(otpRecord.expiresAt),
    retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS
  };
};
