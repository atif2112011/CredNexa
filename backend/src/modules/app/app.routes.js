import { Router } from "express";

import { verifyJwt } from "../../middleware/verifyJwt.js";
import { otpRateLimiter, runningEnrollmentRateLimiter } from "../../middleware/rateLimiters.js";
import { resolveRunningDevice } from "../../middleware/resolveRunningDevice.js";
import { requireOwnerPlayIntegrity } from "../../middleware/requireOwnerPlayIntegrity.js";
import {
  previewRunningEnrollment,
  reportRunningCapabilities
} from "./runningEnrollment.controller.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import { parsePaymentProofUpload, parseUnlockRequestImageUpload } from "../../middleware/parsePaymentProofUpload.js";
import {
  acceptConsent,
  acknowledgeDeviceCommand,
  checkAppUpdate,
  createUnlockRequest,
  createIntegrityChallenge,
  createRiskIntegrityChallenge,
  getActiveUnlockRequest,
  getAppDashboard,
  getConsentTerms,
  getDevicePolicy,
  getInstallmentDetail,
  getInstallments,
  getPaymentDetail,
  getPaymentHistory,
  getPaymentQr,
  getCompanySupportContact,
  getTenantUtility,
  listBorrowerUnlockRequests,
  generateTestUserAccessToken,
  initiateConsentOtp,
  pingDevice,
  reportSecurityEvent,
  refreshUserAccessToken,
  resendConsentOtp,
  submitPayment,
  syncDevice,
  verifyIntegrity,
  verifyRiskIntegrity,
  verifyConsentOtp,
  registerDevice
} from "./app.controller.js";

export const appRoutes = Router();

appRoutes.post("/testing/access-token", generateTestUserAccessToken);
appRoutes.post("/refresh-token", refreshUserAccessToken);
appRoutes.get("/update/check", checkAppUpdate);
appRoutes.post("/update/check", checkAppUpdate);
appRoutes.get("/support-contact", getCompanySupportContact);
appRoutes.get("/consent/terms", getConsentTerms);
appRoutes.post("/consent/terms", getConsentTerms);
appRoutes.post("/consent/initiate", otpRateLimiter, initiateConsentOtp);
appRoutes.post("/consent/resend-otp", otpRateLimiter, resendConsentOtp);
appRoutes.post("/consent/verify-otp", otpRateLimiter, verifyConsentOtp);
appRoutes.post("/running-enrollment/preview", runningEnrollmentRateLimiter, previewRunningEnrollment);
// Guard Integrity before the running-device resolver, including before activation.
appRoutes.post("/integrity/challenge", verifyJwt, requireTokenType("user"), requireOwnerPlayIntegrity, createIntegrityChallenge);
appRoutes.post("/integrity/verify", verifyJwt, requireTokenType("user"), requireOwnerPlayIntegrity, verifyIntegrity);
appRoutes.post("/integrity/risk/challenge", verifyJwt, requireTokenType("user"), requireOwnerPlayIntegrity, createRiskIntegrityChallenge);
appRoutes.post("/integrity/risk/verify", verifyJwt, requireTokenType("user"), requireOwnerPlayIntegrity, verifyRiskIntegrity);
// Both APKs use the existing borrower JWT. Running calls resolve the saved linked device.
appRoutes.use(verifyJwt, requireTokenType("user"), resolveRunningDevice);
appRoutes.post("/consent/accept", verifyJwt, requireTokenType("user"), acceptConsent);

appRoutes.post("/device/register", verifyJwt, requireTokenType("user"), registerDevice);
appRoutes.post("/device/capabilities", reportRunningCapabilities);
appRoutes.get("/device/policy", verifyJwt, requireTokenType("user"), getDevicePolicy);
appRoutes.post("/device/ping", verifyJwt, requireTokenType("user"), pingDevice);
appRoutes.post("/device/sync", verifyJwt, requireTokenType("user"), syncDevice);
appRoutes.post("/device/command/ack", verifyJwt, requireTokenType("user"), acknowledgeDeviceCommand);
appRoutes.post("/security/event", verifyJwt, requireTokenType("user"), reportSecurityEvent);
appRoutes.get("/utility/tenant", verifyJwt, requireTokenType("user"), getTenantUtility);
appRoutes.get("/dashboard", verifyJwt, requireTokenType("user"), getAppDashboard);
appRoutes.get("/installments", verifyJwt, requireTokenType("user"), getInstallments);
appRoutes.get("/installments/:installmentId", verifyJwt, requireTokenType("user"), getInstallmentDetail);
appRoutes.get("/payment/qr", verifyJwt, requireTokenType("user"), getPaymentQr);
appRoutes.post("/payment/submit", verifyJwt, requireTokenType("user"), parsePaymentProofUpload, submitPayment);
appRoutes.get("/payment/history", verifyJwt, requireTokenType("user"), getPaymentHistory);
appRoutes.get("/payment/:paymentId", verifyJwt, requireTokenType("user"), getPaymentDetail);
appRoutes.post("/unlock-request", verifyJwt, requireTokenType("user"), parseUnlockRequestImageUpload, createUnlockRequest);
appRoutes.get("/unlock-requests", verifyJwt, requireTokenType("user"), listBorrowerUnlockRequests);
appRoutes.get("/unlock-request/active", verifyJwt, requireTokenType("user"), getActiveUnlockRequest);
