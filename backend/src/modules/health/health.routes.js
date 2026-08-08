import { Router } from "express";

import { generalRateLimiter } from "../../middleware/rateLimiters.js";
import { getHealth, testMailDelivery } from "./health.controller.js";

export const healthRoutes = Router();

healthRoutes.get("/", getHealth);
healthRoutes.post("/send-test-mail", generalRateLimiter, testMailDelivery);
