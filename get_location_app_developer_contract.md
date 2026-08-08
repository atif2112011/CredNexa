# GET_LOCATION Command — Borrower App Developer Contract

## Purpose

The managed Borrower App must no longer collect or send location during routine device ping or
device sync. A location must be captured only after the backend issues a `GET_LOCATION` command.

The command requests one fresh location fix. It does not authorize continuous or background
location tracking.

## Authentication

All Borrower App endpoints require a borrower user access token:

```text
Authorization: Bearer <user-access-token>
Content-Type: application/json
```

## Routine ping and sync

Routine calls remain:

```text
POST /api/app/device/ping
POST /api/app/device/sync
```

Do not include `location` in either request.

If a legacy app sends location in ping or sync:

- The backend ignores the location.
- `device.lastLocation` is not updated.
- The backend can return this warning:

```json
{
  "field": "location",
  "code": "LOCATION_COMMAND_REQUIRED",
  "message": "Routine ping location was ignored; location is accepted only for GET_LOCATION acknowledgement"
}
```

The app should stop sending routine location after receiving this warning.

## Receiving the command

`GET_LOCATION` can arrive through either:

1. A high-priority FCM data message.
2. A command inside `pendingCommands` returned by device ping or sync.

Example FCM data:

```json
{
  "type": "GET_LOCATION",
  "commandType": "GET_LOCATION",
  "commandId": "665f6f0b6f0f6f0b6f0f6f10",
  "requestedAt": "2026-07-31T10:00:00.000Z"
}
```

Example pending command:

```json
{
  "_id": "665f6f0b6f0f6f0b6f0f6f10",
  "commandId": "665f6f0b6f0f6f0b6f0f6f10",
  "commandType": "GET_LOCATION",
  "status": "pending",
  "payload": {
    "requestedAt": "2026-07-31T10:00:00.000Z"
  },
  "createdAt": "2026-07-31T10:00:00.000Z"
}
```

Both delivery paths must use the same internal command dispatcher. The command ID is the
idempotency key.

## Command processing

When `GET_LOCATION` is received:

1. Ignore it if the same command ID was already successfully processed.
2. Check location permission.
3. Request runtime permission when the current Android version requires it.
4. Capture one fresh location fix.
5. Stop location updates immediately after obtaining the fix.
6. Persist the command ID and captured fix locally until acknowledgement succeeds.
7. Send the successful command acknowledgement.

Do not use an indefinitely cached location. A fresh provider result is preferred. If the device
cannot obtain a valid fix within the app's bounded timeout, report command failure.

## Successful acknowledgement

```text
POST /api/app/device/command/ack
```

Request:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f10",
  "status": "acknowledged",
  "location": {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "accuracyMeters": 18.4,
    "capturedAt": "2026-07-31T10:00:12.000Z"
  }
}
```

Location validation:

- `latitude`: finite number from `-90` to `90`.
- `longitude`: finite number from `-180` to `180`.
- `accuracyMeters`: finite, non-negative number.
- `capturedAt`: valid ISO-8601 timestamp.
- `capturedAt` must not be more than five minutes ahead of server time.
- The fix must not be older than the currently stored device location.

Successful response:

```json
{
  "success": true,
  "message": "Device command acknowledgement saved",
  "data": {
    "commandId": "665f6f0b6f0f6f0b6f0f6f10",
    "status": "acknowledged",
    "deviceState": "ACTIVE",
    "lastLocation": {
      "latitude": 12.9716,
      "longitude": 77.5946,
      "accuracyMeters": 18.4,
      "capturedAt": "2026-07-31T10:00:12.000Z",
      "receivedAt": "2026-07-31T10:00:13.000Z"
    }
  }
}
```

Only a successful acknowledgement updates `device.lastLocation`.

## Failed acknowledgement

If permission is denied, location services are disabled, the provider times out, or no valid fix is
available:

```text
POST /api/app/device/command/ack
```

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f10",
  "status": "failed",
  "failureReason": "Location permission denied"
}
```

Recommended failure reasons:

- `Location permission denied`
- `Location services disabled`
- `Location provider unavailable`
- `Location request timed out`
- `No valid location fix available`

A failed acknowledgement is terminal for that command. The operator can issue a new
`GET_LOCATION` command later.

## HTTP error handling

| Status | Meaning | App behavior |
|---|---|---|
| `200` | Acknowledgement saved | Mark the command complete locally |
| `400` | Missing/invalid/stale/future location | Keep the command pending locally and send a failed acknowledgement with a useful reason |
| `401` | Access token missing or expired | Refresh authentication, then retry acknowledgement |
| `404` | Command does not exist for this device | Drop the local command and log the mismatch |
| `409` | Command was superseded by release or has conflicting terminal status | Stop processing and refresh device state |
| `500` | Temporary backend failure | Retry the same acknowledgement with backoff |

## Idempotency and retry rules

- Never capture multiple fixes because the same command arrived through both FCM and sync.
- Deduplicate by `commandId`.
- If location capture succeeded but acknowledgement failed because of network/server error, retry
  the same acknowledgement and same captured fix.
- Do not recapture unless a new `GET_LOCATION` command ID is received.
- If the backend returns the same successful terminal status, treat the command as complete.
- Process pending commands in ascending creation order.

## Release behavior

Do not process `GET_LOCATION` after device release begins.

If device state is `RELEASE_PENDING` or `RELEASED`:

- Stop an active location capture.
- Do not begin another capture.
- Refresh command/device state if a stale command remains locally.

## Privacy requirements

- Do not continuously track location.
- Do not attach location to routine ping, sync, telemetry events, logs, analytics, or crash reports.
- Do not retain historical fixes beyond what is required to retry the current acknowledgement.
- Remove the locally cached command fix after acknowledgement reaches a terminal state.
- Never log latitude, longitude, or the bearer token.

## Acceptance checklist

- Routine ping and sync contain no location.
- FCM and sync commands share one `GET_LOCATION` handler.
- Duplicate delivery produces one location capture and one logical acknowledgement.
- Valid acknowledgement updates backend `lastLocation`.
- Invalid, stale, or future fixes do not update backend `lastLocation`.
- Permission denial and provider failure create a failed acknowledgement.
- Network failure retries the same captured fix without recapturing.
- No capture runs after release begins.
