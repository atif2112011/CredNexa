# Tenant Mode

## Purpose

Tenant mode decides whether borrower devices follow the EMI automation pipeline or are controlled manually by the tenant. The choice is made when a tenant is created and cannot be changed afterward.

The legacy `TenantPolicy.lockRules.lockOnGraceExpiry` field remains supported. It controls the final scheduled EMI lock only for an `EMI_AUTOMATED` tenant.

## Modes

| Behaviour | `EMI_AUTOMATED` | `MANUAL` |
|---|---|---|
| Internal EMI schedule and overdue calculations | Enabled | Enabled |
| Upcoming and overdue EMI reminders | Enabled | Disabled |
| Grace-period device transitions | Enabled | Disabled |
| Scheduled EMI lock | Controlled by `lockOnGraceExpiry` | Disabled |
| Borrower EMI details | Visible | Hidden |
| Borrower payment submission and history | Enabled | Disabled |
| Payment-approval unlock/release | Enabled | Disabled |
| Tenant manual lock, unlock, and temporary unlock | Enabled | Enabled |
| Borrower unlock request | Enabled | Enabled |

Risk-based auto-lock remains separately controlled by `TenantPolicy.riskRules` and is not changed by tenant mode.

## Storage

The mode is stored in `TenantPolicy`:

```json
{
  "deviceControlRules": {
    "mode": "MANUAL"
  },
  "lockRules": {
    "dpd": 0,
    "gracePeriodDays": 7,
    "lockOnGraceExpiry": true
  }
}
```

Valid values:

- `EMI_AUTOMATED`
- `MANUAL`

If the mode is missing on a legacy policy, the backend treats it as `EMI_AUTOMATED`.

### Legacy lock semantics

The effective scheduled EMI lock rule is:

```text
mode == EMI_AUTOMATED AND lockOnGraceExpiry != false
```

Consequently:

- `EMI_AUTOMATED` plus `lockOnGraceExpiry: false` keeps borrower EMI/payment features but disables the final scheduled lock.
- `MANUAL` disables all borrower-facing EMI automation regardless of the stored legacy flag.

## Tenant creation API

`deviceControlMode` is required when a tenant is created through the super-admin or partner API.

Example:

```json
{
  "name": "Manual Device Outlet",
  "type": "standalone_outlet",
  "deviceControlMode": "MANUAL",
  "channelPartnerId": "<partner-id>",
  "supportPhone": "9876543210",
  "pocName": "Operations Manager",
  "pocPhone": "9876543210",
  "pocDesignation": "Manager",
  "address": {
    "street": "Main Road",
    "city": "Pune",
    "district": "Pune",
    "state": "Maharashtra",
    "pincode": "411001"
  }
}
```

An invalid or missing value returns HTTP `400`.

The super-admin tenant creation form exposes the same required selection and warns that it is permanent. Tenant edit APIs and forms do not permit changing it.

## Borrower app configuration

The backend derives the following configuration for a manual tenant:

```json
{
  "appConfig": {
    "deviceControlMode": "MANUAL",
    "showEmiDetails": false,
    "paymentSubmissionEnabled": false,
    "showPaymentHistory": false,
    "emiNotificationsEnabled": false,
    "unlockRequestEnabled": true
  }
}
```

`appConfig` is returned through the normal device lifecycle rather than through a tenant-mode notification:

- Device registration
- Device policy fetch
- Device login/sync state
- Device ping
- Device sync
- Borrower dashboard
- Tenant utility response

Because mode is immutable and chosen before borrowers are enrolled, no linked-device notification or configuration-change command is required.

The borrower app should persist the last received configuration and use it after app or device restarts. In manual mode it should hide EMI amounts, schedules, due dates, payment history, and Pay Now. A manually locked screen should direct the borrower to the tenant and may continue to expose Request Unlock.

## Borrower API enforcement

Manual-mode tenants cannot call borrower EMI/payment routes. The backend returns HTTP `403` even if an older borrower app displays a stale control.

Disabled EMI routes:

```text
GET /api/app/installments
GET /api/app/installments/:installmentId
```

Error code:

```text
BORROWER_EMI_FEATURE_DISABLED
```

Disabled payment routes:

```text
GET  /api/app/payment/qr
POST /api/app/payment/submit
GET  /api/app/payment/history
GET  /api/app/payment/:paymentId
```

Error code:

```text
BORROWER_PAYMENT_FEATURE_DISABLED
```

The manual lock APIs remain available:

```text
POST /api/distributor/devices/:id/lock
POST /api/distributor/devices/:id/unlock
POST /api/distributor/devices/:id/temp-unlock
```

These APIs continue to update the desired device state, policy, policy version, command record, and audit trail. Updating `Device.state` alone is not sufficient.

## Tenant mark-paid API

A tenant can mark one specific EMI installment paid. Intermediate installment payments do not change device state or schedule a command:

```text
POST /api/distributor/users/:userId/emi-installments/:installmentId/mark-paid
```

Request:

```json
{
  "reason": "Payment received offline",
  "reference": "CASH-2026-001",
  "paidAt": "2026-08-09T10:00:00.000Z"
}
```

`reason` is required. `reference` and `paidAt` are optional. The endpoint marks the complete outstanding installment amount paid, records the tenant account and reason, recalculates overdue totals and DPD, clears that installment's grace-reminder history, and writes an audit log.

If it completes the final unpaid installment, the update and permanent release are atomic: the EMI schedule becomes `settled`, existing active management commands are superseded, the device moves to `RELEASE_PENDING`, and one `RELEASE_DEVICE` command is queued. The response returns `commandScheduled: true` and the release command summary. If no linked device exists or release cannot be queued, the entire mark-paid transaction is rolled back.

## Scheduler behaviour

For manual tenants, the EMI policy job continues to maintain financial records:

- Pending installments can become overdue.
- DPD is recalculated.
- Overdue installment count and amount are recalculated.

It skips borrower/device automation:

- No upcoming EMI reminder.
- No overdue/grace reminder.
- No `GRACE_PERIOD` transition.
- No `EMI_GRACE` policy update.
- No automatic EMI `LOCK` command.

`scheduledLockAt` is `null` for manual tenants. Automatic tenants preserve the existing `lockOnGraceExpiry` behaviour.

## Payment approval

Payment approval is rejected for a manual tenant before any payment, schedule, command, or release mutation occurs.

Error code:

```text
PAYMENT_APPROVAL_DISABLED
```

Manual tenants handle payments outside the borrower payment workflow and explicitly unlock devices through the manual unlock API. Permanent release for manual tenants, if required by the product, should be implemented as a separate explicit workflow.

## Migration

Existing tenant policies must be backfilled as `EMI_AUTOMATED` without inspecting or changing `lockOnGraceExpiry`:

```powershell
npm run migrate:tenant-device-control-mode
```

This preserves both legacy cases:

- Existing automatic tenants with scheduled locking enabled.
- Existing automatic tenants that disabled only the final scheduled lock.

## Rollout

1. Deploy the backend schema, responses, and route enforcement.
2. Run the tenant-mode migration.
3. Release a borrower app that handles and persists `appConfig`.
4. Deploy the updated super-admin tenant creation form.
5. Enable manual tenant creation only after the compatible borrower app is available.
6. Verify manual lock/unlock while online, offline, after reboot, and after app restart.
