# Device Security Controls Frontend Contract

This contract covers the tenant and super-admin frontend APIs for independently blocking factory
reset, USB debugging, and installation of applications from unknown sources. Tenant-app UI changes
for released devices and authoritative device-state labels are included at the end.

## Authentication and response envelope

Tenant endpoints require a tenant-admin account token and only operate on devices belonging to that
tenant. Super-admin endpoints require a super-admin account token.

```text
Authorization: Bearer <account-access-token>
Content-Type: application/json
```

Success:

```json
{
  "success": true,
  "message": "Device security control update queued successfully",
  "data": {}
}
```

Failure:

```json
{
  "success": false,
  "error": "Human-readable error"
}
```

## Security-control toggle APIs

| Control | Tenant App | Super Admin |
|---|---|---|
| Factory reset | `PATCH /api/distributor/devices/:deviceId/controls/factory-reset` | `PATCH /api/admin/devices/:deviceId/controls/factory-reset` |
| USB debugging | `PATCH /api/distributor/devices/:deviceId/controls/usb-debugging` | `PATCH /api/admin/devices/:deviceId/controls/usb-debugging` |
| Unknown app installs | `PATCH /api/distributor/devices/:deviceId/controls/unknown-app-installs` | `PATCH /api/admin/devices/:deviceId/controls/unknown-app-installs` |

All six endpoints use the same request:

```json
{
  "blocked": true,
  "retry": false
}
```

- `blocked: true` requests Blocked.
- `blocked: false` requests Allowed.
- Omit `retry` or send `false` for a normal toggle.
- Send `retry: true` only when retrying the current unapplied desired value after its latest command
  failed or expired.

Successful response:

```json
{
  "success": true,
  "message": "Device security control update queued successfully",
  "data": {
    "controlKey": "factoryReset",
    "controlState": {
      "desiredBlocked": true,
      "appliedBlocked": false,
      "desiredVersion": 2,
      "appliedVersion": 1,
      "updatedAt": "2026-07-30T10:00:00.000Z",
      "appliedAt": "2026-07-29T10:00:00.000Z",
      "updatedBy": "665f6f0b6f0f6f0b6f0f6f01"
    },
    "securityControlState": {
      "factoryReset": {
        "desiredBlocked": true,
        "appliedBlocked": false,
        "desiredVersion": 2,
        "appliedVersion": 1,
        "updatedAt": "2026-07-30T10:00:00.000Z",
        "appliedAt": "2026-07-29T10:00:00.000Z",
        "updatedBy": "665f6f0b6f0f6f0b6f0f6f01"
      },
      "usbDebugging": {
        "desiredBlocked": false,
        "appliedBlocked": false,
        "desiredVersion": 0,
        "appliedVersion": 0,
        "updatedAt": null,
        "appliedAt": null,
        "updatedBy": null
      },
      "unknownAppInstalls": {
        "desiredBlocked": false,
        "appliedBlocked": false,
        "desiredVersion": 0,
        "appliedVersion": 0,
        "updatedAt": null,
        "appliedAt": null,
        "updatedBy": null
      }
    },
    "command": {
      "_id": "665f6f0b6f0f6f0b6f0f6f02",
      "commandType": "SET_FACTORY_RESET_BLOCKED",
      "status": "pending",
      "triggeredBy": "manual_tenant",
      "payload": {
        "blocked": true,
        "controlVersion": 2
      },
      "createdAt": "2026-07-30T10:00:00.000Z"
    },
    "device": {
      "_id": "665f6f0b6f0f6f0b6f0f6f03",
      "state": "ACTIVE",
      "securityControlState": {}
    }
  }
}
```

The command type changes with the endpoint:

- Factory reset: `SET_FACTORY_RESET_BLOCKED`
- USB debugging: `SET_USB_DEBUGGING_BLOCKED`
- Unknown app installs: `SET_UNKNOWN_APP_INSTALL_BLOCKED`

The response `device` is the updated persisted device object. Frontends should replace local
security-control state with `data.securityControlState`; they do not need to parse the duplicated
state inside `data.device`.

Common errors:

| Status | Meaning |
|---|---|
| `400` | Invalid device ID or `blocked` is not a Boolean |
| `401` | Authentication is missing or expired |
| `403` | Account lacks the required tenant or super-admin access |
| `404` | Device does not exist or is outside the tenant |
| `409` | Device release has begun, or retry no longer matches an unapplied desired state |
| `500` | Unexpected backend failure |

## Tenant device detail API

```text
GET /api/distributor/devices/:deviceId
Authorization: Bearer <tenant-admin-access-token>
```

Relevant response:

```json
{
  "success": true,
  "message": "Device detail fetched successfully",
  "data": {
    "device": {
      "_id": "665f6f0b6f0f6f0b6f0f6f03",
      "state": "RELEASED",
      "stateLabel": "Released",
      "currentPolicyKey": "EMI_PAID",
      "currentPolicyLabel": "EMI Paid",
      "releasedAt": "2026-07-30T11:15:00.000Z",
      "securityControlState": {
        "factoryReset": {
          "desiredBlocked": false,
          "appliedBlocked": false,
          "desiredVersion": 3,
          "appliedVersion": 3
        },
        "usbDebugging": {
          "desiredBlocked": false,
          "appliedBlocked": false,
          "desiredVersion": 2,
          "appliedVersion": 2
        },
        "unknownAppInstalls": {
          "desiredBlocked": false,
          "appliedBlocked": false,
          "desiredVersion": 1,
          "appliedVersion": 1
        }
      }
    },
    "latestSecurityControlCommands": {
      "factoryReset": null,
      "usbDebugging": null,
      "unknownAppInstalls": null
    }
  }
}
```

Each non-null latest command contains its normal command fields plus `commandId` and
`controlResult`.

## Tenant dashboard and device list APIs

Dashboard:

```text
GET /api/distributor/dashboard
Authorization: Bearer <tenant-admin-access-token>
```

Use the existing state bucket for the Released card:

```json
{
  "success": true,
  "message": "Dashboard fetched successfully",
  "data": {
    "devices": {
      "activated": 25,
      "pendingActivation": 2,
      "byState": {
        "ACTIVE": 10,
        "GRACE_PERIOD": 3,
        "LOCKED": 4,
        "TEMP_UNLOCK": 2,
        "RELEASED": 6
      }
    }
  }
}
```

The backend includes only states that currently have devices. Render the Released count as:

```text
data.devices.byState.RELEASED ?? 0
```

Released device filter:

```text
GET /api/distributor/devices?state=RELEASED&page=1&limit=20
Authorization: Bearer <tenant-admin-access-token>
```

Relevant list response:

```json
{
  "success": true,
  "message": "Devices fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f6f0b6f0f6f0b6f0f6f03",
        "state": "RELEASED",
        "stateLabel": "Released",
        "currentPolicyKey": "EMI_PAID",
        "currentPolicyLabel": "EMI Paid",
        "releasedAt": "2026-07-30T11:15:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "pages": 1
    }
  }
}
```

The `state` filter accepts the backend device-state enums, including `RELEASED`. An unsupported
state returns HTTP `400` with `Invalid device state`.

## UI Changes in Tenant App

### Dashboard

- Keep the existing Total Devices card using `data.devices.activated`.
- Add a Released card beside it using `data.devices.byState.RELEASED ?? 0`.
- Tapping the Released card should open the device list with `state=RELEASED`.

### Device filters

- Add `Released` with query value `RELEASED`.
- Keep the selected filter in pagination and refresh requests.

### Device card and detail status

- The authoritative badge source is `device.stateLabel`, with `device.state` as the fallback mapping.
- Do not derive the device badge from enrollment status, activation status, EMI installment status,
  or whether a command is pending.
- Required state mappings:

| `device.state` | Display |
|---|---|
| `ACTIVE` | Active |
| `GRACE_PERIOD` | Grace Period |
| `LOCKED` | Locked |
| `TEMP_UNLOCK` | Temp Unlocked |
| `UNLOCK_PENDING` | Unlock Pending |
| `OFFLINE_PENDING` | Offline Pending |
| `CONSENT_INVALID` | Consent Invalid |
| `RELEASE_PENDING` | Release Pending |
| `RELEASED` | Released |

- Display `currentPolicyLabel` instead of formatting `currentPolicyKey`.
- Specifically, `TEMP_UNLOCKED` must display as `Temp Unlocked`.
- A pending command may be shown as secondary command-delivery information, but must never replace
  the authoritative device-state badge.

### Released device details

- When `device.state === "RELEASED"`, show a `Release date` row using `device.releasedAt`.
- Format the timestamp in the user's local timezone.
- Hide or disable lock, unlock, restriction, and security-control actions for `RELEASE_PENDING` and
  `RELEASED`.
- If a legacy released record has no `releasedAt`, display `Not available`; do not substitute
  `updatedAt`.

### Security-control switches

- Switch ON means Blocked (`desiredBlocked === true`).
- Switch OFF means Allowed (`desiredBlocked === false`).
- Display the current `Blocked` or `Allowed` text beside the switch; do not label it using the
  action that will happen on the next click.
- Show the separate applied value from `appliedBlocked`.
- Show `Awaiting device` while `desiredVersion > appliedVersion`.
- Retry only a failed or expired latest command that is still awaiting application.
- Optimistically update the selected switch, roll it back on request failure, and replace local
  state with `data.securityControlState` after success.

### On-demand location

Routine device ping/sync no longer updates location. Add an `Update location` button to the tenant
device detail page:

```text
POST /api/distributor/devices/:deviceId/location-request
Authorization: Bearer <tenant-admin-access-token>
```

Super-admin equivalent:

```text
POST /api/admin/devices/:deviceId/location-request
Authorization: Bearer <super-admin-access-token>
```

No body is required.

```json
{
  "success": true,
  "message": "Location request queued successfully",
  "data": {
    "command": {
      "_id": "665f6f0b6f0f6f0b6f0f6f10",
      "commandType": "GET_LOCATION",
      "status": "pending",
      "triggeredBy": "manual_tenant",
      "payload": {
        "requestedAt": "2026-07-31T10:00:00.000Z"
      }
    }
  }
}
```

- Disable the button while `latestLocationCommand.status` is `pending` or `sent`.
- A duplicate active request returns HTTP `409`.
- Disable the button for `RELEASE_PENDING` and `RELEASED`.
- Refresh device detail after acknowledgement to read the new `device.lastLocation`.
- Show the captured and received timestamps; do not imply continuous tracking.
