import crypto from "crypto";

import jwt from "jsonwebtoken";
import QRCode from "qrcode";

import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { env } from "../config/env.js";
import { AuditLog } from "../models/AuditLog.js";
import { Device } from "../models/Device.js";
import {
  MANUAL_OVERRIDE_TOKEN_STATUSES,
  ManualOverrideToken
} from "../models/ManualOverrideToken.js";
import { Tenant } from "../models/Tenant.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const ACTIVE_TOKEN_STATUSES = [
  MANUAL_OVERRIDE_TOKEN_STATUSES.GENERATED,
  MANUAL_OVERRIDE_TOKEN_STATUSES.DOWNLOADED
];

const USABLE_TOKEN_STATUSES = [
  MANUAL_OVERRIDE_TOKEN_STATUSES.GENERATED,
  MANUAL_OVERRIDE_TOKEN_STATUSES.DOWNLOADED,
  MANUAL_OVERRIDE_TOKEN_STATUSES.SUPERSEDED
];

const normalizePem = (value) => {
  let normalized = String(value || "").trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
};

const getManualOverrideSigningKey = () => {
  try {
     console.log("Key in getManualOverrideSigningKey",normalizePem(env.manualOverridePrivateKey))
    const key = crypto.createPrivateKey({
      key: normalizePem(env.manualOverridePrivateKey),
      format: "pem"
    });

   

    const modulusLength = key.asymmetricKeyDetails?.modulusLength;
    if (
      env.manualOverrideSigningAlgorithm?.startsWith("RS") &&
      modulusLength &&
      modulusLength < 2048 &&
      !env.manualOverrideAllowInsecureKeySize
    ) {
      throw new Error(
        `Loaded RSA private key is ${modulusLength}-bit. RS256 requires at least 2048-bit unless MANUAL_OVERRIDE_ALLOW_INSECURE_KEY_SIZE=true.`
      );
    }

    return key;
  } catch (error) {
    throw new Error(
      `MANUAL_OVERRIDE_PRIVATE_KEY must be a valid PEM RSA private key. Store it as a single env value with literal \\n line breaks. ${error.message}`
    );
  }
};

const getTokenWindow = ({ now = new Date(), validityDays = env.manualOverrideTokenValidityDays } = {}) => {
  const issuedAt = new Date(now);
  const expiresAt = new Date(issuedAt.getTime() + Number(validityDays || 30) * DAY_IN_MS);
  return { issuedAt, expiresAt };
};

const getRenewalThreshold = ({ now = new Date(), renewalWindowDays = env.manualOverrideRenewalWindowDays } = {}) => {
  return new Date(now.getTime() + Number(renewalWindowDays || 7) * DAY_IN_MS);
};

const createAuditLog = async (payload) => AuditLog.create(payload);

const buildManualOverridePayload = ({ tokenId, deviceId, issuedAt, expiresAt }) => ({
  tokenId,
  deviceId: deviceId.toString(),
  purpose: "MANUAL_OVERRIDE",
  issuedAt: issuedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  keyId: env.manualOverridePublicKeyId,
  iat: Math.floor(issuedAt.getTime() / 1000),
  exp: Math.floor(expiresAt.getTime() / 1000)
});

const signManualOverridePayload = (payload) => {
  if (!env.manualOverridePrivateKey) {
    throw new Error("MANUAL_OVERRIDE_PRIVATE_KEY is required to generate manual override tokens");
  }



  return jwt.sign(payload, getManualOverrideSigningKey(), {
    algorithm: env.manualOverrideSigningAlgorithm,
    keyid: env.manualOverridePublicKeyId,
    allowInsecureKeySizes: env.manualOverrideAllowInsecureKeySize
  });
};

const getDeviceTenant = async (device, options = {}) => {
  const query = Tenant.findById(device.tenantId).select("channelPartnerId").lean();
  if (options.session) query.session(options.session);
  return query;
};

export const hasValidManualOverrideToken = async (deviceId, options = {}) => {
  const minValidUntil = options.minValidUntil || new Date();
  const token = await ManualOverrideToken.findOne({
    deviceId,
    status: { $in: ACTIVE_TOKEN_STATUSES },
    expiresAt: { $gt: minValidUntil }
  })
    .sort({ expiresAt: -1 })
    .lean();

  return Boolean(token);
};

export const generateManualOverrideTokenForDevice = async (device, options = {}) => {
  const now = options.now || new Date();
  const { issuedAt, expiresAt } = getTokenWindow({ now, validityDays: options.validityDays });
  const tokenId = options.tokenId || `mot_${crypto.randomUUID()}`;
  const tenant = await getDeviceTenant(device, options);
  const payload = buildManualOverridePayload({ tokenId, deviceId: device._id, issuedAt, expiresAt });
  const signedToken = signManualOverridePayload(payload);
  const qrDataUrl = await QRCode.toDataURL(signedToken, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512
  });

  if (options.supersedeExisting !== false) {
    await ManualOverrideToken.updateMany(
      {
        deviceId: device._id,
        status: { $in: ACTIVE_TOKEN_STATUSES }
      },
      {
        $set: {
          status: MANUAL_OVERRIDE_TOKEN_STATUSES.SUPERSEDED,
          supersededAt: now
        }
      },
      { session: options.session }
    );
  }

  const tokens = await ManualOverrideToken.create(
    [
      {
        tokenId,
        deviceId: device._id,
        userId: device.userId,
        tenantId: device.tenantId,
        channelPartnerId: tenant?.channelPartnerId,
        issuedAt,
        expiresAt,
        signedToken,
        qrDataUrl,
        reason: options.reason || "Emergency offline manual override",
        generatedBy: options.generatedBy,
        metadata: {
          source: options.source || "manual",
          signingAlgorithm: env.manualOverrideSigningAlgorithm,
          keyId: env.manualOverridePublicKeyId,
          ...options.metadata
        }
      }
    ],
    { ordered: true, session: options.session }
  );

  const token = tokens[0];

  await createAuditLog({
    eventType: options.auditEventType || AUDIT_EVENTS.MANUAL_OVERRIDE_TOKEN_GENERATED,
    actorId: options.generatedBy,
    actorCollection: options.generatedBy ? "accounts" : "system",
    tenantId: device.tenantId,
    channelPartnerId: tenant?.channelPartnerId,
    userId: device.userId,
    deviceId: device._id,
    reason: options.reason,
    metadata: {
      tokenId,
      expiresAt,
      source: options.source || "manual"
    }
  });

  return token;
};

export const recordManualOverrideTokenUsage = async ({ tokenId, device, deviceEvent, manualOverride }) => {
  if (!tokenId) {
    return { used: false, reason: "TOKEN_ID_MISSING" };
  }

  const token = await ManualOverrideToken.findOne({ tokenId, deviceId: device._id });
  if (!token) {
    return { used: false, reason: "TOKEN_NOT_FOUND" };
  }

  const now = new Date();
  if (token.expiresAt <= now) {
    if (token.status !== MANUAL_OVERRIDE_TOKEN_STATUSES.EXPIRED) {
      token.status = MANUAL_OVERRIDE_TOKEN_STATUSES.EXPIRED;
      await token.save();
    }
    return { used: false, reason: "TOKEN_EXPIRED" };
  }

  if (!USABLE_TOKEN_STATUSES.includes(token.status)) {
    return { used: false, reason: `TOKEN_${token.status}` };
  }

  token.status = MANUAL_OVERRIDE_TOKEN_STATUSES.USED;
  token.usedAt = now;
  token.usedSyncEventId = deviceEvent?._id;
  token.metadata = {
    ...(token.metadata || {}),
    lastManualOverrideSync: manualOverride || {}
  };
  await token.save();

  await createAuditLog({
    eventType: AUDIT_EVENTS.MANUAL_OVERRIDE_TOKEN_USED,
    actorId: device.userId,
    actorCollection: "users",
    tenantId: device.tenantId,
    channelPartnerId: token.channelPartnerId,
    userId: device.userId,
    deviceId: device._id,
    metadata: {
      tokenId,
      activatedAt: manualOverride?.activatedAt,
      syncEventId: deviceEvent?._id
    }
  });

  return { used: true, token };
};

const buildDeviceQuery = (filters = {}) => {
  const query = {};
  if (filters.deviceId) query._id = filters.deviceId;
  if (filters.tenantId) query.tenantId = filters.tenantId;
  return query;
};

export const backfillManualOverrideTokens = async (options = {}) => {
  const limit = Math.min(Math.max(Number(options.limit || 500), 1), 1000);
  const minValidUntil = options.minValidUntil || new Date();
  const devices = await Device.find(buildDeviceQuery(options)).limit(limit);
  const result = {
    scanned: devices.length,
    created: 0,
    skippedAlreadyValid: 0,
    failed: 0,
    dryRunWouldCreate: 0,
    errors: []
  };

  for (const device of devices) {
    try {
      const hasValidToken = await hasValidManualOverrideToken(device._id, { minValidUntil });
      if (hasValidToken) {
        result.skippedAlreadyValid += 1;
        continue;
      }

      if (options.dryRun) {
        result.dryRunWouldCreate += 1;
        continue;
      }

      await generateManualOverrideTokenForDevice(device, {
        generatedBy: options.generatedBy,
        reason: options.reason || "Manual override token backfill",
        source: options.source || "backfill",
        auditEventType: options.auditEventType || AUDIT_EVENTS.MANUAL_OVERRIDE_TOKEN_BACKFILLED
      });
      result.created += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ deviceId: device._id, message: error.message });
    }
  }

  return result;
};

export const renewExpiringManualOverrideTokens = async (options = {}) => {
  return backfillManualOverrideTokens({
    ...options,
    minValidUntil: options.minValidUntil || getRenewalThreshold(options),
    reason: options.reason || "Manual override token renewal",
    source: options.source || "renewal",
    auditEventType: AUDIT_EVENTS.MANUAL_OVERRIDE_TOKEN_RENEWED
  });
};

export const expireManualOverrideTokens = async (now = new Date()) => {
  const result = await ManualOverrideToken.updateMany(
    {
      status: { $in: ACTIVE_TOKEN_STATUSES },
      expiresAt: { $lte: now }
    },
    {
      $set: {
        status: MANUAL_OVERRIDE_TOKEN_STATUSES.EXPIRED
      }
    }
  );

  return result.modifiedCount || 0;
};

export const getManualOverrideTokenExpiryThreshold = getRenewalThreshold;
