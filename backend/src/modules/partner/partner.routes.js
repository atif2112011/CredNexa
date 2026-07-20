import { Router } from "express";

import { ACCOUNT_ROLES } from "../../constants/roles.js";
import { otpRateLimiter } from "../../middleware/rateLimiters.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import { verifyJwt } from "../../middleware/verifyJwt.js";
import {
  completePartnerSignup,
  createPartnerTenant,
  createTenantAdminAccount,
  getPartnerDashboard,
  getPartnerEscalationByCaseId,
  getPartnerPayoutSummary,
  getPartnerTenantById,
  getPartnerTenants,
  initiateTenantCreationVerification,
  initiatePartnerSignupOtp,
  listPartnerAccounts,
  listPartnerEscalations,
  listPartnerPayoutRequests,
  rejectPartnerEscalation,
  resendPartnerSignupOtp,
  resendTenantCreationVerification,
  requestPartnerPayout,
  tempUnlockPartnerEscalation,
  unlockPartnerEscalation,
  updatePartnerAccount,
  updatePartnerAccountStatus,
  verifyTenantCreationVerification,
  verifyPartnerSignupOtp
} from "./partner.controller.js";

export const partnerRoutes = Router();

const requirePartnerAdmin = [
  verifyJwt,
  requireTokenType("account"),
  requireRole(ACCOUNT_ROLES.PARTNER_ADMIN)
];

partnerRoutes.post("/signup/initiate-otp", otpRateLimiter, initiatePartnerSignupOtp);
partnerRoutes.post("/signup/resend-otp", otpRateLimiter, resendPartnerSignupOtp);
partnerRoutes.post("/signup/verify-otp", otpRateLimiter, verifyPartnerSignupOtp);
partnerRoutes.post("/signup/complete", completePartnerSignup);

partnerRoutes.get("/dashboard", ...requirePartnerAdmin, getPartnerDashboard);
partnerRoutes.get("/payout/summary", ...requirePartnerAdmin, getPartnerPayoutSummary);
partnerRoutes.get("/payout/requests", ...requirePartnerAdmin, listPartnerPayoutRequests);
partnerRoutes.post("/payout/requests", ...requirePartnerAdmin, requestPartnerPayout);
partnerRoutes.post("/tenants/initiate-verification", ...requirePartnerAdmin, otpRateLimiter, initiateTenantCreationVerification);
partnerRoutes.post("/tenants/resend-verification", ...requirePartnerAdmin, otpRateLimiter, resendTenantCreationVerification);
partnerRoutes.post("/tenants/verify-verification", ...requirePartnerAdmin, otpRateLimiter, verifyTenantCreationVerification);
partnerRoutes.get("/tenants", ...requirePartnerAdmin, getPartnerTenants);
partnerRoutes.get("/tenants/:tenantId", ...requirePartnerAdmin, getPartnerTenantById);
partnerRoutes.post("/tenants", ...requirePartnerAdmin, createPartnerTenant);

partnerRoutes.get("/accounts", ...requirePartnerAdmin, listPartnerAccounts);
partnerRoutes.post("/accounts", ...requirePartnerAdmin, createTenantAdminAccount);
partnerRoutes.patch("/accounts/:accountId", ...requirePartnerAdmin, updatePartnerAccount);
partnerRoutes.patch("/accounts/:accountId/status", ...requirePartnerAdmin, updatePartnerAccountStatus);

partnerRoutes.get("/escalations", ...requirePartnerAdmin, listPartnerEscalations);
partnerRoutes.get("/escalations/:caseId", ...requirePartnerAdmin, getPartnerEscalationByCaseId);
partnerRoutes.post("/escalations/:caseId/unlock", ...requirePartnerAdmin, unlockPartnerEscalation);
partnerRoutes.post("/escalations/:caseId/temp-unlock", ...requirePartnerAdmin, tempUnlockPartnerEscalation);
partnerRoutes.post("/escalations/:caseId/reject", ...requirePartnerAdmin, rejectPartnerEscalation);
