# Tenant App Device Telemetry and Restrictions Contract

This contract is for the Tenant App used by authenticated tenant administrators. It covers reading device telemetry and managing five per-device restrictions.

## 1. Authentication and authorization

All routes require an authenticated account token:

```http
Authorization: Bearer <tenant-admin-access-token>
```

The account must:

- Have the `tenant_admin` role.
- Belong to an active tenant.
- Have the tenant distribution capability.

The backend only returns or updates devices belonging to the authenticated tenant.

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

## 2. Fetch device details

```text
GET /api/distributor/devices/:deviceId
```

The existing response continues to include `device`, `borrower`, `emiSchedule`, and `currentPolicy`. It now also includes the latest restriction command.

Example relevant fields:

```json
{
  "success": true,
  "message": "Device detail fetched successfully",
  "data": {
    "device": {
      "_id": "665f6f0b6f0f6f0b6f0f6f0b",
      "imei": "123456789012345",
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
        "appliedVersion": 4,
        "updatedAt": "2026-07-24T10:29:00.000Z",
        "appliedAt": "2026-07-24T10:28:00.000Z"
      }
    },
    "latestRestrictionCommand": {
      "_id": "665f6f0b6f0f6f0b6f0f6f0c",
      "commandType": "RESTRICTIONS_UPDATE",
      "status": "sent",
      "failureReason": null,
      "createdAt": "2026-07-24T10:29:00.000Z"
    },
    "borrower": {},
    "emiSchedule": {},
    "currentPolicy": {}
  }
}
```

For older devices, missing restriction values are returned as unlocked defaults with version `0`.

## 3. Displaying telemetry

### SIM details

Show:

- `device.simInfo.simOperator`
- `device.simInfo.phoneNumber`
- `device.simInfo.simSerial`
- `device.simChangedAt`

Use a placeholder such as `Not available` when a value is absent.

### Location details

Show:

- Latitude
- Longitude
- Accuracy in meters
- Location capture time
- Server receive time

If `device.lastLocation` is absent, show a no-location state and do not display a stale map link.

Build the Google Maps link without an API key:

```text
https://www.google.com/maps/search/?api=1&query=<latitude>,<longitude>
```

Open the map link outside the app or in the app's secure browser view.

## 4. Supported restrictions

| Key | Tenant-facing label | Meaning |
|---|---|---|
| `dialer` | Dialer | Lock the managed device's active/default Dialer app |
| `camera` | Camera | Disable camera access |
| `whatsapp` | WhatsApp | Lock the standard WhatsApp app |
| `youtube` | YouTube | Lock the standard YouTube app |
| `playStore` | Play Store | Lock Google Play Store |

`true` means locked. `false` means allowed.

WhatsApp Business and arbitrary installed applications are outside this contract.

## 5. Toggle a restriction

```text
PATCH /api/distributor/devices/:deviceId/restrictions
Content-Type: application/json
```

Request:

```json
{
  "restriction": "camera",
  "locked": true
}
```

No reason field is required.

Successful response:

```json
{
  "success": true,
  "message": "Device restriction update queued successfully",
  "data": {
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
    },
    "command": {
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
  }
}
```

Each normal toggle:

- Applies immediately to the backend.
- Increments `desiredVersion`.
- Queues the complete desired restriction snapshot for the managed device.
- Persists across EMI lock, temporary unlock, and full unlock transitions.

## 6. Retry a failed restriction command

Allow retry only when:

- `desiredVersion` is greater than `appliedVersion`.
- `latestRestrictionCommand.status` is `failed` or `expired`.

Use the same endpoint and current desired value:

```json
{
  "restriction": "camera",
  "locked": true,
  "retry": true
}
```

A valid retry queues the same desired version again. It does not increment `desiredVersion`.

The backend returns HTTP `409` if the retry value no longer matches the current desired state or the state is already applied. Refresh the device detail after a `409`.

## 7. Tenant App UI behavior

- Render switches using `device.restrictionState.desired`.
- Submit each switch immediately.
- Optimistically update the selected switch.
- Disable restriction switches while a request is in progress.
- Roll the switch back if the HTTP request fails.
- Replace local state with `data.restrictionState` after success.
- Show `Awaiting device` for a restriction whose desired value differs from its applied value.
- Show the latest command status.
- Display `failureReason` when the latest command failed.
- Offer Retry when desired and applied versions differ and the latest command is failed or expired.
- Refresh device details after a successful toggle or retry to obtain the latest command-delivery status.

Suggested status interpretation:

| Condition | Display |
|---|---|
| Desired and applied values match | Applied |
| Desired and applied values differ; command is pending or sent | Awaiting device |
| Desired and applied values differ; command failed | Failed, with Retry |
| Desired and applied values differ; command expired | Expired, with Retry |

## 8. Error handling

| Status | Meaning | Tenant App behavior |
|---|---|---|
| `400` | Invalid device ID, restriction key, or `locked` value | Revert the switch and show the backend error |
| `401` | Missing or expired authentication | Refresh the session or return to login |
| `403` | Account lacks tenant access | Block the action and show an authorization message |
| `404` | Device does not belong to the tenant or does not exist | Return to the device list |
| `409` | Retry state changed or is already applied | Refresh device details |
| `500` | Unexpected backend failure | Revert the switch and offer a normal retry |

## 9. Independent device security controls

Tenant device detail includes:

- `device.securityControlState`, containing independent `factoryReset`, `usbDebugging`, and
  `unknownAppInstalls` desired/applied state and versions.
- `latestSecurityControlCommands`, keyed by those same three names.

Use these explicit endpoints:

```text
PATCH /api/distributor/devices/:deviceId/controls/factory-reset
PATCH /api/distributor/devices/:deviceId/controls/usb-debugging
PATCH /api/distributor/devices/:deviceId/controls/unknown-app-installs
```

Request:

```json
{
  "blocked": true,
  "retry": false
}
```

The endpoints queue, respectively:

- `SET_FACTORY_RESET_BLOCKED`
- `SET_USB_DEBUGGING_BLOCKED`
- `SET_UNKNOWN_APP_INSTALL_BLOCKED`

Each control has an independent desired/applied version. A normal toggle increments only the selected
control. A newer toggle expires only an older pending command for that same control; it does not
expire either of the other security-control commands.

Render each switch as `Blocked` or `Allowed` from `desiredBlocked`. Show `Awaiting device` while
`desiredVersion > appliedVersion`, and show the separate `appliedBlocked` value. Offer Retry only
when the selected control is awaiting application and its latest command is `failed` or `expired`.
Retry by sending the same desired `blocked` value with `retry: true`; a valid retry reuses the desired
version.

Apply the same optimistic-update, rollback, HTTP error, and refresh behavior as restriction switches.
Disable all security-control switches for `RELEASE_PENDING` and `RELEASED` devices.
