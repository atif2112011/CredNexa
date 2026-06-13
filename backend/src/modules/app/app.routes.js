import { Router } from "express";

import { verifyJwt } from "../../middleware/verifyJwt.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import { parsePaymentProofUpload, parseUnlockRequestImageUpload } from "../../middleware/parsePaymentProofUpload.js";
import {
  acceptConsent,
  acknowledgeDeviceCommand,
  createUnlockRequest,
  createIntegrityChallenge,
  getActiveUnlockRequest,
  getAppDashboard,
  getConsentTerms,
  getDevicePolicy,
  getInstallmentDetail,
  getInstallments,
  getPaymentDetail,
  getPaymentHistory,
  getPaymentQr,
  generateTestUserAccessToken,
  initiateConsentOtp,
  pingDevice,
  reportSecurityEvent,
  submitPayment,
  syncDevice,
  verifyIntegrity,
  verifyConsentOtp,
  registerDevice
} from "./app.controller.js";

export const appRoutes = Router();

appRoutes.post("/testing/access-token", generateTestUserAccessToken);
appRoutes.get("/consent/terms", getConsentTerms);
appRoutes.post("/consent/initiate", initiateConsentOtp);
appRoutes.post("/consent/verify-otp", verifyConsentOtp);
appRoutes.post("/integrity/challenge", verifyJwt, requireTokenType("user"), createIntegrityChallenge);
appRoutes.post("/integrity/verify", verifyJwt, requireTokenType("user"), verifyIntegrity);
appRoutes.post("/consent/accept", verifyJwt, requireTokenType("user"), acceptConsent);

appRoutes.post("/device/register", verifyJwt, requireTokenType("user"), registerDevice);
appRoutes.get("/device/policy", verifyJwt, requireTokenType("user"), getDevicePolicy);
appRoutes.post("/device/ping", verifyJwt, requireTokenType("user"), pingDevice);
appRoutes.post("/device/sync", verifyJwt, requireTokenType("user"), syncDevice);
appRoutes.post("/device/command/ack", verifyJwt, requireTokenType("user"), acknowledgeDeviceCommand);
appRoutes.post("/security/event", verifyJwt, requireTokenType("user"), reportSecurityEvent);
appRoutes.get("/dashboard", verifyJwt, requireTokenType("user"), getAppDashboard);
appRoutes.get("/installments", verifyJwt, requireTokenType("user"), getInstallments);
appRoutes.get("/installments/:installmentId", verifyJwt, requireTokenType("user"), getInstallmentDetail);
appRoutes.get("/payment/qr", verifyJwt, requireTokenType("user"), getPaymentQr);
appRoutes.post("/payment/submit", verifyJwt, requireTokenType("user"), parsePaymentProofUpload, submitPayment);
appRoutes.get("/payment/history", verifyJwt, requireTokenType("user"), getPaymentHistory);
appRoutes.get("/payment/:paymentId", verifyJwt, requireTokenType("user"), getPaymentDetail);
appRoutes.post("/unlock-request", verifyJwt, requireTokenType("user"), parseUnlockRequestImageUpload, createUnlockRequest);
appRoutes.get("/unlock-request/active", verifyJwt, requireTokenType("user"), getActiveUnlockRequest);
