# Device Telemetry and Restrictions App Contract

> This combined reference is retained for platform-level review. App developers should use the dedicated [Borrower App contract](./borrower_app_device_telemetry_restrictions_contract.md) and [Tenant App contract](./tenant_app_device_telemetry_restrictions_contract.md).

This contract covers the managed borrower/device-owner app and the tenant app. The backend and Super Admin portal implement these interfaces; mobile enforcement remains the responsibility of the managed Android app.

## Authentication and response envelope

- Managed-device routes use a borrower `user` access token.
- Tenant routes use an authenticated `tenant_admin` account token and can only access devices belonging to that tenant.
- Successful responses use:

```json
{
  "success": true,
  "message": "Human-readable message",
  "data": {}
}
```

- Errors use:

```json
{
  "success": false,
  "error": "Human-readable error"
}
```

## Managed device ping

```text
POST /api/app/device/ping
Authorization: Bearer <user-access-token>
Content-Type: application/json
```

The managed app may omit `location` when permission or a valid fix is unavailable. It may omit `simInfo`, or send only the SIM fields that are available or changed.

```json
{
  "batteryLevel": 78,
  "networkType": "WIFI",
  "appVersion": "1.4.0",
  "fcmToken": "<current-fcm-token>",
  "location": {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "accuracyMeters": 18.4,
    "capturedAt": "2026-07-24T10:30:00.000Z"
  },
  "simInfo": {
    "simOperator": "Airtel",
    "simSerial": "8991000000000000000",
    "phoneNumber": "9876543210"
  }
}
```

Location rules:

- Latitude must be between `-90` and `90`.
- Longitude must be between `-180` and `180`.
- Accuracy must be non-negative.
- `capturedAt` must be a valid timestamp and no more than five minutes ahead of server time.
- Older fixes do not overwrite a newer stored fix.
- Invalid, future, or stale location data does not fail the heartbeat. It is ignored and described in `telemetryWarnings`.
- Only the latest accepted location is retained.

SIM rules:

- Supported fields are `simOperator`, `simSerial`, and `phoneNumber`.
- Only supplied fields are updated.
- A changed value updates `simChangedAt`.
- SIM changes do not create a risk, audit action, or automatic device lock.

Example response:

```json
{
  "success": true,
  "message": "Device ping received",
  "data": {
    "deviceId": "665f6f0b6f0f6f0b6f0f6f0b",
    "serverTime": "2026-07-24T10:30:02.000Z",
    "deviceState": "ACTIVE",
    "currentPolicyKey": "EMI_PAID",
    "desiredPolicyVersion": 3,
    "lastAppliedPolicyVersion": 3,
    "restrictionState": {
      "desired": {
        "dialer": false,
        "camera": true,
        "whatsapp": false,
        "youtube": true,
        "playStore": false
      },
      "applied": {
        "dialer": false,
        "camera": false,
        "whatsapp": false,
        "youtube": true,
        "playStore": false
      },
      "desiredVersion": 5,
      "appliedVersion": 4,
      "updatedAt": "2026-07-24T10:29:00.000Z",
      "appliedAt": "2026-07-24T10:28:00.000Z"
    },
    "policy": {},
    "pendingCommands": [],
    "telemetryWarnings": []
  }
}
```

Possible location warning codes are `INVALID_LOCATION`, `FUTURE_LOCATION`, and `STALE_LOCATION`.

## Tenant device details

```text
GET /api/distributor/devices/:deviceId
Authorization: Bearer <tenant-admin-access-token>
```

The existing `data.device` object now includes:

```json
{
  "simInfo": {
    "simOperator": "Airtel",
    "simSerial": "8991000000000000000",
    "phoneNumber": "9876543210"
  },
  "simChangedAt": "2026-07-24T10:25:00.000Z",
  "lastLocation": {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "accuracyMeters": 18.4,
    "capturedAt": "2026-07-24T10:30:00.000Z",
    "receivedAt": "2026-07-24T10:30:02.000Z"
  },
  "restrictionState": {
    "desired": {
      "dialer": false,
      "camera": true,
      "whatsapp": false,
      "youtube": true,
      "playStore": false
    },
    "applied": {
      "dialer": false,
      "camera": false,
      "whatsapp": false,
      "youtube": true,
      "playStore": false
    },
    "desiredVersion": 5,
    "appliedVersion": 4
  }
}
```

The detail response also includes `data.latestRestrictionCommand`, containing the most recent `RESTRICTIONS_UPDATE` command or `null`. Use its `status` and `failureReason` to show pending, failed, or retry states.

If `lastLocation` is absent, show a no-location state. A Google Maps link can be built without an API key:

```text
https://www.google.com/maps/search/?api=1&query=<latitude>,<longitude>
```

## Updating a device restriction

Tenant endpoint:

```text
PATCH /api/distributor/devices/:deviceId/restrictions
Authorization: Bearer <tenant-admin-access-token>
Content-Type: application/json
```

Super Admin endpoint:

```text
PATCH /api/admin/devices/:deviceId/restrictions
Authorization: Bearer <super-admin-access-token>
Content-Type: application/json
```

Request:

```json
{
  "restriction": "camera",
  "locked": true
}
```

Supported restriction keys:

| Key | Meaning |
|---|---|
| `dialer` | Suspend the active/default Dialer application |
| `camera` | Disable camera access through `DevicePolicyManager` |
| `whatsapp` | Suspend `com.whatsapp` |
| `youtube` | Suspend `com.google.android.youtube` |
| `playStore` | Suspend `com.android.vending` |

Every successful change increments `restrictionState.desiredVersion` and queues a `RESTRICTIONS_UPDATE` command containing the complete desired snapshot.

To retry a failed or expired restriction command without incrementing the desired version:

```json
{
  "restriction": "camera",
  "locked": true,
  "retry": true
}
```

The retry value must match the current desired value.

## Managed-device command handling

The app can receive `RESTRICTIONS_UPDATE` through FCM or through `pendingCommands` returned by device sync/ping.

Example FCM data:

```json
{
  "type": "RESTRICTIONS_UPDATE",
  "commandType": "RESTRICTIONS_UPDATE",
  "commandId": "665f6f0b6f0f6f0b6f0f6f0c",
  "restrictionVersion": "5",
  "restrictions": "{\"dialer\":false,\"camera\":true,\"whatsapp\":false,\"youtube\":true,\"playStore\":false}"
}
```

Enforcement requirements:

1. Parse `restrictionVersion` as an integer.
2. Ignore a command whose version is lower than the locally applied restriction version.
3. Treat the supplied snapshot as authoritative; do not apply only the most recently toggled key.
4. Overlay these restrictions on the active EMI policy. A `true` per-device restriction stays locked through EMI lock, temporary unlock, and full unlock transitions.
5. Persist the applied snapshot and version locally before acknowledgement.

Android mapping:

- Camera: use `DevicePolicyManager.setCameraDisabled(adminComponent, locked)`.
- WhatsApp, YouTube, and Play Store: use Device Owner package suspension for their fixed package names.
- Dialer: resolve the active/default Dialer package through Android role/telecom APIs, then suspend or restore that resolved package. Do not hardcode one OEM Dialer package.
- Preserve emergency-call access wherever Android requires it. If Android refuses to suspend a protected system Dialer, report the restriction as unsupported/failed instead of claiming success.

## Command acknowledgement

```text
POST /api/app/device/command/ack
Authorization: Bearer <user-access-token>
Content-Type: application/json
```

Successful enforcement:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0c",
  "status": "acknowledged",
  "appliedRestrictionsVersion": 5,
  "appliedRestrictions": {
    "dialer": false,
    "camera": true,
    "whatsapp": false,
    "youtube": true,
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

Failed or partially failed enforcement:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0c",
  "status": "failed",
  "failureReason": "Default dialer is a protected system package",
  "restrictionResults": {
    "dialer": {
      "status": "unsupported",
      "message": "Package suspension was rejected by Android"
    }
  }
}
```

For an acknowledged restriction command, `appliedRestrictionsVersion` must exactly match that command's `restrictionVersion`. The backend records older acknowledgements for command history but never lets them reduce the device's current applied version.

## Tenant app UI behavior

- Render switches from `restrictionState.desired`.
- Show “Awaiting device” when a desired value differs from its applied value.
- Apply each switch immediately through the tenant restriction endpoint.
- Roll the switch back if the HTTP request fails.
- Show command failure and offer retry when desired and applied versions differ after a failed or expired command.
- Display coordinates, accuracy, capture time, receive time, and the Google Maps link from `lastLocation`.
