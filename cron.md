# Scheduled Jobs and Cron Behavior

The backend uses in-process scheduled timers, not OS-level crontab. Timers start automatically in `backend/src/server.js` after the API server connects to MongoDB and begins listening, as long as `VERCEL !== "true"`.

Manual one-off execution:

```bash
cd backend
npm run jobs:scheduled
```

That command runs one full pass of all scheduled jobs and exits.

## Where Cron Settings Live

Main file:

`backend/src/jobs/scheduledJobs.js`

Intervals are controlled by:

```js
SCHEDULED_JOB_INTERVALS
```

Batch limits are controlled by:

```js
SCHEDULED_JOB_LIMITS
```

Important: most intervals are currently code constants, not environment variables. To alter them, edit `SCHEDULED_JOB_INTERVALS` and redeploy/restart the backend. Manual override token validity and renewal window are env-driven and are listed below.

## Current Scheduled Timers

| Job | Function | Current Interval | Batch Limit |
| --- | --- | ---: | ---: |
| FCM delivery | `runAllFcmDeliveryBatches` | 5 minutes | 100 |
| Temp unlock expiry | `runTempUnlockExpiryJob` | 10 minutes | 200 |
| SLA escalation | `runSlaEscalationJob` | 30 minutes | 200 |
| EMI policy | `runEmiPolicyJob` | 30 minutes | 500 |
| Manual override token renewal | `runManualOverrideTokenRenewalJob` | 24 hours | 500 |
| Tenant metrics reconciliation | `runTenantMetricsReconciliationJob` | 24 hours | 500 |

The scheduler prevents overlapping runs of the same timer. If a previous run is still active, the next run for that job is skipped and logged.

## FCM Delivery Job

Function:

```js
runAllFcmDeliveryBatches({ limit })
```

Runs every 5 minutes.

What it does:

- Delivers pending/failed `DeviceCommand` records to borrower devices through FCM.
- Delivers pending/failed `AppNotificationJob` records to tenant/partner/admin app users through FCM.
- Writes delivery attempts to `FcmDeliveryLog`.
- Marks device commands as `sent`, `failed`, or skipped.
- Marks app notification jobs as `sent`, `failed`, or skipped.

Device command eligibility:

- `status` is `pending` or `failed`.
- `retryCount < 5`.
- `nextRetryAt` is missing/null or already due.

Retry behavior:

- Missing device FCM token: command becomes `failed`, retry count increments, next retry is 5 minutes later.
- FCM failure: command becomes `failed`, retry count increments, next retry is `(retryCount + 1) * 5 minutes`, capped by the logic at 25 minutes.
- Invalid app push tokens are deactivated for app notification delivery.

How to alter:

- Interval: edit `SCHEDULED_JOB_INTERVALS.fcmDeliveryMs`.
- Batch size: edit `SCHEDULED_JOB_LIMITS.fcmDelivery`.
- Device command max retry count: currently stored on each `DeviceCommand.maxRetries`, but `runFcmDeliveryBatch` also filters with `retryCount < 5`; adjust the worker if a different global retry limit is needed.
- Firebase behavior: set `FCM_MOCK_MODE=false` and configure Firebase Admin envs for real FCM delivery.

## Temp Unlock Expiry Job

Function:

```js
runTempUnlockExpiryJob({ limit })
```

Runs every 10 minutes.

What it does:

- Finds devices where:
  - `state === "TEMP_UNLOCK"`
  - `tempUnlockExpiresAt <= now`
- Finds the active `EMI_LOCKED` policy for the tenant.
- Updates device state back to `LOCKED`.
- Sets `currentPolicyKey` to `EMI_LOCKED`.
- Increments `desiredPolicyVersion`.
- Clears `tempUnlockExpiresAt`.
- Creates a `LOCK` device command with `triggeredBy: "temp_unlock_expiry"`.
- Writes an audit log.

How temp unlock expiry is set:

- Tenant/admin/partner temp unlock APIs set `tempUnlockExpiresAt` from the requested `durationHours`.
- Tenant and partner temp unlock flows enforce tenant policy `tempUnlockRules.maxDurationHours`.
- Super-admin device temp unlock currently accepts positive `durationHours`.

How to alter:

- Interval: edit `SCHEDULED_JOB_INTERVALS.tempUnlockExpiryMs`.
- Batch size: edit `SCHEDULED_JOB_LIMITS.tempUnlockExpiry`.
- Tenant max temp unlock duration: update `TenantPolicy.tempUnlockRules.maxDurationHours`.
- Tenant default duration: update `TenantPolicy.tempUnlockRules.defaultDurationHours`.

## SLA Escalation Job

Function:

```js
runSlaEscalationJob({ limit })
```

Runs every 30 minutes.

What it does:

- Finds unlock requests with `status: "PENDING_TENANT"` and `slaDeadline <= now`.
- Escalates them to `ESCALATED_PARTNER`.
- Sets `escalatedToPartnerAt`.
- Sets `partnerSlaDeadline` from tenant policy `partnerEscalationSlaHours`, defaulting to 48 hours.
- Creates a high-severity `TENANT_SLA_BREACH` risk flag.
- Writes an audit log.
- Refreshes stored tenant metrics after the case moves to partner escalation.
- Finds unlock requests with `status: "ESCALATED_PARTNER"` and `partnerSlaDeadline <= now`.
- Escalates them to `ESCALATED_ADMIN`.
- Creates a critical `PARTNER_SLA_BREACH` risk flag.
- Writes an audit log.
- Refreshes stored tenant metrics after the case moves to admin escalation.

How initial tenant SLA is set:

- Borrower unlock requests use `TenantPolicy.escalationRules.tenantSlaHours` if present, otherwise `TenantPolicy.escalationRules.slaHours`, otherwise 24 hours.

How to alter:

- Interval: edit `SCHEDULED_JOB_INTERVALS.slaEscalationMs`.
- Batch size: edit `SCHEDULED_JOB_LIMITS.slaEscalation`.
- Tenant SLA: update `TenantPolicy.escalationRules.slaHours` or `tenantSlaHours` if present in data.
- Partner SLA: update `TenantPolicy.escalationRules.partnerEscalationSlaHours`.

Note: `TenantPolicy.escalationRules.autoEscalateOnSLABreach` exists in the schema, but the current job does not check it. If that flag must disable escalation, update `runSlaEscalationJob`.

## EMI Policy Job

Function:

```js
runEmiPolicyJob({ limit })
```

Runs every 30 minutes.

What it does:

- Scans EMI schedules with unpaid installments due within the upcoming reminder range.
- Queues upcoming EMI notifications 10 days and 5 days before due date.
- Moves pending installments to `overdue` once the due date has passed.
- Recomputes schedule overdue counts, overdue amount, and DPD.
- Moves eligible devices into `GRACE_PERIOD`.
- Queues grace reminder notifications every 12 hours while in grace.
- Locks devices when unpaid EMI exceeds `dpd + gracePeriodDays`.
- Skips devices already `LOCKED`.
- Skips devices in active `TEMP_UNLOCK`.

EMI reminder settings:

```js
EMI_CRON_CONFIG.upcomingPaymentNotifications
```

Current reminder days:

- 10 days before due date.
- 5 days before due date.

Grace reminder interval:

```js
EMI_CRON_CONFIG.graceReminderIntervalMs
```

Current value: 12 hours.

Tenant policy fields used:

- `TenantPolicy.lockRules.dpd`, default 30.
- `TenantPolicy.lockRules.gracePeriodDays`, default 7.
- `TenantPolicy.lockRules.lockOnGraceExpiry`, default true.

Device states/policies affected:

- `GRACE_PERIOD` with policy key `EMI_GRACE`.
- `LOCKED` with policy key `EMI_LOCKED`.

How to alter:

- Interval: edit `SCHEDULED_JOB_INTERVALS.emiPolicyMs`.
- Batch size: edit `SCHEDULED_JOB_LIMITS.emiPolicy`.
- Reminder days/text: edit `EMI_CRON_CONFIG.upcomingPaymentNotifications`.
- Grace reminder frequency: edit `EMI_CRON_CONFIG.graceReminderIntervalMs`.
- DPD/grace/lock rules per tenant: update `TenantPolicy.lockRules`.

## Manual Override Token Renewal Job

Function:

```js
runManualOverrideTokenRenewalJob({ limit })
```

Runs every 24 hours.

What it does:

- Marks expired manual override tokens as `EXPIRED`.
- Scans devices in batches.
- For any device without a valid unused token lasting at least the next renewal window, creates a fresh signed QR token.
- New tokens are valid for the configured token validity window.
- Replaced active tokens are marked `SUPERSEDED`.
- Audit logs are written with `MANUAL_OVERRIDE_TOKEN_RENEWED`.

Current manual override defaults:

- Token validity: 30 days.
- Renewal window: 7 days.
- Batch size: 500 devices per run.

Env knobs:

```text
MANUAL_OVERRIDE_TOKEN_VALIDITY_DAYS=30
MANUAL_OVERRIDE_RENEWAL_WINDOW_DAYS=7
MANUAL_OVERRIDE_ALLOW_INSECURE_KEY_SIZE=false
```

How to alter:

- Timer interval: edit `SCHEDULED_JOB_INTERVALS.manualOverrideTokenRenewalMs`.
- Batch size: edit `SCHEDULED_JOB_LIMITS.manualOverrideTokenRenewal`.
- Token validity: set `MANUAL_OVERRIDE_TOKEN_VALIDITY_DAYS`.
- Renewal window: set `MANUAL_OVERRIDE_RENEWAL_WINDOW_DAYS`.
- Local testing with a 1024-bit RSA key: set `MANUAL_OVERRIDE_ALLOW_INSECURE_KEY_SIZE=true`; keep it `false` in production.

Manual API equivalents:

- `POST /api/admin/manual-override-tokens/backfill`
- `POST /api/admin/manual-override-tokens/renew-expiring`

Use the API with `"dryRun": true` first to estimate impact.

Initial backfill sequence:

1. Configure `MANUAL_OVERRIDE_PRIVATE_KEY`.
2. Call `POST /api/admin/manual-override-tokens/backfill` with `"dryRun": true`.
3. Call the same API with `"dryRun": false`.
4. Repeat in batches until `created` is `0`.
5. Verify `manualoverridetokens` in MongoDB Compass.

If backfill fails with `secretOrPrivateKey must be an asymmetric key when using RS256`, the private key env is not being parsed as a PEM private key. Store `MANUAL_OVERRIDE_PRIVATE_KEY` as one single-line env value with literal `\n` separators.

If backfill fails with `minimum key size of 2048 bits`, verify the actual loaded key size from the `backend` folder:

```bash
node -e "require('dotenv').config(); const crypto=require('crypto'); let k=process.env.MANUAL_OVERRIDE_PRIVATE_KEY.trim(); if ((k.startsWith('\"') && k.endsWith('\"')) || (k.startsWith(\"'\") && k.endsWith(\"'\"))) k=k.slice(1,-1).trim(); k=k.replace(/\\\\n/g,'\n'); const key=crypto.createPrivateKey({key:k,format:'pem'}); console.log(key.asymmetricKeyType, key.asymmetricKeyDetails);"
```

The output must show `modulusLength: 2048` or higher for production RS256 signing.

## Tenant Metrics Reconciliation Job

Function:

```js
runTenantMetricsReconciliationJob({ limit })
```

Runs every 24 hours.

What it does:

- Scans tenant documents.
- Recomputes stored tenant metrics from source collections.
- Updates `Tenant.metrics.borrowers.total` from borrower records.
- Updates `Tenant.metrics.devices.total` from device records.
- Updates `Tenant.metrics.cases.open` from open unlock request statuses.
- Updates `Tenant.metrics.cases.escalatedToPartner` from cases currently waiting for partner action.
- Sets `Tenant.metrics.updatedAt`.

Why it exists:

- Most write paths refresh tenant metrics immediately after successful changes.
- This daily job repairs older tenant records and any count drift caused by failed post-commit metric refreshes.

How to alter:

- Timer interval: edit `SCHEDULED_JOB_INTERVALS.tenantMetricsReconciliationMs`.
- Batch size: edit `SCHEDULED_JOB_LIMITS.tenantMetricsReconciliation`.

## Operational Notes

Logs:

- Every timed job logs start, finish, duration, and result.
- Failures log message and stack.
- Overlapping runs are skipped per job name.

Vercel:

- `server.js` does not start timers when `VERCEL=true`.
- In Vercel/serverless deployments, these jobs need an external scheduler calling `npm run jobs:scheduled` or equivalent job endpoints/scripts.

Safe alteration process:

1. Change interval/limit/policy/env setting.
2. Restart the backend worker/API process.
3. Run `npm run jobs:scheduled` in a non-production environment.
4. Check logs and affected collections.
5. Deploy to production.

Recommended manual checks:

- `deviceCommands` for queued/sent/failed policy commands.
- `fcmDeliveryLogs` for FCM delivery results.
- `unlockRequests` for SLA status changes.
- `riskFlags` for SLA breach records.
- `devices` for state, policy, and `tempUnlockExpiresAt`.
- `manualoverridetokens` for QR token status and expiry.
- `tenants.metrics` for partner app tenant-level metric counts.
