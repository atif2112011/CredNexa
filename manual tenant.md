# Manual Tenant App

## Purpose

Every tenant has one permanent device-control mode:

- `EMI_AUTOMATED` (shown as **Automatic**): the EMI scheduler can send reminders, move devices through grace, and lock devices according to the tenant policy. The legacy `lockOnGraceExpiry` setting continues to decide whether the final automatic EMI lock occurs.
- `MANUAL` (shown as **Manual**): the tenant records EMI payments and controls device locking from the tenant app. Borrower EMI details and borrower payment options are not shown.

The mode is selected when the tenant is created. The tenant app must display it, but must not provide a control to change it.

## How the tenant app gets the mode

Use the authenticated tenant dashboard request when the app starts, after login, and after a full refresh:

```http
GET /api/distributor/dashboard
Authorization: Bearer <tenant-access-token>
```

The dashboard response must include `data.deviceControlMode`:

```json
{
  "success": true,
  "message": "Dashboard fetched successfully",
  "data": {
    "deviceControlMode": "MANUAL",
    "totalBorrowers": 25,
    "borrowersRegisteredToday": 1,
    "credits": {
      "available": 120
    },
    "devices": {
      "activated": 21,
      "pendingActivation": 4,
      "byState": {
        "ACTIVE": 17,
        "LOCKED": 4
      }
    }
  }
}
```

Valid values are only `EMI_AUTOMATED` and `MANUAL`. If an older backend response omits the field, the app must temporarily fall back to `EMI_AUTOMATED` so legacy tenants keep their existing behavior.

The backend resolves `TenantPolicy.deviceControlRules.mode` for this field. A missing legacy value resolves to `EMI_AUTOMATED`.

The mode is immutable, so a dedicated mode-change event or notification is not required. Keep it in the authenticated app state and refresh it with the dashboard.

## Sidebar

Show the mode in the tenant app sidebar near the tenant name or account section:

- `MANUAL` -> **Manual mode** badge
- `EMI_AUTOMATED` -> **Automatic mode** badge

This is a read-only label, not a switch. Add a short tooltip:

- Manual: “EMI payments and device locking are controlled by your team.”
- Automatic: “EMI reminders and device actions follow the configured EMI policy.”

## EMI schedule UI

The EMI schedule remains visible to the tenant in both modes. Only a manual tenant gets the action to mark an installment paid.

For `MANUAL` mode:

- Show a green **Mark as paid** button for installments whose status is `pending`, `overdue`, or `partial`.
- Do not show the button for `paid` or `waived` installments.
- Disable the button and show a spinner while the request is running.
- After success, replace the action with the paid state and refresh the schedule/device details from the response or relevant GET API.

### Confirmation

Clicking **Mark as paid** must first open a confirmation dialog. Show the installment number, due date, and complete outstanding amount. Suggested copy:

> Mark installment #3 as paid? This records the complete outstanding amount as paid. If this is the final unpaid installment, the device will be queued for permanent release.

Actions:

- **Cancel**: close the dialog without an API request.
- **Confirm payment**: call the API and show a loading state until it completes.

### Fetch EMI schedule

```http
GET /api/distributor/users/:userId/emi-installments
Authorization: Bearer <tenant-access-token>
```

Example response:

```json
{
  "success": true,
  "message": "EMI installments fetched successfully",
  "data": {
    "borrower": {
      "id": "<user-id>",
      "name": "Borrower Name",
      "mobile": "9876543210",
      "loanId": "LN-1001"
    },
    "emiScheduleId": "<schedule-id>",
    "installments": [
      {
        "_id": "<installment-id>",
        "installmentNumber": 3,
        "dueDate": "2026-08-01T00:00:00.000Z",
        "emiAmount": 5000,
        "penaltyAmount": 100,
        "paidAmount": 0,
        "status": "overdue"
      }
    ],
    "overdueAmount": 5100,
    "overdueInstallments": 1,
    "dpd": 9
  }
}
```

Outstanding amount is:

```text
emiAmount + penaltyAmount - paidAmount
```

### Mark an installment paid

```http
POST /api/distributor/users/:userId/emi-installments/:installmentId/mark-paid
Authorization: Bearer <tenant-access-token>
Content-Type: application/json
```

Request:

```json
{
  "reason": "Payment received offline",
  "reference": "CASH-2026-001",
  "paidAt": "2026-08-10T10:00:00.000Z"
}
```

Fields:

| Field | Required | Details |
|---|---:|---|
| `reason` | Yes | Non-empty reason recorded in the installment and audit trail. |
| `reference` | No | Receipt, cash-book, bank, or internal reference. |
| `paidAt` | No | ISO date-time. Defaults to the server time and cannot be in the future. |

The API marks the complete outstanding amount paid; it is not a partial-payment endpoint.

Successful response when other installments remain:

```json
{
  "success": true,
  "message": "EMI installment marked paid successfully",
  "data": {
    "emiScheduleId": "<schedule-id>",
    "scheduleStatus": "active",
    "settlementTime": null,
    "installment": {
      "_id": "<installment-id>",
      "installmentNumber": 3,
      "status": "paid",
      "paidAmount": 5100,
      "paidAt": "2026-08-10T10:00:00.000Z",
      "markPaidReason": "Payment received offline",
      "markPaidReference": "CASH-2026-001"
    },
    "overdueAmount": 0,
    "overdueInstallments": 0,
    "dpd": 0,
    "commandScheduled": false,
    "releaseCommand": null
  }
}
```

Successful response when this was the final unpaid installment:

```json
{
  "success": true,
  "message": "EMI installment marked paid successfully",
  "data": {
    "emiScheduleId": "<schedule-id>",
    "scheduleStatus": "settled",
    "settlementTime": "2026-08-10T10:00:01.000Z",
    "installment": {
      "_id": "<installment-id>",
      "status": "paid",
      "paidAmount": 5100
    },
    "overdueAmount": 0,
    "overdueInstallments": 0,
    "dpd": 0,
    "commandScheduled": true,
    "releaseCommand": {
      "commandId": "<command-id>",
      "commandType": "RELEASE_DEVICE",
      "status": "pending"
    }
  }
}
```

When `commandScheduled` is `true`, show **Release pending** and do not offer lock/unlock actions. The device will complete release through its normal command sync flow.

Relevant errors:

| HTTP | Error/code | UI behavior |
|---:|---|---|
| `400` | Invalid ID, missing reason, or invalid/future `paidAt` | Keep the dialog open and show the validation message. |
| `404` | Borrower, schedule, or installment not found / `EMI_INSTALLMENT_NOT_FOUND` | Refresh the borrower schedule. |
| `409` | `EMI_INSTALLMENT_NOT_MARKABLE` | Another request already resolved it; refresh and show its current status. |
| `409` | `LINKED_DEVICE_REQUIRED_FOR_RELEASE` | The final payment was rolled back; explain that a linked device is required before settlement. |

## Device details UI

Fetch current device details with:

```http
GET /api/distributor/devices/:deviceId
Authorization: Bearer <tenant-access-token>
```

The response provides `data.device.state`, `data.device.stateLabel`, the borrower, EMI schedule, and current policy.

Only show manual lock/unlock controls when `deviceControlMode === "MANUAL"`:

| Device state | Action |
|---|---|
| `ACTIVE`, `GRACE_PERIOD`, `TEMP_UNLOCK`, `OFFLINE_PENDING` | Show **Lock device**. |
| `LOCKED` | Show **Unlock device**. |
| `UNLOCK_PENDING` | Show disabled **Unlock pending**. |
| `RELEASE_PENDING`, `RELEASED` | Show no lock/unlock action. |
| `CONSENT_INVALID` | Show no action until consent is valid. |

For `EMI_AUTOMATED`, hide these manual controls in this feature. Continue to display device state and policy information.

Both lock and unlock actions should request a reason in a confirmation dialog. While the request is in progress:

- Disable the action.
- Replace its label with **Locking…** or **Unlocking…**.
- Do not send a second request from the same screen.
- On success, update the screen from `data.device` and retain `data.command` for status/debug display if needed.

### Lock device

```http
POST /api/distributor/devices/:deviceId/lock
Authorization: Bearer <tenant-access-token>
Content-Type: application/json
```

Request:

```json
{
  "reason": "Payment overdue; lock approved by branch manager"
}
```

Response:

```json
{
  "success": true,
  "message": "Device lock queued successfully",
  "data": {
    "device": {
      "_id": "<device-id>",
      "state": "LOCKED",
      "currentPolicyKey": "EMI_LOCKED",
      "desiredPolicyVersion": 8
    },
    "command": {
      "_id": "<command-id>",
      "commandType": "LOCK",
      "status": "pending",
      "payload": {
        "policyKey": "EMI_LOCKED",
        "policyVersion": 8,
        "reason": "Payment overdue; lock approved by branch manager"
      }
    }
  }
}
```

The state is the desired backend state. The physical device applies it on its normal sync/command cycle.

### Unlock device

```http
POST /api/distributor/devices/:deviceId/unlock
Authorization: Bearer <tenant-access-token>
Content-Type: application/json
```

Request:

```json
{
  "reason": "Offline payment verified"
}
```

Response:

```json
{
  "success": true,
  "message": "Device unlock queued successfully",
  "data": {
    "device": {
      "_id": "<device-id>",
      "state": "UNLOCK_PENDING",
      "currentPolicyKey": "EMI_PAID",
      "desiredPolicyVersion": 9
    },
    "command": {
      "_id": "<command-id>",
      "commandType": "UNLOCK",
      "status": "pending",
      "payload": {
        "policyKey": "EMI_PAID",
        "policyVersion": 9,
        "reason": "Offline payment verified"
      }
    }
  }
}
```

The device changes from `UNLOCK_PENDING` to `ACTIVE` after acknowledging the command.

### Required idempotency

Pressing an action again after a timeout, stale screen, or retry must be harmless. If the desired state/policy is already the same, the backend must not increment `desiredPolicyVersion`, update the state timestamp, or queue another command. It should return HTTP `200`:

```json
{
  "success": true,
  "message": "Device is already in the requested state",
  "data": {
    "noChange": true,
    "device": {
      "_id": "<device-id>",
      "state": "LOCKED",
      "currentPolicyKey": "EMI_LOCKED",
      "desiredPolicyVersion": 8
    },
    "command": null
  }
}
```

For a normal queued action, return `noChange: false` (or omit it for backward compatibility).

The lock/unlock APIs perform this check before updating the device or creating a command, so the app can safely handle a repeated same-state request as a successful no-op.

Common lock/unlock errors:

| HTTP | Error | UI behavior |
|---:|---|---|
| `400` | `Reason is required` | Keep the confirmation open and request a reason. |
| `404` | `Device not found` | Close the action and refresh the device list. |
| `500` | Policy/command failure | Restore the button and allow the user to retry. |

## Frontend acceptance checklist

- Sidebar always shows **Manual mode** or **Automatic mode**.
- The mode is read-only and persists across navigation.
- Only manual tenants see **Mark as paid** for markable installments.
- Mark-paid requires a second confirmation and uses a loading state.
- The final paid installment changes the UI to release pending when `commandScheduled` is `true`.
- Only manual tenants see applicable lock/unlock controls.
- Lock/unlock confirmations capture a reason and show loading states.
- Released and release-pending devices cannot be locked or unlocked.
- All error paths restore enabled UI and refresh stale data where appropriate.
