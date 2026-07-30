# Borrower App Device Telemetry and Restrictions Contract

This contract is for the managed Borrower App running as Android Device Owner. It covers heartbeat telemetry, restriction-command recovery and enforcement, and command acknowledgement.

## 1. Authentication and response envelope

All routes in this contract require a borrower `user` access token.

```http
Authorization: Bearer <user-access-token>
```

Successful responses:

```json
{
  "success": true,
  "message": "Human-readable message",
  "data": {}
}
```

Error responses:

```json
{
  "success": false,
  "error": "Human-readable error"
}
```

## 2. Device ping

```text
POST /api/app/device/ping
Content-Type: application/json
```

Example request:

```json
{
  "batteryLevel": 78,
  "networkType": "WIFI",
  "appVersion": "1.4.0",
  "fcmToken": "<current-fcm-token>",
  "simInfo": {
    "simOperator": "Airtel",
    "simSerial": "8991000000000000000",
    "phoneNumber": "9876543210"
  }
}
```

### Location behavior

- Do not collect or include location in routine ping or sync.
- If a legacy client includes `location`, the backend ignores it and returns
  `LOCATION_COMMAND_REQUIRED`.
- Location is collected only after receiving a `GET_LOCATION` command.

### SIM behavior

- `simInfo` is optional.
- Supported fields are `simOperator`, `simSerial`, and `phoneNumber`.
- The app may send the complete SIM object or only fields that changed.
- A changed field replaces the stored value and updates `simChangedAt`.
- A SIM change does not create a risk or automatically lock the device.

### Ping response

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

Possible telemetry warning codes:

| Code | Meaning |
|---|---|
| `LOCATION_COMMAND_REQUIRED` | Routine ping location was ignored; wait for `GET_LOCATION` |
| `INVALID_SIM_INFO` | `simInfo` was not an object |

The app should log telemetry warnings for diagnostics but continue normal sync and command processing.

## 3. Command delivery and recovery

Restriction commands can arrive through:

- A high-priority FCM data message.
- `pendingCommands` in `POST /api/app/device/ping`.
- `pendingCommands` in `POST /api/app/device/sync`.

The command type is:

```text
RESTRICTIONS_UPDATE
```

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

Example command returned by ping or sync:

```json
{
  "_id": "665f6f0b6f0f6f0b6f0f6f0c",
  "commandType": "RESTRICTIONS_UPDATE",
  "status": "pending",
  "payload": {
    "restrictionVersion": 5,
    "restrictions": {
      "dialer": false,
      "camera": true,
      "whatsapp": false,
      "youtube": true,
      "playStore": false
    }
  }
}
```

## 4. Applying restrictions

The app must:

1. Parse `restrictionVersion` as an integer.
2. Ignore commands older than the locally applied restriction version.
3. Treat `restrictions` as a complete authoritative snapshot.
4. Apply every restriction and collect an individual result for each key.
5. Persist the successfully applied snapshot and version locally.
6. Acknowledge the command.

Per-device restrictions are independent of EMI state. A restriction set to `true` remains enforced through EMI lock, temporary unlock, and full unlock transitions.

### Android enforcement mapping

| Restriction | Android behavior |
|---|---|
| `camera` | Call `DevicePolicyManager.setCameraDisabled(adminComponent, locked)` |
| `whatsapp` | Suspend or restore `com.whatsapp` as Device Owner |
| `youtube` | Suspend or restore `com.google.android.youtube` as Device Owner |
| `playStore` | Suspend or restore `com.android.vending` as Device Owner |
| `dialer` | Resolve the active/default Dialer through Android role or telecom APIs, then suspend or restore that resolved package |

Do not hardcode a single OEM Dialer package. Preserve emergency-call access wherever Android requires it. If Android refuses to suspend a protected system Dialer, report the restriction as unsupported or failed.

WhatsApp Business and arbitrary application packages are outside this contract.

## 5. Command acknowledgement

```text
POST /api/app/device/command/ack
Content-Type: application/json
```

### Successful enforcement

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

For an acknowledged command, `appliedRestrictionsVersion` must exactly match that command's `restrictionVersion`.

### Failed or partially failed enforcement

If any required restriction cannot be applied, acknowledge the command as failed and include individual results:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0c",
  "status": "failed",
  "failureReason": "One or more restrictions could not be applied",
  "restrictionResults": {
    "dialer": {
      "status": "unsupported",
      "message": "The default Dialer is a protected system package"
    },
    "camera": {
      "status": "applied"
    }
  }
}
```

Do not advance the locally applied restriction version after failed or partial enforcement.

A device-reported failed acknowledgement is terminal for that command. The backend does not
automatically redeliver it. An administrator or tenant operator can explicitly retry the current
desired restriction state, which queues a new `RESTRICTIONS_UPDATE` command using the same desired
restriction version. Firebase delivery failures remain eligible for the backend's automatic retry
and backoff behavior.

## 6. Required background behavior

- Send a ping periodically while the device is online.
- Send a ping after FCM token rotation and SIM changes.
- Call device sync on application launch, boot completion, and network reconnection.
- Process pending commands in ascending creation/version order.
- Ignore a stale restriction command rather than rolling local restrictions backward.
- Retry failed API acknowledgements without reapplying an older command over newer state.

## 7. Independent device security controls

Device ping and sync responses include `securityControlState`:

```json
{
  "factoryReset": {
    "desiredBlocked": true,
    "appliedBlocked": false,
    "desiredVersion": 2,
    "appliedVersion": 1
  },
  "usbDebugging": {
    "desiredBlocked": true,
    "appliedBlocked": true,
    "desiredVersion": 3,
    "appliedVersion": 3
  },
  "unknownAppInstalls": {
    "desiredBlocked": false,
    "appliedBlocked": false,
    "desiredVersion": 1,
    "appliedVersion": 1
  }
}
```

The app can receive these independent command types through FCM or `pendingCommands`:

| Command type | Android Device Owner enforcement |
|---|---|
| `SET_FACTORY_RESET_BLOCKED` | Add or clear `UserManager.DISALLOW_FACTORY_RESET` |
| `SET_USB_DEBUGGING_BLOCKED` | Add or clear `UserManager.DISALLOW_DEBUGGING_FEATURES` |
| `SET_UNKNOWN_APP_INSTALL_BLOCKED` | Add or clear the appropriate unknown-source restriction, using the device-wide variant where supported |

Each command payload contains:

```json
{
  "blocked": true,
  "controlVersion": 3
}
```

Treat each control as a separate version stream. Ignore a command older than that control's locally
applied version, apply only the named control, persist the applied value/version, and then acknowledge:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0d",
  "status": "acknowledged",
  "appliedControlVersion": 3,
  "appliedBlocked": true,
  "controlResult": {
    "status": "applied"
  }
}
```

`appliedControlVersion` and `appliedBlocked` must exactly match the command payload. If Device Owner
is unavailable or Android/OEM enforcement is refused, send `status: "failed"`, a `failureReason`,
and `controlResult.status` of `failed` or `unsupported`. Local persistence alone is not success.

Factory-reset blocking prevents reset through Android Settings but cannot guarantee blocking every
recovery or OEM reset path. Unknown-source blocking affects future installations and does not remove
previously installed APKs.

These controls persist through lock, temporary unlock, and full unlock. For `RELEASE_DEVICE`, clear
all three controls before removing Device Owner management and reporting release completion.

## 8. On-demand location command

`GET_LOCATION` arrives through high-priority FCM or `pendingCommands` in ping/sync:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f10",
  "commandType": "GET_LOCATION",
  "payload": {
    "requestedAt": "2026-07-31T10:00:00.000Z"
  }
}
```

When received:

1. Request the required runtime location permission if it is not already granted.
2. Capture one fresh location fix. Do not start continuous tracking.
3. Acknowledge the command with the captured location:

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

Latitude must be between `-90` and `90`, longitude between `-180` and `180`,
`accuracyMeters` must be non-negative, and `capturedAt` cannot be more than five minutes ahead of
server time or older than the stored location.

If permission is denied, the provider times out, or no valid fix is available, acknowledge with:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f10",
  "status": "failed",
  "failureReason": "Location permission denied"
}
```

Do not send the captured location through a separate routine ping. Retry acknowledgement delivery
without capturing another fix unless a newer `GET_LOCATION` command exists.
