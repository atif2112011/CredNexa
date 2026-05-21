import { Router } from "express";

import { verifyJwt } from "../../middleware/verifyJwt.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import {
  generateEnrollmentQr,
  getDistributorDevices,
  getDistributorUsers,
  registerBorrower
} from "./distributor.controller.js";

export const distributorRoutes = Router();

distributorRoutes.use(verifyJwt);
distributorRoutes.use(requireTokenType("account"));
distributorRoutes.post("/users/register", registerBorrower);
distributorRoutes.post("/enrollment/qr", generateEnrollmentQr);
distributorRoutes.get("/users", getDistributorUsers);
distributorRoutes.get("/devices", getDistributorDevices);
