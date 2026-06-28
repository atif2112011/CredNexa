import bcrypt from "bcryptjs";
import crypto from "crypto";
import mongoose from "mongoose";

import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import { DEFAULT_DEVICE_POLICIES, DEFAULT_TENANT_POLICY } from "../../constants/defaultPolicies.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../../constants/deviceStates.js";
import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { TENANT_CAPABILITIES, TENANT_TYPES } from "../../constants/tenant.js";
import { Account } from "../../models/Account.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ChannelPartner } from "../../models/ChannelPartner.js";
import { Device } from "../../models/Device.js";
import { DeviceCommand } from "../../models/DeviceCommand.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { OtpRecord } from "../../models/OtpRecord.js";
import {
  PARTNER_CREDIT_BALANCE_TYPES,
  PARTNER_CREDIT_LEDGER_TYPES,
  PartnerCreditLedger
} from "../../models/PartnerCreditLedger.js";
import { PARTNER_PAYOUT_STATUSES, PartnerPayoutRequest } from "../../models/PartnerPayoutRequest.js";
import { Tenant } from "../../models/Tenant.js";
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { UnlockRequest } from "../../models/UnlockRequest.js";
import { User } from "../../models/User.js";
import { buildEmptyTenantMetrics, safeRefreshTenantMetrics } from "../../services/tenantMetrics.service.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import {
  getOrCreatePayoutConstants,
  getPartnerCreditPercentage,
  getPartnerPayoutRange,
  isValidUpiId,
  parseRupeeAmount,
  roundRupeeAmount
} from "../../utils/payout.js";
import { hasRequiredFields, isValidObjectId } from "../../utils/validators.js";

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

const isTruthyQueryParam = (value) => ["true", "1", "yes"].includes(String(value || "").trim().toLowerCase());

const createTemporaryPassword = () => `CNX-${crypto.randomBytes(6).toString("base64url")}Aa1!`;

const PARTNER_SIGNUP_OTP = "123456";
const PARTNER_SIGNUP_OTP_EXPIRY_SECONDS = 10 * 60;
const PARTNER_SIGNUP_PURPOSE = "partner_signup";
const TENANT_CREATION_OTP = "123456";
const TENANT_CREATION_OTP_EXPIRY_SECONDS = 10 * 60;
const TENANT_CREATION_PURPOSE = "tenant_creation";
const TENANT_CREATION_VERIFICATION_MODES = ["mobile_otp", "aadhaar_otp"];
const CHANNEL_PARTNER_TYPES = ["nbfc_group", "retail_chain_group", "independent"];

const normalizeMobile = (mobile) => String(mobile || "").trim();
const normalizeEmail = (email) => {
  const value = String(email || "").trim().toLowerCase();
  return value || undefined;
};
const isValidIndianMobile = (mobile) => /^\d{10}$/.test(normalizeMobile(mobile));
const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPassword = (password) => {
  const value = String(password || "");
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
};
const normalizeComparableName = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
const normalizeTenantCreationVerificationMode = (mode) => String(mode || "mobile_otp").trim().toLowerCase();

const ensurePartnerSignupUnique = async ({ mobile, email }) => {
  const [accountByMobile, partnerByMobile, accountByEmail] = await Promise.all([
    Account.findOne({ mobile }).lean(),
    ChannelPartner.findOne({ contactPhone: mobile }).lean(),
    email ? Account.findOne({ email }).lean() : null
  ]);

  if (accountByMobile || partnerByMobile) {
    return "Phone number is already used";
  }

  if (accountByEmail) {
    return "Account with this email already exists";
  }

  return null;
};

const createAuditLog = async (payload, options = {}) => {
  return AuditLog.create([payload], { ordered: true, ...options }).then((items) => items[0]);
};

const ensurePartnerAccess = async (req, res) => {
  if (!req.auth.channelPartnerId) {
    sendError(res, 403, "Partner scope is required");
    return null;
  }

  const channelPartner = await ChannelPartner.findOne({
    _id: req.auth.channelPartnerId,
    isActive: true
  }).lean();

  if (!channelPartner) {
    sendError(res, 403, "Active channel partner not found");
    return null;
  }

  return channelPartner;
};

const validateTenantBelongsToPartner = async (tenantId, channelPartnerId) => {
  if (!isValidObjectId(tenantId)) return null;
  return Tenant.findOne({ _id: tenantId, channelPartnerId });
};

export const initiatePartnerSignupOtp = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body.mobile);

    if (!isValidIndianMobile(mobile)) {
      return sendError(res, 400, "Valid 10 digit mobile number is required");
    }

    const duplicateError = await ensurePartnerSignupUnique({ mobile });
    if (duplicateError) {
      return sendError(res, 400, duplicateError);
    }

    const verificationSessionId = `otp_${crypto.randomBytes(12).toString("hex")}`;
    const otpHash = await bcrypt.hash(PARTNER_SIGNUP_OTP, 12);

    await OtpRecord.create({
      mobile,
      otpHash,
      purpose: PARTNER_SIGNUP_PURPOSE,
      verificationSessionId,
      provider: "mock",
      maxAttempts: 3,
      expiresAt: new Date(Date.now() + PARTNER_SIGNUP_OTP_EXPIRY_SECONDS * 1000),
      providerResponse: { mock: true }
    });

    return sendSuccess(res, 200, "OTP sent successfully", {
      verificationSessionId,
      otpSent: true,
      expiresInSeconds: PARTNER_SIGNUP_OTP_EXPIRY_SECONDS
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const verifyPartnerSignupOtp = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body.mobile);

    if (!hasRequiredFields(req.body, ["mobile", "verificationSessionId", "otp"])) {
      return sendError(res, 400, "Mobile, verificationSessionId, and otp are required");
    }

    if (!isValidIndianMobile(mobile)) {
      return sendError(res, 400, "Valid 10 digit mobile number is required");
    }

    const otpRecord = await OtpRecord.findOne({
      mobile,
      verificationSessionId: req.body.verificationSessionId,
      purpose: PARTNER_SIGNUP_PURPOSE,
      verified: false
    });

    if (!otpRecord) {
      return sendError(res, 400, "Invalid OTP session");
    }

    if (otpRecord.expiresAt < new Date()) {
      return sendError(res, 400, "OTP expired");
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      return sendError(res, 429, "Maximum OTP attempts exceeded");
    }

    const otpMatches = await bcrypt.compare(String(req.body.otp), otpRecord.otpHash);
    if (!otpMatches) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      return sendError(res, 400, "Invalid OTP");
    }

    otpRecord.verified = true;
    otpRecord.providerResponse = {
      ...otpRecord.providerResponse,
      verifiedAt: new Date()
    };
    await otpRecord.save();

    return sendSuccess(res, 200, "OTP verified successfully", {
      verified: true,
      verificationSessionId: otpRecord.verificationSessionId
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const completePartnerSignup = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const createAccount = isTruthyQueryParam(req.query.createAccount);
    const name = String(req.body.name || "").trim();
    const mobile = normalizeMobile(req.body.mobile);

    const email = normalizeEmail(req.body.email);
    const type = String(req.body.type || "").trim();
    const addressInput = req.body.address && typeof req.body.address === "object" && !Array.isArray(req.body.address)
      ? req.body.address
      : {};
    const address = {
      street: String(addressInput.street || req.body.address || "").trim(),
      city: String(addressInput.city || req.body.city || "").trim(),
      state: String(addressInput.state || req.body.state || "").trim(),
      pincode: String(addressInput.pincode || req.body.pincode || "").trim()
    };

    if (!hasRequiredFields({ name, mobile, type, verificationSessionId: req.body.verificationSessionId }, [
      "name",
      "mobile",
      "type",
      "verificationSessionId"
    ])) {
      return sendError(res, 400, "Name, mobile, type, and verificationSessionId are required");
    }

    if (!isValidIndianMobile(mobile)) {
      return sendError(res, 400, "Valid 10 digit mobile number is required");
    }

    if (!CHANNEL_PARTNER_TYPES.includes(type)) {
      return sendError(res, 400, "Invalid partner type");
    }

    if (!isValidEmail(email)) {
      return sendError(res, 400, "Invalid email");
    }

    if (createAccount && !isValidPassword(req.body.password)) {
      return sendError(res, 400, "Password must be at least 8 characters and include at least one letter and one number");
    }

    if (createAccount && !req.body.confirmPassword) {
      return sendError(res, 400, "Confirm password is required");
    }

    if (createAccount && req.body.password !== req.body.confirmPassword) {
      return sendError(res, 400, "Password and confirm password must match");
    }

    const otpRecord = await OtpRecord.findOne({
      mobile,
      verificationSessionId: req.body.verificationSessionId,
      purpose: PARTNER_SIGNUP_PURPOSE,
      verified: true
    });

    if (!otpRecord) {
      return sendError(res, 400, "OTP verification is required before signup");
    }

    if (otpRecord.expiresAt < new Date()) {
      return sendError(res, 400, "OTP expired");
    }

    const duplicateError = await ensurePartnerSignupUnique({ mobile, email });
    if (duplicateError) {
      return sendError(res, 400, duplicateError);
    }

    session.startTransaction();

    const partners = await ChannelPartner.create(
      [
        {
          name,
          type,
          contactPhone: mobile,
          ...email && { contactEmail: email },
          // contactEmail: email,
          address,
          isActive: true
        }
      ],
      { session, ordered: true }
    );
    const channelPartner = partners[0];
    let account = null;

    if (createAccount) {
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const accounts = await Account.create(
        [
          {
            name,
            // email,
            ...email && { email },
            mobile,
            role: ACCOUNT_ROLES.PARTNER_ADMIN,
            channelPartnerId: channelPartner._id,
            passwordHash,
            isActive: true
          }
        ],
        { session, ordered: true }
      );
      account = accounts[0];
      channelPartner.adminAccountId = account._id;
      await channelPartner.save({ session });

      await createAuditLog(
        {
          eventType: AUDIT_EVENTS.ACCOUNT_CREATED,
          actorCollection: "system",
          channelPartnerId: channelPartner._id,
          metadata: { accountId: account._id, role: account.role, source: "partner_self_signup" }
        },
        { session }
      );
    }

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.CHANNEL_PARTNER_CREATED,
        actorCollection: "system",
        channelPartnerId: channelPartner._id,
        metadata: { name: channelPartner.name, type: channelPartner.type, source: "partner_self_signup" }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 201, "Partner signup completed successfully", {
      channelPartner: {
        id: channelPartner._id,
        name: channelPartner.name,
        type: channelPartner.type,
        contactPhone: channelPartner.contactPhone,
        contactEmail: channelPartner.contactEmail,
        address: channelPartner.address,
        adminAccountId: channelPartner.adminAccountId,
        isActive: channelPartner.isActive
      },
      account: account
        ? {
            id: account._id,
            name: account.name,
            mobile: account.mobile,
            email: account.email,
            role: account.role,
            channelPartnerId: account.channelPartnerId
          }
        : null
    });
  } catch (error) {
    console.log('[ERROR] completePartnerSignup', error);
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (error?.code === 11000) {
      return sendError(res, 400, "Phone number or email is already used");
    }

    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

const applyPartnerEscalationCommand = async ({
  unlockRequest,
  accountId,
  commandType,
  targetState,
  policyKey,
  note,
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

  const commands = await DeviceCommand.create(
    [
      {
        deviceId: unlockRequest.deviceId,
        tenantId: unlockRequest.tenantId,
        commandType,
        triggeredBy: "partner_admin",
        triggeredByAccountId: accountId,
        payload: {
          note,
          policyKey,
          desiredPolicyVersion: device?.desiredPolicyVersion,
          durationHours
        }
      }
    ],
    { session, ordered: true }
  );

  return { device, command: commands[0] };
};

/**
 * Partner dashboard.
 * Sample query: /partner/dashboard
 */
export const getPartnerDashboard = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const tenantFilter = { channelPartnerId: channelPartner._id };
    const openCaseStatuses = ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"];
    const scopedTenantIds = await Tenant.find(tenantFilter).distinct("_id");

    const [
      totalTenants,
      activeTenants,
      tenantAdminAccounts,
      totalBorrowers,
      totalDevices,
      devicesByState,
      partnerEscalations,
      openCases,
      recentEscalations
    ] = await Promise.all([
      Tenant.countDocuments(tenantFilter),
      Tenant.countDocuments({ ...tenantFilter, isActive: true }),
      Account.countDocuments({ tenantId: { $in: scopedTenantIds }, role: ACCOUNT_ROLES.TENANT_ADMIN }),
      User.countDocuments({ tenantId: { $in: scopedTenantIds } }),
      Device.countDocuments({ tenantId: { $in: scopedTenantIds } }),
      Device.aggregate([
        { $match: { tenantId: { $in: scopedTenantIds } } },
        { $group: { _id: "$state", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      UnlockRequest.countDocuments({ channelPartnerId: channelPartner._id, status: "ESCALATED_PARTNER" }),
      UnlockRequest.countDocuments({ channelPartnerId: channelPartner._id, status: { $in: openCaseStatuses } }),
      UnlockRequest.find({ channelPartnerId: channelPartner._id, status: { $in: openCaseStatuses } })
        .sort({ updatedAt: -1 })
        .limit(8)
        .populate("tenantId", "name type")
        .populate("userId", "name mobile loanId")
        .populate("deviceId", "imei deviceModel manufacturer state")
        .lean()
    ]);

    return sendSuccess(res, 200, "Partner dashboard fetched successfully", {
      channelPartner: {
        id: channelPartner._id,
        name: channelPartner.name,
        type: channelPartner.type
      },
      tenants: {
        total: totalTenants,
        active: activeTenants,
        inactive: totalTenants - activeTenants
      },
      accounts: {
        tenantAdmins: tenantAdminAccounts
      },
      borrowers: {
        total: totalBorrowers
      },
      devices: {
        total: totalDevices,
        byState: devicesByState.reduce((result, item) => {
          result[item._id] = item.count;
          return result;
        }, {})
      },
      cases: {
        open: openCases,
        escalatedToPartner: partnerEscalations
      },
      tenantIds: scopedTenantIds,
      recentEscalations
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch partner payout summary and request range.
 * Sample query: /partner/payout/summary
 */
export const getPartnerPayoutSummary = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const payoutConstants = await getOrCreatePayoutConstants();
    const payoutRange = getPartnerPayoutRange({
      availableBalance: channelPartner.availablePayoutBalance,
      payoutConstants
    });

    return sendSuccess(res, 200, "Partner payout summary fetched successfully", {
      channelPartner: {
        id: channelPartner._id,
        name: channelPartner.name,
        type: channelPartner.type
      },
      creditPercentage: getPartnerCreditPercentage(channelPartner, payoutConstants),
      balances: {
        available: roundRupeeAmount(channelPartner.availablePayoutBalance || 0),
        onHold: roundRupeeAmount(channelPartner.payoutHoldBalance || 0),
        lifetimeEarned: roundRupeeAmount(channelPartner.lifetimePayoutEarned || 0),
        lifetimePaid: roundRupeeAmount(channelPartner.lifetimePayoutPaid || 0)
      },
      payoutRange: {
        currency: "INR",
        min: payoutRange.min,
        max: payoutRange.max,
        available: payoutRange.available,
        hasMaximumCap: payoutRange.hasMaximumCap
      },
      upi: {
        upiId: channelPartner.payoutUpiId || null,
        upiName: channelPartner.payoutUpiName || null,
        isComplete: Boolean(channelPartner.payoutUpiId && channelPartner.payoutUpiName)
      }
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Request partner payout.
 * Sample body: { "amount": 1000, "upiId": "partner@upi", "upiName": "Partner Name" }
 */
export const requestPartnerPayout = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const amount = parseRupeeAmount(req.body.amount);
    if (amount === null || amount <= 0) {
      return sendError(res, 400, "Valid payout amount is required");
    }

    const payoutConstants = await getOrCreatePayoutConstants();
    const payoutRange = getPartnerPayoutRange({
      availableBalance: channelPartner.availablePayoutBalance,
      payoutConstants
    });

    if (payoutRange.min > 0 && amount < payoutRange.min) {
      return sendError(res, 400, `Minimum payout amount is ${payoutRange.min}`);
    }

    if (amount > payoutRange.max) {
      return sendError(res, 400, "Payout amount exceeds available payout range");
    }

    const upiId = String(req.body.upiId || channelPartner.payoutUpiId || "").trim();
    const upiName = String(req.body.upiName || channelPartner.payoutUpiName || "").trim();

    if (!upiId || !upiName) {
      return sendError(res, 400, "UPI ID and UPI name are required");
    }

    if (!isValidUpiId(upiId)) {
      return sendError(res, 400, "Valid UPI ID is required");
    }

    session.startTransaction();

    const partnerBeforeHold = await ChannelPartner.findOneAndUpdate(
      {
        _id: channelPartner._id,
        isActive: true,
        availablePayoutBalance: { $gte: amount }
      },
      {
        $inc: {
          availablePayoutBalance: -amount,
          payoutHoldBalance: amount
        },
        $set: {
          payoutUpiId: upiId,
          payoutUpiName: upiName
        }
      },
      { new: false, session }
    );

    if (!partnerBeforeHold) {
      await session.abortTransaction();
      return sendError(res, 400, "Insufficient available payout balance");
    }

    const balanceBefore = roundRupeeAmount(partnerBeforeHold.availablePayoutBalance || 0);
    const balanceAfter = roundRupeeAmount(balanceBefore - amount);
    const holdBefore = roundRupeeAmount(partnerBeforeHold.payoutHoldBalance || 0);
    const holdAfter = roundRupeeAmount(holdBefore + amount);

    const payoutRequests = await PartnerPayoutRequest.create(
      [
        {
          channelPartnerId: partnerBeforeHold._id,
          amount,
          status: PARTNER_PAYOUT_STATUSES.PENDING,
          upiId,
          upiName,
          requestedBy: req.auth.id,
          metadata: {
            availableBalanceBefore: balanceBefore,
            availableBalanceAfter: balanceAfter,
            holdBalanceBefore: holdBefore,
            holdBalanceAfter: holdAfter
          }
        }
      ],
      { session, ordered: true }
    );
    const payoutRequest = payoutRequests[0];

    const ledgerEntries = await PartnerCreditLedger.create(
      [
        {
          channelPartnerId: partnerBeforeHold._id,
          payoutRequestId: payoutRequest._id,
          type: PARTNER_CREDIT_LEDGER_TYPES.PAYOUT_REQUEST_HOLD,
          balanceType: PARTNER_CREDIT_BALANCE_TYPES.AVAILABLE,
          delta: -amount,
          balanceBefore,
          balanceAfter,
          actorId: req.auth.id,
          actorCollection: "accounts",
          reason: "Partner payout requested",
          metadata: {
            holdBalanceBefore: holdBefore,
            holdBalanceAfter: holdAfter,
            upiId,
            upiName
          }
        }
      ],
      { session, ordered: true }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.PARTNER_PAYOUT_REQUESTED,
        actorId: req.auth.id,
        channelPartnerId: partnerBeforeHold._id,
        metadata: {
          payoutRequestId: payoutRequest._id,
          amount,
          ledgerEntryId: ledgerEntries[0]._id
        }
      },
      { session }
    );

    await session.commitTransaction();

    return sendSuccess(res, 201, "Partner payout requested successfully", {
      payoutRequest,
      ledgerEntryId: ledgerEntries[0]._id,
      balances: {
        available: balanceAfter,
        onHold: holdAfter
      }
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, 500, error.message || "Internal server error");
  } finally {
    session.endSession();
  }
};

/**
 * List payout requests for the authenticated partner.
 * Sample query: /partner/payout/requests?status=PENDING&page=1&limit=20
 */
export const listPartnerPayoutRequests = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const { page, limit, skip } = getPagination(req.query);
    const filter = { channelPartnerId: channelPartner._id };

    if (req.query.status) {
      if (!Object.values(PARTNER_PAYOUT_STATUSES).includes(req.query.status)) {
        return sendError(res, 400, "Invalid payout status");
      }
      filter.status = req.query.status;
    }

    const [items, total] = await Promise.all([
      PartnerPayoutRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-__v")
        .lean(),
      PartnerPayoutRequest.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Partner payout requests fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List tenants owned by the partner.
 * Sample query: /partner/tenants?status=active&capability=lend&search=pune&page=1&limit=20
 */
export const getPartnerTenants = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const { page, limit, skip } = getPagination(req.query);
    const filter = { channelPartnerId: channelPartner._id };

    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "inactive") filter.isActive = false;
    if (req.query.capability) filter.capabilities = req.query.capability;
    if (req.query.search) filter.name = buildRegex(req.query.search);

    const [items, total] = await Promise.all([
      Tenant.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Tenant.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Partner tenants fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Fetch one tenant owned by the partner.
 * Sample request: /partner/tenants/665f...
 */
export const getPartnerTenantById = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const tenant = await validateTenantBelongsToPartner(req.params.tenantId, channelPartner._id);
    if (!tenant) {
      return sendError(res, 404, "Tenant not found");
    }

    return sendSuccess(res, 200, "Partner tenant fetched successfully", tenant);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const initiateTenantCreationVerification = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const supportPhone = normalizeMobile(req.body.supportPhone);
    const tenantName = String(req.body.name || "").trim();
    const tenantCreationVerificationMode = normalizeTenantCreationVerificationMode(req.body.tenantCreationVerificationMode);

    if (!tenantName) {
      return sendError(res, 400, "Tenant name is required");
    }

    if (!supportPhone) {
      return sendError(res, 400, "Support phone is required");
    }

    if (!isValidIndianMobile(supportPhone)) {
      return sendError(res, 400, "Valid 10 digit support phone is required");
    }

    if (!TENANT_CREATION_VERIFICATION_MODES.includes(tenantCreationVerificationMode)) {
      return sendError(res, 400, "Invalid tenant creation verification mode");
    }

    const verificationSessionId = `otp_${crypto.randomBytes(12).toString("hex")}`;
    const otpHash = await bcrypt.hash(TENANT_CREATION_OTP, 12);
    const providerReferenceId = `tenant_creation_mock_${crypto.randomBytes(8).toString("hex")}`;

    await OtpRecord.create({
      mobile: supportPhone,
      otpHash,
      purpose: TENANT_CREATION_PURPOSE,
      verificationSessionId,
      provider: "mock",
      providerReferenceId,
      maxAttempts: 3,
      expiresAt: new Date(Date.now() + TENANT_CREATION_OTP_EXPIRY_SECONDS * 1000),
      providerResponse: {
        mock: true,
        status: "OTP_SENT",
        channelPartnerId: channelPartner._id,
        tenantName,
        normalizedTenantName: normalizeComparableName(tenantName),
        // Future Aadhaar OTP provider must match Aadhaar document name and mobile against these submitted values.
        aadhaarMatchInput: {
          name: tenantName,
          mobile: supportPhone
        },
        tenantCreationVerificationMode
      }
    });

    return sendSuccess(res, 200, "Tenant creation OTP sent successfully", {
      verificationSessionId,
      otpSent: true,
      tenantCreationVerificationMode,
      expiresInSeconds: TENANT_CREATION_OTP_EXPIRY_SECONDS
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const verifyTenantCreationVerification = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!hasRequiredFields(req.body, ["supportPhone", "tenantCreationVerificationMode", "verificationSessionId", "otp"])) {
      return sendError(res, 400, "Support phone, verification mode, verification session, and OTP are required");
    }

    const supportPhone = normalizeMobile(req.body.supportPhone);
    const tenantCreationVerificationMode = normalizeTenantCreationVerificationMode(req.body.tenantCreationVerificationMode);

    if (!isValidIndianMobile(supportPhone)) {
      return sendError(res, 400, "Valid 10 digit support phone is required");
    }

    if (!TENANT_CREATION_VERIFICATION_MODES.includes(tenantCreationVerificationMode)) {
      return sendError(res, 400, "Invalid tenant creation verification mode");
    }

    const otpRecord = await OtpRecord.findOne({
      mobile: supportPhone,
      verificationSessionId: req.body.verificationSessionId,
      purpose: TENANT_CREATION_PURPOSE,
      consumedAt: null
    });

    if (!otpRecord) {
      return sendError(res, 400, "Invalid OTP session");
    }

    if (String(otpRecord.providerResponse?.channelPartnerId) !== String(channelPartner._id)) {
      return sendError(res, 400, "Invalid OTP session");
    }

    if (otpRecord.providerResponse?.tenantCreationVerificationMode !== tenantCreationVerificationMode) {
      return sendError(res, 400, "Tenant creation verification mode mismatch");
    }

    if (otpRecord.expiresAt < new Date()) {
      return sendError(res, 400, "OTP expired");
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      return sendError(res, 429, "Maximum OTP attempts exceeded");
    }

    const otpMatches = await bcrypt.compare(String(req.body.otp), otpRecord.otpHash);
    if (!otpMatches) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      return sendError(res, 400, "Invalid OTP");
    }

    otpRecord.attempts += 1;
    otpRecord.verified = true;
    otpRecord.providerResponse = {
      ...(otpRecord.providerResponse || {}),
      status: "VERIFIED",
      verifiedAt: new Date()
    };
    await otpRecord.save();

    return sendSuccess(res, 200, "Tenant creation OTP verified successfully", {
      verified: true,
      verificationSessionId: otpRecord.verificationSessionId,
      tenantCreationVerificationMode,
      nextStep: "CREATE_TENANT"
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create a tenant under the authenticated partner.
 * Sample body: { "name": "Bharat Finance - Jaipur", "type": "nbfc", "capabilities": ["lend","distribute"], "supportPhone": "9800000002", "supportEmail": "support@tenant.in" }
 */
export const createPartnerTenant = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const shouldCreateTenantAdmin = isTruthyQueryParam(req.query.app);
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!hasRequiredFields(req.body, ["name", "capabilities", "supportPhone"])) {
      return sendError(res, 400, "Name, capabilities, and supportPhone are required");
    }

    const supportPhone = normalizeMobile(req.body.supportPhone);

    if (!isValidIndianMobile(supportPhone)) {
      return sendError(res, 400, "Valid 10 digit support phone is required");
    }

    if (req.body.channelPartnerId || req.body.tenantPolicy || req.body.devicePolicies) {
      return sendError(res, 400, "channelPartnerId and policy payloads are managed by the backend");
    }

    if (!Array.isArray(req.body.capabilities) || req.body.capabilities.length === 0) {
      return sendError(res, 400, "At least one tenant capability is required");
    }

    const invalidCapability = req.body.capabilities.find(
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

    if (req.body.parentTenantId) {
      const parentTenant = await validateTenantBelongsToPartner(req.body.parentTenantId, channelPartner._id);
      if (!parentTenant) {
        return sendError(res, 400, "Parent tenant not found under this partner");
      }
    }

    let tenantAdminInput = null;
    let tenantAdminPassword = null;
    let tenantCreationOtpRecord = null;

    if (shouldCreateTenantAdmin) {
      const tenantCreationVerificationMode = normalizeTenantCreationVerificationMode(req.body.tenantCreationVerificationMode);
      const verificationSessionId = String(req.body.tenantCreationVerificationSessionId || "").trim();

      if (!TENANT_CREATION_VERIFICATION_MODES.includes(tenantCreationVerificationMode)) {
        return sendError(res, 400, "Invalid tenant creation verification mode");
      }

      if (!verificationSessionId) {
        return sendError(res, 400, "Tenant creation verification session is required when app=true");
      }

      tenantCreationOtpRecord = await OtpRecord.findOne({
        mobile: supportPhone,
        verificationSessionId,
        purpose: TENANT_CREATION_PURPOSE,
        verified: true,
        consumedAt: null,
        expiresAt: { $gt: new Date() }
      });

      if (!tenantCreationOtpRecord) {
        return sendError(res, 400, "Verified tenant creation OTP session not found");
      }

      if (String(tenantCreationOtpRecord.providerResponse?.channelPartnerId) !== String(channelPartner._id)) {
        return sendError(res, 400, "Verified tenant creation OTP session not found");
      }

      if (tenantCreationOtpRecord.providerResponse?.tenantCreationVerificationMode !== tenantCreationVerificationMode) {
        return sendError(res, 400, "Tenant creation verification mode mismatch");
      }

      if (
        tenantCreationOtpRecord.providerResponse?.normalizedTenantName &&
        tenantCreationOtpRecord.providerResponse.normalizedTenantName !== normalizeComparableName(req.body.name)
      ) {
        return sendError(res, 400, "Tenant name does not match verified OTP session");
      }

      tenantAdminInput = req.body.tenantAdmin || {};
      const tenantAdminEmail = String(tenantAdminInput.email || req.body.adminEmail || "")
        .trim()
        .toLowerCase();
      const tenantAdminMobile = normalizeMobile(tenantAdminInput.mobile || req.body.adminMobile || req.body.supportPhone);
      const requestedTemporaryPassword = tenantAdminInput.password || req.body.password || tenantAdminInput.temporaryPassword || req.body.temporaryPassword;
      const confirmTenantAdminPassword = tenantAdminInput.confirmPassword || req.body.confirmPassword;

      if (requestedTemporaryPassword && requestedTemporaryPassword !== confirmTenantAdminPassword) {
        return sendError(res, 400, "Password and confirm password must match");
      }

      if (!tenantAdminMobile) {
        return sendError(res, 400, "Tenant admin mobile is required when app=true");
      }

      if (!isValidIndianMobile(tenantAdminMobile)) {
        return sendError(res, 400, "Valid 10 digit tenant admin mobile is required");
      }

      const duplicateAccountFilters = [{ mobile: tenantAdminMobile }];
      if (tenantAdminEmail) {
        duplicateAccountFilters.push({ email: tenantAdminEmail });
      }

      const existingAccount = await Account.findOne({ $or: duplicateAccountFilters }).lean();
      if (existingAccount?.mobile === tenantAdminMobile) {
        return sendError(res, 400, "Account with this mobile already exists");
      }

      if (tenantAdminEmail && existingAccount?.email === tenantAdminEmail) {
        return sendError(res, 400, "Account with this email already exists");
      }

      tenantAdminInput = {
        name: tenantAdminInput.name || req.body.adminName || `${req.body.name} Admin`,
        email: tenantAdminEmail || undefined,
        mobile: tenantAdminMobile
      };
      tenantAdminPassword = requestedTemporaryPassword || createTemporaryPassword();
    }

    session.startTransaction();

    const tenants = await Tenant.create(
      [
        {
          name: req.body.name,
          type: TENANT_TYPES.STANDALONE_OUTLET,
          capabilities: ["lend","distribute"],
          channelPartnerId: channelPartner._id,
          parentTenantId: req.body.parentTenantId || null,
          supportPhone,
          supportEmail: req.body.supportEmail,
          address: req.body.address,
          ...(creditPurchasePerKeyPrice !== undefined ? { creditPurchasePerKeyPrice } : {}),
          metrics: buildEmptyTenantMetrics(),
          isAdhaarVerificationEnabled: req.body.isAdhaarVerificationEnabled === true,
          createdBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );
    const tenant = tenants[0];
    let createdTenantAdmin = null;

    const tenantPolicies = await TenantPolicy.create(
      [
        {
          tenantId: tenant._id,
          ...DEFAULT_TENANT_POLICY,
          updatedBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );

    const devicePolicies = await DevicePolicy.create(
      DEFAULT_DEVICE_POLICIES.map((policy) => ({
        tenantId: tenant._id,
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
            tenantId: tenant._id,
            channelPartnerId: channelPartner._id,
            passwordHash,
            createdBy: req.auth.id
          }
        ],
        { session, ordered: true }
      );

      createdTenantAdmin = tenantAdminAccounts[0];
      tenant.adminAccountId = createdTenantAdmin._id;
      await tenant.save({ session });

      await createAuditLog(
        {
          eventType: AUDIT_EVENTS.ACCOUNT_CREATED,
          actorId: req.auth.id,
          tenantId: tenant._id,
          channelPartnerId: channelPartner._id,
          metadata: {
            accountId: createdTenantAdmin._id,
            role: createdTenantAdmin.role,
            email: createdTenantAdmin.email,
            source: "partner_tenant_create_app"
          }
        },
        { session }
      );
    }

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TENANT_CREATED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: channelPartner._id,
        metadata: { name: tenant.name, type: tenant.type, capabilities: tenant.capabilities }
      },
      { session }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TENANT_POLICY_CREATED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: channelPartner._id
      },
      { session }
    );

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.DEVICE_POLICIES_CREATED,
        actorId: req.auth.id,
        tenantId: tenant._id,
        channelPartnerId: channelPartner._id,
        metadata: { policyKeys: devicePolicies.map((policy) => policy.policyKey) }
      },
      { session }
    );

    if (shouldCreateTenantAdmin) {
      const consumedOtpRecord = await OtpRecord.findOneAndUpdate(
        {
          _id: tenantCreationOtpRecord._id,
          verified: true,
          consumedAt: null,
          expiresAt: { $gt: new Date() }
        },
        { $set: { consumedAt: new Date() } },
        { new: true, session }
      );

      if (!consumedOtpRecord) {
        await session.abortTransaction();
        return sendError(res, 400, "Verified tenant creation OTP session already used or expired");
      }
    }

    await session.commitTransaction();

    return sendSuccess(res, 201, "Partner tenant created successfully", {
      tenant,
      tenantPolicy: tenantPolicies[0],
      devicePolicies,
      ...(createdTenantAdmin
        ? {
            tenantAdmin: {
              accountId: createdTenantAdmin._id,
              name: createdTenantAdmin.name,
              email: createdTenantAdmin.email || null,
              mobile: createdTenantAdmin.mobile,
              role: createdTenantAdmin.role,
              tenantId: createdTenantAdmin.tenantId,
              channelPartnerId: createdTenantAdmin.channelPartnerId
            },
            credentials: {
              identifier: createdTenantAdmin.mobile,
              mobile: createdTenantAdmin.mobile,
              email: createdTenantAdmin.email || null,
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
 * List tenant_admin accounts under partner tenants.
 * Sample query: /partner/accounts?tenantId=665f...&status=active&page=1&limit=20
 */
export const listPartnerAccounts = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const { page, limit, skip } = getPagination(req.query);
    const tenantIds = await Tenant.find({ channelPartnerId: channelPartner._id }).distinct("_id");
    const filter = { role: ACCOUNT_ROLES.TENANT_ADMIN, tenantId: { $in: tenantIds } };

    if (req.query.tenantId) {
      const tenant = await validateTenantBelongsToPartner(req.query.tenantId, channelPartner._id);
      if (!tenant) return sendError(res, 400, "Tenant not found under this partner");
      filter.tenantId = tenant._id;
    }

    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "inactive") filter.isActive = false;
    if (req.query.search) {
      filter.$or = [{ name: buildRegex(req.query.search) }, { email: buildRegex(req.query.search) }];
    }

    const [items, total] = await Promise.all([
      Account.find(filter)
        .select("-passwordHash")
        .populate("tenantId", "name type")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Account.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Partner tenant admin accounts fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Create tenant_admin account for one partner-owned tenant.
 * Sample body: { "name": "Priya Sharma", "email": "priya@tenant.in", "mobile": "9800000003", "tenantId": "...", "temporaryPassword": "Welcome@123" }
 */
export const createTenantAdminAccount = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!hasRequiredFields(req.body, ["name", "email", "tenantId", "temporaryPassword"])) {
      return sendError(res, 400, "Name, email, tenantId, and temporaryPassword are required");
    }

    const tenant = await validateTenantBelongsToPartner(req.body.tenantId, channelPartner._id);
    if (!tenant || !tenant.isActive) {
      return sendError(res, 400, "Active tenant not found under this partner");
    }

    const existingAccount = await Account.findOne({ email: req.body.email.toLowerCase() });
    if (existingAccount) {
      return sendError(res, 400, "Account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(req.body.temporaryPassword, 12);
    const account = await Account.create({
      name: req.body.name,
      email: req.body.email,
      mobile: req.body.mobile,
      role: ACCOUNT_ROLES.TENANT_ADMIN,
      tenantId: tenant._id,
      passwordHash,
      createdBy: req.auth.id
    });

    if (!tenant.adminAccountId) {
      tenant.adminAccountId = account._id;
      await tenant.save();
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.ACCOUNT_CREATED,
      actorId: req.auth.id,
      tenantId: tenant._id,
      channelPartnerId: channelPartner._id,
      metadata: { accountId: account._id, role: account.role, email: account.email }
    });

    const safeAccount = account.toObject();
    delete safeAccount.passwordHash;

    return sendSuccess(res, 201, "Tenant admin account created successfully", safeAccount);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Update tenant_admin account profile/scope under partner.
 * Sample body: { "name": "Priya S. Sharma", "mobile": "9800000099", "tenantId": "..." }
 */
export const updatePartnerAccount = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!isValidObjectId(req.params.accountId)) {
      return sendError(res, 400, "Invalid account ID");
    }

    const tenantIds = await Tenant.find({ channelPartnerId: channelPartner._id }).distinct("_id");
    const account = await Account.findOne({
      _id: req.params.accountId,
      role: ACCOUNT_ROLES.TENANT_ADMIN,
      tenantId: { $in: tenantIds }
    });

    if (!account) {
      return sendError(res, 404, "Tenant admin account not found under this partner");
    }

    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => ["name", "mobile", "tenantId"].includes(key))
    );

    if (updates.tenantId) {
      const tenant = await validateTenantBelongsToPartner(updates.tenantId, channelPartner._id);
      if (!tenant) return sendError(res, 400, "Tenant not found under this partner");
    }

    Object.assign(account, updates);
    await account.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.ACCOUNT_UPDATED,
      actorId: req.auth.id,
      tenantId: account.tenantId,
      channelPartnerId: channelPartner._id,
      metadata: { accountId: account._id, updates }
    });

    const safeAccount = account.toObject();
    delete safeAccount.passwordHash;

    return sendSuccess(res, 200, "Tenant admin account updated successfully", safeAccount);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Activate or deactivate tenant_admin account under partner.
 * Sample body: { "isActive": false, "reason": "Admin left organisation" }
 */
export const updatePartnerAccountStatus = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!isValidObjectId(req.params.accountId)) {
      return sendError(res, 400, "Invalid account ID");
    }

    if (typeof req.body.isActive !== "boolean") {
      return sendError(res, 400, "isActive boolean is required");
    }

    if (!req.body.isActive && !req.body.reason) {
      return sendError(res, 400, "Reason is required when deactivating an account");
    }

    const tenantIds = await Tenant.find({ channelPartnerId: channelPartner._id }).distinct("_id");
    const account = await Account.findOneAndUpdate(
      {
        _id: req.params.accountId,
        role: ACCOUNT_ROLES.TENANT_ADMIN,
        tenantId: { $in: tenantIds }
      },
      { isActive: req.body.isActive },
      { new: true }
    ).select("-passwordHash");

    if (!account) {
      return sendError(res, 404, "Tenant admin account not found under this partner");
    }

    await createAuditLog({
      eventType: AUDIT_EVENTS.ACCOUNT_STATUS_CHANGED,
      actorId: req.auth.id,
      tenantId: account.tenantId,
      channelPartnerId: channelPartner._id,
      reason: req.body.reason,
      metadata: { accountId: account._id, isActive: account.isActive }
    });

    return sendSuccess(res, 200, "Tenant admin account status updated successfully", account);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * List partner escalations.
 * Sample query: /partner/escalations?status=ESCALATED_PARTNER&tenantId=665f...&page=1&limit=20
 */
export const listPartnerEscalations = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const { page, limit, skip } = getPagination(req.query);
    const filter = {
      channelPartnerId: channelPartner._id,
      status: req.query.status || "ESCALATED_PARTNER"
    };

    if (req.query.tenantId) {
      const tenant = await validateTenantBelongsToPartner(req.query.tenantId, channelPartner._id);
      if (!tenant) return sendError(res, 400, "Tenant not found under this partner");
      filter.tenantId = tenant._id;
    }

    const [items, total] = await Promise.all([
      UnlockRequest.find(filter)
        .populate("tenantId", "name type")
        .populate("userId", "name mobile loanId")
        .populate("deviceId", "imei deviceModel manufacturer state")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UnlockRequest.countDocuments(filter)
    ]);

    return sendSuccess(res, 200, "Partner escalations fetched successfully", {
      items,
      pagination: buildPagination(page, limit, total)
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Get partner escalation detail.
 * Sample params: /partner/escalations/CASE-2026-0001
 */
export const getPartnerEscalationByCaseId = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    const unlockRequest = await UnlockRequest.findOne({
      caseId: req.params.caseId,
      channelPartnerId: channelPartner._id
    })
      .populate("tenantId", "name type supportPhone supportEmail")
      .populate("userId", "name mobile loanId loanAmount emiAmount tenureMonths")
      .populate("deviceId", "imei imei2 deviceModel manufacturer androidVersion state currentPolicyKey lastSeenAt")
      .lean();

    if (!unlockRequest) {
      return sendError(res, 404, "Partner escalation not found");
    }

    const [commands, auditLogs] = await Promise.all([
      DeviceCommand.find({ deviceId: unlockRequest.deviceId?._id || unlockRequest.deviceId }).sort({ createdAt: -1 }).lean(),
      AuditLog.find({ caseId: unlockRequest.caseId }).sort({ timestamp: -1 }).lean()
    ]);

    return sendSuccess(res, 200, "Partner escalation fetched successfully", {
      unlockRequest,
      commands,
      auditLogs
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Partner full unlock for an escalated case.
 * Sample body: { "note": "Verified borrower proof. Unlock approved." }
 */
export const unlockPartnerEscalation = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!req.body.note) {
      return sendError(res, 400, "note is required");
    }

    const unlockRequest = await UnlockRequest.findOne({
      caseId: req.params.caseId,
      channelPartnerId: channelPartner._id
    });

    if (!unlockRequest) {
      return sendError(res, 404, "Partner escalation not found");
    }

    if (unlockRequest.status !== "ESCALATED_PARTNER") {
      return sendError(res, 400, "Only partner-escalated cases can be resolved by partner");
    }

    session.startTransaction();

    const { device, command } = await applyPartnerEscalationCommand({
      unlockRequest,
      accountId: req.auth.id,
      commandType: "UNLOCK",
      targetState: DEVICE_STATES.UNLOCK_PENDING,
      policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
      note: req.body.note,
      session
    });

    unlockRequest.status = "RESOLVED_PARTNER";
    unlockRequest.resolutionAction = "unlocked";
    unlockRequest.resolutionNote = req.body.note;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: unlockRequest.tenantId,
        channelPartnerId: channelPartner._id,
        userId: unlockRequest.userId,
        deviceId: unlockRequest.deviceId,
        caseId: unlockRequest.caseId,
        reason: req.body.note,
        metadata: { action: "partner_unlock", commandId: command._id }
      },
      { session }
    );

    await session.commitTransaction();

    await safeRefreshTenantMetrics(unlockRequest.tenantId, { source: "partner_escalation_unlocked", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Partner unlock queued successfully", {
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
 * Partner temporary unlock for an escalated case.
 * Sample body: { "durationHours": 24, "note": "Emergency access approved." }
 */
export const tempUnlockPartnerEscalation = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!req.body.note || !req.body.durationHours) {
      return sendError(res, 400, "note and durationHours are required");
    }

    const durationHours = Number(req.body.durationHours);
    if (durationHours <= 0) {
      return sendError(res, 400, "durationHours must be greater than zero");
    }

    const unlockRequest = await UnlockRequest.findOne({
      caseId: req.params.caseId,
      channelPartnerId: channelPartner._id
    });

    if (!unlockRequest) {
      return sendError(res, 404, "Partner escalation not found");
    }

    if (unlockRequest.status !== "ESCALATED_PARTNER") {
      return sendError(res, 400, "Only partner-escalated cases can be resolved by partner");
    }

    const tenantPolicy = await TenantPolicy.findOne({ tenantId: unlockRequest.tenantId }).lean();
    const maxDurationHours = tenantPolicy?.tempUnlockRules?.maxDurationHours || 72;

    if (durationHours > maxDurationHours) {
      return sendError(res, 400, `durationHours cannot exceed ${maxDurationHours}`);
    }

    session.startTransaction();

    const { device, command } = await applyPartnerEscalationCommand({
      unlockRequest,
      accountId: req.auth.id,
      commandType: "TEMP_UNLOCK",
      targetState: DEVICE_STATES.TEMP_UNLOCK,
      policyKey: DEVICE_POLICY_KEYS.TEMP_UNLOCKED,
      note: req.body.note,
      durationHours,
      session
    });

    unlockRequest.status = "RESOLVED_PARTNER";
    unlockRequest.resolutionAction = "temp_unlocked";
    unlockRequest.resolutionNote = req.body.note;
    unlockRequest.tempUnlockDurationHours = durationHours;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save({ session });

    await createAuditLog(
      {
        eventType: AUDIT_EVENTS.TEMP_UNLOCK_TRIGGERED,
        actorId: req.auth.id,
        tenantId: unlockRequest.tenantId,
        channelPartnerId: channelPartner._id,
        userId: unlockRequest.userId,
        deviceId: unlockRequest.deviceId,
        caseId: unlockRequest.caseId,
        reason: req.body.note,
        metadata: { action: "partner_temp_unlock", durationHours, commandId: command._id }
      },
      { session }
    );

    await session.commitTransaction();

    await safeRefreshTenantMetrics(unlockRequest.tenantId, { source: "partner_escalation_temp_unlocked", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Partner temporary unlock queued successfully", {
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
 * Partner reject escalated case.
 * Sample body: { "note": "No valid payment proof found." }
 */
export const rejectPartnerEscalation = async (req, res) => {
  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!req.body.note) {
      return sendError(res, 400, "note is required");
    }

    const unlockRequest = await UnlockRequest.findOne({
      caseId: req.params.caseId,
      channelPartnerId: channelPartner._id
    });

    if (!unlockRequest) {
      return sendError(res, 404, "Partner escalation not found");
    }

    if (unlockRequest.status !== "ESCALATED_PARTNER") {
      return sendError(res, 400, "Only partner-escalated cases can be rejected by partner");
    }

    unlockRequest.status = "REJECTED";
    unlockRequest.resolutionAction = "rejected";
    unlockRequest.resolutionNote = req.body.note;
    unlockRequest.resolvedBy = req.auth.id;
    unlockRequest.resolvedAt = new Date();
    await unlockRequest.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.CASE_REJECTED_BY_PARTNER,
      actorId: req.auth.id,
      tenantId: unlockRequest.tenantId,
      channelPartnerId: channelPartner._id,
      userId: unlockRequest.userId,
      deviceId: unlockRequest.deviceId,
      caseId: unlockRequest.caseId,
      reason: req.body.note
    });

    await safeRefreshTenantMetrics(unlockRequest.tenantId, { source: "partner_escalation_rejected", caseId: unlockRequest.caseId });

    return sendSuccess(res, 200, "Partner escalation rejected successfully", unlockRequest);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
