import { Router } from "express";

import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import { verifyJwt } from "../../middleware/verifyJwt.js";
import {
  createPartnerTenant,
  createTenantAdminAccount,
  getPartnerDashboard,
  getPartnerEscalationByCaseId,
  getPartnerTenants,
  listPartnerAccounts,
  listPartnerEscalations,
  rejectPartnerEscalation,
  tempUnlockPartnerEscalation,
  unlockPartnerEscalation,
  updatePartnerAccount,
  updatePartnerAccountStatus
} from "./partner.controller.js";

export const partnerRoutes = Router();

partnerRoutes.use(verifyJwt);
partnerRoutes.use(requireTokenType("account"));
partnerRoutes.use(requireRole(ACCOUNT_ROLES.PARTNER_ADMIN));

partnerRoutes.get("/dashboard", getPartnerDashboard);
partnerRoutes.get("/tenants", getPartnerTenants);
partnerRoutes.post("/tenants", createPartnerTenant);

partnerRoutes.get("/accounts", listPartnerAccounts);
partnerRoutes.post("/accounts", createTenantAdminAccount);
partnerRoutes.patch("/accounts/:accountId", updatePartnerAccount);
partnerRoutes.patch("/accounts/:accountId/status", updatePartnerAccountStatus);

partnerRoutes.get("/escalations", listPartnerEscalations);
partnerRoutes.get("/escalations/:caseId", getPartnerEscalationByCaseId);
partnerRoutes.post("/escalations/:caseId/unlock", unlockPartnerEscalation);
partnerRoutes.post("/escalations/:caseId/temp-unlock", tempUnlockPartnerEscalation);
partnerRoutes.post("/escalations/:caseId/reject", rejectPartnerEscalation);
