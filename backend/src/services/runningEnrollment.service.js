import crypto from "crypto";

import { env } from "../config/env.js";
import { ENROLLMENT_MODES, getEnrollmentMode } from "../constants/enrollmentModes.js";
import { EnrollmentToken } from "../models/EnrollmentToken.js";

export const RUNNING_REQUIREMENTS_VERSION = 1;

export const assertRunningEnrollmentConfigured = () => {
  getEncryptionKey();
  buildRunningQrText("configuration-check");
};

const getEncryptionKey = () => {
  if (!/^[a-f\d]{64}$/i.test(env.runningEnrollmentSecretKey || "")) {
    throw new Error("RUNNING_ENROLLMENT_SECRET_KEY must be 32 bytes of hex before running enrollment is enabled");
  }
  return Buffer.from(env.runningEnrollmentSecretKey, "hex");
};

export const hashRunningSecret = (secret) =>
  crypto.createHash("sha256").update(String(secret || "")).digest("hex");

export const createRunningSecret = () => crypto.randomBytes(32).toString("base64url");

export const encryptRunningSecret = (secret) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
};

export const decryptRunningSecret = (ciphertext) => {
  const [iv, tag, encrypted] = String(ciphertext || "").split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !encrypted) {
    throw new Error("Invalid encrypted running enrollment secret");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
};

export const createRunningTokenFields = () => {
  const secret = createRunningSecret();
  return {
    // The existing required token field holds a non-secret internal identifier for running claims.
    token: `run_${crypto.randomBytes(18).toString("hex")}`,
    runningTokenHash: hashRunningSecret(secret),
    runningTokenCiphertext: encryptRunningSecret(secret),
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP
  };
};

export const buildRunningQrText = (secret) => {
  const base = new URL(env.runningEnrollmentLinkBase || "");
  if (base.protocol !== "https:") throw new Error("RUNNING_ENROLLMENT_LINK_BASE must use https");
  base.searchParams.set("code", secret);
  return base.toString();
};

export const findEnrollmentTokenBySecret = (secret, options = {}) => {
  const value = String(secret || "").trim();
  // Return a query even for malformed input so legacy callers can still chain .lean().
  if (!value || value.length > 256) return EnrollmentToken.findOne({ _id: null });
  const filter = {
    $or: [
      { token: value, enrollmentMode: { $in: [ENROLLMENT_MODES.DEVICE_OWNER_QR, null] } },
      { runningTokenHash: hashRunningSecret(value), enrollmentMode: ENROLLMENT_MODES.RUNNING_APP }
    ],
    ...options
  };
  return EnrollmentToken.findOne(filter).select("+runningTokenHash");
};

export const matchesEnrollmentSecret = (enrollmentToken, secret) => {
  if (getEnrollmentMode(enrollmentToken) !== ENROLLMENT_MODES.RUNNING_APP) {
    return enrollmentToken?.token === secret;
  }
  const expected = enrollmentToken?.runningTokenHash;
  const received = hashRunningSecret(secret);
  if (!expected || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
};

export const validateRunningCapabilities = (capabilities) => {
  if (!capabilities || typeof capabilities !== "object") return "Capabilities are required";
  if (capabilities.notificationsAllowed !== true) return "Notification access is required";
  if (capabilities.overlayAllowed !== true) return "Overlay access is required";
  const observedAt = new Date(capabilities.observedAt);
  if (!Number.isFinite(observedAt.getTime()) || Math.abs(Date.now() - observedAt.getTime()) > 5 * 60 * 1000) {
    return "A fresh capability check is required";
  }
  return null;
};

export const normalizeImei = (value) => String(value || "").replace(/[\s-]/g, "");

export const isValidImei = (value) => {
  const imei = normalizeImei(value);
  if (!/^\d{15}$/.test(imei)) return false;
  const sum = imei.split("").reduce((total, digit, index) => {
    const doubled = Number(digit) * (index % 2 === 1 ? 2 : 1);
    return total + Math.floor(doubled / 10) + (doubled % 10);
  }, 0);
  return sum % 10 === 0;
};

// A retry ID is for response deduplication only. Authentication remains the borrower JWT.
export const isValidActivationRequestId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
