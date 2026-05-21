import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { AUDIT_EVENTS } from "../../constants/auditEvents.js";
import { DEFAULT_DEVICE_POLICIES, DEFAULT_TENANT_POLICY } from "../../constants/defaultPolicies.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../../constants/deviceStates.js";
import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { TENANT_CAPABILITIES, TENANT_TYPES } from "../../constants/tenant.js";
import { Account } from "../../models/Account.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ChannelPartner } from "../../models/ChannelPartner.js";
import { ConsentVersion } from "../../models/ConsentVersion.js";
import { Device } from "../../models/Device.js";
import { DeviceCommand } from "../../models/DeviceCommand.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
import { RiskFlag } from "../../models/RiskFlag.js";
import { Tenant } from "../../models/Tenant.js";
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { UnlockRequest } from "../../models/UnlockRequest.js";
import { User } from "../../models/User.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
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

const createAuditLog = async (payload, options = {}) => {
  return AuditLog.create([payload], { ordered: true, ...options }).then((items) => items[0]);
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
      RiskFlag.find({ tenantId, status: { $ne: "resolved" } }).lean()
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
      RiskFlag.find({ status: { $ne: "resolved" } }).sort({ createdAt: -1 }).limit(8).lean(),
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

    const channelPartner = await ChannelPartner.create({
      ...req.body,
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

    const allowedUpdates = ["name", "type", "contactEmail", "contactPhone"];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowedUpdates.includes(key))
    );

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

    const channelPartner = await ChannelPartner.findOne({
      _id: req.body.channelPartnerId,
      isActive: true
    });

    if (!channelPartner) {
      return sendError(res, 400, "Active channel partner not found");
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
          address: req.body.address,
          createdBy: req.auth.id
        }
      ],
      { session, ordered: true }
    );

    const createdTenant = tenant[0];

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
      devicePolicies
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

    const allowedUpdates = ["name", "supportPhone", "supportEmail", "supportWhatsapp", "address", "parentTenantId"];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowedUpdates.includes(key))
    );

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
        req.body.role === ACCOUNT_ROLES.PARTNER_ADMIN ? req.body.channelPartnerId : undefined,
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
    const filter = {
      status: req.query.status || "ESCALATED_ADMIN"
    };

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
        .sort({ escalatedToAdminAt: -1, createdAt: -1 })
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
 * Override full unlock for an escalated case.
 * Sample body: { "reason": "Tenant and partner breached SLA. Borrower proof verified.", "emiAction": "none" }
 */
export const unlockAdminEscalation = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    if (!req.body.reason) {
      return sendError(res, 400, "Reason is required");
    }

    const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId });

    if (!unlockRequest) {
      return sendError(res, 400, "Escalation not found");
    }

    if (!["ESCALATED_ADMIN", "UNDER_REVIEW"].includes(unlockRequest.status)) {
      return sendError(res, 400, "Only admin-escalated cases can be overridden");
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

    unlockRequest.status = "RESOLVED_SUPER_ADMIN";
    unlockRequest.resolutionAction = "override";
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
        metadata: { action: "unlock", commandId: command._id }
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

    if (!["ESCALATED_ADMIN", "UNDER_REVIEW"].includes(unlockRequest.status)) {
      return sendError(res, 400, "Only admin-escalated cases can be overridden");
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

    if (!["ESCALATED_ADMIN", "UNDER_REVIEW"].includes(unlockRequest.status)) {
      return sendError(res, 400, "Only admin-escalated cases can be rejected");
    }

    unlockRequest.status = "REJECTED";
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
      RiskFlag.find({ deviceId: device._id, status: { $ne: "resolved" } }).lean()
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

    if (req.query.severity) filter.severity = req.query.severity;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;

    const [items, total] = await Promise.all([
      RiskFlag.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
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
        acknowledgedAt: new Date()
      },
      { new: true }
    );

    if (!riskFlag) {
      return sendError(res, 400, "Risk flag not found");
    }

    return sendSuccess(res, 200, "Risk flag acknowledged successfully", riskFlag);
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
      AuditLog.find(filter).skip(skip).limit(limit).sort({ timestamp: -1 }).lean(),
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
