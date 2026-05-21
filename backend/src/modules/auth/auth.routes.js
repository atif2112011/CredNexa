import { Router } from "express";

import { loginAccount, logoutAccount, refreshAccessToken } from "./auth.controller.js";

export const authRoutes = Router();

authRoutes.post("/login", loginAccount);
authRoutes.post("/refresh-token", refreshAccessToken);
authRoutes.post("/logout", logoutAccount);
