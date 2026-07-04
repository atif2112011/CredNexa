import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";

import { createApp } from "./src/app.js";
import { env } from "./src/config/env.js";
import {
  runEmiPolicyJob,
  runManualOverrideTokenRenewalJob,
  runSlaEscalationJob,
  runTempUnlockExpiryJob,
  runTenantMetricsReconciliationJob,
  SCHEDULED_JOB_LIMITS
} from "./src/jobs/scheduledJobs.js";
import { runAllFcmDeliveryBatches } from "./src/jobs/fcmDeliveryWorker.js";

setGlobalOptions({
  region: env.firebaseFunctionsRegion,
  maxInstances: 10
});

const schedulerOptions = {
  region: env.firebaseFunctionsRegion,
  timeZone: env.firebaseSchedulerTimeZone,
  retryCount: 0
};

const createScheduledFunction = ({ schedule, jobName, run }) =>
  onSchedule({ ...schedulerOptions, schedule }, async () => {
    const result = await run();
    console.info(`${jobName} completed`, { jobName, result });
    return result;
  });

const firebaseApiApp = createApp({ apiBasePath: "/" });

export const api = onRequest({ region: env.firebaseFunctionsRegion }, firebaseApiApp);

export const fcmDeliveryJob = createScheduledFunction({
  schedule: "* * * * *",
  jobName: "fcmDeliveryJob",
  run: () => runAllFcmDeliveryBatches({ limit: SCHEDULED_JOB_LIMITS.fcmDelivery })
});

export const tempUnlockExpiryJob = createScheduledFunction({
  schedule: "*/10 * * * *",
  jobName: "tempUnlockExpiryJob",
  run: () => runTempUnlockExpiryJob({ limit: SCHEDULED_JOB_LIMITS.tempUnlockExpiry })
});

export const slaEscalationJob = createScheduledFunction({
  schedule: "*/30 * * * *",
  jobName: "slaEscalationJob",
  run: () => runSlaEscalationJob({ limit: SCHEDULED_JOB_LIMITS.slaEscalation })
});

export const emiPolicyJob = createScheduledFunction({
  schedule: "*/30 * * * *",
  jobName: "emiPolicyJob",
  run: () => runEmiPolicyJob({ limit: SCHEDULED_JOB_LIMITS.emiPolicy })
});

export const manualOverrideTokenRenewalJob = createScheduledFunction({
  schedule: "0 0 * * *",
  jobName: "manualOverrideTokenRenewalJob",
  run: () =>
    runManualOverrideTokenRenewalJob({ limit: SCHEDULED_JOB_LIMITS.manualOverrideTokenRenewal })
});

export const tenantMetricsReconciliationJob = createScheduledFunction({
  schedule: "0 1 * * *",
  jobName: "tenantMetricsReconciliationJob",
  run: () =>
    runTenantMetricsReconciliationJob({ limit: SCHEDULED_JOB_LIMITS.tenantMetricsReconciliation })
});
