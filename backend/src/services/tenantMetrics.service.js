import { Device } from "../models/Device.js";
import { Tenant } from "../models/Tenant.js";
import { UnlockRequest } from "../models/UnlockRequest.js";
import { User } from "../models/User.js";

const OPEN_CASE_STATUSES = ["PENDING_TENANT", "ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"];

export const buildEmptyTenantMetrics = () => ({
  borrowers: { total: 0 },
  devices: { total: 0 },
  cases: {
    open: 0,
    escalatedToPartner: 0
  },
  updatedAt: new Date()
});

export const computeTenantMetrics = async (tenantId) => {
  const [borrowersTotal, devicesTotal, openCases, escalatedToPartner] = await Promise.all([
    User.countDocuments({ tenantId }),
    Device.countDocuments({ tenantId }),
    UnlockRequest.countDocuments({ tenantId, status: { $in: OPEN_CASE_STATUSES } }),
    UnlockRequest.countDocuments({ tenantId, status: "ESCALATED_PARTNER" })
  ]);

  return {
    borrowers: { total: borrowersTotal },
    devices: { total: devicesTotal },
    cases: {
      open: openCases,
      escalatedToPartner
    },
    updatedAt: new Date()
  };
};

export const refreshTenantMetrics = async (tenantId, { session } = {}) => {
  const metrics = await computeTenantMetrics(tenantId);

  await Tenant.updateOne(
    { _id: tenantId },
    { $set: { metrics } },
    { session }
  );

  return metrics;
};

export const safeRefreshTenantMetrics = async (tenantId, context = {}) => {
  try {
    return await refreshTenantMetrics(tenantId);
  } catch (error) {
    console.error("Failed to refresh tenant metrics", {
      tenantId,
      ...context,
      message: error.message
    });
    return null;
  }
};

export const refreshTenantMetricsForMany = async (tenantIds, { limit } = {}) => {
  const ids = [...new Set((tenantIds || []).filter(Boolean).map((tenantId) => tenantId.toString()))];
  const limitedIds = Number.isFinite(Number(limit)) && Number(limit) > 0 ? ids.slice(0, Number(limit)) : ids;
  const refreshed = [];
  const failed = [];

  for (const tenantId of limitedIds) {
    try {
      const metrics = await refreshTenantMetrics(tenantId);
      refreshed.push({ tenantId, metrics });
    } catch (error) {
      failed.push({ tenantId, error: error.message });
    }
  }

  return {
    scanned: limitedIds.length,
    refreshed,
    failed
  };
};

export const refreshAllTenantMetrics = async ({ limit } = {}) => {
  const query = Tenant.find({}).select("_id").sort({ updatedAt: 1 }).lean();
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    query.limit(Number(limit));
  }

  const tenants = await query;
  return refreshTenantMetricsForMany(
    tenants.map((tenant) => tenant._id),
    { limit }
  );
};
