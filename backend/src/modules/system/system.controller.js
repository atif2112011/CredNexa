import { env } from "../../config/env.js";
import {
  runEmiPolicyJob,
  runManualOverrideTokenRenewalJob,
  runSlaEscalationJob,
  runTempUnlockExpiryJob,
  runTenantMetricsReconciliationJob,
  SCHEDULED_JOB_LIMITS
} from "../../jobs/scheduledJobs.js";
import { runAllFcmDeliveryBatches } from "../../jobs/fcmDeliveryWorker.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";

const CRON_SOURCE_HEADER = "x-cron-source";
const VERCEL_CRON_HEADER = "x-vercel-cron-schedule";
const FIREBASE_SCHEDULER_HEADER = "x-cloudscheduler";

const verifyCronRequest = (req, res) => {
  const source =
    req.get(CRON_SOURCE_HEADER) ||
    (req.get(FIREBASE_SCHEDULER_HEADER) ? "firebase-scheduler" : null) ||
    req.get(VERCEL_CRON_HEADER);

  if (!source) {
    sendError(res, 401, "Missing scheduler identification header");
    return null;
  }

  if (!env.cronSecret) {
    sendError(res, 500, "Cron secret is not configured");
    return null;
  }

  if (String(req.query.secret || req.get("x-cron-secret") || "") !== env.cronSecret) {
    sendError(res, 403, "Invalid cron secret");
    return null;
  }

  return source;
};

const runCronJob = async ({ req, res, jobName, jobFn }) => {
  const schedule = verifyCronRequest(req, res);
  if (!schedule) return null;

  const result = await jobFn();
  return sendSuccess(res, 200, `${jobName} completed successfully`, {
    jobName,
    schedule,
    result
  });
};

/**
 * Internal scheduler/manual endpoint for queued device/app notification FCM delivery.
 * Schedule intent: every minute so borrower-facing commands are not delayed behind other cron work.
 */
export const runFcmDeliveryCron = async (req, res) => {
  try {
    return await runCronJob({
      req,
      res,
      jobName: "fcm-delivery",
      jobFn: () => runAllFcmDeliveryBatches({ limit: SCHEDULED_JOB_LIMITS.fcmDelivery })
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Internal scheduler/manual endpoint for relocking devices whose temporary unlock window has expired.
 * Schedule intent: every 10 minutes to keep temporary unlock expiry enforcement reasonably fresh.
 */
export const runTempUnlockExpiryCron = async (req, res) => {
  try {
    return await runCronJob({
      req,
      res,
      jobName: "temp-unlock-expiry",
      jobFn: () => runTempUnlockExpiryJob({ limit: SCHEDULED_JOB_LIMITS.tempUnlockExpiry })
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Internal scheduler/manual endpoint for moving unlock requests across SLA breach thresholds.
 * Schedule intent: every 30 minutes because the SLA windows are hour-based.
 */
export const runSlaEscalationCron = async (req, res) => {
  try {
    return await runCronJob({
      req,
      res,
      jobName: "sla-escalation",
      jobFn: () => runSlaEscalationJob({ limit: SCHEDULED_JOB_LIMITS.slaEscalation })
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Internal scheduler/manual endpoint for EMI reminder, grace-period, and lock state evaluation.
 * Schedule intent: every 30 minutes because reminders and lock transitions are day-based.
 */
export const runEmiPolicyCron = async (req, res) => {
  try {
    return await runCronJob({
      req,
      res,
      jobName: "emi-policy",
      jobFn: () => runEmiPolicyJob({ limit: SCHEDULED_JOB_LIMITS.emiPolicy })
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Internal scheduler/manual endpoint for expiring and renewing manual override tokens in batches.
 * Schedule intent: once per day because token validity is measured in days, not minutes.
 */
export const runManualOverrideRenewalCron = async (req, res) => {
  try {
    return await runCronJob({
      req,
      res,
      jobName: "manual-override-renewal",
      jobFn: () =>
        runManualOverrideTokenRenewalJob({ limit: SCHEDULED_JOB_LIMITS.manualOverrideTokenRenewal })
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

/**
 * Internal scheduler/manual endpoint for repairing stored tenant metrics from source collections.
 * Schedule intent: once per day because this is a reconciliation/repair pass, not a hot-path update.
 */
export const runTenantMetricsReconciliationCron = async (req, res) => {
  try {
    return await runCronJob({
      req,
      res,
      jobName: "tenant-metrics-reconciliation",
      jobFn: () =>
        runTenantMetricsReconciliationJob({ limit: SCHEDULED_JOB_LIMITS.tenantMetricsReconciliation })
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};
