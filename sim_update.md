# Update SIM Details Using Device Ping

This document is for the Borrower App developer.

## Endpoint

```http
POST /api/app/device/ping
Authorization: Bearer <userAccessToken>
Content-Type: application/json
```

The access token must belong to the borrower whose registered device is sending the ping.

## Request

Send the SIM details inside `simInfo`:

```json
{
  "simInfo": {
    "simOperator": "Airtel",
    "simSerial": "8991000000000000000",
    "phoneNumber": "9876543210"
  }
}
```

Supported fields:

| Field | Description |
|---|---|
| `simOperator` | Mobile network operator name |
| `simSerial` | SIM serial number |
| `phoneNumber` | Phone number associated with the SIM, when available |

`simInfo` is optional during a normal ping. Include it when SIM information is available or when the app detects a SIM change.

## Partial Updates

The app may send the complete SIM object or only the fields that changed.

Example—update only the operator:

```json
{
  "simInfo": {
    "simOperator": "Jio"
  }
}
```

Fields omitted from `simInfo` keep their existing stored values.

To clear a stored field, explicitly send `null`:

```json
{
  "simInfo": {
    "phoneNumber": null
  }
}
```

## Successful Response

Status: `200 OK`

```json
{
  "success": true,
  "message": "Device ping received",
  "data": {
    "deviceId": "deviceId",
    "serverTime": "2026-08-15T10:30:00.000Z",
    "telemetryWarnings": []
  }
}
```

When at least one supplied SIM value differs from the stored value, the backend:

- Updates only the changed SIM fields.
- Preserves SIM fields omitted from the request.
- Updates the device's `simChangedAt` timestamp.

The ping response does not return the saved `simInfo` or `simChangedAt`. Treat a successful `200 OK` response with no SIM warning as confirmation that the ping was processed.

## Invalid SIM Payload

If `simInfo` is supplied, it must be a JSON object. An invalid value does not fail the entire ping; the response contains a warning:

```json
{
  "success": true,
  "message": "Device ping received",
  "data": {
    "telemetryWarnings": [
      {
        "field": "simInfo",
        "code": "INVALID_SIM_INFO",
        "message": "simInfo must be an object"
      }
    ]
  }
}
```

The app should log or report this warning and correct the payload on the next ping.

## Required App Behavior

```text
Detect a SIM detail change
-> Read the available operator, serial number, and phone number
-> POST /api/app/device/ping with simInfo
-> Check for HTTP 200 and success: true
-> Inspect data.telemetryWarnings
-> If INVALID_SIM_INFO is present, correct the payload before retrying
```

Send a ping after a detected SIM change. Normal periodic pings may also include the latest available `simInfo` values; unchanged values do not update `simChangedAt`.
