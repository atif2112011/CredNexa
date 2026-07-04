# Notification System

This document is the system-level reference for EMI Shield backend notifications.

For the tenant and partner app FCM integration contract, also see:

```text
tenant_partner_notification_contract.md
```

## Notification Architecture

The backend has two notification delivery paths.

### 1. Borrower Device Notifications

Borrower notifications are queued as `DeviceCommand` records.

Collection:

```text
devicecommands
```

Model:

```text
backend/src/models/DeviceCommand.js
```

Delivery worker:

```text
backend/src/jobs/fcmDeliveryWorker.js
runFcmDeliveryBatch()
```

Supported notification-style borrower command types:

```text
NOTIFICATION
UPCOMING_PAYMENT
```

`NOTIFICATION` commands create visible FCM notifications with:

```json
{
  "type": "NOTIFICATION",
  "commandId": "deviceCommandId",
  "commandType": "NOTIFICATION",
  "notificationType": "CUSTOM",
  "title": "Notification title",
  "text": "Notification body"
}
```

Extra fields from `command.payload.data` are merged into the FCM `data` payload. Non-string values are JSON stringified.

Android channel:

```text
custom_notifications
```

`UPCOMING_PAYMENT` commands are data-only FCM messages with:

```json
{
  "type": "UPCOMING_PAYMENT",
  "commandId": "deviceCommandId",
  "commandType": "UPCOMING_PAYMENT",
  "installmentId": "installmentId",
  "installmentNumber": "1",
  "dueDate": "2026-07-01T00:00:00.000Z",
  "outstandingAmount": "2500"
}
```

### 2. Tenant And Partner App Notifications

Tenant and partner app notifications are queued as `AppNotificationJob` records.

Collection:

```text
appnotificationjobs
```

Models:

```text
backend/src/models/AppNotificationJob.js
backend/src/models/AccountPushToken.js
```

Delivery worker:

```text
backend/src/jobs/fcmDeliveryWorker.js
runAppNotificationDeliveryBatch()
```

Target apps:

```text
tenant_app
partner_app
```

Recipients:

```text
tenant_admin
partner_admin
```

FCM payload shape:

```json
{
  "notification": {
    "title": "Notification title",
    "body": "Notification body"
  },
  "data": {
    "type": "APP_NOTIFICATION",
    "notificationJobId": "jobId",
    "notificationType": "CUSTOM",
    "targetApp": "tenant_app",
    "title": "Notification title",
    "text": "Notification body"
  }
}
```

Extra fields from `AppNotificationJob.data` are merged into the FCM `data` payload. Non-string values are JSON stringified.

Android channel:

```text
app_notifications
```

## Delivery Logs

Every FCM attempt writes to:

```text
fcmdeliverylogs
```

Model:

```text
backend/src/models/FcmDeliveryLog.js
```

Useful fields:

```text
deviceId
commandId
notificationJobId
accountId
accountPushTokenId
tenantId
channelPartnerId
targetApp
recipientType
notificationType
messageType
status
providerMessageId
error
metadata
```

## Firebase And Mock Mode

FCM delivery uses mock mode unless:

```text
FCM_MOCK_MODE=false
```

When mock mode is enabled, delivery workers mark messages as sent with mock provider IDs instead of calling Firebase.

Firebase Admin configuration is loaded from one of these options:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
```

or:

```text
FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY
```

`FIREBASE_ADMIN_PRIVATE_KEY` should use literal `\n` separators if stored as a single-line env value.

If neither service-account option is set and `FCM_MOCK_MODE=false`, Firebase Admin falls back to application default credentials.

## Triggered Notifications

| Notification | Target App | Queue | Trigger Source | Delivery | Audit |
| --- | --- | --- | --- | --- | --- |
| `UPCOMING_EMI` | Borrower App | `DeviceCommand` `NOTIFICATION` | `runEmiPolicyJob` | FCM delivery cron | none |
| `GRACE_PERIOD_REMINDER` | Borrower App | `DeviceCommand` `NOTIFICATION` | `runEmiPolicyJob` | FCM delivery cron | none |
| `UPCOMING_PAYMENT` | Borrower App | `DeviceCommand` `UPCOMING_PAYMENT` | `POST /api/tenant/devices/:id/upcoming-payment-reminder` | FCM delivery cron | `DEVICE_COMMAND_CREATED` |
| `OVERDUE_EMI_REMINDER` | Borrower App | `DeviceCommand` `NOTIFICATION` | `POST /api/tenant/users/:userId/overdue-emi-reminder` or bulk reminder API | FCM delivery cron | `DEVICE_COMMAND_CREATED` |
| `PAYMENT_APPROVED` | Borrower App | `DeviceCommand` `NOTIFICATION` | `POST /api/tenant/payments/:paymentId/approve` | FCM delivery cron | `PAYMENT_APPROVED`, `UNLOCK_TRIGGERED` |
| `PAYMENT_REJECTED` | Borrower App | `DeviceCommand` `NOTIFICATION` | `POST /api/tenant/payments/:paymentId/reject` | FCM delivery cron | `PAYMENT_REJECTED` |
| `PAYMENT_SUBMITTED` | Tenant App | `AppNotificationJob` | Borrower submits a payment approval request | FCM delivery cron | `PAYMENT_SUBMITTED` |
| `UNLOCK_REQUEST_CREATED` | Tenant App | `AppNotificationJob` | Borrower creates unlock request | FCM delivery cron | `UNLOCK_REQUEST_CREATED` |
| `UNLOCK_REQUEST_ESCALATED_TO_PARTNER` | Tenant App | `AppNotificationJob` | SLA escalation job | FCM delivery cron | `SLA_BREACHED` |
| `UNLOCK_REQUEST_ESCALATED_TO_PARTNER` | Partner App | `AppNotificationJob` | SLA escalation job | FCM delivery cron | `SLA_BREACHED` |
| `TENANT_CREDIT_PURCHASE_APPROVED` | Tenant App | `AppNotificationJob` | Super admin approves tenant key purchase | FCM delivery cron | `TENANT_CREDIT_PURCHASE_APPROVED` |
| `TENANT_CREDIT_PURCHASE_REJECTED` | Tenant App | `AppNotificationJob` | Super admin rejects tenant key purchase | FCM delivery cron | `TENANT_CREDIT_PURCHASE_REJECTED` |
| `PARTNER_PAYOUT_APPROVED` | Partner App | `AppNotificationJob` | Super admin approves partner payout | FCM delivery cron | `PARTNER_PAYOUT_APPROVED` |
| `PARTNER_PAYOUT_REJECTED` | Partner App | `AppNotificationJob` | Super admin rejects partner payout | FCM delivery cron | `PARTNER_PAYOUT_REJECTED` |
| `CUSTOM` | Borrower App | `DeviceCommand` `NOTIFICATION` | Super admin custom notification API | Immediate delivery attempt, then normal retry queue | `CUSTOM_NOTIFICATION_QUEUED` |
| `CUSTOM` | Tenant App | `AppNotificationJob` | Super admin custom notification API | FCM delivery cron | `CUSTOM_NOTIFICATION_QUEUED` |
| `CUSTOM` | Partner App | `AppNotificationJob` | Super admin custom notification API | FCM delivery cron | `CUSTOM_NOTIFICATION_QUEUED` |

## Notification Details

### `UPCOMING_EMI`

Created by:

```text
runEmiPolicyJob()
```

When:

- EMI installment is unpaid.
- Due date is exactly one configured reminder day away.
- Current configured reminder days are 10 and 5 days before due date.
- Device has an FCM token.
- No existing reminder command exists for the same device, installment, and reminder day.

Queue:

```text
DeviceCommand.commandType = "NOTIFICATION"
DeviceCommand.payload.notificationType = "UPCOMING_EMI"
DeviceCommand.triggeredBy = "auto_policy"
```

Payload fields:

```text
title
text
installmentId
installmentNumber
dueDate
reminderDays
outstandingAmount
```

Current titles/text:

```text
10 days: EMI due in 10 days / Your EMI is due in 10 days. Please pay on time to avoid restrictions.
5 days: EMI due in 5 days / Your EMI is due in 5 days. Please complete the payment soon.
```

How to edit reminder days/text:

```text
backend/src/jobs/scheduledJobs.js
EMI_CRON_CONFIG.upcomingPaymentNotifications
```

### `GRACE_PERIOD_REMINDER`

Created by:

```text
runEmiPolicyJob()
```

When:

- Borrower is inside the EMI grace window.
- The device is active or moved into `GRACE_PERIOD`.
- Device has an FCM token.
- No grace reminder was sent for the same installment within the configured interval.

Queue:

```text
DeviceCommand.commandType = "NOTIFICATION"
DeviceCommand.payload.notificationType = "GRACE_PERIOD_REMINDER"
DeviceCommand.triggeredBy = "auto_policy"
```

Payload fields:

```text
title
text
installmentId
installmentNumber
dueDate
graceStartedAt
graceExpiresAt
outstandingAmount
```

Current title/text:

```text
EMI overdue / Your EMI is overdue. Please pay before the grace period ends to avoid device restrictions.
```

Current repeat interval:

```text
EMI_CRON_CONFIG.graceReminderIntervalMs = 12 hours
```

### `UPCOMING_PAYMENT`

Created by tenant API:

```text
POST /api/tenant/devices/:id/upcoming-payment-reminder
```

Request body:

```json
{
  "windowDays": 7,
  "note": "Reminder before due date"
}
```

When:

- Tenant admin targets a device.
- Device belongs to the tenant.
- Borrower has a pending or partial EMI due within `windowDays`.

Queue:

```text
DeviceCommand.commandType = "UPCOMING_PAYMENT"
DeviceCommand.triggeredBy = "manual_tenant"
```

Payload fields:

```text
note
windowDays
emiScheduleId
installmentId
installmentNumber
dueDate
emiAmount
penaltyAmount
outstandingAmount
```

Delivery:

- Data-only FCM message.
- Delivered by `fcmDeliveryJob`.

Audit:

```text
DEVICE_COMMAND_CREATED
```

### `OVERDUE_EMI_REMINDER`

Created by tenant APIs:

```text
POST /api/tenant/users/:userId/overdue-emi-reminder
POST /api/tenant/users/overdue-emis/reminders
```

Single reminder request body:

```json
{
  "note": "Please clear your overdue EMI to avoid device restrictions."
}
```

Bulk reminder request body:

```json
{
  "userIds": ["665f..."],
  "limit": 100,
  "note": "Please clear your overdue EMI to avoid device restrictions."
}
```

When:

- Borrower belongs to the tenant.
- Borrower has at least one overdue EMI.
- Borrower has a registered device with an FCM token.

Overdue definition:

```text
installment.status === "overdue"
or status is "pending"/"partial" and dueDate < now
```

Queue:

```text
DeviceCommand.commandType = "NOTIFICATION"
DeviceCommand.payload.notificationType = "OVERDUE_EMI_REMINDER"
DeviceCommand.triggeredBy = "manual_tenant"
```

Payload fields:

```text
title
text
userId
deviceId
overdueInstallmentCount
totalOutstandingAmount
installmentIds
note
```

Delivery:

- Visible borrower notification.
- Delivered by `fcmDeliveryJob`.

Audit:

```text
DEVICE_COMMAND_CREATED
```

### `PAYMENT_APPROVED`

Created by tenant API:

```text
POST /api/tenant/payments/:paymentId/approve
```

When:

- Tenant admin approves a pending borrower QR payment.
- The payment is applied to the EMI schedule.
- The backend queues the related device unlock command.

Queue:

```text
DeviceCommand.commandType = "NOTIFICATION"
DeviceCommand.payload.notificationType = "PAYMENT_APPROVED"
DeviceCommand.triggeredBy = "manual_tenant"
```

Payload fields:

```text
paymentId
deviceId
userId
matchedInstallments
unlockCommandId
```

Current title/text:

```text
Payment approved / Your payment has been approved and your device unlock is being processed.
```

Delivery:

- Visible borrower notification.
- Delivered by `fcmDeliveryJob`.

Audit:

```text
PAYMENT_APPROVED
UNLOCK_TRIGGERED
```

### `PAYMENT_REJECTED`

Created by tenant API:

```text
POST /api/tenant/payments/:paymentId/reject
```

When:

- Tenant admin rejects a pending borrower QR payment.

Queue:

```text
DeviceCommand.commandType = "NOTIFICATION"
DeviceCommand.payload.notificationType = "PAYMENT_REJECTED"
DeviceCommand.triggeredBy = "manual_tenant"
```

Payload fields:

```text
paymentId
deviceId
userId
rejectionReason
```

Current title/text:

```text
Payment rejected / Your payment was rejected. Please review the reason and submit again if needed.
```

Delivery:

- Visible borrower notification.
- Delivered by `fcmDeliveryJob`.

Audit:

```text
PAYMENT_REJECTED
```

### `UNLOCK_REQUEST_CREATED`

Created by borrower API:

```text
POST /api/app/unlock-request
```

When:

- Borrower creates an unlock request.
- This also covers temporary unlock requests submitted from the borrower app by using `reasonCategory: "temporary_emergency"`.
- Tenant admins for the borrower tenant have active tenant-app push tokens.

Queue:

```text
AppNotificationJob.targetApp = "tenant_app"
AppNotificationJob.notificationType = "UNLOCK_REQUEST_CREATED"
```

Payload fields:

```text
caseId
unlockRequestId
deviceId
userId
tenantId
reasonCategory
slaDeadline
```

Audit:

```text
UNLOCK_REQUEST_CREATED
```

### `PAYMENT_SUBMITTED`

Created by borrower API:

```text
POST /api/app/payment/submit
```

When:

- Borrower submits a payment proof request for tenant approval.
- Tenant admins for the borrower tenant have active tenant-app push tokens.

Queue:

```text
AppNotificationJob.targetApp = "tenant_app"
AppNotificationJob.notificationType = "PAYMENT_SUBMITTED"
```

Payload fields:

```text
paymentId
tenantId
userId
deviceId
amount
reference
```

Current title/text:

```text
New payment approval request / A borrower payment has been submitted for review.
```

Audit:

```text
PAYMENT_SUBMITTED
```

### `UNLOCK_REQUEST_ESCALATED_TO_PARTNER`

Created by:

```text
runSlaEscalationJob()
```

When:

- Unlock request has `status: "PENDING_TENANT"`.
- `slaDeadline <= now`.
- SLA job changes status to `ESCALATED_PARTNER`.

Queues:

```text
Tenant App:
AppNotificationJob.targetApp = "tenant_app"

Partner App:
AppNotificationJob.targetApp = "partner_app"
```

Notification type:

```text
UNLOCK_REQUEST_ESCALATED_TO_PARTNER
```

Payload fields:

```text
caseId
unlockRequestId
tenantId
channelPartnerId
deviceId
userId
partnerSlaDeadline
```

Audit:

```text
SLA_BREACHED
```

### `TENANT_CREDIT_PURCHASE_APPROVED`

Created by admin API:

```text
POST /api/admin/tenant-credit-purchases/:requestId/approve
```

Queue:

```text
AppNotificationJob.targetApp = "tenant_app"
AppNotificationJob.notificationType = "TENANT_CREDIT_PURCHASE_APPROVED"
```

Payload fields:

```text
creditPurchaseRequestId
requestedCredits
purchaseAmount
tenantCreditLedgerId
```

Audit:

```text
TENANT_CREDIT_PURCHASE_APPROVED
```

### `TENANT_CREDIT_PURCHASE_REJECTED`

Created by admin API:

```text
POST /api/admin/tenant-credit-purchases/:requestId/reject
```

Queue:

```text
AppNotificationJob.targetApp = "tenant_app"
AppNotificationJob.notificationType = "TENANT_CREDIT_PURCHASE_REJECTED"
```

Payload fields:

```text
creditPurchaseRequestId
requestedCredits
purchaseAmount
rejectionReason
```

Audit:

```text
TENANT_CREDIT_PURCHASE_REJECTED
```

### `PARTNER_PAYOUT_APPROVED`

Created by admin API:

```text
POST /api/admin/partner-payouts/:payoutId/approve
```

Queue:

```text
AppNotificationJob.targetApp = "partner_app"
AppNotificationJob.notificationType = "PARTNER_PAYOUT_APPROVED"
```

Payload fields:

```text
payoutRequestId
amount
referenceId
ledgerEntryId
```

Audit:

```text
PARTNER_PAYOUT_APPROVED
```

### `PARTNER_PAYOUT_REJECTED`

Created by admin API:

```text
POST /api/admin/partner-payouts/:payoutId/reject
```

Queue:

```text
AppNotificationJob.targetApp = "partner_app"
AppNotificationJob.notificationType = "PARTNER_PAYOUT_REJECTED"
```

Payload fields:

```text
payoutRequestId
amount
rejectionReason
ledgerEntryId
```

Audit:

```text
PARTNER_PAYOUT_REJECTED
```

## Custom Notification Flow

Custom notifications are super-admin only.

Routes:

```text
GET /api/admin/notifications/targets
POST /api/admin/notifications/custom
```

Valid target apps:

```text
borrower_app
tenant_app
partner_app
```

### List Targets

Endpoint:

```text
GET /api/admin/notifications/targets?targetApp=borrower_app
```

Response:

```json
{
  "success": true,
  "message": "Notification targets fetched successfully",
  "data": {
    "targetApp": "borrower_app",
    "items": [
      { "id": "all", "label": "All" },
      { "id": "665f...", "label": "Borrower Name - Tenant Name" }
    ]
  }
}
```

Target behavior:

- `borrower_app`: returns active borrowers that have registered devices with FCM tokens.
- `tenant_app`: returns active tenants.
- `partner_app`: returns active channel partners.
- The response always includes `{ "id": "all", "label": "All" }`.

### Send Custom Notification

Endpoint:

```text
POST /api/admin/notifications/custom
```

Request:

```json
{
  "targetApp": "borrower_app",
  "targetId": "all",
  "title": "Payment reminder",
  "text": "Your EMI is due soon"
}
```

Validation:

```text
title required, non-empty, max 120 characters
text required, non-empty, max 1000 characters
targetApp optional, defaults to borrower_app
targetId optional, defaults to all
```

Legacy borrower scoping:

```json
{
  "targetApp": "borrower_app",
  "tenantId": "665f...",
  "title": "Message",
  "text": "Message body"
}
```

If `targetApp` is `borrower_app` and `tenantId` is present with no specific `targetId`, the backend sends to active borrowers in that tenant with registered device FCM tokens.

### Borrower Custom Notification

Target app:

```text
borrower_app
```

Queue:

```text
DeviceCommand.commandType = "NOTIFICATION"
DeviceCommand.payload.notificationType = "CUSTOM"
DeviceCommand.triggeredBy = "super_admin"
```

Delivery:

- The API creates `DeviceCommand` rows.
- The API immediately calls `runFcmDeliveryBatch()` for those command IDs.
- If immediate delivery fails, failed commands remain in the normal device command retry queue.

Success response includes:

```text
targetDeviceCount
queuedCommandCount
deliveryAttempted: true
deliverySummary
deliveryResults
```

Audit:

```text
CUSTOM_NOTIFICATION_QUEUED
```

### Tenant App Custom Notification

Target app:

```text
tenant_app
```

Queue:

```text
AppNotificationJob.targetApp = "tenant_app"
AppNotificationJob.notificationType = "CUSTOM"
```

Delivery:

- The API creates `AppNotificationJob` rows for active tenant admin accounts with active tenant-app push tokens.
- Delivery is not attempted inside the request.
- Jobs are delivered by `fcmDeliveryJob`.

Success response includes:

```text
targetTenantCount
targetAccountCount
queuedJobCount
deliveryAttempted: false
```

Audit:

```text
CUSTOM_NOTIFICATION_QUEUED
```

### Partner App Custom Notification

Target app:

```text
partner_app
```

Queue:

```text
AppNotificationJob.targetApp = "partner_app"
AppNotificationJob.notificationType = "CUSTOM"
```

Delivery:

- The API creates `AppNotificationJob` rows for active partner admin accounts with active partner-app push tokens.
- Delivery is not attempted inside the request.
- Jobs are delivered by `fcmDeliveryJob`.

Success response includes:

```text
targetPartnerCount
targetAccountCount
queuedJobCount
deliveryAttempted: false
```

Audit:

```text
CUSTOM_NOTIFICATION_QUEUED
```

## Cron Jobs Responsible For Notifications

The backend uses in-process scheduled timers from:

```text
backend/src/jobs/scheduledJobs.js
```

Timers start from:

```text
backend/src/server.js
```

Timers do not start when:

```text
VERCEL=true
```

### `fcmDeliveryJob`

Function:

```js
runAllFcmDeliveryBatches({ limit })
```

Interval:

```text
SCHEDULED_JOB_INTERVALS.fcmDeliveryMs = 5 minutes
```

Batch limit:

```text
SCHEDULED_JOB_LIMITS.fcmDelivery = 100
```

What it does:

- Runs `runFcmDeliveryBatch()` for borrower `DeviceCommand` records.
- Runs `runAppNotificationDeliveryBatch()` for tenant/partner `AppNotificationJob` records.
- Writes `FcmDeliveryLog` records.
- Updates queue status fields.

### `emiPolicyJob`

Function:

```js
runEmiPolicyJob({ limit })
```

Interval:

```text
SCHEDULED_JOB_INTERVALS.emiPolicyMs = 30 minutes
```

Batch limit:

```text
SCHEDULED_JOB_LIMITS.emiPolicy = 500
```

Notifications created:

```text
UPCOMING_EMI
GRACE_PERIOD_REMINDER
```

Timing constants:

```js
EMI_CRON_CONFIG.upcomingPaymentNotifications = {
  10: {
    title: "EMI due in 10 days",
    text: "Your EMI is due in 10 days. Please pay on time to avoid restrictions."
  },
  5: {
    title: "EMI due in 5 days",
    text: "Your EMI is due in 5 days. Please complete the payment soon."
  }
}

EMI_CRON_CONFIG.graceReminderIntervalMs = 12 * 60 * 60 * 1000
```

### `slaEscalationJob`

Function:

```js
runSlaEscalationJob({ limit })
```

Interval:

```text
SCHEDULED_JOB_INTERVALS.slaEscalationMs = 30 minutes
```

Batch limit:

```text
SCHEDULED_JOB_LIMITS.slaEscalation = 200
```

Notifications created:

```text
UNLOCK_REQUEST_ESCALATED_TO_PARTNER
```

Related tenant policy timing:

```text
TenantPolicy.escalationRules.tenantSlaHours
TenantPolicy.escalationRules.slaHours
TenantPolicy.escalationRules.partnerEscalationSlaHours
```

The borrower unlock request initially uses `tenantSlaHours`, then `slaHours`, then a 24-hour fallback. Partner escalation SLA defaults to 48 hours if the tenant policy does not define `partnerEscalationSlaHours`.

## How To Edit Time Constants

Main file:

```text
backend/src/jobs/scheduledJobs.js
```

Edit timer intervals in:

```js
SCHEDULED_JOB_INTERVALS
```

Edit batch limits in:

```js
SCHEDULED_JOB_LIMITS
```

Edit EMI reminder days/text and grace reminder frequency in:

```js
EMI_CRON_CONFIG
```

After editing:

1. Restart or redeploy the backend.
2. Run one non-production manual pass:

```bash
cd backend
npm run jobs:scheduled
```

3. Check:

```text
devicecommands
appnotificationjobs
fcmdeliverylogs
auditlogs
```

## Retry Behavior

### Borrower `DeviceCommand`

Eligible for delivery when:

```text
status is pending or failed
retryCount < 5
nextRetryAt is missing/null or <= now
```

On missing device FCM token:

- Command becomes `failed`.
- `retryCount` increments.
- `nextRetryAt` is set 5 minutes later.
- `FcmDeliveryLog.status = "skipped"`.

On FCM failure:

- Command becomes `failed`.
- `retryCount` increments.
- `nextRetryAt` is set to `(retryCount + 1) * 5 minutes`, capped by current worker logic at 25 minutes.
- `FcmDeliveryLog.status = "failed"`.

On success:

- Command becomes `sent`.
- `sentAt` is set.
- `fcmMessageId` is stored.
- `FcmDeliveryLog.status = "sent"`.

### Tenant/Partner `AppNotificationJob`

Eligible for delivery when:

```text
status is pending or failed
retryCount < maxRetries
nextRetryAt is missing/null or <= now
```

Default max retries:

```text
AppNotificationJob.maxRetries = 5
```

On no active account push token:

- Job becomes `skipped`.
- `failureReason = "Active account FCM token not found"`.
- `FcmDeliveryLog.status = "skipped"`.

On invalid FCM token:

- The related `AccountPushToken` is deactivated.
- Delivery attempt is logged.
- Job may retry if no token succeeded.

On success:

- Job becomes `sent`.
- `sentAt` is set.
- `FcmDeliveryLog.status = "sent"`.

## Important Collections

Inspect these collections when debugging notifications:

```text
devicecommands
appnotificationjobs
accountpushtokens
fcmdeliverylogs
auditlogs
devices
users
tenants
channelpartners
```

## Troubleshooting

### Notification Queued But Not Delivered Yet

Check:

```text
fcmDeliveryJob interval
devicecommands.status or appnotificationjobs.status
nextRetryAt
retryCount
```

Tenant and partner app notifications are normally delivered by `fcmDeliveryJob`, not inside the API request.

### Borrower Device Has No FCM Token

Check:

```text
devices.fcmToken
devices.fcmTokenUpdatedAt
```

The borrower app must register or refresh the FCM token through the borrower device registration/sync flow.

### Tenant Or Partner Account Has No Active Push Token

Check:

```text
accountpushtokens
targetApp
accountId
isActive
tokenHash
```

Tenant app accounts must register `targetApp: "tenant_app"`.

Partner app accounts must register `targetApp: "partner_app"`.

### Mock Mode Is Enabled

If:

```text
FCM_MOCK_MODE is not exactly false
```

then the backend does not call Firebase. The delivery workers still mark messages as sent with mock provider IDs.

For real FCM delivery:

```text
FCM_MOCK_MODE=false
```

and configure Firebase Admin credentials.

### Firebase Admin Env Missing Or Invalid

Check one of these setups:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
```

or:

```text
FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY
```

If using `FIREBASE_ADMIN_PRIVATE_KEY` in `.env`, preserve line breaks as literal `\n` separators.

### Invalid Tokens Are Being Deactivated

The app notification worker deactivates invalid `AccountPushToken` records. If tenant/partner notifications stop reaching a device, re-register the FCM token from the app.

## Useful Manual Commands

Run one full scheduled pass:

```bash
cd backend
npm run jobs:scheduled
```

Run only the FCM worker:

```bash
cd backend
npm run worker:fcm
```

Search queued notifications in MongoDB Compass:

```text
devicecommands: { status: { $in: ["pending", "failed"] } }
appnotificationjobs: { status: { $in: ["pending", "failed"] } }
fcmdeliverylogs: sort by createdAt desc
```
