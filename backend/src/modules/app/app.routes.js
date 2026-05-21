import { Router } from "express";

import { verifyJwt } from "../../middleware/verifyJwt.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import {
  confirmConsentOtp,
  getConsentTerms,
  getDevicePolicy,
  initiateConsentOtp,
  registerDevice
} from "./app.controller.js";

export const appRoutes = Router();

appRoutes.get("/consent/terms", getConsentTerms);
appRoutes.post("/consent/initiate", initiateConsentOtp);
appRoutes.post("/consent/confirm", confirmConsentOtp);

appRoutes.post("/device/register", verifyJwt, requireTokenType("user"), registerDevice);
appRoutes.get("/device/policy", verifyJwt, requireTokenType("user"), getDevicePolicy);
