# EMI Reminder And Partner Tenant Metrics App Developer Contract

## Summary

This contract covers three app-facing changes:

- Tenant App can send overdue EMI reminders to borrower devices.
- Borrower App must handle overdue EMI reminder FCM notifications.
- Partner App receives tenant-level metrics in tenant list and tenant detail APIs.

Base API prefix remains unchanged:

```text
/api
```

Tenant routes are available under:

```text
/api/tenant
```

Partner routes are available under:

```text
/api/partner
```

## Tenant App: Upcoming EMI Reminder

The backend already sends upcoming payment notifications.

Automatic cron reminders:

```text
notificationType: UPCOMING_EMI
```

These are queued by the EMI policy scheduled job 10 days and 5 days before due date.

For each upcoming borrower row, wire the Send Reminder button to:

```text
POST /api/tenant/users/:userId/upcoming-emi-reminder
```

Headers:

```text
Authorization: Bearer <tenant_admin_access_token>
Content-Type: application/json
```

Optional body:

```json
{
  "windowDays": 7,
  "note": "Your EMI payment is due soon."
}
```

`windowDays` defaults to `7` and is limited to `1` through `30`. The backend selects the earliest pending or partially paid installment due within that window.

Queued response:

```json
{
  "success": true,
  "message": "Upcoming EMI reminder queued successfully",
  "data": {
    "queued": true,
    "commandId": "665f...",
    "commandType": "EMI_REMINDER",
    "status": "pending",
    "userId": "665f...",
    "deviceId": "665f...",
    "installmentId": "665f...",
    "installmentNumber": 4,
    "dueDate": "2026-08-10T00:00:00.000Z",
    "outstandingAmount": 3500,
    "windowDays": 7
  }
}
```

No qualifying upcoming EMI returns `200` with `queued: false` and `reason: NO_UPCOMING_EMI`. A borrower without a registered device returns `200` with `queued: false` and `reason: DEVICE_NOT_REACHABLE`.

The command is stored as `commandType: EMI_REMINDER` with `payload.reminderType: UPCOMING`.

The older device-scoped endpoint remains available for backward compatibility:

```text
POST /api/tenant/devices/:deviceId/upcoming-payment-reminder
```

## Tenant App: Overdue EMI Reminder

The existing overdue EMI list remains:

```text
GET /api/tenant/users/overdue-emis?page=1&limit=20&search=ramesh
```

For each overdue borrower row, wire the Send Reminder button to:

```text
POST /api/tenant/users/:userId/overdue-emi-reminder
```

Headers:

```text
Authorization: Bearer <tenant_admin_access_token>
Content-Type: application/json
```

Optional body:

```json
{
  "note": "Please clear your overdue EMI to avoid device restrictions."
}
```

Queued response:

```json
{
  "success": true,
  "message": "Overdue EMI reminder queued successfully",
  "data": {
    "queued": true,
    "commandId": "665f...",
    "userId": "665f...",
    "deviceId": "665f...",
    "overdueInstallmentCount": 2,
    "totalOutstandingAmount": 4500
  }
}
```

No overdue EMI response:

```json
{
  "success": true,
  "message": "No overdue EMI found for borrower",
  "data": {
    "queued": false,
    "reason": "NO_OVERDUE_EMI",
    "userId": "665f..."
  }
}
```

Device not reachable response:

```json
{
  "success": true,
  "message": "Device is not reachable for reminder",
  "data": {
    "queued": false,
    "reason": "DEVICE_NOT_REACHABLE",
    "userId": "665f...",
    "deviceId": "665f..."
  }
}
```

Bulk reminder endpoint:

```text
POST /api/tenant/users/overdue-emis/reminders
```

Body:

```json
{
  "userIds": ["665f..."],
  "limit": 100,
  "note": "Please clear your overdue EMI to avoid device restrictions."
}
```

If `userIds` is omitted, the backend scans overdue borrowers for the tenant up to `limit`.

Bulk response:

```json
{
  "success": true,
  "message": "Overdue EMI reminders processed successfully",
  "data": {
    "counts": {
      "scanned": 10,
      "queued": 8,
      "skippedNoOverdue": 1,
      "skippedNoDevice": 1,
      "failed": 0
    },
    "results": []
  }
}
```

## Borrower App: FCM Handling

Handle borrower device notification:

```json
{
  "type": "NOTIFICATION",
  "commandId": "665f...",
  "commandType": "NOTIFICATION",
  "notificationType": "OVERDUE_EMI_REMINDER",
  "title": "EMI overdue",
  "text": "Please clear your overdue EMI to avoid device restrictions.",
  "userId": "665f...",
  "deviceId": "665f...",
  "overdueInstallmentCount": "2",
  "totalOutstandingAmount": "4500",
  "installmentIds": "[\"665f...\"]"
}
```

App behavior:

- Show a normal borrower notification using `title` and `text`.
- On notification tap, open the EMI/payment screen.
- Treat all FCM `data` values as strings.
- Parse `installmentIds` as JSON only if the app needs installment-level navigation.

Android notification channel used by borrower notifications:

```text
custom_notifications
```

## Partner App: Tenant Metrics

Tenant list:

```text
GET /api/partner/tenants?page=1&limit=20&status=active&search=pune
```

Each item includes:

```json
{
  "_id": "665f...",
  "name": "Tenant Name",
  "metrics": {
    "borrowers": {
      "total": 120
    },
    "devices": {
      "total": 104
    },
    "cases": {
      "open": 8,
      "escalatedToPartner": 3
    },
    "updatedAt": "2026-06-27T10:00:00.000Z"
  }
}
```

Tenant detail:

```text
GET /api/partner/tenants/:tenantId
```

Response:

```json
{
  "success": true,
  "message": "Partner tenant fetched successfully",
  "data": {
    "_id": "665f...",
    "name": "Tenant Name",
    "type": "standalone_outlet",
    "metrics": {
      "borrowers": {
        "total": 120
      },
      "devices": {
        "total": 104
      },
      "cases": {
        "open": 8,
        "escalatedToPartner": 3
      },
      "updatedAt": "2026-06-27T10:00:00.000Z"
    }
  }
}
```

Partner App behavior:

- Use `items[].metrics` for tenant cards/list rows.
- Use `data.metrics` for tenant detail.
- If metrics are missing on older records, show zero until backend reconciliation refreshes them.
- `cases.open` includes tenant, partner, admin, and under-review open cases.
- `cases.escalatedToPartner` includes only cases currently waiting for partner action.
