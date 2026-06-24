import { Router } from "express";

import {
  deactivateAccountPushToken,
  getCurrentAccount,
  loginAccount,
  logoutAccount,
  refreshAccessToken,
  registerAccountPushToken
} from "./auth.controller.js";
import { verifyJwt } from "../../middleware/verifyJwt.js";

export const authRoutes = Router();

authRoutes.post("/login", loginAccount);
authRoutes.post("/refresh-token", refreshAccessToken);
authRoutes.post("/logout", logoutAccount);
authRoutes.post("/push-token", verifyJwt, registerAccountPushToken);
authRoutes.post("/push-token/deactivate", verifyJwt, deactivateAccountPushToken);
authRoutes.get("/me", verifyJwt, getCurrentAccount);
