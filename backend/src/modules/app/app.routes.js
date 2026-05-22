import { Router } from "express";

import { verifyJwt } from "../../middleware/verifyJwt.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import {
  confirmConsentOtp,
  acknowledgeDeviceCommand,
  createUnlockRequest,
  getActiveUnlockRequest,
  getConsentTerms,
  getDevicePolicy,
  getPaymentDetail,
  getPaymentHistory,
  getPaymentQr,
  initiateConsentOtp,
  pingDevice,
  reportSecurityEvent,
  submitPayment,
  syncDevice,
  registerDevice
} from "./app.controller.js";

export const appRoutes = Router();

appRoutes.get("/consent/terms", getConsentTerms);
appRoutes.post("/consent/initiate", initiateConsentOtp);
appRoutes.post("/consent/confirm", confirmConsentOtp);

appRoutes.post("/device/register", verifyJwt, requireTokenType("user"), registerDevice);
appRoutes.get("/device/policy", verifyJwt, requireTokenType("user"), getDevicePolicy);
appRoutes.post("/device/ping", verifyJwt, requireTokenType("user"), pingDevice);
appRoutes.post("/device/sync", verifyJwt, requireTokenType("user"), syncDevice);
appRoutes.post("/device/command/ack", verifyJwt, requireTokenType("user"), acknowledgeDeviceCommand);
appRoutes.post("/security/event", verifyJwt, requireTokenType("user"), reportSecurityEvent);
appRoutes.get("/payment/qr", verifyJwt, requireTokenType("user"), getPaymentQr);
appRoutes.post("/payment/submit", verifyJwt, requireTokenType("user"), submitPayment);
appRoutes.get("/payment/history", verifyJwt, requireTokenType("user"), getPaymentHistory);
appRoutes.get("/payment/:paymentId", verifyJwt, requireTokenType("user"), getPaymentDetail);
appRoutes.post("/unlock-request", verifyJwt, requireTokenType("user"), createUnlockRequest);
appRoutes.get("/unlock-request/active", verifyJwt, requireTokenType("user"), getActiveUnlockRequest);
