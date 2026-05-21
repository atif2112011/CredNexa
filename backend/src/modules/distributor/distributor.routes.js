import { Router } from "express";

import { verifyJwt } from "../../middleware/verifyJwt.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import {
  generateEnrollmentQr,
  getDashboard,
  getDistributorDeviceById,
  getDistributorDevices,
  getDistributorUserById,
  getDistributorUsers,
  getEnrollmentStatusByToken,
  regenerateEnrollmentQr,
  registerBorrower
} from "./distributor.controller.js";

export const distributorRoutes = Router();

distributorRoutes.use(verifyJwt);
distributorRoutes.use(requireTokenType("account"));
distributorRoutes.get("/dashboard", getDashboard);
distributorRoutes.post("/users/register", registerBorrower);
distributorRoutes.post("/enrollment/qr", generateEnrollmentQr);
distributorRoutes.get("/enrollments/:token/status", getEnrollmentStatusByToken);
distributorRoutes.post("/enrollment/:token/regenerate", regenerateEnrollmentQr);
distributorRoutes.get("/users", getDistributorUsers);
distributorRoutes.get("/users/:id", getDistributorUserById);
distributorRoutes.get("/devices", getDistributorDevices);
distributorRoutes.get("/devices/:id", getDistributorDeviceById);
