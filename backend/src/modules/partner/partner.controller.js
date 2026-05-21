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
import { Device } from "../../models/Device.js";
import { DeviceCommand } from "../../models/DeviceCommand.js";
import { DevicePolicy } from "../../models/DevicePolicy.js";
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
 * Create a tenant under the authenticated partner.
 * Sample body: { "name": "Bharat Finance - Jaipur", "type": "nbfc", "capabilities": ["lend","distribute"], "supportPhone": "9800000002", "supportEmail": "support@tenant.in" }
 */
export const createPartnerTenant = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const channelPartner = await ensurePartnerAccess(req, res);
    if (!channelPartner) return null;

    if (!hasRequiredFields(req.body, ["name", "type", "capabilities"])) {
      return sendError(res, 400, "Name, type, and capabilities are required");
    }

    if (req.body.channelPartnerId || req.body.tenantPolicy || req.body.devicePolicies) {
      return sendError(res, 400, "channelPartnerId and policy payloads are managed by the backend");
    }

    if (!Object.values(TENANT_TYPES).includes(req.body.type)) {
      return sendError(res, 400, "Invalid tenant type");
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

    if (req.body.parentTenantId) {
      const parentTenant = await validateTenantBelongsToPartner(req.body.parentTenantId, channelPartner._id);
      if (!parentTenant) {
        return sendError(res, 400, "Parent tenant not found under this partner");
      }
    }

    session.startTransaction();

    const tenants = await Tenant.create(
      [
        {
          name: req.body.name,
          type: req.body.type,
          capabilities: req.body.capabilities,
          channelPartnerId: channelPartner._id,
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
    const tenant = tenants[0];

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

    await session.commitTransaction();

    return sendSuccess(res, 201, "Partner tenant created successfully", {
      tenant,
      tenantPolicy: tenantPolicies[0],
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

    return sendSuccess(res, 200, "Partner escalation rejected successfully", unlockRequest);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
