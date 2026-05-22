import { Router } from "express";

import { getCurrentAccount, loginAccount, logoutAccount, refreshAccessToken } from "./auth.controller.js";
import { verifyJwt } from "../../middleware/verifyJwt.js";

export const authRoutes = Router();

authRoutes.post("/login", loginAccount);
authRoutes.post("/refresh-token", refreshAccessToken);
authRoutes.post("/logout", logoutAccount);
authRoutes.get("/me", verifyJwt, getCurrentAccount);
