# Restriction Results and EMI Reminder Client Contract

The configured mobile API base URL already contains `/api`. Client code uses the
logical routes below and must not add another `/api` segment.

## Restriction command acknowledgement

Route:

```http
POST /app/device/command/ack
```

Successful restriction enforcement:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0c",
  "status": "acknowledged",
  "appliedRestrictionsVersion": 5,
  "appliedRestrictions": {
    "dialer": true,
    "camera": true,
    "whatsapp": false,
    "youtube": false,
    "playStore": true
  },
  "restrictionResults": {
    "dialer": { "status": "applied" },
    "camera": { "status": "applied" },
    "whatsapp": { "status": "applied" },
    "youtube": { "status": "applied" },
    "playStore": { "status": "applied" }
  }
}
```

Failed or partial enforcement:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0c",
  "status": "failed",
  "failureReason": "One or more restrictions could not be applied",
  "restrictionResults": {
    "dialer": { "status": "applied" },
    "camera": { "status": "applied" },
    "whatsapp": { "status": "applied" },
    "youtube": { "status": "applied" },
    "playStore": { "status": "failed" }
  }
}
```

Per-key statuses are `applied`, `failed`, or `unsupported`. A result may include
an optional `message`. Missing keys remain missing and are not interpreted as
failed.

The ACK response retains the existing success envelope:

```json
{
  "success": true,
  "message": "Device command acknowledgement saved",
  "data": {
    "commandId": "665f6f0b6f0f6f0b6f0f6f0c",
    "status": "failed"
  }
}
```

## Tenant device detail

Route:

```http
GET /tenant/devices/:deviceId
```

The existing Tenant device-detail response now exposes results directly:

```json
{
  "success": true,
  "message": "Device detail fetched successfully",
  "data": {
    "device": {
      "restrictionState": {
        "desired": {
          "dialer": true,
          "camera": true,
          "whatsapp": false,
          "youtube": false,
          "playStore": true
        },
        "desiredVersion": 5
      }
    },
    "latestRestrictionCommand": {
      "_id": "665f6f0b6f0f6f0b6f0f6f0c",
      "commandId": "665f6f0b6f0f6f0b6f0f6f0c",
      "commandType": "RESTRICTIONS_UPDATE",
      "status": "failed",
      "failureReason": "One or more restrictions could not be applied",
      "restrictionResults": {
        "dialer": { "status": "applied" },
        "camera": { "status": "applied" },
        "whatsapp": { "status": "applied" },
        "youtube": { "status": "applied" },
        "playStore": { "status": "failed" }
      }
    }
  }
}
```

For historical commands without results, `restrictionResults` is `null`.

## EMI reminder queue response

Existing logical Tenant reminder routes continue to be used:

```http
POST /tenant/users/:userId/overdue-emi-reminder
POST /tenant/users/overdue-emis/reminders
POST /tenant/devices/:deviceId/upcoming-payment-reminder
```

A queued response identifies the authoritative device command:

```json
{
  "success": true,
  "message": "Overdue EMI reminder queued successfully",
  "data": {
    "queued": true,
    "commandId": "665f6f0b6f0f6f0b6f0f6f0d",
    "commandType": "EMI_REMINDER",
    "status": "pending"
  }
}
```

This confirms queueing only. It does not confirm display, audio playback, or
borrower viewing.

## Borrower pending command

Authenticated responses from these logical routes include the command:

```text
POST /app/device/sync
POST /app/device/ping
```

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0d",
  "commandType": "EMI_REMINDER",
  "status": "pending",
  "payload": {
    "reminderType": "OVERDUE",
    "message": "Your EMI payment is overdue.",
    "amount": 12500,
    "dueDate": "2026-07-20T00:00:00.000Z",
    "installmentNumber": 4,
    "totalInstallments": 12
  }
}
```

`amount`, `dueDate`, `installmentNumber`, and `totalInstallments` are optional.
Supported `reminderType` values are `OVERDUE`, `PENDING`, and `UPCOMING`.

## EMI wake-up FCM

EMI reminder FCM is data-only and non-authoritative:

```json
{
  "data": {
    "type": "EMI_REMINDER",
    "commandType": "EMI_REMINDER",
    "commandId": "665f6f0b6f0f6f0b6f0f6f0d"
  }
}
```

The Borrower App authenticates and retrieves the matching pending command through
sync or ping before displaying it.

## EMI acknowledgement

The existing generic endpoint is used:

```http
POST /app/device/command/ack
```

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0d",
  "status": "acknowledged"
}
```

An acknowledged command is terminal and is no longer returned in
`pendingCommands`. Re-delivery of the same terminal ACK is idempotent.
