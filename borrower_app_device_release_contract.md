# Borrower App Permanent Device Release Contract

## Trigger

The backend queues `RELEASE_DEVICE` when tenant approval of a payment leaves every EMI installment in `paid` or `waived` status. A super admin can also retry a failed or expired release for a settled schedule.

`RELEASE_DEVICE` is permanent. After it succeeds, EMI Shield must not enforce EMI, risk, restriction, wipe, update, or other device-management commands on that device.

## FCM and Sync Payload

The command is delivered as a high-priority data message and is also returned in the normal pending-command sync response:

```json
{
  "type": "RELEASE_DEVICE",
  "commandType": "RELEASE_DEVICE",
  "commandId": "<deviceCommandId>",
  "reason": "All EMI installments paid or waived",
  "settlementTime": "2026-07-25T10:00:00.000Z",
  "emiScheduleId": "<emiScheduleId>"
}
```

The FCM message is a wake-up signal. The app must confirm the command against the authenticated sync API before applying it.

## Settled and Released Screens

When the API reports `RELEASE_PENDING`, or the app receives a verified `RELEASE_DEVICE` command, replace the normal EMI dashboard, payment UI, and lock screen with a dedicated full-screen settlement experience:

- Title: **All EMIs completed**
- Primary message: **Your EMI plan is fully settled. We are permanently releasing this device from EMI Shield management.**
- Show the formatted `settlementTime`.
- Show a release-in-progress indicator while device-management removal is running.
- Hide Pay EMI, Request Unlock, temporary-unlock, overdue, and countdown controls.
- Keep emergency calling accessible if the device was locked before release began.
- Do not show language suggesting that another EMI is due or that the device can be re-locked.

If the command is waiting for connectivity, show:

> Your EMIs are complete. Connect to the internet to finish releasing your device.

After local release succeeds, show a final confirmation screen:

- Title: **Device released**
- Message: **All EMIs are settled and this device is no longer managed by EMI Shield.**
- Provide a single **Continue** action to enter the normal device experience.

Persist the settled/released screen state across app and device restarts. A failed release should keep the settled screen visible, show a safe retry/support message, and must never return the borrower to an EMI lock or payment-due screen.

## Required App Processing

Process the command idempotently:

1. Exit kiosk and lock-task mode.
2. Restore access to all applications and device UI.
3. Clear all per-device restrictions.
4. Re-enable factory reset, status bar, ADB, and other features controlled solely by EMI Shield.
5. Clear locally cached EMI lock, temporary-unlock, risk-lock, and policy state.
6. Remove EMI Shield Device Owner/device-management control using the supported Android DPC release flow.
7. Acknowledge success only after every required release operation succeeds.

The app must never apply a later lock or management command after it has persisted successful release locally.

## Acknowledgement

Success:

```http
POST /api/app/device/command/ack
Authorization: Bearer <borrowerAccessToken>
Content-Type: application/json

{
  "commandId": "<deviceCommandId>",
  "status": "acknowledged",
  "releaseCompleted": true
}
```

The backend rejects a successful release acknowledgement unless `releaseCompleted` is exactly `true`.

Failure:

```json
{
  "commandId": "<deviceCommandId>",
  "status": "failed",
  "failureReason": "Device Owner removal failed: <safe diagnostic>"
}
```

A failed release remains `RELEASE_PENDING`. It is not automatically retried as a delivery failure; a super admin can queue a fresh retry.

## Offline and Restart Behavior

- Persist the release command before beginning destructive management removal.
- Resume incomplete release processing after an app or device restart.
- If offline, keep the command pending and process it after the next authenticated sync.
- A settled device must not be re-locked while release is pending.
- Treat an already-completed local release as success when the same command is delivered again.
