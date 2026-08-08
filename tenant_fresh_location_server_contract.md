# Tenant Fresh Location — Server API Contract

**Audience:** Tenant App developer  
**Server authority:** EMI Shield backend  
**Version date:** 2026-08-03

## 1. Purpose

This API lets an authenticated Tenant Admin ask a managed Borrower device for one fresh location fix.

The server creates the existing `GET_LOCATION` device command. The Borrower App captures one location and acknowledges that command. Only a valid successful acknowledgement updates `device.lastLocation`.

This flow does not enable continuous or background location tracking.

## 2. Base path and authentication

All paths below are relative to the configured backend base URL.

Use the Tenant route namespace:

```text
/tenant/...
```

Every request requires:

```http
Authorization: Bearer <tenant-admin-access-token>
```

The server verifies that:

- the access token is valid and is an account token;
- the account has the `tenant_admin` role;
- the account has a Tenant scope;
- the Tenant is active;
- the Tenant has the `distribute` capability; and
- the requested device belongs to that Tenant.

The Tenant App must not send or derive a Tenant ID for these requests. Tenant scope comes from the authenticated token.

## 3. Request one fresh location

```http
POST /tenant/devices/:deviceId/location-request
Authorization: Bearer <tenant-admin-access-token>
Content-Type: application/json
```

The request body may be omitted or sent as an empty object:

```json
{}
```

Do not send coordinates, borrower ID, Tenant ID, command ID, tracking intervals, or background-tracking options.

### Successful response

The server returns HTTP `201 Created` after the command is committed. It then attempts immediate FCM delivery without making delivery success a requirement for creating the command.

```json
{
  "success": true,
  "message": "Location request sent successfully",
  "data": {
    "command": {
      "_id": "665f6f0b6f0f6f0b6f0f6f10",
      "deviceId": "665f6f0b6f0f6f0b6f0f6f0b",
      "tenantId": "665f6f0b6f0f6f0b6f0f6f01",
      "commandType": "GET_LOCATION",
      "status": "pending",
      "triggeredBy": "manual_tenant",
      "payload": {
        "requestedAt": "2026-08-03T10:00:00.000Z"
      },
      "createdAt": "2026-08-03T10:00:00.000Z",
      "updatedAt": "2026-08-03T10:00:00.000Z"
    },
    "immediateDelivery": {
      "commandId": "665f6f0b6f0f6f0b6f0f6f10",
      "status": "sent",
      "providerMessageId": "provider-message-id"
    }
  }
}
```

Additional command fields may be present. The Tenant App only needs:

- `data.command.commandType`
- `data.command.status`
- `data.command.payload.requestedAt`
- `data.immediateDelivery.status`

The Tenant App does not need to display or persist the command ID.

### Immediate-delivery results

`data.immediateDelivery.status` may be:

- `sent` — FCM accepted the immediate delivery;
- `skipped` — immediate delivery could not occur, such as when no device token is available;
- `failed` — an immediate delivery attempt failed; or
- `deferred` — the committed command remains available for the normal delivery flow.

A result other than `sent` does not mean the POST request failed. The command was already committed. Show a neutral message such as “Location request queued” and use Device Detail as the source of truth.

## 4. Repeated requests

The server uses refresh/supersession behavior, not deduplication.

When the Tenant requests location again while an earlier `GET_LOCATION` command is `pending` or `sent`:

1. the earlier command is marked `expired`;
2. its failure reason becomes `Superseded by a newer location request`; and
3. a new `GET_LOCATION` command is created and returned with HTTP `201`.

The Update Location action may therefore remain available while an earlier request is `pending` or `sent`. Disable the action only:

- while the POST request itself is in progress; or
- when the device is `RELEASE_PENDING` or `RELEASED`.

An acknowledgement for a superseded `GET_LOCATION` command is rejected with HTTP `409` and cannot update `device.lastLocation`.

## 5. Read the location and request status

```http
GET /tenant/devices/:deviceId
Authorization: Bearer <tenant-admin-access-token>
```

Relevant response fields:

```json
{
  "success": true,
  "message": "Device detail fetched successfully",
  "data": {
    "device": {
      "_id": "665f6f0b6f0f6f0b6f0f6f0b",
      "state": "ACTIVE",
      "lastLocation": {
        "latitude": 12.9716,
        "longitude": 77.5946,
        "accuracyMeters": 18.4,
        "capturedAt": "2026-08-03T10:00:12.000Z",
        "receivedAt": "2026-08-03T10:00:13.000Z"
      }
    },
    "latestLocationCommand": {
      "_id": "665f6f0b6f0f6f0b6f0f6f10",
      "commandType": "GET_LOCATION",
      "status": "acknowledged",
      "payload": {
        "requestedAt": "2026-08-03T10:00:00.000Z"
      },
      "acknowledgedAt": "2026-08-03T10:00:13.000Z",
      "createdAt": "2026-08-03T10:00:00.000Z",
      "updatedAt": "2026-08-03T10:00:13.000Z"
    }
  }
}
```

`data.latestLocationCommand` is `null` when the device has never had a location request.

Use these mappings:

| Tenant App value | Server field |
|---|---|
| Latest accepted location | `data.device.lastLocation` |
| Request status | `data.latestLocationCommand.status` |
| Request time | `data.latestLocationCommand.payload.requestedAt` |
| Successful acknowledgement time | `data.latestLocationCommand.acknowledgedAt` |
| Failure or expiry time | `data.latestLocationCommand.updatedAt` |
| Failure explanation | `data.latestLocationCommand.failureReason` |

If `lastLocation` is `null`, show a “Location not available” state. Do not infer coordinates from the command or from routine device telemetry.

## 6. Command statuses

The server exposes these statuses:

| Status | Tenant App meaning |
|---|---|
| `pending` | The command exists and is waiting for delivery. |
| `sent` | The command was sent or made available to the Borrower device and is awaiting acknowledgement. |
| `acknowledged` | The server accepted a valid location and updated `device.lastLocation`. |
| `failed` | Delivery or device processing failed. Display `failureReason` when available and allow another request. |
| `expired` | The command was superseded by a newer request or by device release. It can no longer update location. |

There is currently no time-based expiry for an unanswered location command. A request remains `pending` or `sent` until it is acknowledged, fails, is replaced by a newer request, or is superseded by release.

## 7. Refresh behavior

After a successful POST:

1. show that the request was queued;
2. refresh Device Detail to obtain the authoritative command status;
3. while the screen remains open, the app may poll Device Detail for a short UI window;
4. stop polling when the command becomes `acknowledged`, `failed`, or `expired`; and
5. when acknowledged, render `data.device.lastLocation`.

The Tenant App must not update its displayed coordinates from the POST response. The POST response represents command creation, not a location result.

## 8. Successful result

The Borrower App sends the location through the device-command acknowledgement endpoint. The Tenant App does not call that endpoint.

For an accepted `GET_LOCATION` acknowledgement, the server:

- validates latitude, longitude, accuracy, and capture time;
- rejects stale, invalid, or excessively future-dated locations;
- sets `receivedAt` using server time;
- marks the command `acknowledged`; and
- updates `device.lastLocation`.

Only this successful acknowledgement path updates `device.lastLocation`.

## 9. Failed or obsolete result

When the Borrower device reports failure, the command becomes `failed` and may include `failureReason`. The previous `device.lastLocation` remains unchanged.

When an old request has been superseded, its command becomes `expired`. Any later acknowledgement for that command returns:

```json
{
  "success": false,
  "error": "Location request is no longer active",
  "data": {
    "code": "COMMAND_EXPIRED"
  }
}
```

This Borrower-facing error does not need to be handled by the Tenant App. Tenant Device Detail will continue to expose the newer location command as `latestLocationCommand`.

## 10. Release handling

For devices in `RELEASE_PENDING` or `RELEASED`, the server does not create a new location command and returns HTTP `409`:

```json
{
  "success": false,
  "error": "Location cannot be requested after device release begins"
}
```

When permanent release begins, existing active management commands, including location commands, are expired according to the server’s release supersession behavior.

## 11. Errors

All errors use this envelope:

```json
{
  "success": false,
  "error": "Human-readable error"
}
```

Some errors also include `data`, such as a stable error `code`.

| HTTP status | Meaning |
|---|---|
| `400` | Invalid device ID or request data. |
| `401` | Authentication token is missing, invalid, or expired. |
| `403` | The account lacks Tenant access, the Tenant is inactive, or the required capability is absent. |
| `404` | The device does not exist or does not belong to the authenticated Tenant. |
| `409` | Device release prevents the request, or an obsolete location command attempted acknowledgement. |
| `500` | Unexpected backend failure. |

The app should make decisions using the HTTP status and stable `data.code` when provided. Human-readable `message` and `error` text may be displayed but should not be parsed for application logic.

## 12. Tenant App implementation checklist

- Call only the `/tenant/...` route namespace.
- Send only the Tenant Admin bearer token and an empty request body.
- Treat HTTP `201` as successful command creation regardless of immediate-delivery status.
- Read request time from `latestLocationCommand.payload.requestedAt`.
- Read the accepted location only from `device.lastLocation`.
- Allow a new request to supersede an older pending or sent request.
- Disable location requests after device release begins.
- Handle every supported command status and unknown future statuses safely.
- Do not persist or display the command ID unless needed for diagnostics.
- Do not implement continuous or background location tracking.
