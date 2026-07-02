import { Router } from "express";

import {
  runEmiPolicyCron,
  runFcmDeliveryCron,
  runManualOverrideRenewalCron,
  runSlaEscalationCron,
  runTempUnlockExpiryCron,
  runTenantMetricsReconciliationCron
} from "./system.controller.js";

export const systemRoutes = Router();

// Internal Vercel cron endpoints. These are not user/admin APIs and should only be invoked by the scheduler.
systemRoutes.get("/cron/fcm-delivery", runFcmDeliveryCron);
systemRoutes.get("/cron/temp-unlock-expiry", runTempUnlockExpiryCron);
systemRoutes.get("/cron/sla-escalation", runSlaEscalationCron);
systemRoutes.get("/cron/emi-policy", runEmiPolicyCron);
systemRoutes.get("/cron/manual-override-renewal", runManualOverrideRenewalCron);
systemRoutes.get("/cron/tenant-metrics-reconciliation", runTenantMetricsReconciliationCron);
