import { Router } from "express";

import { healthRoutes } from "../modules/health/health.routes.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { adminRoutes } from "../modules/admin/admin.routes.js";
import { distributorRoutes } from "../modules/distributor/distributor.routes.js";
import { appRoutes } from "../modules/app/app.routes.js";
import { partnerRoutes } from "../modules/partner/partner.routes.js";

export const apiRoutes = Router();

// apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/admin", adminRoutes);
apiRoutes.use("/partner", partnerRoutes);
apiRoutes.use("/distributor", distributorRoutes);
apiRoutes.use("/app", appRoutes);
