# App Restriction Removal After Payment Approval

This is an informational note for the borrower-app developer. No new borrower-app API or command type has been introduced.

## What changed

When the tenant approves a borrower payment, the backend now checks the linked device for app restrictions.

For a normal approved payment:

- The backend queues the existing `UNLOCK` command.
- If any desired or applied app restriction is enabled, the backend also queues one `RESTRICTIONS_UPDATE` command that sets every app restriction to `false`.
- If the device has no app restrictions, no unnecessary restriction command is created.

When the approved payment completes the entire EMI schedule:

- The backend queues only `RELEASE_DEVICE`.
- The release flow already clears app restrictions permanently.

## Restriction command received by the app

The borrower app receives the existing command format through FCM wake-up and device ping/sync:

```json
{
  "commandId": "<restriction-command-id>",
  "commandType": "RESTRICTIONS_UPDATE",
  "payload": {
    "restrictionVersion": 6,
    "restrictions": {
      "dialer": false,
      "camera": false,
      "whatsapp": false,
      "youtube": false,
      "playStore": false
    },
    "reason": "Payment approved",
    "paymentId": "<approved-payment-id>"
  }
}
```

## Required borrower-app behavior

No app-side change is required if the borrower app already follows the restriction command contract.

The app must continue to:

1. Process every pending command returned by device ping/sync.
2. Apply `RESTRICTIONS_UPDATE` as a complete restriction snapshot.
3. Remove each listed restriction when its value is `false`.
4. Apply the latest `restrictionVersion` and avoid regressing to an older version.
5. Process `UNLOCK`, `RESTRICTIONS_UPDATE`, and other pending commands without assuming FCM arrival order.
6. Acknowledge the restriction command separately using the existing command acknowledgement API.

Example acknowledgement:

```http
POST /api/app/device/command/ack
Authorization: Bearer <borrower-access-token>
Content-Type: application/json
```

```json
{
  "commandId": "<restriction-command-id>",
  "status": "acknowledged",
  "appliedRestrictionsVersion": 6,
  "appliedRestrictions": {
    "dialer": false,
    "camera": false,
    "whatsapp": false,
    "youtube": false,
    "playStore": false
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

## Offline behavior

If the device is offline when payment is approved, the commands remain queued. The borrower app must retrieve and apply them on the next successful ping/sync, including after an app restart or phone reboot.

The regular EMI policy cron may apply restrictions again later when another EMI becomes overdue. The app should always follow the latest backend restriction version and device state.
