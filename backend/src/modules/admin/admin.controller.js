import bcrypt from "bcryptjs";
import crypto from "crypto";
import mongoose from "mongoose";

import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import { DEFAULT_DEVICE_POLICIES, DEFAULT_TENANT_POLICY } from "../../constants/defaultPolicies.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../../constants/deviceStates.js";
import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { TENANT_CAPABILITIES, TENANT_TYPES } from "../../constants/tenant.js";
import { Account } from "../../models/Account.js";
import { APP_BUILD_CHANNELS, APP_BUILD_PLATFORMS, APP_BUILD_STATUSES, APP_BUILD_TYPES, AppBuild } from "../../models/AppBuild.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ChannelPartner } from "../../models/ChannelPartner.js";
import { ConsentVersion } from "../../models/ConsentVersion.js";
import { Device } from "../../models/Device.js";
import { DeviceCommand } from "../../models/DeviceCommand.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { EmiSchedule } from "../../models/EmiSchedule.js";
import { FcmDeliveryLog } from "../../models/FcmDeliveryLog.js";
import { IntegrityCheck } from "../../models/IntegrityCheck.js";
import { MANUAL_OVERRIDE_TOKEN_STATUSES, ManualOverrideToken } from "../../models/ManualOverrideToken.js";
import {
  PARTNER_CREDIT_BALANCE_TYPES,
  PARTNER_CREDIT_LEDGER_TYPES,
  PartnerCreditLedger
} from "../../models/PartnerCreditLedger.js";
import { PARTNER_PAYOUT_STATUSES, PartnerPayoutRequest } from "../../models/PartnerPayoutRequest.js";
import { PayoutConstants } from "../../models/PayoutConstants.js";
import { INACTIVE_RISK_FLAG_STATUSES, RISK_FLAG_STATUSES, RiskFlag } from "../../models/RiskFlag.js";
import { Tenant } from "../../models/Tenant.js";
import { TENANT_CREDIT_PURCHASE_STATUSES, TenantCreditPurchaseRequest } from "../../models/TenantCreditPurchaseRequest.js";
import { TenantCreditLedger, TENANT_CREDIT_LEDGER_TYPES } from "../../models/TenantCreditLedger.js";
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { UnlockRequest } from "../../models/UnlockRequest.js";
import {ProvisioningDetails} from "../../models/ProvisioningDetails.js";
import { User } from "../../models/User.js";
import {
  BORROWER_ANDROID_PACKAGE_NAME,
  publishBuild,
  uploadBuildApk,
  validateAppBuildIdentity,
  validateBuildPayload
} from "../../services/appUpdate.service.js";
import {
  backfillManualOverrideTokens,
  generateManualOverrideTokenForDevice,
  renewExpiringManualOverrideTokens
} from "../../services/manualOverrideToken.service.js";
import {
  getActiveCriticalRiskFlagsForDevice,
  getActiveRiskFilter
} from "../../services/riskManagement.service.js";
import { buildEmptyTenantMetrics, safeRefreshTenantMetrics } from "../../services/tenantMetrics.service.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import { hasRequiredFields, isValidObjectId } from "../../utils/validators.js";
import { runFcmDeliveryBatch } from "../../jobs/fcmDeliveryWorker.js";
import {
  NOTIFICATION_AUDIENCES,
  queuePartnerAppNotification,
  queueTenantAppNotification,
  safeQueueNotification
} from "../../utils/appNotifications.js";
import { uploadImageToFirebase } from "../../utils/firebaseImageUpload.js";
import {
  calculatePartnerCreditAmount,
  getOrCreatePayoutConstants,
  getPartnerCreditPercentage,
  isValidUpiId,
  parseRupeeAmount,
  roundRupeeAmount
} from "../../utils/payout.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const buildPagination = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit)
});

const buildRegex = (value) => new RegExp(String(value).trim(), "i");

const escapeRegex = (value) => String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isTruthyQueryParam = (value) => ["true", "1", "yes"].includes(String(value || "").trim().toLowerCase());

const createTemporaryPassword = () => `CNX-${crypto.randomBytes(6).toString("base64url")}Aa1!`;

const parseBoolean = (value) => value === true || isTruthyQueryParam(value);
const normalizeMobile = (mobile) => String(mobile || "").trim();
const isValidIndianMobile = (mobile) => /^\d{10}$/.test(normalizeMobile(mobile));

const normalizeAddressPayload = (payload = {}) => {
  const addressInput = payload.address && typeof payload.address === "object" && !Array.isArray(payload.address) ? payload.address : {};

  return {
    street: String(addressInput.street || payload.street || payload.address || "").trim(),
    city: String(addressInput.city || payload.city || "").trim(),
    state: String(addressInput.state || payload.state || "").trim(),
    pincode: String(addressInput.pincode || payload.pincode || "").trim()
  };
};

const getAddressValidationError = (address) => {
  if (!address.street) return "address.street is required";
  if (!address.city) return "address.city is required";
  if (!address.state) return "address.state is required";
  if (!address.pincode) return "address.pincode is required";
  return null;
};

const normalizeTenantPocPayload = (payload = {}) => ({
  pocName: String(payload.pocName || "").trim(),
  pocPhone: normalizeMobile(payload.pocPhone),
  pocDesignation: String(payload.pocDesignation || "").trim()
});

const WIPE_ELIGIBLE_RISK_TYPES = new Set([
  "DEVICE_INTEGRITY_COMPROMISED",
  "ROOT_DETECTED",
  "TAMPER_DETECTED",
  "SYSTEM_TAMPER_DETECTED",
  "CUSTOM_ROM_DETECTED",
  "BOOTLOADER_UNLOCKED"
]);

const isRiskFlagWipeEligible = (riskFlag) => {
  const riskType = riskFlag?.riskType || riskFlag?.type;
  return (
    riskFlag?.severity === "critical" &&
    (riskFlag?.riskBucket === "device_compromise" ||
      riskFlag?.status === RISK_FLAG_STATUSES.COMPROMISED_PERMANENT ||
      WIPE_ELIGIBLE_RISK_TYPES.has(riskType))
  );
};

const getTenantPocValidationError = ({ pocName, pocPhone, pocDesignation }) => {
  if (!pocName) return "pocName is required";
  if (!pocPhone) return "pocPhone is required";
  if (!isValidIndianMobile(pocPhone)) return "pocPhone must be a valid 10 digit mobile number";
  if (!pocDesignation) return "pocDesignation is required";
  return null;
};

const NOTIFICATION_TARGET_APPS = Object.freeze({
  BORROWER_APP: "borrower_app",
  TENANT_APP: "tenant_app",
  PARTNER_APP: "partner_app"
});

const createAuditLog = async (payload, options = {}) => {
  return AuditLog.create([payload], { ordered: true, ...options }).then((items) => items[0]);
};

const buildManualOverrideTokenResponse = (token, { includeQr = false } = {}) => {
  const response = {
    _id: token._id,
    tokenId: token.tokenId,
    deviceId: token.deviceId,
    userId: token.userId,
    tenantId: token.tenantId,
    channelPartnerId: token.channelPartnerId,
    status: token.status,
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
    usedAt: token.usedAt,
    downloadedAt: token.downloadedAt,
    supersededAt: token.supersededAt,
    revokedAt: token.revokedAt,
    reason: token.reason,
    generatedBy: token.generatedBy,
    downloadedBy: token.downloadedBy,
    usedSyncEventId: token.usedSyncEventId,
    metadata: token.metadata,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt
  };

  if (includeQr) {
    response.signedToken = token.signedToken;
    response.qrDataUrl = token.qrDataUrl;
  }

  return response;
};

const isValidPercentage = (value) => {
  const percentage = Number(value);
  return Number.isFinite(percentage) && percentage >= 0 && percentage <= 100;
};

const buildPartnerPayoutProof = async ({ req, payoutRequest, channelPartner }) => {
  if (req.file) {
    return uploadImageToFirebase({
      file: req.file,
      folder: "partner-payout-proofs",
      recordId: payoutRequest._id,
      userId: req.auth.id,
      tenantId: channelPartner._id,
      metadata: {
        payoutRequestId: payoutRequest._id.toString(),
        channelPartnerId: channelPartner._id.toString()
      },
      purpose: "screenshot"
    });
  }

  const imageUrl = String(req.body.paymentProofImageUrl || "").trim();
  if (!imageUrl) return null;

  return {
    imageUrl,
    uploadedAt: new Date()
  };
};

const awardPartnerCreditForTenantCreditPurchase = async ({
  tenant,
  keysPurchased,
  perKeyPrice,
  purchaseAmount,
  tenantCreditLedgerId,
  actorId,
  reason,
  session
}) => {
  if (!tenant?.channelPartnerId || purchaseAmount <= 0) return null;

  const payoutConstants = await getOrCreatePayoutConstants(session);
  const channelPartner = await ChannelPartner.findById(tenant.channelPartnerId).session(session);
  if (!channelPartner) return null;

  const creditPercentage = getPartnerCreditPercentage(channelPartner, payoutConstants);
  const creditAmount = calculatePartnerCreditAmount({ purchaseAmount, creditPercentage });

  if (creditAmount <= 0) {
    return {
      channelPartnerId: channelPartner._id,
      creditPercentage,
      creditAmount: 0,
      purchaseAmount
    };
  }

  const balanceBefore = roundRupeeAmount(channelPartner.availablePayoutBalance || 0);
  const balanceAfter = roundRupeeAmount(balanceBefore + creditAmount);

  channelPartner.creditPercentage = creditPercentage;
  channelPartner.availablePayoutBalance = balanceAfter;
  channelPartner.lifetimePayoutEarned = roundRupeeAmount(Number(channelPartner.lifetimePayoutEarned || 0) + creditAmount);
  await channelPartner.save({ session });

  const ledgerEntries = await PartnerCreditLedger.create(
    [
      {
        channelPartnerId: channelPartner._id,
        tenantId: tenant._id,
        tenantCreditLedgerId,
        type: PARTNER_CREDIT_LEDGER_TYPES.TENANT_KEY_PURCHASE_COMMISSION,
        balanceType: PARTNER_CREDIT_BALANCE_TYPES.AVAILABLE,
        delta: creditAmount,
        balanceBefore,
        balanceAfter,
        keysPurchased,
        perKeyPrice,
        purchaseAmount,
        creditPercentage,
        actorId,
        actorCollection: "accounts",
        reason: reason || "Tenant credit purchase commission",
        metadata: {
          source: "tenant_credit_purchase",
          formula: "keysPurchased * perKeyPrice * creditPercentage / 100"
        }
      }
    ],
    { session, ordered: true }
  );

  await createAuditLog(
    {
      eventType: AUDIT_EVENTS.PARTNER_CREDIT_EARNED,
      actorId,
      tenantId: tenant._id,
      channelPartnerId: channelPartner._id,
      reason,
      metadata: {
        keysPurchased,
        perKeyPrice,
        purchaseAmount,
        creditPercentage,
        creditAmount,
        balanceBefore,
        balanceAfter,
        partnerCreditLedgerId: ledgerEntries[0]._id,
        tenantCreditLedgerId
      }
    },
    { session }
  );

  return {
    channelPartnerId: channelPartner._id,
    creditPercentage,
    creditAmount,
    balanceBefore,
    balanceAfter,
    ledgerEntryId: ledgerEntries[0]._id,
    purchaseAmount
  };
};

const getTenantDetailData = async (tenantId) => {
  const [tenant, tenantPolicy, devicePolicies, accounts, deviceSummary, openCases, riskFlags] =
    await Promise.all([
      Tenant.findById(tenantId).populate("channelPartnerId", "name type").lean(),
      TenantPolicy.findOne({ tenantId }).lean(),
      DevicePolicy.find({ tenantId }).sort({ policyKey: 1 }).lean(),
      Account.find({ tenantId }).select("-passwordHash").lean(),
      Device.aggregate([
        { $match: { tenantId: new mongoose.Types.ObjectId(tenantId) } },
        { $group: { _id: "$state", count: { $sum: 1 } } }
      ]),
      UnlockRequest.find({
        tenantId,
        status: { $in: ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"] }
      }).lean(),
      RiskFlag.find(getActiveRiskFilter({ tenantId })).lean()
    ]);

  return {
    tenant,
    tenantPolicy,
    devicePolicies,
    accounts,
    deviceSummary,
    openCases,
    riskFlags
  };
};

const applyEscalationDeviceCommand = async ({
  unlockRequest,
  accountId,
  commandType,
  targetState,
  policyKey,
  reason,
  durationHours,
  session
}) => {
  const deviceUpdate = {
    $set: {
      state: targetState,
      currentPolicyKey: policyKey,
      stateUpdatedAt: new Date(),
      stateUpdatedBy: accountId
    },
    $inc: { desiredPolicyVersion: 1 }
  };

  if (durationHours) {
    deviceUpdate.$set.tempUnlockExpiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  }

  const device = await Device.findByIdAndUpdate(unlockRequest.deviceId, deviceUpdate, {
    new: true,
    session
  });

  const command = await DeviceCommand.create(
    [
      {
        deviceId: unlockRequest.deviceId,
        tenantId: unlockRequest.tenantId,
        commandType,
        triggeredBy: "super_admin",
        triggeredByAccountId: accountId,
        payload: {
          reason,
          policyKey,
          desiredPolicyVersion: device?.desiredPolicyVersion,
          durationHours
        }
      }
    ],
    { session, ordered: true }
  );

  return { device, command: command[0] };
};

const queueAdminDeviceCommand = async ({
  device,
  accountId,
  commandType,
  targetState,
  policyKey,
  reason,
  durationHours,
  extraPayload = {},
  session
}) => {
  const activePolicy = await DevicePolicy.findOne({
    tenantId: device.tenantId,
    policyKey,
    isActive: true
  }).lean();

  if (!activePolicy) {
    throw new Error(`Active ${policyKey} policy not found for tenant`);
  }

  const nextPolicyVersion = Number(device.desiredPolicyVersion || 0) + 1;
  const deviceUpdate = {
    $set: {
      state: targetState,
      stateUpdatedAt: new Date(),
      stateUpdatedBy: accountId,
      currentPolicyKey: policyKey,
      currentPolicyId: activePolicy._id,
      desiredPolicyVersion: nextPolicyVersion
    }
  };

  if (durationHours) {
    deviceUpdate.$set.tempUnlockExpiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  } else {
    deviceUpdate.$unset = { tempUnlockExpiresAt: "" };
  }

  const updatedDevice = await Device.findByIdAndUpdate(device._id, deviceUpdate, {
    new: true,
    session
  });

  const command = await DeviceCommand.create(
    [
      {
        deviceId: device._id,
        tenantId: device.tenantId,
        commandType,
        triggeredBy: "super_admin",
        triggeredByAccountId: accountId,
        payload: {
          reason,
          durationHours,
          policyKey,
          policyVersion: nextPolicyVersion,
          ...extraPayload
        }
      }
    ],
    { session, ordered: true }
  );

  return { device: updatedDevice, command: command[0] };
};

const buildRiskWarningPayload = async (deviceId) => {
  const activeCriticalRiskFlags = await getActiveCriticalRiskFlagsForDevice(deviceId);

  return {
    activeCriticalRiskFlags,
    riskWarning: activeCriticalRiskFlags.length
      ? {
          hasActiveCriticalRisk: true,
          riskFlagIds: activeCriticalRiskFlags.map((flag) => flag._id),
          message: "Active critical security risks exist. Admin override is allowed, but the risk is not cleared."
        }
      : {
          hasActiveCriticalRisk: false,
          riskFlagIds: []
        }
  };
};

const resolveAllUnpaidInstallments = async ({ userId, tenantId, accountId, reason, emiAction, session }) => {
  if (!["mark_paid", "waive"].includes(emiAction)) {
    throw new Error("emiAction must be mark_paid or waive");
  }

  const schedule = await EmiSchedule.findOne({ userId, tenantId }).session(session);
  const unpaidInstallments = schedule?.installments?.filter((item) => ["overdue", "partial", "pending"].includes(item.status)) || [];

  if (!schedule || !unpaidInstallments.length) {
    throw new Error("No unpaid EMI installments found to update");
  }

  for (const installment of unpaidInstallments) {
    if (emiAction === "mark_paid") {
      installment.status = "paid";
      installment.paidAmount = Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0);
      installment.paidAt = new Date();
    } else {
      installment.status = "waived";
      installment.waivedBy = accountId;
      installment.waivedAt = new Date();
      installment.waiveReason = reason;
    }
  }

  schedule.overdueInstallments = schedule.installments.filter((item) => ["overdue", "partial"].includes(item.status)).length;
  schedule.overdueAmount = schedule.installments.reduce((sum, item) => {
    if (!["overdue", "partial"].includes(item.status)) return sum;
    return sum + Math.max(Number(item.emiAmount || 0) + Number(item.penaltyAmount || 0) - Number(item.paidAmount || 0), 0);
  }, 0);
  await schedule.save({ session });

  await Device.updateOne(
    { userId, tenantId },
    { $pull: { graceReminderHistory: { installmentId: { $in: unpaidInstallments.map((item) => item._id) } } } },
    { session }
  );

  return {
    schedule,
    updatedInstallmentIds: unpaidInstallments.map((item) => item._id)
  };
};

/**
 * Super Admin dashboard overview.
 * Sample request: /admin/dashboard
 */
export const getAdminDashboard = async (req, res) => {
  try {
    const openCaseStatuses = ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"];

    const [
      channelPartners,
      tenants,
      accounts,
      users,
      devices,
      devicesByState,
      escalationsByStatus,
      openEscalations,
      riskFlagsByStatus,
      riskFlagsBySeverity,
      recentEscalations,
      recentRiskFlags,
      recentAuditLogs
    ] = await Promise.all([
      ChannelPartner.countDocuments(),
      Tenant.countDocuments(),
      Account.countDocuments(),
      User.countDocuments(),
      Device.countDocuments(),
      Device.aggregate([
        { $group: { _id: "$state", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      UnlockRequest.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      UnlockRequest.countDocuments({ status: { $in: openCaseStatuses } }),
      RiskFlag.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      RiskFlag.aggregate([
        { $group: { _id: "$severity", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      UnlockRequest.find({ status: { $in: openCaseStatuses } })
        .populate("tenantId", "name")
        .populate("channelPartnerId", "name")
        .populate("deviceId", "imei deviceModel manufacturer state")
        .populate("userId", "name mobile loanId")
        .sort({ updatedAt: -1 })
        .limit(8)
        .lean(),
      RiskFlag.find(getActiveRiskFilter()).sort({ createdAt: -1 }).limit(8).lean(),
      AuditLog.find({}).sort({ timestamp: -1 }).limit(10).lean()
    ]);

    const toCountMap = (items) =>
      items.reduce((result, item) => {
        result[item._id || "unknown"] = item.count;
        return result;
      }, {});

    return sendSuccess(res, 200, "Admin dashboard fetched successfully", {
      totals: {
        channelPartners,
        tenants,
        accounts,
        users,
        devices,
        openEscalations
      },
      devicesByState: toCountMap(devicesByState),
      escalationsByStatus: toCountMap(escalationsByStatus),
      riskFlagsByStatus: toCountMap(riskFlagsByStatus),
      riskFlagsBySeverity: toCountMap(riskFlagsBySeverity),
      recentEscalations,
      recentRiskFlags,
      recentAuditLogs
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List channel partners.
 * Sample query: /admin/channel-partners?status=active&type=nbfc_group&search=bharat&page=1&limit=20
 */
export const listChannelPartners = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "inactive") filter.isActive = false;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.search) filter.name = buildRegex(req.query.search);

    const [items, total] = await Promise.all([
      ChannelPartner.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
      ChannelPartner.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Channel partners fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create a channel partner.
 * Sample body: { "name": "Bharat Finance Group", "type": "nbfc_group", "contactEmail": "ops@bharatfinance.in", "contactPhone": "9800000001" }
 */
export const createChannelPartner = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["name", "type"])) {
      return sendError(res, 400, "Name and type are required");
    }

    if (req.body.creditPercentage !== undefined && !isValidPercentage(req.body.creditPercentage)) {
      return sendError(res, 400, "creditPercentage must be between 0 and 100");
    }

    const address = normalizeAddressPayload(req.body);
    const addressError = getAddressValidationError(address);
    if (addressError) {
      return sendError(res, 400, addressError);
    }

    const channelPartner = await ChannelPartner.create({
      ...req.body,
      address,
      createdBy: req.auth.id
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.CHANNEL_PARTNER_CREATED,
      actorId: req.auth.id,
      channelPartnerId: channelPartner._id,
      metadata: { name: channelPartner.name, type: channelPartner.type }
    });

    return sendSuccess(res, 201, "Channel partner created successfully", channelPartner);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get channel partner detail.
 * Sample params: /admin/channel-partners/665f...
 */
export const getChannelPartnerById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid channel partner ID");
    }

    const [channelPartner, tenants, accounts] = await Promise.all([
      ChannelPartner.findById(req.params.id).lean(),
      Tenant.find({ channelPartnerId: req.params.id }).lean(),
      Account.find({ channelPartnerId: req.params.id }).select("-passwordHash").lean()
    ]);

    if (!channelPartner) {
      return sendError(res, 400, "Channel partner not found");
    }

    return sendSuccess(res, 200, "Channel partner fetched successfully", {
      channelPartner,
      tenants,
      accounts
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Update channel partner profile.
 * Sample body: { "name": "Bharat Finance Group", "contactEmail": "ops@bharatfinance.in", "contactPhone": "9800000001" }
 */
export const updateChannelPartner = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid channel partner ID");
    }

    if (req.body.creditPercentage !== undefined && !isValidPercentage(req.body.creditPercentage)) {
      return sendError(res, 400, "creditPercentage must be between 0 and 100");
    }

    const address = normalizeAddressPayload(req.body);
    const addressError = getAddressValidationError(address);
    if (addressError) {
      return sendError(res, 400, addressError);
    }

    const allowedUpdates = ["name", "type", "contactEmail", "contactPhone", "creditPercentage", "payoutUpiId", "payoutUpiName"];
    const updates = {
      ...Object.fromEntries(Object.entries(req.body).filter(([key]) => allowedUpdates.includes(key))),
      address
    };

    const channelPartner = await ChannelPartner.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    });

    if (!channelPartner) {
      return sendError(res, 400, "Channel partner not found");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.CHANNEL_PARTNER_UPDATED,
      actorId: req.auth.id,
      channelPartnerId: channelPartner._id,
      metadata: updates
    });

    if (updates.creditPercentage !== undefined) {
      await createAuditLog({
        eventType: AUDIT_EVENTS.PARTNER_CREDIT_PERCENTAGE_UPDATED,
        actorId: req.auth.id,
        channelPartnerId: channelPartner._id,
        metadata: { creditPercentage: channelPartner.creditPercentage }
      });
    }

    return sendSuccess(res, 200, "Channel partner updated successfully", channelPartner);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Activate or deactivate a channel partner.
 * Sample body: { "isActive": false, "reason": "Contract ended" }
 */
export const updateChannelPartnerStatus = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid channel partner ID");
    }

    if (typeof req.body.isActive !== "boolean") {
      return sendError(res, 400, "isActive boolean is required");
    }

    if (!req.body.isActive && !req.body.reason) {
      return sendError(res, 400, "Reason is required when deactivating a channel partner");
    }

    const channelPartner = await ChannelPartner.findByIdAndUpdate(
      req.params.id,
      { isActive: req.body.isActive },
      { new: true }
    );

    if (!channelPartner) {
      return sendError(res, 400, "Channel partner not found");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.CHANNEL_PARTNER_STATUS_CHANGED,
      actorId: req.auth.id,
      channelPartnerId: channelPartner._id,
      reason: req.body.reason,
      metadata: { isActive: req.body.isActive }
    });

    return sendSuccess(res, 200, "Channel partner status updated successfully", channelPartner);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch payout constants.
 * Sample query: /admin/payout/constants
 */
export const getPayoutConstants = async (req, res) => {
  try {
    const payoutConstants = await getOrCreatePayoutConstants();
    return sendSuccess(res, 200, "Payout constants fetched successfully", payoutConstants);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Update payout constants.
 * Sample body: { "defaultPartnerCreditPercentage": 15, "minPartnerPayoutAmount": 0, "maxPartnerPayoutAmount": 0, "defaultTenantCreditPerKeyPrice": 100 }
 */
export const updatePayoutConstants = async (req, res) => {
  try {
    const updates = {};
    const currentConstants = await getOrCreatePayoutConstants();

    if (req.body.defaultPartnerCreditPercentage !== undefined) {
      if (!isValidPercentage(req.body.defaultPartnerCreditPercentage)) {
        return sendError(res, 400, "defaultPartnerCreditPercentage must be between 0 and 100");
      }
      updates.defaultPartnerCreditPercentage = Number(req.body.defaultPartnerCreditPercentage);
    }

    if (req.body.minPartnerPayoutAmount !== undefined) {
      const minAmount = parseRupeeAmount(req.body.minPartnerPayoutAmount);
      if (minAmount === null || minAmount < 0) {
        return sendError(res, 400, "minPartnerPayoutAmount must be a valid non-negative rupee amount");
      }
      updates.minPartnerPayoutAmount = minAmount;
    }

    if (req.body.maxPartnerPayoutAmount !== undefined) {
      const maxAmount = parseRupeeAmount(req.body.maxPartnerPayoutAmount);
      if (maxAmount === null || maxAmount < 0) {
        return sendError(res, 400, "maxPartnerPayoutAmount must be a valid non-negative rupee amount");
      }
      updates.maxPartnerPayoutAmount = maxAmount;
    }

    if (req.body.defaultTenantCreditPerKeyPrice !== undefined) {
      const perKeyPrice = parseRupeeAmount(req.body.defaultTenantCreditPerKeyPrice);
      if (perKeyPrice === null || perKeyPrice < 0) {
        return sendError(res, 400, "defaultTenantCreditPerKeyPrice must be a valid non-negative rupee amount");
      }
      updates.defaultTenantCreditPerKeyPrice = perKeyPrice;
    }

    if (req.body.minTenantCreditPurchase !== undefined) {
      const minCredits = Number(req.body.minTenantCreditPurchase);
      if (!Number.isInteger(minCredits) || minCredits < 0) {
        return sendError(res, 400, "minTenantCreditPurchase must be a non-negative integer");
      }
      updates.minTenantCreditPurchase = minCredits;
    }

    if (req.body.maxTenantCreditPurchase !== undefined) {
      const maxCredits = Number(req.body.maxTenantCreditPurchase);
      if (!Number.isInteger(maxCredits) || maxCredits < 0) {
        return sendError(res, 400, "maxTenantCreditPurchase must be a non-negative integer");
      }
      updates.maxTenantCreditPurchase = maxCredits;
    }

    if (req.body.adminCreditPurchaseUpiId !== undefined) {
      const upiId = String(req.body.adminCreditPurchaseUpiId || "").trim();
      if (!upiId || !isValidUpiId(upiId)) {
        return sendError(res, 400, "Valid adminCreditPurchaseUpiId is required");
      }
      updates.adminCreditPurchaseUpiId = upiId;
    }

    if (req.body.adminCreditPurchaseUpiName !== undefined) {
      const upiName = String(req.body.adminCreditPurchaseUpiName || "").trim();
      if (!upiName) {
        return sendError(res, 400, "adminCreditPurchaseUpiName is required");
      }
      updates.adminCreditPurchaseUpiName = upiName;
    }

    if (req.body.adminCreditPurchaseQrImageUrl !== undefined) {
      const qrImageUrl = String(req.body.adminCreditPurchaseQrImageUrl || "").trim();
      if (!qrImageUrl) {
        return sendError(res, 400, "adminCreditPurchaseQrImageUrl is required");
      }
      updates.adminCreditPurchaseQrImageUrl = qrImageUrl;
    }

    if (req.file) {
      const uploadedQrImage = await uploadImageToFirebase({
        file: req.file,
        folder: "payout-constants/admin-credit-purchase-qr",
        recordId: currentConstants._id,
        userId: req.auth.id,
        metadata: {
          payoutConstantsId: currentConstants._id.toString(),
          payoutConstantsKey: currentConstants.key
        },
        purpose: "qr-code"
      });

      updates.adminCreditPurchaseQrImageUrl = uploadedQrImage.imageUrl;
      updates.adminCreditPurchaseQrStoragePath = uploadedQrImage.storagePath;
    }

    if (!Object.keys(updates).length) {
      return sendError(res, 400, "At least one payout constant is required");
    }

    const nextMin = updates.minPartnerPayoutAmount ?? Number(currentConstants.minPartnerPayoutAmount || 0);
    const nextMax = updates.maxPartnerPayoutAmount ?? Number(currentConstants.maxPartnerPayoutAmount || 0);

    if (nextMax > 0 && nextMax < nextMin) {
      return sendError(res, 400, "maxPartnerPayoutAmount cannot be less than minPartnerPayoutAmount unless max is 0");
    }

    const nextMinCredits = updates.minTenantCreditPurchase ?? Number(currentConstants.minTenantCreditPurchase || 0);
    const nextMaxCredits = updates.maxTenantCreditPurchase ?? Number(currentConstants.maxTenantCreditPurchase || 0);

    if (nextMaxCredits > 0 && nextMaxCredits < nextMinCredits) {
      return sendError(res, 400, "maxTenantCreditPurchase cannot be less than minTenantCreditPurchase unless max is 0");
    }

    const payoutConstants = await PayoutConstants.findOneAndUpdate(
      { key: currentConstants.key },
      { $set: { ...updates, updatedBy: req.auth.id } },
      { new: true, runValidators: true }
    );

    await createAuditLog({
      eventType: AUDIT_EVENTS.PAYOUT_CONSTANTS_UPDATED,
      actorId: req.auth.id,
      metadata: updates
    });

    return sendSuccess(res, 200, "Payout constants updated successfully", payoutConstants);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List tenants.
 * Sample query: /admin/tenants?channelPartnerId=665f...&capability=lend&status=active&page=1&limit=20
 */
export const listTenants = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.channelPartnerId) {
      if (!isValidObjectId(req.query.channelPartnerId)) {
        return sendError(res, 400, "Invalid channel partner ID");
      }
      filter.channelPartnerId = req.query.channelPartnerId;
    }

    if (req.query.capability) filter.capabilities = req.query.capability;
    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "inactive") filter.isActive = false;
    if (req.query.search) filter.name = buildRegex(req.query.search);

    const [items, total] = await Promise.all([
      Tenant.find(filter).populate("channelPartnerId", "name type").skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
      Tenant.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Tenants fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create tenant and copy centralized default policies.
 * Sample body: { "name": "Bharat Finance - Pune", "type": "nbfc", "capabilities": ["lend","distribute"], "channelPartnerId": "...", "supportPhone": "9800000002", "supportEmail": "support@tenant.in" }
 */
export const createTenant = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const shouldCreateTenantAdmin = isTruthyQueryParam(req.query.app);
    const requiredFields = ["name", "type", "capabilities", "channelPartnerId"];

    if (!hasRequiredFields(req.body, requiredFields)) {
      return sendError(res, 400, "Name, type, capabilities, and channelPartnerId are required");
    }

    if (req.body.tenantPolicy || req.body.devicePolicies) {
      return sendError(res, 400, "tenantPolicy and devicePolicies are managed centrally and cannot be sent in this request");
    }

    if (!Object.values(TENANT_TYPES).includes(req.body.type)) {
      return sendError(res, 400, "Invalid tenant type");
    }

    if (!isValidObjectId(req.body.channelPartnerId)) {
      return sendError(res, 400, "Invalid channel partner ID");
    }

    const capabilities = req.body.capabilities;

    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      return sendError(res, 400, "At least one tenant capability is required");
    }

    const invalidCapability = capabilities.find(
      (capability) => !Object.values(TENANT_CAPABILITIES).includes(capability)
    );

    if (invalidCapability) {
      return sendError(res, 400, `Invalid capability: ${invalidCapability}`);
    }

    const creditPurchasePerKeyPrice =
      req.body.creditPurchasePerKeyPrice !== undefined ? parseRupeeAmount(req.body.creditPurchasePerKeyPrice) : undefined;

    if (req.body.creditPurchasePerKeyPrice !== undefined && (creditPurchasePerKeyPrice === null || creditPurchasePerKeyPrice < 0)) {
      return sendError(res, 400, "creditPurchasePerKeyPrice must be a valid non-negative rupee amount");
    }

    const address = normalizeAddressPayload(req.body);
    const addressError = getAddressValidationError(address);
    if (addressError) {
      return sendError(res, 400, addressError);
    }

    const poc = normalizeTenantPocPayload(req.body);
    const pocError = getTenantPocValidationError(poc);
    if (pocError) {
      return sendError(res, 400, pocError);
    }

    const channelPartner = await ChannelPartner.findOne({
      _id: req.body.channelPartnerId,
      isActive: true
    });

    if (!channelPartner) {
      return sendError(res, 400, "Active channel partner not found");
    }

    let tenantAdminInput = null;
    let tenantAdminPassword = null;

    if (shouldCreateTenantAdmin) {
      tenantAdminInput = req.body.tenantAdmin || {};
      const tenantAdminEmail = String(tenantAdminInput.email || req.body.adminEmail || req.body.supportEmail || "")
        .trim()
        .toLowerCase();
      const requestedTemporaryPassword = tenantAdminInput.temporaryPassword || req.body.temporaryPassword;

      if (!tenantAdminEmail) {
        return sendError(res, 400, "Tenant admin email is required when app=true");
      }

      const existingAccount = await Account.findOne({ email: tenantAdminEmail }).lean();
      if (existingAccount) {
        return sendError(res, 400, "Account with this email already exists");
      }

      tenantAdminInput = {
        name: tenantAdminInput.name || req.body.adminName || `${req.body.name} Admin`,
        email: tenantAdminEmail,
        mobile: tenantAdminInput.mobile || req.body.adminMobile || req.body.supportPhone,
        channelPartnerId: req.body.channelPartnerId
      };
      tenantAdminPassword = requestedTemporaryPassword || createTemporaryPassword();
    }

    session.startTransaction();

    const tenant = await Tenant.create(
      [
        {
          name: req.body.name,
          type: req.body.type,
          capabilities,
          channelPartnerId: req.body.channelPartnerId,
          parentTenantId: req.body.parentTenantId || null,
          supportPhone: req.body.supportPhone,
          supportEmail: req.body.supportEmail,
          supportWhatsapp: req.body.supportWhatsapp,
          address,
          ...poc,
          ...(creditPurchasePerKeyPrice !== undefined ? { creditPurchasePerKeyPrice } : {}),
          metrics: buildEmptyTenantMetrics(),
          isAdhaarVerificationEnabled: false,
          createdBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );

    const createdTenant = tenant[0];
    let createdTenantAdmin = null;

    const tenantPolicies = await TenantPolicy.create(
      [
        {
          tenantId: createdTenant._id,
          ...DEFAULT_TENANT_POLICY,
          updatedBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );
    const tenantPolicy = tenantPolicies[0];

    const devicePolicies = await DevicePolicy.create(
      DEFAULT_DEVICE_POLICIES.map((policy) => ({
        tenantId: createdTenant._id,
        policyKey: policy.policyKey,
        restrictions: policy.restrictions,
        createdBy: req.auth.id
      })),
      { session, ordered: true }
    );

    if (shouldCreateTenantAdmin) {
      const passwordHash = await bcrypt.hash(tenantAdminPassword, 12);
      const tenantAdminAccounts = await Account.create(
        [
          {
            name: tenantAdminInput.name,
            email: tenantAdminInput.email,
            mobile: tenantAdminInput.mobile,
            role: ACCOUNT_ROLES.TENANT_ADMIN,
            tenantId: createdTenant._id,
            channelPartnerId: tenantAdminInput.channelPartnerId,
            passwordHash,
            createdBy: req.auth.id
          }
        ],
        { session, ordered: true }
      );

      createdTenantAdmin = tenantAdminAccounts[0];
      createdTenant.adminAccountId = createdTenantAdmin._id;
      await createdTenant.save({ session });

      await createAuditLog(
        {
          eventType: AUDIT_EVENTS.ACCOUNT_CREATED,
          actorId: req.auth.id,
          tenantId: createdTenant._id,
          channelPartnerId: createdTenant.channelPartnerId,
          metadata: {
            accountId: createdTenantAdmin._id,
            role: createdTenantAdmin.role,
            email: createdTenantAdmin.email,
            source: "tenant_create_app"
          }
        },
        { session }
      );
    }

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TENANT_CREATED,
        actorId: req.auth.id,
        tenantId: createdTenant._id,
        channelPartnerId: createdTenant.channelPartnerId,
        metadata: { name: createdTenant.name, type: createdTenant.type, capabilities }
      },
      { session }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TENANT_POLICY_CREATED,
        actorId: req.auth.id,
        tenantId: createdTenant._id,
        channelPartnerId: createdTenant.channelPartnerId
      },
      { session }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.DEVICE_POLICIES_CREATED,
        actorId: req.auth.id,
        tenantId: createdTenant._id,
        channelPartnerId: createdTenant.channelPartnerId,
        metadata: { policyKeys: devicePolicies.map((policy) => policy.policyKey) }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 201, "Tenant created successfully", {
      tenant: createdTenant,
      tenantPolicy,
      devicePolicies,
      ...(createdTenantAdmin
        ? {
            tenantAdmin: {
              accountId: createdTenantAdmin._id,
              name: createdTenantAdmin.name,
              email: createdTenantAdmin.email,
              mobile: createdTenantAdmin.mobile,
              role: createdTenantAdmin.role,
              tenantId: createdTenantAdmin.tenantId,
              channelPartnerId: createdTenantAdmin.channelPartnerId
            },
            credentials: {
              email: createdTenantAdmin.email,
              temporaryPassword: tenantAdminPassword
            }
          }
        : {})
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
 * Get tenant detail.
 * Sample params: /admin/tenants/665f...
 */
export const getTenantById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid tenant ID");
    }

    const data = await getTenantDetailData(req.params.id);

    if (!data.tenant) {
      return sendError(res, 400, "Tenant not found");
    }

    return sendSuccess(res, 200, "Tenant fetched successfully", data);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Update tenant profile/support details.
 * Sample body: { "supportPhone": "9800000009", "supportEmail": "support@tenant.in", "address": { "city": "Pune" } }
 */
export const updateTenant = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid tenant ID");
    }

    if (req.body.creditPurchasePerKeyPrice !== undefined) {
      const creditPurchasePerKeyPrice = parseRupeeAmount(req.body.creditPurchasePerKeyPrice);
      if (creditPurchasePerKeyPrice === null || creditPurchasePerKeyPrice < 0) {
        return sendError(res, 400, "creditPurchasePerKeyPrice must be a valid non-negative rupee amount");
      }
      req.body.creditPurchasePerKeyPrice = creditPurchasePerKeyPrice;
    }

    const address = normalizeAddressPayload(req.body);
    const addressError = getAddressValidationError(address);
    if (addressError) {
      return sendError(res, 400, addressError);
    }

    const poc = normalizeTenantPocPayload(req.body);
    const pocError = getTenantPocValidationError(poc);
    if (pocError) {
      return sendError(res, 400, pocError);
    }

    const allowedUpdates = ["name", "supportPhone", "supportEmail", "supportWhatsapp", "parentTenantId", "creditPurchasePerKeyPrice"];
    const updates = {
      ...Object.fromEntries(Object.entries(req.body).filter(([key]) => allowedUpdates.includes(key))),
      address,
      ...poc
    };

    const tenant = await Tenant.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    });

    if (!tenant) {
      return sendError(res, 400, "Tenant not found");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.TENANT_UPDATED,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      metadata: updates
    });

    return sendSuccess(res, 200, "Tenant updated successfully", tenant);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Activate or deactivate tenant.
 * Sample body: { "isActive": false, "reason": "Tenant offboarded" }
 */
export const updateTenantStatus = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid tenant ID");
    }

    if (typeof req.body.isActive !== "boolean") {
      return sendError(res, 400, "isActive boolean is required");
    }

    if (!req.body.isActive && !req.body.reason) {
      return sendError(res, 400, "Reason is required when deactivating a tenant");
    }

    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { isActive: req.body.isActive },
      { new: true }
    );

    if (!tenant) {
      return sendError(res, 400, "Tenant not found");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.TENANT_STATUS_CHANGED,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: tenant.channelPartnerId,
      reason: req.body.reason,
      metadata: { isActive: req.body.isActive }
    });

    return sendSuccess(res, 200, "Tenant status updated successfully", tenant);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Adjust tenant credits after offline/manual payment handling.
 * Sample body: { "delta": 25, "reason": "Credits purchased manually" }
 */
export const adjustTenantCredits = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid tenant ID");
    }

    const delta = Number(req.body.delta);
    const reason = String(req.body.reason || "").trim();
    const perKeyPrice = delta > 0 ? parseRupeeAmount(req.body.perKeyPrice) : null;

    if (!Number.isInteger(delta) || delta === 0) {
      return sendError(res, 400, "delta must be a non-zero integer");
    }

    if (delta > 0 && (perKeyPrice === null || perKeyPrice < 0)) {
      return sendError(res, 400, "perKeyPrice is required for positive credit adjustments");
    }

    const purchaseAmount = delta > 0 ? roundRupeeAmount(delta * perKeyPrice) : 0;
    const submittedPurchaseAmount =
      req.body.purchaseAmount !== undefined
        ? parseRupeeAmount(req.body.purchaseAmount)
        : req.body.amount !== undefined
          ? parseRupeeAmount(req.body.amount)
          : null;

    if (delta > 0 && submittedPurchaseAmount !== null && submittedPurchaseAmount !== purchaseAmount) {
      return sendError(res, 400, "purchaseAmount must equal delta * perKeyPrice");
    }

    if (!reason) {
      return sendError(res, 400, "Reason is required");
    }

    session.startTransaction();

    const tenant = await Tenant.findById(req.params.id).session(session);
    if (!tenant) {
      await session.abortTransaction();
      return sendError(res, 404, "Tenant not found");
    }

    const balanceBefore = Number(tenant.creditBalance || 0);
    const balanceAfter = balanceBefore + delta;

    if (balanceAfter < 0) {
      await session.abortTransaction();
      return sendError(res, 400, "Credit adjustment cannot make balance negative");
    }

    tenant.creditBalance = balanceAfter;
    await tenant.save({ session });

    const ledgerEntries = await TenantCreditLedger.create(
      [
        {
          tenantId: tenant._id,
          type: TENANT_CREDIT_LEDGER_TYPES.ADMIN_ADJUSTMENT,
          delta,
          balanceBefore,
          balanceAfter,
          actorId: req.auth.id,
          actorCollection: "accounts",
          reason,
          metadata: {
            source: "super_admin",
            ...(delta > 0
              ? {
                  keysPurchased: delta,
                  perKeyPrice,
                  purchaseAmount,
                  purchaseAmountFormula: "delta * perKeyPrice"
                }
              : {})
          }
        }
      ],
      { session, ordered: true }
    );

    const partnerCredit = delta > 0
      ? await awardPartnerCreditForTenantCreditPurchase({
          tenant,
          keysPurchased: delta,
          perKeyPrice,
          purchaseAmount,
          tenantCreditLedgerId: ledgerEntries[0]._id,
          actorId: req.auth.id,
          reason,
          session
        })
      : null;

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TENANT_CREDITS_ADJUSTED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        reason,
        metadata: {
          delta,
          balanceBefore,
          balanceAfter,
          ledgerEntryId: ledgerEntries[0]._id,
          ...(delta > 0 ? { perKeyPrice, purchaseAmount, partnerCredit } : {})
        }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 200, "Tenant credits adjusted successfully", {
      tenantId: tenant._id,
      credits: {
        previous: balanceBefore,
        delta,
        current: balanceAfter
      },
      ledgerEntryId: ledgerEntries[0]._id,
      ...(delta > 0
        ? {
            purchase: {
              keysPurchased: delta,
              perKeyPrice,
              purchaseAmount
            },
            partnerCredit
          }
        : {})
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * List tenant credit purchase requests.
 * Sample query: /admin/tenant-credit-purchases?status=PENDING&tenantId=665f...&sortBy=requestedAt&sortOrder=desc&page=1&limit=20
 */
export const listTenantCreditPurchaseRequests = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};
    const allowedSortFields = {
      tenantName: "tenantName",
      partnerName: "partnerName",
      status: "status",
      purchaseAmount: "purchaseAmount",
      requestedAt: "requestedAt",
      createdAt: "createdAt"
    };

    if (req.query.status) {
      if (!Object.values(TENANT_CREDIT_PURCHASE_STATUSES).includes(req.query.status)) {
        return sendError(res, 400, "Invalid credit purchase status");
      }
      filter.status = req.query.status;
    }

    if (req.query.tenantId) {
      if (!isValidObjectId(req.query.tenantId)) {
        return sendError(res, 400, "Invalid tenant ID");
      }
      filter.tenantId = new mongoose.Types.ObjectId(req.query.tenantId);
    }

    if (req.query.channelPartnerId) {
      if (!isValidObjectId(req.query.channelPartnerId)) {
        return sendError(res, 400, "Invalid channel partner ID");
      }
      filter.channelPartnerId = new mongoose.Types.ObjectId(req.query.channelPartnerId);
    }

    if (req.query.search) {
      const searchRegex = new RegExp(escapeRegex(req.query.search), "i");
      filter.$or = [
        { referenceNumber: searchRegex },
        { status: searchRegex }
      ];
    }

    const sortBy = allowedSortFields[req.query.sortBy] || "requestedAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const sort = ["requestedAt", "createdAt"].includes(sortBy) ? { [sortBy]: sortOrder, _id: -1 } : { [sortBy]: sortOrder, requestedAt: -1, _id: -1 };

    const [result] = await TenantCreditPurchaseRequest.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "tenants",
          localField: "tenantId",
          foreignField: "_id",
          as: "tenant"
        }
      },
      {
        $lookup: {
          from: "channelpartners",
          localField: "channelPartnerId",
          foreignField: "_id",
          as: "channelPartner"
        }
      },
      {
        $lookup: {
          from: "accounts",
          localField: "requestedBy",
          foreignField: "_id",
          as: "requestedByAccount"
        }
      },
      {
        $lookup: {
          from: "accounts",
          localField: "approvedBy",
          foreignField: "_id",
          as: "approvedByAccount"
        }
      },
      {
        $lookup: {
          from: "accounts",
          localField: "rejectedBy",
          foreignField: "_id",
          as: "rejectedByAccount"
        }
      },
      {
        $addFields: {
          tenantId: { $arrayElemAt: ["$tenant", 0] },
          channelPartnerId: { $arrayElemAt: ["$channelPartner", 0] },
          requestedBy: { $arrayElemAt: ["$requestedByAccount", 0] },
          approvedBy: { $arrayElemAt: ["$approvedByAccount", 0] },
          rejectedBy: { $arrayElemAt: ["$rejectedByAccount", 0] },
          tenantName: { $ifNull: [{ $arrayElemAt: ["$tenant.name", 0] }, ""] },
          partnerName: { $ifNull: [{ $arrayElemAt: ["$channelPartner.name", 0] }, ""] }
        }
      },
      {
        $project: {
          tenant: 0,
          channelPartner: 0,
          requestedByAccount: 0,
          approvedByAccount: 0,
          rejectedByAccount: 0,
          "requestedBy.passwordHash": 0,
          "approvedBy.passwordHash": 0,
          "rejectedBy.passwordHash": 0
        }
      },
      {
        $facet: {
          items: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit }
          ],
          total: [{ $count: "count" }]
        }
      }
    ]);

    const items = result?.items || [];
    const total = result?.total?.[0]?.count || 0;

    return sendSuccess(res, 200, "Tenant credit purchase requests fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch tenant credit purchase request detail.
 * Sample params: /admin/tenant-credit-purchases/665f...
 */
export const getTenantCreditPurchaseRequestById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.requestId)) {
      return sendError(res, 400, "Invalid credit purchase request ID");
    }

    const creditPurchaseRequest = await TenantCreditPurchaseRequest.findById(req.params.requestId)
      .populate("tenantId", "name type creditBalance totalCreditsPurchased lifetimeCreditPurchaseAmount")
      .populate("channelPartnerId", "name type")
      .populate("requestedBy", "name email mobile role")
      .populate("approvedBy", "name email mobile role")
      .populate("rejectedBy", "name email mobile role")
      .lean();

    if (!creditPurchaseRequest) {
      return sendError(res, 404, "Tenant credit purchase request not found");
    }

    const [tenantCreditLedger, partnerCreditLedger] = await Promise.all([
      creditPurchaseRequest.tenantCreditLedgerId
        ? TenantCreditLedger.findById(creditPurchaseRequest.tenantCreditLedgerId).lean()
        : null,
      creditPurchaseRequest.partnerCreditLedgerId
        ? PartnerCreditLedger.findById(creditPurchaseRequest.partnerCreditLedgerId).lean()
        : null
    ]);

    return sendSuccess(res, 200, "Tenant credit purchase request fetched successfully", {
      creditPurchaseRequest,
      tenantCreditLedger,
      partnerCreditLedger
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Approve tenant credit purchase request.
 * Sample body: { "note": "Payment verified" }
 */
export const approveTenantCreditPurchaseRequest = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.requestId)) {
      return sendError(res, 400, "Invalid credit purchase request ID");
    }

    session.startTransaction();

    const creditPurchaseRequest = await TenantCreditPurchaseRequest.findOne({
      _id: req.params.requestId,
      status: TENANT_CREDIT_PURCHASE_STATUSES.PENDING
    }).session(session);

    if (!creditPurchaseRequest) {
      await session.abortTransaction();
      return sendError(res, 404, "Pending tenant credit purchase request not found");
    }

    const tenant = await Tenant.findById(creditPurchaseRequest.tenantId).session(session);
    if (!tenant) {
      await session.abortTransaction();
      return sendError(res, 404, "Tenant not found");
    }

    const balanceBefore = Number(tenant.creditBalance || 0);
    const balanceAfter = balanceBefore + creditPurchaseRequest.requestedCredits;

    tenant.creditBalance = balanceAfter;
    tenant.totalCreditsPurchased = Number(tenant.totalCreditsPurchased || 0) + creditPurchaseRequest.requestedCredits;
    tenant.lifetimeCreditPurchaseAmount = roundRupeeAmount(
      Number(tenant.lifetimeCreditPurchaseAmount || 0) + Number(creditPurchaseRequest.purchaseAmount || 0)
    );
    tenant.lastCreditPurchasedAt = new Date();
    await tenant.save({ session });

    const tenantLedgerEntries = await TenantCreditLedger.create(
      [
        {
          tenantId: tenant._id,
          type: TENANT_CREDIT_LEDGER_TYPES.TENANT_CREDIT_PURCHASE,
          delta: creditPurchaseRequest.requestedCredits,
          balanceBefore,
          balanceAfter,
          actorId: req.auth.id,
          actorCollection: "accounts",
          reason: req.body.note || "Tenant credit purchase approved",
          metadata: {
            creditPurchaseRequestId: creditPurchaseRequest._id,
            requestedCredits: creditPurchaseRequest.requestedCredits,
            perKeyPrice: creditPurchaseRequest.perKeyPrice,
            purchaseAmount: creditPurchaseRequest.purchaseAmount,
            referenceNumber: creditPurchaseRequest.referenceNumber,
            source: "tenant_credit_purchase_request"
          }
        }
      ],
      { session, ordered: true }
    );

    const partnerCredit = await awardPartnerCreditForTenantCreditPurchase({
      tenant,
      keysPurchased: creditPurchaseRequest.requestedCredits,
      perKeyPrice: creditPurchaseRequest.perKeyPrice,
      purchaseAmount: creditPurchaseRequest.purchaseAmount,
      tenantCreditLedgerId: tenantLedgerEntries[0]._id,
      actorId: req.auth.id,
      reason: req.body.note || "Tenant credit purchase approved",
      session
    });

    creditPurchaseRequest.status = TENANT_CREDIT_PURCHASE_STATUSES.APPROVED;
    creditPurchaseRequest.approvedBy = req.auth.id;
    creditPurchaseRequest.approvedAt = new Date();
    creditPurchaseRequest.tenantCreditLedgerId = tenantLedgerEntries[0]._id;
    creditPurchaseRequest.partnerCreditLedgerId = partnerCredit?.ledgerEntryId;
    creditPurchaseRequest.metadata = {
      ...(creditPurchaseRequest.metadata || {}),
      approvalNote: req.body.note,
      balanceBefore,
      balanceAfter,
      partnerCredit
    };
    await creditPurchaseRequest.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TENANT_CREDIT_PURCHASE_APPROVED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: tenant.channelPartnerId,
        metadata: {
          creditPurchaseRequestId: creditPurchaseRequest._id,
          tenantCreditLedgerId: tenantLedgerEntries[0]._id,
          partnerCredit,
          requestedCredits: creditPurchaseRequest.requestedCredits,
          perKeyPrice: creditPurchaseRequest.perKeyPrice,
          purchaseAmount: creditPurchaseRequest.purchaseAmount
        }
      },
      { session }
    );

    await session.commitTransaction();

    await safeQueueNotification({
      audience: NOTIFICATION_AUDIENCES.TENANT,
      tenantId: tenant._id,
      title: "Key purchase approved",
      text: `${creditPurchaseRequest.requestedCredits} key credits have been added to your account.`,
      notificationType: "TENANT_CREDIT_PURCHASE_APPROVED",
      data: {
        creditPurchaseRequestId: creditPurchaseRequest._id,
        requestedCredits: creditPurchaseRequest.requestedCredits,
        purchaseAmount: creditPurchaseRequest.purchaseAmount,
        tenantCreditLedgerId: tenantLedgerEntries[0]._id
      }
    });

    return sendSuccess(res, 200, "Tenant credit purchase approved successfully", {
      creditPurchaseRequest,
      credits: {
        previous: balanceBefore,
        added: creditPurchaseRequest.requestedCredits,
        current: balanceAfter
      },
      tenantCreditLedgerId: tenantLedgerEntries[0]._id,
      partnerCredit
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Reject tenant credit purchase request.
 * Sample body: { "reason": "Payment not found" }
 */
export const rejectTenantCreditPurchaseRequest = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.requestId)) {
      return sendError(res, 400, "Invalid credit purchase request ID");
    }

    const reason = String(req.body.reason || "").trim();
    if (!reason) {
      return sendError(res, 400, "Rejection reason is required");
    }

    session.startTransaction();

    const creditPurchaseRequest = await TenantCreditPurchaseRequest.findOne({
      _id: req.params.requestId,
      status: TENANT_CREDIT_PURCHASE_STATUSES.PENDING
    }).session(session);

    if (!creditPurchaseRequest) {
      await session.abortTransaction();
      return sendError(res, 404, "Pending tenant credit purchase request not found");
    }

    creditPurchaseRequest.status = TENANT_CREDIT_PURCHASE_STATUSES.REJECTED;
    creditPurchaseRequest.rejectedBy = req.auth.id;
    creditPurchaseRequest.rejectedAt = new Date();
    creditPurchaseRequest.rejectionReason = reason;
    await creditPurchaseRequest.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TENANT_CREDIT_PURCHASE_REJECTED,
        actorId: req.auth.id,
        tenantId: creditPurchaseRequest.tenantId,
        channelPartnerId: creditPurchaseRequest.channelPartnerId,
        reason,
        metadata: {
          creditPurchaseRequestId: creditPurchaseRequest._id,
          requestedCredits: creditPurchaseRequest.requestedCredits,
          perKeyPrice: creditPurchaseRequest.perKeyPrice,
          purchaseAmount: creditPurchaseRequest.purchaseAmount
        }
      },
      { session }
    );

    await session.commitTransaction();

    await safeQueueNotification({
      audience: NOTIFICATION_AUDIENCES.TENANT,
      tenantId: creditPurchaseRequest.tenantId,
      title: "Key purchase rejected",
      text: "Your key purchase request was rejected.",
      notificationType: "TENANT_CREDIT_PURCHASE_REJECTED",
      data: {
        creditPurchaseRequestId: creditPurchaseRequest._id,
        requestedCredits: creditPurchaseRequest.requestedCredits,
        purchaseAmount: creditPurchaseRequest.purchaseAmount,
        rejectionReason: reason
      }
    });

    return sendSuccess(res, 200, "Tenant credit purchase rejected successfully", {
      creditPurchaseRequest
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * List partner payout requests.
 * Sample query: /admin/partner-payouts?status=PENDING&channelPartnerId=665f...&sortBy=requestedAt&sortOrder=desc&page=1&limit=20
 */
export const listPartnerPayoutRequests = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};
    const allowedSortFields = {
      partnerName: "partnerName",
      status: "status",
      amount: "amount",
      requestedAt: "requestedAt",
      createdAt: "createdAt"
    };

    if (req.query.status) {
      if (!Object.values(PARTNER_PAYOUT_STATUSES).includes(req.query.status)) {
        return sendError(res, 400, "Invalid payout status");
      }
      filter.status = req.query.status;
    }

    if (req.query.channelPartnerId) {
      if (!isValidObjectId(req.query.channelPartnerId)) {
        return sendError(res, 400, "Invalid channel partner ID");
      }
      filter.channelPartnerId = new mongoose.Types.ObjectId(req.query.channelPartnerId);
    }

    if (req.query.search) {
      const searchText = String(req.query.search).trim();
      const searchRegex = new RegExp(escapeRegex(searchText), "i");
      const searchFilter = [
        { adminReferenceId: searchRegex },
        { status: searchRegex }
      ];
      const searchAmount = parseRupeeAmount(searchText);
      if (searchAmount !== null) {
        searchFilter.push({ amount: searchAmount });
      }
      filter.$or = searchFilter;
    }

    const sortBy = allowedSortFields[req.query.sortBy] || "requestedAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const sort = ["requestedAt", "createdAt"].includes(sortBy) ? { [sortBy]: sortOrder, _id: -1 } : { [sortBy]: sortOrder, requestedAt: -1, _id: -1 };

    const [result] = await PartnerPayoutRequest.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "channelpartners",
          localField: "channelPartnerId",
          foreignField: "_id",
          as: "channelPartner"
        }
      },
      {
        $lookup: {
          from: "accounts",
          localField: "requestedBy",
          foreignField: "_id",
          as: "requestedByAccount"
        }
      },
      {
        $lookup: {
          from: "accounts",
          localField: "approvedBy",
          foreignField: "_id",
          as: "approvedByAccount"
        }
      },
      {
        $lookup: {
          from: "accounts",
          localField: "rejectedBy",
          foreignField: "_id",
          as: "rejectedByAccount"
        }
      },
      {
        $addFields: {
          channelPartnerId: { $arrayElemAt: ["$channelPartner", 0] },
          requestedBy: { $arrayElemAt: ["$requestedByAccount", 0] },
          approvedBy: { $arrayElemAt: ["$approvedByAccount", 0] },
          rejectedBy: { $arrayElemAt: ["$rejectedByAccount", 0] },
          partnerName: { $ifNull: [{ $arrayElemAt: ["$channelPartner.name", 0] }, ""] }
        }
      },
      {
        $project: {
          channelPartner: 0,
          requestedByAccount: 0,
          approvedByAccount: 0,
          rejectedByAccount: 0,
          "requestedBy.passwordHash": 0,
          "approvedBy.passwordHash": 0,
          "rejectedBy.passwordHash": 0
        }
      },
      {
        $facet: {
          items: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit }
          ],
          total: [{ $count: "count" }]
        }
      }
    ]);

    const items = result?.items || [];
    const total = result?.total?.[0]?.count || 0;

    return sendSuccess(res, 200, "Partner payout requests fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get partner payout request detail.
 * Sample params: /admin/partner-payouts/665f...
 */
export const getPartnerPayoutRequestById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.payoutId)) {
      return sendError(res, 400, "Invalid payout request ID");
    }

    const payoutRequest = await PartnerPayoutRequest.findById(req.params.payoutId)
      .populate("channelPartnerId", "name type contactPhone contactEmail availablePayoutBalance payoutHoldBalance payoutUpiId payoutUpiName")
      .populate("requestedBy", "name email mobile role")
      .populate("approvedBy", "name email mobile role")
      .populate("rejectedBy", "name email mobile role")
      .lean();

    if (!payoutRequest) {
      return sendError(res, 404, "Partner payout request not found");
    }

    const ledger = await PartnerCreditLedger.find({ payoutRequestId: payoutRequest._id }).sort({ createdAt: -1 }).lean();

    return sendSuccess(res, 200, "Partner payout request fetched successfully", {
      payoutRequest,
      ledger
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Approve partner payout request.
 * Multipart fields: referenceId, proofImage
 * JSON fallback: { "referenceId": "UTR123", "paymentProofImageUrl": "https://..." }
 */
export const approvePartnerPayoutRequest = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.payoutId)) {
      return sendError(res, 400, "Invalid payout request ID");
    }

    const referenceId = String(req.body.referenceId || req.body.adminReferenceId || "").trim();
    if (!referenceId) {
      return sendError(res, 400, "Payment reference ID is required");
    }

    if (!req.file && !req.body.paymentProofImageUrl) {
      return sendError(res, 400, "Payment proof image is required");
    }

    const payoutRequest = await PartnerPayoutRequest.findById(req.params.payoutId);
    if (!payoutRequest) {
      return sendError(res, 404, "Partner payout request not found");
    }

    if (payoutRequest.status !== PARTNER_PAYOUT_STATUSES.PENDING) {
      return sendError(res, 400, "Only pending payout requests can be approved");
    }

    const channelPartner = await ChannelPartner.findById(payoutRequest.channelPartnerId);
    if (!channelPartner) {
      return sendError(res, 404, "Channel partner not found");
    }

    const paymentProof = await buildPartnerPayoutProof({ req, payoutRequest, channelPartner });

    session.startTransaction();

    const payoutRequestForUpdate = await PartnerPayoutRequest.findOne({
      _id: payoutRequest._id,
      status: PARTNER_PAYOUT_STATUSES.PENDING
    }).session(session);

    if (!payoutRequestForUpdate) {
      await session.abortTransaction();
      return sendError(res, 400, "Only pending payout requests can be approved");
    }

    const lockedPartner = await ChannelPartner.findById(payoutRequestForUpdate.channelPartnerId).session(session);
    if (!lockedPartner) {
      await session.abortTransaction();
      return sendError(res, 404, "Channel partner not found");
    }

    const holdBefore = roundRupeeAmount(lockedPartner.payoutHoldBalance || 0);
    const amount = roundRupeeAmount(payoutRequestForUpdate.amount);
    const holdAfter = roundRupeeAmount(holdBefore - amount);

    if (holdAfter < 0) {
      await session.abortTransaction();
      return sendError(res, 400, "Partner payout hold balance is insufficient");
    }

    lockedPartner.payoutHoldBalance = holdAfter;
    lockedPartner.lifetimePayoutPaid = roundRupeeAmount(Number(lockedPartner.lifetimePayoutPaid || 0) + amount);
    await lockedPartner.save({ session });

    payoutRequestForUpdate.status = PARTNER_PAYOUT_STATUSES.APPROVED;
    payoutRequestForUpdate.approvedBy = req.auth.id;
    payoutRequestForUpdate.approvedAt = new Date();
    payoutRequestForUpdate.adminReferenceId = referenceId;
    payoutRequestForUpdate.paymentProof = paymentProof;
    await payoutRequestForUpdate.save({ session });

    const ledgerEntries = await PartnerCreditLedger.create(
      [
        {
          channelPartnerId: lockedPartner._id,
          payoutRequestId: payoutRequestForUpdate._id,
          type: PARTNER_CREDIT_LEDGER_TYPES.PAYOUT_APPROVED_PAID,
          balanceType: PARTNER_CREDIT_BALANCE_TYPES.HOLD,
          delta: -amount,
          balanceBefore: holdBefore,
          balanceAfter: holdAfter,
          actorId: req.auth.id,
          actorCollection: "accounts",
          reason: "Partner payout approved",
          metadata: {
            referenceId,
            paymentProofImageUrl: paymentProof?.imageUrl
          }
        }
      ],
      { session, ordered: true }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.PARTNER_PAYOUT_APPROVED,
        actorId: req.auth.id,
        channelPartnerId: lockedPartner._id,
        metadata: {
          payoutRequestId: payoutRequest._id,
          amount,
          referenceId,
          ledgerEntryId: ledgerEntries[0]._id
        }
      },
      { session }
    );

    await session.commitTransaction();

    await safeQueueNotification({
      audience: NOTIFICATION_AUDIENCES.PARTNER,
      channelPartnerId: lockedPartner._id,
      title: "Payout approved",
      text: `Your payout of Rs ${amount} has been approved.`,
      notificationType: "PARTNER_PAYOUT_APPROVED",
      data: {
        payoutRequestId: payoutRequestForUpdate._id,
        amount,
        referenceId,
        ledgerEntryId: ledgerEntries[0]._id
      }
    });

    return sendSuccess(res, 200, "Partner payout approved successfully", {
      payoutRequest: payoutRequestForUpdate,
      ledgerEntryId: ledgerEntries[0]._id
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Reject partner payout request.
 * Sample body: { "reason": "UPI ID mismatch" }
 */
export const rejectPartnerPayoutRequest = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.payoutId)) {
      return sendError(res, 400, "Invalid payout request ID");
    }

    const reason = String(req.body.reason || "").trim();
    if (!reason) {
      return sendError(res, 400, "Rejection reason is required");
    }

    session.startTransaction();

    const payoutRequest = await PartnerPayoutRequest.findById(req.params.payoutId).session(session);
    if (!payoutRequest) {
      await session.abortTransaction();
      return sendError(res, 404, "Partner payout request not found");
    }

    if (payoutRequest.status !== PARTNER_PAYOUT_STATUSES.PENDING) {
      await session.abortTransaction();
      return sendError(res, 400, "Only pending payout requests can be rejected");
    }

    const channelPartner = await ChannelPartner.findById(payoutRequest.channelPartnerId).session(session);
    if (!channelPartner) {
      await session.abortTransaction();
      return sendError(res, 404, "Channel partner not found");
    }

    const amount = roundRupeeAmount(payoutRequest.amount);
    const availableBefore = roundRupeeAmount(channelPartner.availablePayoutBalance || 0);
    const availableAfter = roundRupeeAmount(availableBefore + amount);
    const holdBefore = roundRupeeAmount(channelPartner.payoutHoldBalance || 0);
    const holdAfter = roundRupeeAmount(holdBefore - amount);

    if (holdAfter < 0) {
      await session.abortTransaction();
      return sendError(res, 400, "Partner payout hold balance is insufficient");
    }

    channelPartner.availablePayoutBalance = availableAfter;
    channelPartner.payoutHoldBalance = holdAfter;
    await channelPartner.save({ session });

    payoutRequest.status = PARTNER_PAYOUT_STATUSES.REJECTED;
    payoutRequest.rejectedBy = req.auth.id;
    payoutRequest.rejectedAt = new Date();
    payoutRequest.rejectionReason = reason;
    await payoutRequest.save({ session });

    const ledgerEntries = await PartnerCreditLedger.create(
      [
        {
          channelPartnerId: channelPartner._id,
          payoutRequestId: payoutRequest._id,
          type: PARTNER_CREDIT_LEDGER_TYPES.PAYOUT_REJECTED_RELEASE,
          balanceType: PARTNER_CREDIT_BALANCE_TYPES.AVAILABLE,
          delta: amount,
          balanceBefore: availableBefore,
          balanceAfter: availableAfter,
          actorId: req.auth.id,
          actorCollection: "accounts",
          reason,
          metadata: {
            holdBalanceBefore: holdBefore,
            holdBalanceAfter: holdAfter
          }
        }
      ],
      { session, ordered: true }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.PARTNER_PAYOUT_REJECTED,
        actorId: req.auth.id,
        channelPartnerId: channelPartner._id,
        reason,
        metadata: {
          payoutRequestId: payoutRequest._id,
          amount,
          ledgerEntryId: ledgerEntries[0]._id
        }
      },
      { session }
    );

    await session.commitTransaction();

    await safeQueueNotification({
      audience: NOTIFICATION_AUDIENCES.PARTNER,
      channelPartnerId: channelPartner._id,
      title: "Payout rejected",
      text: `Your payout request of Rs ${amount} was rejected.`,
      notificationType: "PARTNER_PAYOUT_REJECTED",
      data: {
        payoutRequestId: payoutRequest._id,
        amount,
        rejectionReason: reason,
        ledgerEntryId: ledgerEntries[0]._id
      }
    });

    return sendSuccess(res, 200, "Partner payout rejected successfully", {
      payoutRequest,
      ledgerEntryId: ledgerEntries[0]._id
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * List partner_admin and tenant_admin accounts.
 * Sample query: /admin/accounts?role=tenant_admin&tenantId=665f...&status=active&page=1&limit=20
 */
export const listAdminAccounts = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {
      role: { $in: [ACCOUNT_ROLES.PARTNER_ADMIN, ACCOUNT_ROLES.TENANT_ADMIN] }
    };

    if (req.query.role) filter.role = req.query.role;
    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "inactive") filter.isActive = false;
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.channelPartnerId) filter.channelPartnerId = req.query.channelPartnerId;
    if (req.query.search) {
      filter.$or = [{ name: buildRegex(req.query.search) }, { email: buildRegex(req.query.search) }];
    }

    const [items, total] = await Promise.all([
      Account.find(filter)
        .select("-passwordHash")
        .populate("tenantId", "name type")
        .populate("channelPartnerId", "name type")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      Account.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Accounts fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get admin account detail.
 * Sample params: /admin/accounts/665f...
 */
export const getAdminAccountById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.accountId)) {
      return sendError(res, 400, "Invalid account ID");
    }

    const account = await Account.findById(req.params.accountId)
      .select("-passwordHash")
      .populate("tenantId", "name type")
      .populate("channelPartnerId", "name type")
      .lean();

    if (!account) {
      return sendError(res, 400, "Account not found");
    }

    if (![ACCOUNT_ROLES.PARTNER_ADMIN, ACCOUNT_ROLES.TENANT_ADMIN].includes(account.role)) {
      return sendError(res, 403, "This account is not managed from this route");
    }

    return sendSuccess(res, 200, "Account fetched successfully", account);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create partner_admin or tenant_admin account.
 * Sample body: { "name": "Priya Sharma", "email": "priya@tenant.in", "mobile": "9800000003", "role": "tenant_admin", "tenantId": "...", "temporaryPassword": "Welcome@123" }
 */
export const createAdminAccount = async (req, res) => {
  try {
    if (!hasRequiredFields(req.body, ["name", "email", "role", "temporaryPassword"])) {
      return sendError(res, 400, "Name, email, role, and temporaryPassword are required");
    }

    if (![ACCOUNT_ROLES.PARTNER_ADMIN, ACCOUNT_ROLES.TENANT_ADMIN].includes(req.body.role)) {
      return sendError(res, 400, "Only partner_admin and tenant_admin can be created here");
    }

    if (req.body.role === ACCOUNT_ROLES.TENANT_ADMIN && !isValidObjectId(req.body.tenantId)) {
      return sendError(res, 400, "Valid tenantId is required for tenant_admin");
    }

    if (req.body.role === ACCOUNT_ROLES.PARTNER_ADMIN && !isValidObjectId(req.body.channelPartnerId)) {
      return sendError(res, 400, "Valid channelPartnerId is required for partner_admin");
    }

    const existingAccount = await Account.findOne({ email: req.body.email.toLowerCase() });

    if (existingAccount) {
      return sendError(res, 400, "Account with this email already exists");
    }

    if (req.body.role === ACCOUNT_ROLES.TENANT_ADMIN) {
      const tenant = await Tenant.findOne({ _id: req.body.tenantId, isActive: true });
      if (!tenant) return sendError(res, 400, "Active tenant not found");
    }

    if (req.body.role === ACCOUNT_ROLES.TENANT_ADMIN && req.body.channelPartnerId && !isValidObjectId(req.body.channelPartnerId)) {
      return sendError(res, 400, "Valid channelPartnerId is required when provided");
    }

    if (req.body.role === ACCOUNT_ROLES.TENANT_ADMIN && req.body.channelPartnerId) {
      const channelPartner = await ChannelPartner.findOne({
        _id: req.body.channelPartnerId,
        isActive: true
      });
      if (!channelPartner) return sendError(res, 400, "Active channel partner not found");
    }

    if (req.body.role === ACCOUNT_ROLES.PARTNER_ADMIN) {
      const channelPartner = await ChannelPartner.findOne({
        _id: req.body.channelPartnerId,
        isActive: true
      });
      if (!channelPartner) return sendError(res, 400, "Active channel partner not found");
    }

    const passwordHash = await bcrypt.hash(req.body.temporaryPassword, 12);
    const account = await Account.create({
      name: req.body.name,
      email: req.body.email,
      mobile: req.body.mobile,
      role: req.body.role,
      tenantId: req.body.role === ACCOUNT_ROLES.TENANT_ADMIN ? req.body.tenantId : undefined,
      channelPartnerId:
        req.body.role === ACCOUNT_ROLES.PARTNER_ADMIN || req.body.channelPartnerId ? req.body.channelPartnerId : undefined,
      passwordHash,
      createdBy: req.auth.id
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.ACCOUNT_CREATED,
      actorId: req.auth.id,
      tenantId: account.tenantId,
      channelPartnerId: account.channelPartnerId,
      metadata: { accountId: account._id, role: account.role, email: account.email }
    });

    const safeAccount = account.toObject();
    delete safeAccount.passwordHash;

    return sendSuccess(res, 201, "Account created successfully", safeAccount);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Update admin account profile/scope.
 * Sample body: { "name": "Priya S. Sharma", "mobile": "9800000099" }
 */
export const updateAdminAccount = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.accountId)) {
      return sendError(res, 400, "Invalid account ID");
    }

    const account = await Account.findById(req.params.accountId);

    if (!account) {
      return sendError(res, 400, "Account not found");
    }

    if (![ACCOUNT_ROLES.PARTNER_ADMIN, ACCOUNT_ROLES.TENANT_ADMIN].includes(account.role)) {
      return sendError(res, 403, "This account cannot be updated from this route");
    }

    const allowedUpdates = ["name", "mobile"];

    if (account.role === ACCOUNT_ROLES.TENANT_ADMIN) {
      allowedUpdates.push("tenantId");
    }

    if (account.role === ACCOUNT_ROLES.PARTNER_ADMIN) {
      allowedUpdates.push("channelPartnerId");
    }
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowedUpdates.includes(key))
    );

    if (updates.tenantId && !isValidObjectId(updates.tenantId)) {
      return sendError(res, 400, "Invalid tenant ID");
    }

    if (updates.channelPartnerId && !isValidObjectId(updates.channelPartnerId)) {
      return sendError(res, 400, "Invalid channel partner ID");
    }

    Object.assign(account, updates);
    await account.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.ACCOUNT_UPDATED,
      actorId: req.auth.id,
      tenantId: account.tenantId,
      channelPartnerId: account.channelPartnerId,
      metadata: { accountId: account._id, updates }
    });

    const safeAccount = account.toObject();
    delete safeAccount.passwordHash;

    return sendSuccess(res, 200, "Account updated successfully", safeAccount);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Activate or deactivate admin account.
 * Sample body: { "isActive": false, "reason": "Admin left organisation" }
 */
export const updateAdminAccountStatus = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.accountId)) {
      return sendError(res, 400, "Invalid account ID");
    }

    if (typeof req.body.isActive !== "boolean") {
      return sendError(res, 400, "isActive boolean is required");
    }

    if (!req.body.isActive && !req.body.reason) {
      return sendError(res, 400, "Reason is required when deactivating an account");
    }

    const account = await Account.findByIdAndUpdate(
      req.params.accountId,
      { isActive: req.body.isActive },
      { new: true }
    ).select("-passwordHash");

    if (!account) {
      return sendError(res, 400, "Account not found");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.ACCOUNT_STATUS_CHANGED,
      actorId: req.auth.id,
      tenantId: account.tenantId,
      channelPartnerId: account.channelPartnerId,
      reason: req.body.reason,
      metadata: { accountId: account._id, isActive: account.isActive }
    });

    return sendSuccess(res, 200, "Account status updated successfully", account);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List consent versions.
 * Sample query: /admin/consent-versions?status=current&page=1&limit=20
 */
export const listConsentVersions = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.status === "current") filter.isCurrent = true;
    if (req.query.status === "draft") filter.isCurrent = false;

    const [items, total] = await Promise.all([
      ConsentVersion.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
      ConsentVersion.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Consent versions fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create consent version.
 * Sample body: { "version": "1.2", "title": "EMI Shield Device Control Agreement", "borrowerAgreementText": "...", "deviceControlConsentText": "...", "privacyPolicyText": "...", "tripartiteAckText": "..." }
 */
export const createConsentVersion = async (req, res) => {
  try {
    const requiredFields = [
      "version",
      "title",
      "borrowerAgreementText",
      "deviceControlConsentText",
      "privacyPolicyText"
    ];

    if (!hasRequiredFields(req.body, requiredFields)) {
      return sendError(res, 400, "Version, title, borrowerAgreementText, deviceControlConsentText, and privacyPolicyText are required");
    }

    const existingVersion = await ConsentVersion.findOne({ version: req.body.version });

    if (existingVersion) {
      return sendError(res, 400, "Consent version already exists");
    }

    const consentVersion = await ConsentVersion.create(req.body);

    await createAuditLog({
      eventType: AUDIT_EVENTS.CONSENT_VERSION_CREATED,
      actorId: req.auth.id,
      metadata: { consentVersionId: consentVersion._id, version: consentVersion.version }
    });

    return sendSuccess(res, 201, "Consent version created successfully", consentVersion);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get consent version detail.
 * Sample params: /admin/consent-versions/665f...
 */
export const getConsentVersionById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid consent version ID");
    }

    const consentVersion = await ConsentVersion.findById(req.params.id).lean();

    if (!consentVersion) {
      return sendError(res, 400, "Consent version not found");
    }

    return sendSuccess(res, 200, "Consent version fetched successfully", consentVersion);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Publish consent version.
 * Sample body: { "reason": "Updated legal language" }
 */
export const publishConsentVersion = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, 400, "Invalid consent version ID");
    }

    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    const consentVersion = await ConsentVersion.findById(req.params.id);

    if (!consentVersion) {
      return sendError(res, 400, "Consent version not found");
    }

    session.startTransaction();

    await ConsentVersion.updateMany({}, { isCurrent: false }, { session });
    consentVersion.isCurrent = true;
    consentVersion.publishedAt = new Date();
    consentVersion.publishedBy = req.auth.id;
    await consentVersion.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.CONSENT_VERSION_PUBLISHED,
        actorId: req.auth.id,
        reason: req.body.reason,
        metadata: { consentVersionId: consentVersion._id, version: consentVersion.version }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 200, "Consent version published successfully", consentVersion);
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
 * List Super Admin escalations.
 * Sample query: /admin/escalations?status=ESCALATED_ADMIN&tenantId=665f...&page=1&limit=20
 */
export const listAdminEscalations = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.status && req.query.status !== "all") {
      filter.status = req.query.status;
    }

    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.channelPartnerId) filter.channelPartnerId = req.query.channelPartnerId;

    const [items, total] = await Promise.all([
      UnlockRequest.find(filter)
        .populate("userId", "name mobile")
        .populate("deviceId", "imei deviceModel manufacturer state")
        .populate("tenantId", "name")
        .populate("channelPartnerId", "name")
        .skip(skip)
        .limit(limit)
        .sort({ escalatedToAdminAt: -1, escalatedToPartnerAt: -1, createdAt: -1 })
        .lean(),
      UnlockRequest.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Escalations fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get Super Admin escalation detail.
 * Sample params: /admin/escalations/CASE-2024-00123
 */
export const getAdminEscalationByCaseId = async (req, res) => {
  try {
    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId })
      .populate("userId", "name mobile email")
      .populate("deviceId")
      .populate("tenantId", "name supportPhone supportEmail")
      .populate("channelPartnerId", "name")
      .lean();

    if (!unlockRequest) {
      return sendError(res, 400, "Escalation not found");
    }

    const [commands, auditLogs] = await Promise.all([
      DeviceCommand.find({ deviceId: unlockRequest.deviceId?._id || unlockRequest.deviceId }).sort({ createdAt: -1 }).lean(),
      AuditLog.find({ caseId: unlockRequest.caseId }).sort({ timestamp: -1 }).lean()
    ]);

    return sendSuccess(res, 200, "Escalation fetched successfully", {
      unlockRequest,
      commands,
      auditLogs
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Override full unlock for an escalated case by resolving all unpaid EMIs.
 * Sample body: { "reason": "Tenant and partner breached SLA. Payment verified.", "emiAction": "mark_paid" }
 */
export const unlockAdminEscalation = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    if (!["mark_paid", "waive"].includes(req.body.emiAction)) {
      return sendError(res, 400, "Full unlock requires emiAction: mark_paid or waive. Use temporary unlock for time-bound access.");
    }

    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId });

    if (!unlockRequest) {
      return sendError(res, 400, "Escalation not found");
    }

    if (!["ESCALATED_ADMIN", "ESCALATED_PARTNER", "UNDER_REVIEW"].includes(unlockRequest.status)) {
      return sendError(res, 400, "Only open escalated cases can be overridden");
    }

    session.startTransaction();

    const { device, command } = await applyEscalationDeviceCommand({
      unlockRequest,
      accountId: req.auth.id,
      commandType: "UNLOCK",
      targetState: DEVICE_STATES.UNLOCK_PENDING,
      policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      reason: req.body.reason,
      session
    });

    let emiUpdate;
    try {
      emiUpdate = await resolveAllUnpaidInstallments({
        userId: unlockRequest.userId,
        tenantId: unlockRequest.tenantId,
        accountId: req.auth.id,
        reason: unlockRequest.caseId,
        emiAction: req.body.emiAction,
        session
      });
    } catch (error) {
      await session.abortTransaction();
      return sendError(res, 400, error.message);
    }

    unlockRequest.status = "RESOLVED_SUPER_ADMIN";
    unlockRequest.resolutionAction = req.body.emiAction === "waive" ? "waived" : "unlocked";
    unlockRequest.resolutionNote = req.body.reason;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.OVERRIDE_EXECUTED,
        actorId: req.auth.id,
        tenantId: unlockRequest.tenantId,
        channelPartnerId: unlockRequest.channelPartnerId,
        userId: unlockRequest.userId,
        deviceId: unlockRequest.deviceId,
        caseId: unlockRequest.caseId,
        reason: req.body.reason,
        metadata: { action: "unlock", commandId: command._id, emiAction: req.body.emiAction, updatedInstallmentIds: emiUpdate.updatedInstallmentIds }
      },
      { session }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: unlockRequest.tenantId,
        channelPartnerId: unlockRequest.channelPartnerId,
        userId: unlockRequest.userId,
        deviceId: unlockRequest.deviceId,
        caseId: unlockRequest.caseId,
        reason: req.body.reason
      },
      { session }
    );

    await session.commitTransaction();

    await safeRefreshTenantMetrics(unlockRequest.tenantId, { source: "admin_escalation_unlocked", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Admin unlock override queued successfully", {
      unlockRequest,
      device,
      command
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
 * Override temporary unlock for an escalated case.
 * Sample body: { "durationHours": 24, "reason": "Emergency access approved" }
 */
export const tempUnlockAdminEscalation = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!req.body.reason || !req.body.durationHours) {
      return sendError(res, 400, "Reason and durationHours are required");
    }

    const durationHours = Number(req.body.durationHours);

    if (durationHours <= 0) {
      return sendError(res, 400, "durationHours must be greater than zero");
    }

    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId });

    if (!unlockRequest) {
      return sendError(res, 400, "Escalation not found");
    }

    if (!["ESCALATED_ADMIN", "ESCALATED_PARTNER", "UNDER_REVIEW"].includes(unlockRequest.status)) {
      return sendError(res, 400, "Only open escalated cases can be overridden");
    }

    session.startTransaction();

    const { device, command } = await applyEscalationDeviceCommand({
      unlockRequest,
      accountId: req.auth.id,
      commandType: "TEMP_UNLOCK",
      targetState: DEVICE_STATES.TEMP_UNLOCK,
      policyKey: DEVICE_POLICY_KEYS.TEMP_UNLOCKED,
      reason: req.body.reason,
      durationHours,
      session
    });

    unlockRequest.status = "RESOLVED_SUPER_ADMIN";
    unlockRequest.resolutionAction = "temp_unlocked";
    unlockRequest.resolutionNote = req.body.reason;
    unlockRequest.tempUnlockDurationHours = durationHours;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TEMP_UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: unlockRequest.tenantId,
        channelPartnerId: unlockRequest.channelPartnerId,
        userId: unlockRequest.userId,
        deviceId: unlockRequest.deviceId,
        caseId: unlockRequest.caseId,
        reason: req.body.reason,
        metadata: { durationHours, commandId: command._id }
      },
      { session }
    );

    await session.commitTransaction();

    await safeRefreshTenantMetrics(unlockRequest.tenantId, { source: "admin_escalation_temp_unlocked", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Admin temporary unlock queued successfully", {
      unlockRequest,
      device,
      command
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
 * Reject an admin escalation.
 * Sample body: { "reason": "Bank record confirms no payment was received" }
 */
export const rejectAdminEscalation = async (req, res) => {
  try {
    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId });

    if (!unlockRequest) {
      return sendError(res, 400, "Escalation not found");
    }

    if (!["ESCALATED_ADMIN", "ESCALATED_PARTNER", "UNDER_REVIEW"].includes(unlockRequest.status)) {
      return sendError(res, 400, "Only open escalated cases can be rejected");
    }

    unlockRequest.status = "REJECTED_SUPER_ADMIN";
    unlockRequest.resolutionAction = "rejected";
    unlockRequest.resolutionNote = req.body.reason;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.CASE_REJECTED_BY_SUPER_ADMIN,
      actorId: req.auth.id,
      tenantId: unlockRequest.tenantId,
      channelPartnerId: unlockRequest.channelPartnerId,
      userId: unlockRequest.userId,
      deviceId: unlockRequest.deviceId,
      caseId: unlockRequest.caseId,
      reason: req.body.reason
    });

    await safeRefreshTenantMetrics(unlockRequest.tenantId, { source: "admin_escalation_rejected", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Escalation rejected successfully", unlockRequest);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Search devices.
 * Sample query: /admin/devices?imei=123456789012345&tenantId=665f...&state=LOCKED&mobile=9876543210
 */
export const listDevices = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.imei) filter.imei = req.query.imei;
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.state) filter.state = req.query.state;

    if (req.query.mobile) {
      const users = await User.find({ mobile: buildRegex(req.query.mobile) }).select("_id").lean();
      filter.userId = { $in: users.map((user) => user._id) };
    }

    const [items, total] = await Promise.all([
      Device.find(filter)
        .populate("userId", "name mobile")
        .populate("tenantId", "name channelPartnerId")
        .skip(skip)
        .limit(limit)
        .sort({ updatedAt: -1 })
        .lean(),
      Device.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Devices fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get device detail.
 * Sample params: /admin/devices/665f...
 */
export const getDeviceById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Invalid device ID");
    }

    const device = await Device.findById(req.params.deviceId)
      .populate("userId", "name mobile email loanId")
      .populate("tenantId", "name channelPartnerId supportPhone supportEmail")
      .lean();

    if (!device) {
      return sendError(res, 400, "Device not found");
    }

    const [policy, commands, cases, riskFlags] = await Promise.all([
      DevicePolicy.findOne({ tenantId: device.tenantId?._id || device.tenantId, policyKey: device.currentPolicyKey }).lean(),
      DeviceCommand.find({ deviceId: device._id }).sort({ createdAt: -1 }).limit(10).lean(),
      UnlockRequest.find({ deviceId: device._id }).sort({ createdAt: -1 }).limit(10).lean(),
      RiskFlag.find(getActiveRiskFilter({ deviceId: device._id })).lean()
    ]);

    return sendSuccess(res, 200, "Device fetched successfully", {
      device,
      policy,
      commands,
      cases,
      riskFlags
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get device command history.
 * Sample params: /admin/devices/665f.../commands
 */
export const getDeviceCommands = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Invalid device ID");
    }

    const commands = await DeviceCommand.find({ deviceId: req.params.deviceId })
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, 200, "Device commands fetched successfully", commands);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Super admin manual device lock.
 * Sample body: { "reason": "Compliance hold requested by lender" }
 */
export const lockAdminDevice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Invalid device ID");
    }

    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    const device = await Device.findById(req.params.deviceId).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    session.startTransaction();

    const result = await queueAdminDeviceCommand({
      device,
      accountId: req.auth.id,
      commandType: "LOCK",
      targetState: DEVICE_STATES.LOCKED,
      policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
      reason: req.body.reason,
      session
    });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.MANUAL_LOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: device.tenantId,
        userId: device.userId,
        deviceId: device._id,
        reason: req.body.reason,
        metadata: { commandId: result.command._id, source: "device_detail" }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 200, "Device lock queued successfully", result);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Super admin temporary device unlock.
 * Sample body: { "durationHours": 60, "reason": "Emergency access approved" }
 */
export const tempUnlockAdminDevice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Invalid device ID");
    }

    if (!req.body.reason || !req.body.durationHours) {
      return sendError(res, 400, "Reason and durationHours are required");
    }

    const durationHours = Number(req.body.durationHours);
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      return sendError(res, 400, "durationHours must be greater than zero");
    }

    const device = await Device.findById(req.params.deviceId).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }
    const riskWarningPayload = await buildRiskWarningPayload(device._id);

    session.startTransaction();

    const result = await queueAdminDeviceCommand({
      device,
      accountId: req.auth.id,
      commandType: "TEMP_UNLOCK",
      targetState: DEVICE_STATES.TEMP_UNLOCK,
      policyKey: DEVICE_POLICY_KEYS.TEMP_UNLOCKED,
      reason: req.body.reason,
      durationHours,
      extraPayload: {
        riskWarning: riskWarningPayload.riskWarning
      },
      session
    });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TEMP_UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: device.tenantId,
        userId: device.userId,
        deviceId: device._id,
        reason: req.body.reason,
        metadata: { commandId: result.command._id, durationHours, source: "device_detail" }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 200, "Temporary unlock queued successfully", {
      ...result,
      riskWarning: riskWarningPayload.riskWarning,
      activeCriticalRiskFlags: riskWarningPayload.activeCriticalRiskFlags
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Super admin full device unlock without EMI update.
 * Sample body: { "reason": "Manual unlock approved" }
 */
export const unlockAdminDevice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Invalid device ID");
    }

    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    const device = await Device.findById(req.params.deviceId).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }
    const riskWarningPayload = await buildRiskWarningPayload(device._id);

    session.startTransaction();

    const result = await queueAdminDeviceCommand({
      device,
      accountId: req.auth.id,
      commandType: "UNLOCK",
      targetState: DEVICE_STATES.UNLOCK_PENDING,
      policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      reason: req.body.reason,
      extraPayload: {
        riskWarning: riskWarningPayload.riskWarning
      },
      session
    });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.MANUAL_UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: device.tenantId,
        userId: device.userId,
        deviceId: device._id,
        reason: req.body.reason,
        metadata: { commandId: result.command._id, source: "device_detail" }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 200, "Device unlock queued successfully", {
      ...result,
      riskWarning: riskWarningPayload.riskWarning,
      activeCriticalRiskFlags: riskWarningPayload.activeCriticalRiskFlags
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * Super admin full unlock with EMI update.
 * Sample body: { "reason": "Payment verified by lender", "emiAction": "mark_paid" }
 */
export const unlockAdminDeviceWithWaive = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Invalid device ID");
    }

    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    if (!["mark_paid", "waive"].includes(req.body.emiAction)) {
      return sendError(res, 400, "Full unlock requires emiAction: mark_paid or waive");
    }

    const device = await Device.findById(req.params.deviceId).session(session);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }
    const riskWarningPayload = await buildRiskWarningPayload(device._id);

    session.startTransaction();

    let emiUpdate;
    try {
      emiUpdate = await resolveAllUnpaidInstallments({
        userId: device.userId,
        tenantId: device.tenantId,
        accountId: req.auth.id,
        reason: req.body.reason,
        emiAction: req.body.emiAction,
        session
      });
    } catch (error) {
      await session.abortTransaction();
      return sendError(res, 400, error.message);
    }

    const result = await queueAdminDeviceCommand({
      device,
      accountId: req.auth.id,
      commandType: "UNLOCK",
      targetState: DEVICE_STATES.UNLOCK_PENDING,
      policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      reason: req.body.reason,
      extraPayload: {
        riskWarning: riskWarningPayload.riskWarning
      },
      session
    });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.MANUAL_UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: device.tenantId,
        userId: device.userId,
        deviceId: device._id,
        reason: req.body.reason,
        metadata: {
          commandId: result.command._id,
          emiAction: req.body.emiAction,
          updatedInstallmentIds: emiUpdate.updatedInstallmentIds,
          source: "device_detail"
        }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 200, "Device unlock with EMI update queued successfully", {
      ...result,
      updatedInstallmentIds: emiUpdate.updatedInstallmentIds,
      riskWarning: riskWarningPayload.riskWarning,
      activeCriticalRiskFlags: riskWarningPayload.activeCriticalRiskFlags
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

const validateCustomNotificationPayload = (req, res) => {
  if (!hasRequiredFields(req.body, ["title", "text"])) {
    sendError(res, 400, "Title and text are required");
    return null;
  }

  const title = String(req.body.title).trim();
  const text = String(req.body.text).trim();

  if (!title || !text) {
    sendError(res, 400, "Title and text cannot be empty");
    return null;
  }

  if (title.length > 120) {
    sendError(res, 400, "Title must be 120 characters or fewer");
    return null;
  }

  if (text.length > 1000) {
    sendError(res, 400, "Text must be 1000 characters or fewer");
    return null;
  }

  return { title, text };
};

const getDeliverySummary = (results) =>
  results.reduce((summary, result) => {
    const status = result.status || "unknown";
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});

/**
 * List Super Admin notification target options.
 * Sample query: /admin/notifications/targets?targetApp=tenant_app
 */
export const listNotificationTargets = async (req, res) => {
  try {
    const targetApp = String(req.query.targetApp || NOTIFICATION_TARGET_APPS.BORROWER_APP).trim();
    if (!Object.values(NOTIFICATION_TARGET_APPS).includes(targetApp)) {
      return sendError(res, 400, "Invalid targetApp");
    }

    const allOption = { id: "all", label: "All" };
    let items = [];

    if (targetApp === NOTIFICATION_TARGET_APPS.BORROWER_APP) {
      const userIds = await Device.distinct("userId", { fcmToken: { $exists: true, $ne: "" } });
      const users = await User.find({ _id: { $in: userIds }, isActive: true })
        .select("name tenantId")
        .populate("tenantId", "name")
        .sort({ name: 1 })
        .lean();

      items = users.map((user) => ({
        id: user._id.toString(),
        label: user.tenantId?.name ? `${user.name} - ${user.tenantId.name}` : user.name
      }));
    }

    if (targetApp === NOTIFICATION_TARGET_APPS.TENANT_APP) {
      const tenants = await Tenant.find({ isActive: true }).select("name").sort({ name: 1 }).lean();
      items = tenants.map((tenant) => ({
        id: tenant._id.toString(),
        label: tenant.name
      }));
    }

    if (targetApp === NOTIFICATION_TARGET_APPS.PARTNER_APP) {
      const partners = await ChannelPartner.find({ isActive: true }).select("name").sort({ name: 1 }).lean();
      items = partners.map((partner) => ({
        id: partner._id.toString(),
        label: partner.name
      }));
    }

    return sendSuccess(res, 200, "Notification targets fetched successfully", {
      targetApp,
      items: [allOption, ...items]
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

const sendBorrowerAppCustomNotification = async ({ req, res, title, text, targetId, notificationRequestId }) => {
  const deviceFilter = {
    fcmToken: { $exists: true, $ne: "" }
  };
  let scope = "all";
  let activeUserCount;
  let auditTenantId;
  let auditUserId;

  if (targetId && targetId !== "all") {
    if (!isValidObjectId(targetId)) {
      return sendError(res, 400, "Invalid borrower target ID");
    }

    const user = await User.findOne({ _id: targetId, isActive: true }).lean();
    if (!user) {
      return sendError(res, 404, "Active borrower not found");
    }

    deviceFilter.userId = user._id;
    scope = "user";
    activeUserCount = 1;
    auditUserId = user._id;
  } else if (req.body.tenantId) {
    if (!isValidObjectId(req.body.tenantId)) {
      return sendError(res, 400, "Invalid tenant ID");
    }

    const tenant = await Tenant.findById(req.body.tenantId).lean();
    if (!tenant) {
      return sendError(res, 404, "Tenant not found");
    }

    const activeUsers = await User.find({ tenantId: tenant._id, isActive: true }).select("_id").lean();
    activeUserCount = activeUsers.length;
    deviceFilter.userId = { $in: activeUsers.map((user) => user._id) };
    deviceFilter.tenantId = tenant._id;
    scope = "tenant";
    auditTenantId = tenant._id;
  } else {
    const activeUsers = await User.find({ isActive: true }).select("_id").lean();
    activeUserCount = activeUsers.length;
    deviceFilter.userId = { $in: activeUsers.map((user) => user._id) };
  }

  const devices = await Device.find(deviceFilter).select("_id tenantId userId fcmToken").lean();
  if (!devices.length) {
    console.warn("Custom borrower notification has no target devices with FCM tokens", {
      notificationRequestId,
      scope,
      targetId,
      activeUserCount
    });
    return sendError(res, 404, "No registered devices with FCM tokens found for this notification target");
  }

  const commands = await DeviceCommand.create(
    devices.map((device) => ({
      deviceId: device._id,
      tenantId: device.tenantId,
      commandType: "NOTIFICATION",
      triggeredBy: "super_admin",
      triggeredByAccountId: req.auth.id,
      payload: {
        title,
        text,
        scope,
        targetApp: NOTIFICATION_TARGET_APPS.BORROWER_APP,
        userId: scope === "user" ? targetId : req.body.userId,
        tenantId: scope === "tenant" ? req.body.tenantId : undefined,
        notificationType: "CUSTOM"
      }
    }))
  );

  const commandIds = commands.map((command) => command._id);
  await createAuditLog({
    eventType: AUDIT_EVENTS.CUSTOM_NOTIFICATION_QUEUED,
    actorId: req.auth.id,
    actorCollection: "accounts",
    tenantId: auditTenantId,
    userId: auditUserId,
    metadata: {
      targetApp: NOTIFICATION_TARGET_APPS.BORROWER_APP,
      targetId: targetId || "all",
      scope,
      title,
      targetDeviceCount: devices.length,
      commandIds
    }
  });

  const deliveryResults = await runFcmDeliveryBatch({ limit: commands.length, commandIds });
  const deliverySummary = getDeliverySummary(deliveryResults);

  return sendSuccess(res, 201, "Custom notification queued successfully", {
    targetApp: NOTIFICATION_TARGET_APPS.BORROWER_APP,
    targetId: targetId || "all",
    scope,
    targetDeviceCount: devices.length,
    queuedCommandCount: commands.length,
    deliveryAttempted: true,
    deliverySummary,
    deliveryResults
  });
};

const sendTenantAppCustomNotification = async ({ req, res, title, text, targetId }) => {
  let jobs = [];
  let targetTenantCount = 0;

  if (targetId && targetId !== "all") {
    if (!isValidObjectId(targetId)) return sendError(res, 400, "Invalid tenant target ID");
    const tenant = await Tenant.findOne({ _id: targetId, isActive: true }).select("_id").lean();
    if (!tenant) return sendError(res, 404, "Active tenant not found");
    jobs = await queueTenantAppNotification({ tenantId: tenant._id, title, text, notificationType: "CUSTOM" });
    targetTenantCount = 1;
  } else {
    const tenants = await Tenant.find({ isActive: true }).select("_id").lean();
    targetTenantCount = tenants.length;
    const queued = await Promise.all(
      tenants.map((tenant) =>
        queueTenantAppNotification({ tenantId: tenant._id, title, text, notificationType: "CUSTOM" })
      )
    );
    jobs = queued.flat();
  }

  if (!jobs.length) {
    return sendError(res, 404, "No active tenant app push tokens found for this notification target");
  }

  await createAuditLog({
    eventType: AUDIT_EVENTS.CUSTOM_NOTIFICATION_QUEUED,
    actorId: req.auth.id,
    actorCollection: "accounts",
    tenantId: targetId && targetId !== "all" ? targetId : undefined,
    metadata: {
      targetApp: NOTIFICATION_TARGET_APPS.TENANT_APP,
      targetId: targetId || "all",
      title,
      queuedJobCount: jobs.length
    }
  });

  return sendSuccess(res, 201, "Custom notification queued successfully", {
    targetApp: NOTIFICATION_TARGET_APPS.TENANT_APP,
    targetId: targetId || "all",
    targetTenantCount,
    targetAccountCount: jobs.length,
    queuedJobCount: jobs.length,
    deliveryAttempted: false
  });
};

const sendPartnerAppCustomNotification = async ({ req, res, title, text, targetId }) => {
  let jobs = [];
  let targetPartnerCount = 0;

  if (targetId && targetId !== "all") {
    if (!isValidObjectId(targetId)) return sendError(res, 400, "Invalid partner target ID");
    const partner = await ChannelPartner.findOne({ _id: targetId, isActive: true }).select("_id").lean();
    if (!partner) return sendError(res, 404, "Active channel partner not found");
    jobs = await queuePartnerAppNotification({ channelPartnerId: partner._id, title, text, notificationType: "CUSTOM" });
    targetPartnerCount = 1;
  } else {
    const partners = await ChannelPartner.find({ isActive: true }).select("_id").lean();
    targetPartnerCount = partners.length;
    const queued = await Promise.all(
      partners.map((partner) =>
        queuePartnerAppNotification({ channelPartnerId: partner._id, title, text, notificationType: "CUSTOM" })
      )
    );
    jobs = queued.flat();
  }

  if (!jobs.length) {
    return sendError(res, 404, "No active partner app push tokens found for this notification target");
  }

  await createAuditLog({
    eventType: AUDIT_EVENTS.CUSTOM_NOTIFICATION_QUEUED,
    actorId: req.auth.id,
    actorCollection: "accounts",
    channelPartnerId: targetId && targetId !== "all" ? targetId : undefined,
    metadata: {
      targetApp: NOTIFICATION_TARGET_APPS.PARTNER_APP,
      targetId: targetId || "all",
      title,
      queuedJobCount: jobs.length
    }
  });

  return sendSuccess(res, 201, "Custom notification queued successfully", {
    targetApp: NOTIFICATION_TARGET_APPS.PARTNER_APP,
    targetId: targetId || "all",
    targetPartnerCount,
    targetAccountCount: jobs.length,
    queuedJobCount: jobs.length,
    deliveryAttempted: false
  });
};

/**
 * Send a custom notification to Borrower App, Tenant App, or Partner App.
 * Sample body: { "targetApp": "borrower_app", "targetId": "all", "title": "Payment reminder", "text": "Your EMI is due soon" }
 */
export const sendCustomNotification = async (req, res) => {
  const notificationRequestId = `custom_notification_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const notificationPayload = validateCustomNotificationPayload(req, res);
    if (!notificationPayload) return null;

    const targetApp = String(req.body.targetApp || NOTIFICATION_TARGET_APPS.BORROWER_APP).trim();
    if (!Object.values(NOTIFICATION_TARGET_APPS).includes(targetApp)) {
      return sendError(res, 400, "Invalid targetApp");
    }

    const targetId = req.body.targetId || req.body.userId || "all";
    console.info("Custom notification request received", {
      notificationRequestId,
      actorId: req.auth.id,
      targetApp,
      targetId,
      hasLegacyTenantId: Boolean(req.body.tenantId),
      titleLength: notificationPayload.title.length,
      textLength: notificationPayload.text.length
    });

    if (targetApp === NOTIFICATION_TARGET_APPS.BORROWER_APP) {
      return sendBorrowerAppCustomNotification({
        req,
        res,
        ...notificationPayload,
        targetId,
        notificationRequestId
      });
    }

    if (targetApp === NOTIFICATION_TARGET_APPS.TENANT_APP) {
      return sendTenantAppCustomNotification({ req, res, ...notificationPayload, targetId });
    }

    return sendPartnerAppCustomNotification({ req, res, ...notificationPayload, targetId });
  } catch (error) {
    console.error("Custom notification failed", {
      notificationRequestId,
      actorId: req.auth?.id,
      targetApp: req.body?.targetApp,
      targetId: req.body?.targetId,
      message: error.message,
      stack: error.stack
    });

    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List triggered device commands across the platform.
 * Sample query: /admin/commands?status=pending&commandType=LOCK&triggeredBy=manual_tenant&tenantId=665f...&deviceId=665f...&from=2026-05-01&to=2026-05-22&page=1&limit=20
 */
export const listDeviceCommands = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.commandType && req.query.commandType !== "all") filter.commandType = req.query.commandType;
    if (req.query.triggeredBy && req.query.triggeredBy !== "all") filter.triggeredBy = req.query.triggeredBy;
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.deviceId) filter.deviceId = req.query.deviceId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const [items, total] = await Promise.all([
      DeviceCommand.find(filter)
        .populate("deviceId", "imei deviceModel manufacturer state userId")
        .populate("tenantId", "name")
        .populate("triggeredByAccountId", "name email role")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      DeviceCommand.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Device commands fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List FCM delivery attempts across borrower, tenant, and partner apps.
 * Sample query: /admin/fcm-logs?status=sent&targetApp=tenant_app&sortBy=createdAt&sortOrder=desc&page=1&limit=20
 */
export const listFcmDeliveryLogs = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    const allowedStatuses = new Set(["sent", "failed", "skipped"]);
    const allowedTargetApps = new Set(["borrower_app", "tenant_app", "partner_app"]);
    const allowedRecipientTypes = new Set(["device", "tenant_admin", "partner_admin"]);
    const allowedMessageTypes = new Set(["POLICY_UPDATE", "NOTIFICATION", "APP_NOTIFICATION"]);
    const allowedSortFields = new Set(["createdAt", "status", "targetApp", "recipientType", "messageType", "notificationType"]);

    if (req.query.status && req.query.status !== "all") {
      if (!allowedStatuses.has(req.query.status)) return sendError(res, 400, "Invalid FCM log status");
      filter.status = req.query.status;
    }
    if (req.query.targetApp && req.query.targetApp !== "all") {
      if (!allowedTargetApps.has(req.query.targetApp)) return sendError(res, 400, "Invalid targetApp");
      filter.targetApp = req.query.targetApp;
    }
    if (req.query.recipientType && req.query.recipientType !== "all") {
      if (!allowedRecipientTypes.has(req.query.recipientType)) return sendError(res, 400, "Invalid recipientType");
      filter.recipientType = req.query.recipientType;
    }
    if (req.query.messageType && req.query.messageType !== "all") {
      if (!allowedMessageTypes.has(req.query.messageType)) return sendError(res, 400, "Invalid messageType");
      filter.messageType = req.query.messageType;
    }
    if (req.query.notificationType) filter.notificationType = req.query.notificationType;
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.channelPartnerId) filter.channelPartnerId = req.query.channelPartnerId;
    if (req.query.deviceId) filter.deviceId = req.query.deviceId;
    if (req.query.accountId) filter.accountId = req.query.accountId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }
    if (req.query.search) {
      const search = new RegExp(escapeRegex(req.query.search), "i");
      filter.$or = [
        { providerMessageId: search },
        { error: search },
        { tokenHash: search },
        { messageType: search },
        { notificationType: search },
        { targetApp: search },
        { recipientType: search },
        { status: search }
      ];
    }

    const sortBy = allowedSortFields.has(req.query.sortBy) ? req.query.sortBy : "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const sort = sortBy === "createdAt" ? { createdAt: sortOrder } : { [sortBy]: sortOrder, createdAt: -1 };

    const [rawItems, total] = await Promise.all([
      FcmDeliveryLog.find(filter)
        .select("-token")
        .populate("deviceId", "imei deviceModel manufacturer state")
        .populate("commandId", "commandType status triggeredBy")
        .populate("notificationJobId", "title notificationType status")
        .populate("accountId", "name email role")
        .populate("tenantId", "name")
        .populate("channelPartnerId", "name")
        .skip(skip)
        .limit(limit)
        .sort(sort)
        .lean(),
      FcmDeliveryLog.countDocuments(filter)
    ]);

    const items = rawItems.map(({ token, ...item }) => item);

    return sendSuccess(res, 200, "FCM delivery logs fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get device audit trail.
 * Sample params: /admin/devices/665f.../audit-logs
 */
export const getDeviceAuditLogs = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Invalid device ID");
    }

    const auditLogs = await AuditLog.find({ deviceId: req.params.deviceId })
      .sort({ timestamp: -1 })
      .lean();

    return sendSuccess(res, 200, "Device audit logs fetched successfully", auditLogs);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List risk flags.
 * Sample query: /admin/risk-flags?severity=high&status=open&tenantId=665f...
 */
export const getAdminRiskFlags = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};
    const allowedSortFields = new Set(["createdAt", "updatedAt", "lastDetectedAt", "severity", "status", "type", "riskBucket"]);

    if (req.query.severity && req.query.severity !== "all") filter.severity = req.query.severity;
    if (req.query.status && req.query.status !== "all") {
      filter.status = req.query.status === "active" ? { $nin: INACTIVE_RISK_FLAG_STATUSES } : req.query.status;
    }
    if (req.query.type) filter.type = req.query.type;
    if (req.query.riskBucket && req.query.riskBucket !== "all") filter.riskBucket = req.query.riskBucket;
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.deviceId) filter.deviceId = req.query.deviceId;
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.search) {
      const search = new RegExp(escapeRegex(req.query.search), "i");
      filter.$or = [{ type: search }, { riskType: search }, { message: search }, { caseId: search }];
    }

    const sortBy = allowedSortFields.has(req.query.sortBy) ? req.query.sortBy : "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const sort = sortBy === "createdAt" ? { createdAt: sortOrder } : { [sortBy]: sortOrder, createdAt: -1 };

    const [items, total] = await Promise.all([
      RiskFlag.find(filter)
        .populate("tenantId", "name")
        .populate("deviceId", "imei deviceModel manufacturer state deviceSecurityState")
        .populate("userId", "name mobile loanId")
        .populate("acknowledgedBy", "name email role")
        .populate("clearedBy", "name email role")
        .skip(skip)
        .limit(limit)
        .sort(sort)
        .lean(),
      RiskFlag.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Risk flags fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const getAdminRiskFlagById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.flagId)) {
      return sendError(res, 400, "Invalid risk flag ID");
    }

    const riskFlag = await RiskFlag.findById(req.params.flagId)
      .populate("tenantId", "name supportPhone supportEmail")
      .populate("deviceId", "imei deviceModel manufacturer state currentPolicyKey deviceSecurityState lastIntegrityCheckAt lastCleanIntegrityAt lastRiskAt")
      .populate("userId", "name mobile email loanId")
      .populate("acknowledgedBy", "name email role")
      .populate("clearedBy", "name email role")
      .lean();

    if (!riskFlag) {
      return sendError(res, 404, "Risk flag not found");
    }

    const deviceId = riskFlag.deviceId?._id || riskFlag.deviceId;
    const [integrityChecks, commands, auditLogs, activeCriticalRiskFlags] = await Promise.all([
      deviceId
        ? IntegrityCheck.find({ deviceId }).sort({ createdAt: -1 }).limit(10).lean()
        : IntegrityCheck.find({ userId: riskFlag.userId?._id || riskFlag.userId }).sort({ createdAt: -1 }).limit(10).lean(),
      deviceId ? DeviceCommand.find({ deviceId }).sort({ createdAt: -1 }).limit(10).lean() : [],
      AuditLog.find({
        $or: [
          { "metadata.riskFlagId": riskFlag._id },
          { "metadata.riskFlagIds": riskFlag._id },
          ...(deviceId ? [{ deviceId }] : [])
        ]
      })
        .sort({ timestamp: -1 })
        .limit(10)
        .lean(),
      deviceId ? getActiveCriticalRiskFlagsForDevice(deviceId) : []
    ]);

    return sendSuccess(res, 200, "Risk flag fetched successfully", {
      riskFlag,
      integrityChecks,
      commands,
      auditLogs,
      activeCriticalRiskFlags
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Acknowledge risk flag.
 * Sample body: { "note": "Reviewed with tenant" }
 */
export const acknowledgeRiskFlag = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.flagId)) {
      return sendError(res, 400, "Invalid risk flag ID");
    }

    const riskFlag = await RiskFlag.findByIdAndUpdate(
      req.params.flagId,
      {
        status: "acknowledged",
        acknowledgedBy: req.auth.id,
        acknowledgedAt: new Date(),
        acknowledgedNote: req.body.note
      },
      { new: true }
    );

    if (!riskFlag) {
      return sendError(res, 400, "Risk flag not found");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.RISK_FLAG_ACKNOWLEDGED,
      actorId: req.auth.id,
      tenantId: riskFlag.tenantId,
      userId: riskFlag.userId,
      deviceId: riskFlag.deviceId,
      reason: req.body.note,
      metadata: { riskFlagId: riskFlag._id }
    });

    return sendSuccess(res, 200, "Risk flag acknowledged successfully", riskFlag);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

const getActionableRiskFlag = async (flagId) => {
  return RiskFlag.findById(flagId);
};

const getRiskFlagDevice = async (riskFlag) => {
  if (!riskFlag.deviceId) return null;
  return Device.findById(riskFlag.deviceId).lean();
};

export const requestRiskFlagRecheck = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.flagId)) {
      return sendError(res, 400, "Invalid risk flag ID");
    }

    const riskFlag = await getActionableRiskFlag(req.params.flagId);
    if (!riskFlag) return sendError(res, 404, "Risk flag not found");

    const device = await getRiskFlagDevice(riskFlag);
    if (!device) return sendError(res, 400, "Risk flag is not linked to a device");

    const command = await DeviceCommand.create({
      deviceId: device._id,
      tenantId: device.tenantId,
      commandType: "RUN_INTEGRITY_CHECK",
      triggeredBy: "super_admin",
      triggeredByAccountId: req.auth.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      payload: {
        source: "risk_admin_recheck",
        reason: req.body.reason || "Admin requested security recheck",
        riskFlagId: riskFlag._id.toString(),
        riskType: riskFlag.type,
        action: "ADMIN_RECHECK"
      }
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.RISK_RECHECK_REQUESTED,
      actorId: req.auth.id,
      tenantId: riskFlag.tenantId,
      userId: riskFlag.userId,
      deviceId: riskFlag.deviceId,
      reason: req.body.reason,
      metadata: { riskFlagId: riskFlag._id, commandId: command._id }
    });

    return sendSuccess(res, 201, "Security recheck command queued successfully", { command });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const clearRiskFlag = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.flagId)) {
      return sendError(res, 400, "Invalid risk flag ID");
    }

    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    const resolution =
      req.body.resolution === RISK_FLAG_STATUSES.FALSE_POSITIVE
        ? RISK_FLAG_STATUSES.FALSE_POSITIVE
        : RISK_FLAG_STATUSES.CLEARED;

    const riskFlag = await RiskFlag.findByIdAndUpdate(
      req.params.flagId,
      {
        status: resolution,
        clearedBy: req.auth.id,
        clearedAt: new Date(),
        clearanceReason: req.body.reason
      },
      { new: true }
    );

    if (!riskFlag) return sendError(res, 404, "Risk flag not found");

    if (riskFlag.deviceId) {
      const hasOtherActiveRisk = await RiskFlag.exists({
        deviceId: riskFlag.deviceId,
        _id: { $ne: riskFlag._id },
        ...getActiveRiskFilter()
      });
      const deviceUpdate = {
        $pull: { currentRiskIds: riskFlag._id }
      };
      if (!hasOtherActiveRisk) {
        deviceUpdate.$set = { deviceSecurityState: "HEALTHY" };
      }
      await Device.findByIdAndUpdate(riskFlag.deviceId, deviceUpdate);
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.RISK_FLAG_CLEARED,
      actorId: req.auth.id,
      tenantId: riskFlag.tenantId,
      userId: riskFlag.userId,
      deviceId: riskFlag.deviceId,
      reason: req.body.reason,
      metadata: { riskFlagId: riskFlag._id, resolution }
    });

    return sendSuccess(res, 200, "Risk flag updated successfully", riskFlag);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const queueRiskFlagAppUpdate = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.flagId)) {
      return sendError(res, 400, "Invalid risk flag ID");
    }

    const riskFlag = await getActionableRiskFlag(req.params.flagId);
    if (!riskFlag) return sendError(res, 404, "Risk flag not found");

    const device = await getRiskFlagDevice(riskFlag);
    if (!device) return sendError(res, 400, "Risk flag is not linked to a device");

    const build = await AppBuild.findOne({
      platform: APP_BUILD_PLATFORMS.ANDROID,
      packageName: BORROWER_ANDROID_PACKAGE_NAME,
      channel: APP_BUILD_CHANNELS.PRODUCTION,
      buildType: APP_BUILD_TYPES.RELEASE,
      status: APP_BUILD_STATUSES.PUBLISHED
    })
      .sort({ versionCode: -1, publishedAt: -1 })
      .lean();

    if (!build) {
      return sendError(res, 404, "Published production Android build not found");
    }

    const command = await DeviceCommand.create({
      deviceId: device._id,
      tenantId: device.tenantId,
      commandType: "INSTALL_UPDATE",
      triggeredBy: "super_admin",
      triggeredByAccountId: req.auth.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      payload: {
        source: "risk_admin_app_update",
        reason: req.body.reason || "Admin pushed trusted app repair",
        riskFlagId: riskFlag._id.toString(),
        riskType: riskFlag.type,
        packageName: build.packageName,
        versionName: build.versionName,
        versionCode: build.versionCode,
        apkUrl: build.apkUrl,
        apkSha256: build.apkSha256,
        checksumRequired: build.checksumRequired
      }
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.RISK_APP_UPDATE_QUEUED,
      actorId: req.auth.id,
      tenantId: riskFlag.tenantId,
      userId: riskFlag.userId,
      deviceId: riskFlag.deviceId,
      reason: req.body.reason,
      metadata: { riskFlagId: riskFlag._id, commandId: command._id, buildId: build._id }
    });

    return sendSuccess(res, 201, "App update command queued successfully", { command, build });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const queueRiskFlagWipe = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.flagId)) {
      return sendError(res, 400, "Invalid risk flag ID");
    }

    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    const riskFlag = await getActionableRiskFlag(req.params.flagId);
    if (!riskFlag) return sendError(res, 404, "Risk flag not found");
    if (!isRiskFlagWipeEligible(riskFlag)) {
      return sendError(res, 400, "Wipe is allowed only for critical permanent device-compromise risks");
    }

    const device = await getRiskFlagDevice(riskFlag);
    if (!device) return sendError(res, 400, "Risk flag is not linked to a device");

    const command = await DeviceCommand.create({
      deviceId: device._id,
      tenantId: device.tenantId,
      commandType: "WIPE_DEVICE",
      triggeredBy: "super_admin",
      triggeredByAccountId: req.auth.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      payload: {
        source: "risk_admin_wipe",
        reason: req.body.reason,
        riskFlagId: riskFlag._id.toString(),
        riskType: riskFlag.type,
        destructiveAction: true,
        requireDeviceOwner: true
      }
    });

    riskFlag.status = RISK_FLAG_STATUSES.WIPED_PENDING_REPROVISION;
    riskFlag.metadata = {
      ...(riskFlag.metadata || {}),
      wipeCommandId: command._id,
      wipeQueuedAt: new Date()
    };
    await riskFlag.save();

    await Device.findByIdAndUpdate(device._id, {
      $set: { deviceSecurityState: "WIPED_PENDING_REPROVISION" }
    });

    await createAuditLog({
      eventType: AUDIT_EVENTS.RISK_WIPE_QUEUED,
      actorId: req.auth.id,
      tenantId: riskFlag.tenantId,
      userId: riskFlag.userId,
      deviceId: riskFlag.deviceId,
      reason: req.body.reason,
      metadata: { riskFlagId: riskFlag._id, commandId: command._id }
    });

    return sendSuccess(res, 201, "Admin wipe command queued successfully", { command, riskFlag });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Generate a signed manual override QR token for one device.
 * Sample body: { "reason": "Server outage readiness" }
 */
export const generateDeviceManualOverrideToken = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Valid device ID is required");
    }

    const device = await Device.findById(req.params.deviceId);
    if (!device) {
      return sendError(res, 404, "Device not found");
    }

    const token = await generateManualOverrideTokenForDevice(device, {
      generatedBy: req.auth.id,
      reason: req.body.reason || "Emergency offline manual override",
      source: "admin_api"
    });

    return sendSuccess(
      res,
      201,
      "Manual override token generated successfully",
      buildManualOverrideTokenResponse(token, { includeQr: true })
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List manual override QR tokens for one device.
 */
export const listDeviceManualOverrideTokens = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.deviceId)) {
      return sendError(res, 400, "Valid device ID is required");
    }

    const tokens = await ManualOverrideToken.find({ deviceId: req.params.deviceId }).sort({ createdAt: -1 }).lean();

    return sendSuccess(
      res,
      200,
      "Device manual override tokens fetched successfully",
      tokens.map((token) => buildManualOverrideTokenResponse(token))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List platform manual override QR tokens.
 * Sample query: /admin/manual-override-tokens?tenantId=665f...&status=GENERATED&page=1&limit=20
 */
export const listManualOverrideTokens = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.deviceId) filter.deviceId = req.query.deviceId;
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.channelPartnerId) filter.channelPartnerId = req.query.channelPartnerId;
    if (req.query.status) {
      const status = String(req.query.status).trim().toUpperCase();
      if (!Object.values(MANUAL_OVERRIDE_TOKEN_STATUSES).includes(status)) {
        return sendError(res, 400, "Invalid manual override token status");
      }
      filter.status = status;
    }
    if (req.query.expiresBefore) {
      const expiresBefore = new Date(req.query.expiresBefore);
      if (Number.isNaN(expiresBefore.getTime())) {
        return sendError(res, 400, "expiresBefore must be a valid date");
      }
      filter.expiresAt = { $lte: expiresBefore };
    }

    const [items, total] = await Promise.all([
      ManualOverrideToken.find(filter)
        .populate("deviceId", "imei deviceModel manufacturer state")
        .populate("tenantId", "name")
        .populate("channelPartnerId", "name")
        .populate("generatedBy", "name email")
        .populate("downloadedBy", "name email")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      ManualOverrideToken.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Manual override tokens fetched successfully", {
      items: items.map((token) => buildManualOverrideTokenResponse(token)),
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

const buildManualOverrideTokenLookup = (tokenId) => {
  const lookup = [{ tokenId }];
  if (isValidObjectId(tokenId)) lookup.push({ _id: tokenId });
  return { $or: lookup };
};

/**
 * Fetch one manual override QR token and mark it as downloaded.
 */
export const getManualOverrideTokenById = async (req, res) => {
  try {
    const token = await ManualOverrideToken.findOne(buildManualOverrideTokenLookup(req.params.tokenId));
    if (!token) {
      return sendError(res, 404, "Manual override token not found");
    }

    if (token.status === MANUAL_OVERRIDE_TOKEN_STATUSES.GENERATED) {
      token.status = MANUAL_OVERRIDE_TOKEN_STATUSES.DOWNLOADED;
      token.downloadedAt = new Date();
      token.downloadedBy = req.auth.id;
      await token.save();

      await createAuditLog({
        eventType: AUDIT_EVENTS.MANUAL_OVERRIDE_TOKEN_DOWNLOADED,
        actorId: req.auth.id,
        actorCollection: "accounts",
        tenantId: token.tenantId,
        channelPartnerId: token.channelPartnerId,
        userId: token.userId,
        deviceId: token.deviceId,
        metadata: { tokenId: token.tokenId }
      });
    }

    return sendSuccess(
      res,
      200,
      "Manual override token fetched successfully",
      buildManualOverrideTokenResponse(token, { includeQr: true })
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Revoke an unused manual override QR token.
 */
export const revokeManualOverrideToken = async (req, res) => {
  try {
    const token = await ManualOverrideToken.findOne(buildManualOverrideTokenLookup(req.params.tokenId));
    if (!token) {
      return sendError(res, 404, "Manual override token not found");
    }

    if (token.status === MANUAL_OVERRIDE_TOKEN_STATUSES.USED) {
      return sendError(res, 409, "Used manual override tokens cannot be revoked");
    }

    if (token.status !== MANUAL_OVERRIDE_TOKEN_STATUSES.REVOKED) {
      token.status = MANUAL_OVERRIDE_TOKEN_STATUSES.REVOKED;
      token.revokedAt = new Date();
      token.metadata = {
        ...(token.metadata || {}),
        revokedReason: req.body.reason
      };
      await token.save();

      await createAuditLog({
        eventType: AUDIT_EVENTS.MANUAL_OVERRIDE_TOKEN_REVOKED,
        actorId: req.auth.id,
        actorCollection: "accounts",
        tenantId: token.tenantId,
        channelPartnerId: token.channelPartnerId,
        userId: token.userId,
        deviceId: token.deviceId,
        reason: req.body.reason,
        metadata: { tokenId: token.tokenId }
      });
    }

    return sendSuccess(res, 200, "Manual override token revoked successfully", buildManualOverrideTokenResponse(token));
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Backfill manual override QR tokens for existing devices.
 * Sample body: { "tenantId": "...", "deviceId": "...", "limit": 500, "dryRun": false }
 */
export const backfillManualOverrideTokensForDevices = async (req, res) => {
  try {
    if (req.body.deviceId && !isValidObjectId(req.body.deviceId)) {
      return sendError(res, 400, "deviceId must be valid");
    }
    if (req.body.tenantId && !isValidObjectId(req.body.tenantId)) {
      return sendError(res, 400, "tenantId must be valid");
    }

    const result = await backfillManualOverrideTokens({
      deviceId: req.body.deviceId,
      tenantId: req.body.tenantId,
      limit: req.body.limit,
      dryRun: parseBoolean(req.body.dryRun),
      generatedBy: req.auth.id,
      reason: req.body.reason || "Manual override token backfill",
      source: "admin_backfill_api"
    });

    return sendSuccess(res, 200, "Manual override token backfill completed", result);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Renew manual override QR tokens that are missing or close to expiry.
 */
export const renewExpiringManualOverrideTokensForDevices = async (req, res) => {
  try {
    if (req.body.deviceId && !isValidObjectId(req.body.deviceId)) {
      return sendError(res, 400, "deviceId must be valid");
    }
    if (req.body.tenantId && !isValidObjectId(req.body.tenantId)) {
      return sendError(res, 400, "tenantId must be valid");
    }

    const result = await renewExpiringManualOverrideTokens({
      deviceId: req.body.deviceId,
      tenantId: req.body.tenantId,
      limit: req.body.limit,
      dryRun: parseBoolean(req.body.dryRun),
      generatedBy: req.auth.id,
      source: "admin_renewal_api"
    });

    return sendSuccess(res, 200, "Manual override token renewal completed", result);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List platform audit logs.
 * Sample query: /admin/audit-logs?tenantId=665f...&eventType=OVERRIDE_EXECUTED&page=1&limit=20
 */
export const getAuditLogs = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.tenantId) filter.tenantId = req.query.tenantId;
    if (req.query.channelPartnerId) filter.channelPartnerId = req.query.channelPartnerId;
    if (req.query.deviceId) filter.deviceId = req.query.deviceId;
    if (req.query.eventType) filter.eventType = req.query.eventType;

    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .populate("actorId", "name email")
        .populate("tenantId", "name")
        .populate("channelPartnerId", "name")
        .skip(skip)
        .limit(limit)
        .sort({ timestamp: -1 })
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Audit logs fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

const buildAppBuildFilter = (query) => {
  const filter = {};
  const identity = validateAppBuildIdentity({
    platform: query.platform || "android",
    packageName: query.packageName || "com.crednexa.app",
    channel: query.channel || undefined
  });

  if (identity.error) {
    return { error: identity.error };
  }

  filter.platform = identity.value.platform;
  filter.packageName = identity.value.packageName;
  if (query.channel) filter.channel = identity.value.channel;

  if (query.status && Object.values(APP_BUILD_STATUSES).includes(String(query.status).trim().toLowerCase())) {
    filter.status = String(query.status).trim().toLowerCase();
  } else if (query.status) {
    return { error: "status must be draft, published, or archived" };
  }

  return { filter };
};

const handleAppBuildWriteError = (res, error) => {
  if (error?.code === 11000) {
    return sendError(res, 409, "App build versionCode already exists for this app channel");
  }

  return sendError(res, 500, error.message || "Internal server error");
};

/**
 * List Android app builds for Super Admin release management. Filters are safe
 * operational metadata only; borrower/device identifiers are not involved.
 */
export const listAppBuilds = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filterResult = buildAppBuildFilter(req.query);
    if (filterResult.error) {
      return sendError(res, 400, filterResult.error);
    }

    const [items, total] = await Promise.all([
      AppBuild.find(filterResult.filter)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("publishedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AppBuild.countDocuments(filterResult.filter)
    ]);

    return sendSuccess(res, 200, "App builds fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create a draft build. Publishing is deliberately separate so an uploaded APK
 * can be reviewed before borrower devices start receiving it.
 */
export const createAppBuild = async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, 400, "apkFile is required");
    }

    const validation = validateBuildPayload(req.body);
    if (validation.error) {
      return sendError(res, 400, validation.error);
    }

    const apkMetadata = await uploadBuildApk({
      file: req.file,
      buildData: validation.value,
      actorId: req.auth.id
    });

    const appBuild = await AppBuild.create({
      ...validation.value,
      ...apkMetadata,
      status: APP_BUILD_STATUSES.DRAFT,
      createdBy: req.auth.id,
      updatedBy: req.auth.id
    });

    return sendSuccess(res, 201, "App build created successfully", appBuild);
  } catch (error) {
    return handleAppBuildWriteError(res, error);
  }
};

export const getAppBuildById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.buildId)) {
      return sendError(res, 400, "Invalid app build ID");
    }

    const appBuild = await AppBuild.findById(req.params.buildId)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("publishedBy", "name email")
      .lean();

    if (!appBuild) {
      return sendError(res, 404, "App build not found");
    }

    return sendSuccess(res, 200, "App build fetched successfully", appBuild);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Update draft build metadata and optionally replace the APK. Published builds
 * are immutable for identity/version fields to keep installed-client decisions
 * auditable and reproducible.
 */
export const updateAppBuild = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.buildId)) {
      return sendError(res, 400, "Invalid app build ID");
    }

    const appBuild = await AppBuild.findById(req.params.buildId);
    if (!appBuild) {
      return sendError(res, 404, "App build not found");
    }

    const protectedFields = ["platform", "packageName", "channel", "versionCode"];
    if (appBuild.status === APP_BUILD_STATUSES.PUBLISHED && protectedFields.some((field) => req.body[field] !== undefined)) {
      return sendError(res, 400, "Published build identity fields cannot be updated");
    }

    const validation = validateBuildPayload(
      {
        platform: req.body.platform ?? appBuild.platform,
        packageName: req.body.packageName ?? appBuild.packageName,
        channel: req.body.channel ?? appBuild.channel,
        versionName: req.body.versionName ?? appBuild.versionName,
        versionCode: req.body.versionCode ?? appBuild.versionCode,
        minimumSupportedVersionCode: req.body.minimumSupportedVersionCode ?? appBuild.minimumSupportedVersionCode,
        releaseNotes: req.body.releaseNotes ?? appBuild.releaseNotes,
        buildType: req.body.buildType ?? appBuild.buildType,
        checksumRequired: req.body.checksumRequired ?? appBuild.checksumRequired
      },
      { partial: false }
    );
    if (validation.error) {
      return sendError(res, 400, validation.error);
    }

    Object.assign(appBuild, validation.value, { updatedBy: req.auth.id });

    if (req.file) {
      Object.assign(
        appBuild,
        await uploadBuildApk({
          file: req.file,
          buildData: validation.value,
          actorId: req.auth.id
        })
      );
    }

    await appBuild.save();
    return sendSuccess(res, 200, "App build updated successfully", appBuild);
  } catch (error) {
    return handleAppBuildWriteError(res, error);
  }
};

/**
 * Publish one build for a package/channel and archive any previously published
 * sibling build so production and QA channels stay independently deterministic.
 */
export const publishAppBuild = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.buildId)) {
      return sendError(res, 400, "Invalid app build ID");
    }

    const appBuild = await AppBuild.findById(req.params.buildId);
    if (!appBuild) {
      return sendError(res, 404, "App build not found");
    }

    const identity = validateAppBuildIdentity(appBuild);
    if (identity.error) {
      return sendError(res, 400, identity.error);
    }

    if (!appBuild.apkUrl?.startsWith("https://")) {
      return sendError(res, 400, "Published build requires an HTTPS apkUrl");
    }

    if (appBuild.versionCode < appBuild.minimumSupportedVersionCode) {
      return sendError(res, 400, "versionCode must be greater than or equal to minimumSupportedVersionCode");
    }

    const publishedBuild = await publishBuild({ build: appBuild, actorId: req.auth.id });
    return sendSuccess(res, 200, "App build published successfully", publishedBuild);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const archiveAppBuild = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.buildId)) {
      return sendError(res, 400, "Invalid app build ID");
    }

    const appBuild = await AppBuild.findById(req.params.buildId);
    if (!appBuild) {
      return sendError(res, 404, "App build not found");
    }

    appBuild.status = APP_BUILD_STATUSES.ARCHIVED;
    appBuild.updatedBy = req.auth.id;
    await appBuild.save();

    return sendSuccess(res, 200, "App build archived successfully", appBuild);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};


/**
 * Create/Update provisioning Details
 * Sample query: /admin/provisioning-details
 */

export const upsertProvisioningDetails=async(req,res)=>{
  try{
    const {componentName,packageUrl,checksum}=req.body;

    if(!componentName || !packageUrl || !checksum){
      return sendError(res,400,"componentName, packageUrl and checksum are required");
    }
    const skipEncryption=req.body?.skipEncryption || false;

    const provisioningDetail=await ProvisioningDetails.findOneAndUpdate(
     {},
     {adminComponentName:componentName,
      adminPackageDownloadUrl:packageUrl,
      adminSignatureChecksum:checksum,
      skipEncryption
     },
      { upsert: true, new: true }
    );
    return sendSuccess(res,200,"Provisioning details upserted successfully",provisioningDetail);


  }
  catch(error){
    return sendError(res, 500, error.message || "Internal server error");
  }
}

/**
 * Get provisioning Details
 * Sample query: /admin/provisioning-details
 */

export const getProvisioningDetails=async(req,res)=>{
  try{
    const provisioningDetail=await ProvisioningDetails.findOne({}).lean();
    if(!provisioningDetail){
      return sendError(res,404,"Provisioning details not found");
    }
    return sendSuccess(res,200,"Provisioning details fetched successfully",provisioningDetail);
  }
  catch(error){
    return sendError(res, 500, error.message || "Internal server error");
  }
}
