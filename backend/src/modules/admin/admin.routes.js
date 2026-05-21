import { Router } from "express";

import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { requireRole } from "../../middleware/requireRole.js";
import { verifyJwt } from "../../middleware/verifyJwt.js";
import {
  acknowledgeRiskFlag,
  createAdminAccount,
  createChannelPartner,
  createConsentVersion,
  createTenant,
  getAdminEscalationByCaseId,
  getAdminAccountById,
  getAdminRiskFlags,
  getAuditLogs,
  getChannelPartnerById,
  getConsentVersionById,
  getDeviceAuditLogs,
  getDeviceById,
  getDeviceCommands,
  getTenantById,
  listAdminAccounts,
  listAdminEscalations,
  listChannelPartners,
  listConsentVersions,
  listDevices,
  listTenants,
  publishConsentVersion,
  rejectAdminEscalation,
  tempUnlockAdminEscalation,
  unlockAdminEscalation,
  updateAdminAccount,
  updateAdminAccountStatus,
  updateChannelPartner,
  updateChannelPartnerStatus,
  updateTenant,
  updateTenantStatus
} from "./admin.controller.js";

export const adminRoutes = Router();

adminRoutes.use(verifyJwt);
adminRoutes.use(requireRole(ACCOUNT_ROLES.SUPER_ADMIN));

adminRoutes.get("/channel-partners", listChannelPartners);
adminRoutes.post("/channel-partners", createChannelPartner);
adminRoutes.get("/channel-partners/:id", getChannelPartnerById);
adminRoutes.patch("/channel-partners/:id", updateChannelPartner);
adminRoutes.patch("/channel-partners/:id/status", updateChannelPartnerStatus);

adminRoutes.get("/tenants", listTenants);
adminRoutes.post("/tenants", createTenant);
adminRoutes.get("/tenants/:id", getTenantById);
adminRoutes.patch("/tenants/:id", updateTenant);
adminRoutes.patch("/tenants/:id/status", updateTenantStatus);

adminRoutes.get("/accounts", listAdminAccounts);
adminRoutes.post("/accounts", createAdminAccount);
adminRoutes.get("/accounts/:accountId", getAdminAccountById);
adminRoutes.patch("/accounts/:accountId", updateAdminAccount);
adminRoutes.patch("/accounts/:accountId/status", updateAdminAccountStatus);

adminRoutes.get("/consent-versions", listConsentVersions);
adminRoutes.post("/consent-versions", createConsentVersion);
adminRoutes.get("/consent-versions/:id", getConsentVersionById);
adminRoutes.patch("/consent-versions/:id/publish", publishConsentVersion);

adminRoutes.get("/escalations", listAdminEscalations);
adminRoutes.get("/escalations/:caseId", getAdminEscalationByCaseId);
adminRoutes.post("/escalations/:caseId/unlock", unlockAdminEscalation);
adminRoutes.post("/escalations/:caseId/temp-unlock", tempUnlockAdminEscalation);
adminRoutes.post("/escalations/:caseId/reject", rejectAdminEscalation);

adminRoutes.get("/devices", listDevices);
adminRoutes.get("/devices/:deviceId", getDeviceById);
adminRoutes.get("/devices/:deviceId/commands", getDeviceCommands);
adminRoutes.get("/devices/:deviceId/audit-logs", getDeviceAuditLogs);

adminRoutes.get("/risk-flags", getAdminRiskFlags);
adminRoutes.patch("/risk-flags/:flagId/acknowledge", acknowledgeRiskFlag);
adminRoutes.get("/audit-logs", getAuditLogs);
