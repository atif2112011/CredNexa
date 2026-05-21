import { Router } from "express";

import { healthRoutes } from "../modules/health/health.routes.js";
import { authRoutes } from "../modules/auth/auth.routes.js";

export const apiRoutes = Router();

// apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/auth", authRoutes);
