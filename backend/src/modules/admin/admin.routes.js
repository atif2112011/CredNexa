import { Router } from "express";

import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { parseApkUpload } from "../../middleware/parseApkUpload.js";
import { parseAdminCreditPurchaseQrImageUpload, parsePaymentProofUpload } from "../../middleware/parsePaymentProofUpload.js";
import { requireRole } from "../../middleware/requireRole.js";
import { verifyJwt } from "../../middleware/verifyJwt.js";
import {
  acknowledgeRiskFlag,
  adjustTenantCredits,
  approvePartnerPayoutRequest,
  approveTenantCreditPurchaseRequest,
  archiveAppBuild,
  backfillManualOverrideTokensForDevices,
  clearRiskFlag,
  createAppBuild,
  createAdminAccount,
  createChannelPartner,
  createConsentVersion,
  createTenant,
  generateDeviceManualOverrideToken,
  getAdminDashboard,
  getAdminEscalationByCaseId,
  getAdminAccountById,
  getAdminRiskFlags,
  getAdminRiskFlagById,
  getAppBuildById,
  getAuditLogs,
  getChannelPartnerById,
  getCompanySupportContact,
  getConsentVersionById,
  getDeviceAuditLogs,
  getDeviceById,
  getDeviceCommands,
  getManualOverrideTokenById,
  listFcmDeliveryLogs,
  listDeviceManualOverrideTokens,
  listPartnerCreditLedger,
  listTenantCreditLedger,
  getPartnerPayoutRequestById,
  getPayoutConstants,
  getTenantCreditPurchaseRequestById,
  listDeviceCommands,
  listManualOverrideTokens,
  listNotificationTargets,
  lockAdminDevice,
  getTenantById,
  listAdminAccounts,
  listAdminEscalations,
  listChannelPartners,
  listConsentVersions,
  listDevices,
  listPartnerPayoutRequests,
  listTenantCreditPurchaseRequests,
  listTenants,
  publishConsentVersion,
  rejectPartnerPayoutRequest,
  rejectTenantCreditPurchaseRequest,
  rejectAdminEscalation,
  renewExpiringManualOverrideTokensForDevices,
  releaseAdminDevice,
  revokeManualOverrideToken,
  sendCustomNotification,
  tempUnlockAdminEscalation,
  tempUnlockAdminDevice,
  unlockAdminDevice,
  unlockAdminEscalation,
  unlockAdminDeviceWithWaive,
  updateAdminAccount,
  updateAdminAccountStatus,
  updateChannelPartner,
  updateChannelPartnerStatus,
  updateCompanySupportContact,
  updateAdminDeviceRestrictions,
  updatePayoutConstants,
  updateTenant,
  updateTenantStatus,
  upsertProvisioningDetails,
  getProvisioningDetails,
  listAppBuilds,
  publishAppBuild,
  queueRiskFlagAppUpdate,
  queueRiskFlagWipe,
  requestRiskFlagRecheck,
  updateAppBuild
} from "./admin.controller.js";

export const adminRoutes = Router();

adminRoutes.use(verifyJwt);
adminRoutes.use(requireRole(ACCOUNT_ROLES.SUPER_ADMIN));

adminRoutes.get("/dashboard", getAdminDashboard);

adminRoutes.get("/support-contact", getCompanySupportContact);
adminRoutes.patch("/support-contact", updateCompanySupportContact);

adminRoutes.get("/app-builds", listAppBuilds);
adminRoutes.post("/app-builds", parseApkUpload, createAppBuild);
adminRoutes.get("/app-builds/:buildId", getAppBuildById);
adminRoutes.patch("/app-builds/:buildId", parseApkUpload, updateAppBuild);
adminRoutes.patch("/app-builds/:buildId/publish", publishAppBuild);
adminRoutes.patch("/app-builds/:buildId/archive", archiveAppBuild);

adminRoutes.get("/channel-partners", listChannelPartners);
adminRoutes.post("/channel-partners", createChannelPartner);
adminRoutes.get("/channel-partners/:id", getChannelPartnerById);
adminRoutes.patch("/channel-partners/:id", updateChannelPartner);
adminRoutes.patch("/channel-partners/:id/status", updateChannelPartnerStatus);

adminRoutes.get("/payout/constants", getPayoutConstants);
adminRoutes.patch("/payout/constants", parseAdminCreditPurchaseQrImageUpload, updatePayoutConstants);
adminRoutes.get("/ledgers/partners", listPartnerCreditLedger);
adminRoutes.get("/ledgers/tenants", listTenantCreditLedger);
adminRoutes.get("/partner-payouts", listPartnerPayoutRequests);
adminRoutes.get("/partner-payouts/:payoutId", getPartnerPayoutRequestById);
adminRoutes.post("/partner-payouts/:payoutId/approve", parsePaymentProofUpload, approvePartnerPayoutRequest);
adminRoutes.post("/partner-payouts/:payoutId/reject", rejectPartnerPayoutRequest);
adminRoutes.get("/tenant-credit-purchases", listTenantCreditPurchaseRequests);
adminRoutes.get("/tenant-credit-purchases/:requestId", getTenantCreditPurchaseRequestById);
adminRoutes.post("/tenant-credit-purchases/:requestId/approve", approveTenantCreditPurchaseRequest);
adminRoutes.post("/tenant-credit-purchases/:requestId/reject", rejectTenantCreditPurchaseRequest);

adminRoutes.get("/tenants", listTenants);
adminRoutes.post("/tenants", createTenant);
adminRoutes.get("/tenants/:id", getTenantById);
adminRoutes.patch("/tenants/:id", updateTenant);
adminRoutes.patch("/tenants/:id/status", updateTenantStatus);
adminRoutes.post("/tenants/:id/credits/adjust", adjustTenantCredits);

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
adminRoutes.get("/commands", listDeviceCommands);
adminRoutes.get("/fcm-logs", listFcmDeliveryLogs);
adminRoutes.get("/manual-override-tokens", listManualOverrideTokens);
adminRoutes.post("/manual-override-tokens/backfill", backfillManualOverrideTokensForDevices);
adminRoutes.post("/manual-override-tokens/renew-expiring", renewExpiringManualOverrideTokensForDevices);
adminRoutes.get("/manual-override-tokens/:tokenId", getManualOverrideTokenById);
adminRoutes.post("/manual-override-tokens/:tokenId/revoke", revokeManualOverrideToken);
adminRoutes.get("/devices/:deviceId", getDeviceById);
adminRoutes.post("/devices/:deviceId/manual-override-token", generateDeviceManualOverrideToken);
adminRoutes.get("/devices/:deviceId/manual-override-tokens", listDeviceManualOverrideTokens);
adminRoutes.post("/devices/:deviceId/lock", lockAdminDevice);
adminRoutes.post("/devices/:deviceId/temp-unlock", tempUnlockAdminDevice);
adminRoutes.post("/devices/:deviceId/unlock", unlockAdminDevice);
adminRoutes.post("/devices/:deviceId/unlock-waive", unlockAdminDeviceWithWaive);
adminRoutes.post("/devices/:deviceId/release", releaseAdminDevice);
adminRoutes.patch("/devices/:deviceId/restrictions", updateAdminDeviceRestrictions);
adminRoutes.get("/devices/:deviceId/commands", getDeviceCommands);
adminRoutes.get("/devices/:deviceId/audit-logs", getDeviceAuditLogs);

adminRoutes.get("/risk-flags", getAdminRiskFlags);
adminRoutes.get("/risk-flags/:flagId", getAdminRiskFlagById);
adminRoutes.patch("/risk-flags/:flagId/acknowledge", acknowledgeRiskFlag);
adminRoutes.post("/risk-flags/:flagId/recheck", requestRiskFlagRecheck);
adminRoutes.post("/risk-flags/:flagId/clear", clearRiskFlag);
adminRoutes.post("/risk-flags/:flagId/app-update", queueRiskFlagAppUpdate);
adminRoutes.post("/risk-flags/:flagId/wipe", queueRiskFlagWipe);
adminRoutes.get("/audit-logs", getAuditLogs);

adminRoutes.get("/notifications/targets", listNotificationTargets);
adminRoutes.post("/notifications/custom", sendCustomNotification);

adminRoutes.post("/provisioning-details", upsertProvisioningDetails);
adminRoutes.get("/provisioning-details", getProvisioningDetails);
