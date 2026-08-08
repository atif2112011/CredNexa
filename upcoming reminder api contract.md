# Upcoming EMI Reminder API Contract

This contract explains how the tenant app can manually send an upcoming EMI reminder to a particular borrower and their registered device.

## Endpoint

```http
POST /api/tenant/users/:userId/upcoming-emi-reminder
Authorization: Bearer <tenant-admin-access-token>
Content-Type: application/json
```

Replace `:userId` with the borrower ID returned by the tenant borrower or upcoming-EMI APIs.

## Authorization

The endpoint requires:

- A valid account access token
- The `tenant_admin` role
- An active tenant
- The tenant's `DISTRIBUTE` capability

The backend verifies that the borrower belongs to the authenticated tenant. The tenant app must not send a `tenantId`.

## Request body

Both fields are optional:

```json
{
  "windowDays": 7,
  "note": "Your EMI payment is due soon."
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `windowDays` | Number | No | Number of future days in which an EMI is considered upcoming. Defaults to `7` and is limited to `1`–`30`. |
| `note` | String | No | Reminder message shown to the borrower. Defaults to `Your EMI payment is due soon.` |

The backend selects the earliest installment that:

- Belongs to the specified borrower and authenticated tenant
- Has status `pending` or `partial`
- Has a due date from the current time through the end of `windowDays`

## Successful queued response

HTTP status: `201 Created`

```json
{
  "success": true,
  "message": "Upcoming EMI reminder queued successfully",
  "data": {
    "queued": true,
    "commandId": "665f6f0b6f0f6f0b6f0f6f0d",
    "commandType": "EMI_REMINDER",
    "status": "pending",
    "userId": "665f6f0b6f0f6f0b6f0f6f0a",
    "deviceId": "665f6f0b6f0f6f0b6f0f6f0b",
    "installmentId": "665f6f0b6f0f6f0b6f0f6f0c",
    "installmentNumber": 4,
    "dueDate": "2026-08-10T00:00:00.000Z",
    "outstandingAmount": 3500,
    "windowDays": 7
  }
}
```

`queued: true` confirms that the backend has stored the device command. It does not confirm that the borrower device has received or displayed the reminder.

The device command is stored as:

```json
{
  "commandType": "EMI_REMINDER",
  "payload": {
    "reminderType": "UPCOMING",
    "message": "Your EMI payment is due soon.",
    "amount": 3500,
    "dueDate": "2026-08-10T00:00:00.000Z",
    "installmentNumber": 4,
    "totalInstallments": 12
  }
}
```

## No upcoming EMI response

Returned when the borrower has no pending or partially paid installment within the requested window.

HTTP status: `200 OK`

```json
{
  "success": true,
  "message": "No upcoming EMI found for borrower",
  "data": {
    "queued": false,
    "reason": "NO_UPCOMING_EMI",
    "userId": "665f6f0b6f0f6f0b6f0f6f0a",
    "windowDays": 7
  }
}
```

The tenant app should show an informational message and must not show the reminder as sent.

## Device unavailable response

Returned when the borrower has an upcoming EMI but does not have a registered device.

HTTP status: `200 OK`

```json
{
  "success": true,
  "message": "Device is not reachable for reminder",
  "data": {
    "queued": false,
    "reason": "DEVICE_NOT_REACHABLE",
    "userId": "665f6f0b6f0f6f0b6f0f6f0a",
    "deviceId": null,
    "windowDays": 7
  }
}
```

The tenant app should show that no registered borrower device is available and must not show the reminder as sent.

## Error responses

### Invalid borrower ID

HTTP status: `400 Bad Request`

```json
{
  "success": false,
  "error": "INVALID_USER_ID"
}
```

### Borrower not found in tenant

HTTP status: `404 Not Found`

```json
{
  "success": false,
  "error": "BORROWER_NOT_FOUND"
}
```

### Authentication or tenant-access failure

The API can return:

- `401` when the access token is missing, invalid, or expired
- `403` when the account is not a tenant admin, has no tenant scope, the tenant is inactive, or the tenant lacks distribution capability

### Device permanently released

HTTP status: `409 Conflict`

No EMI reminder is allowed when device release is pending or complete.

### Server failure

HTTP status: `500 Internal Server Error`

The tenant app should show a retry option and must not mark the reminder as sent.

## Tenant-app button behavior

When the tenant taps **Send Reminder** on an upcoming-EMI row:

1. Disable the button while the request is running.
2. Call this endpoint using that row's borrower `userId`.
3. Send `windowDays` consistent with the upcoming-EMI list filter.
4. Show success only when the response has `data.queued === true`.
5. Show an informational message for `NO_UPCOMING_EMI` or `DEVICE_NOT_REACHABLE`.
6. Re-enable the button after the request completes.
7. Prevent rapid repeated taps.

The endpoint deduplicates an active upcoming reminder for the same device and installment. A repeated request may return the existing active command instead of creating another command.

## FCM delivery behavior

The reminder is queued for asynchronous FCM delivery. The FCM delivery worker normally processes queued commands within approximately one minute.

The borrower device receives a high-priority, data-only wake-up message:

```json
{
  "commandId": "665f6f0b6f0f6f0b6f0f6f0d",
  "commandType": "EMI_REMINDER",
  "type": "EMI_REMINDER"
}
```

The borrower app then retrieves the authoritative command through device ping/sync. It identifies this reminder using:

```text
commandType: EMI_REMINDER
payload.reminderType: UPCOMING
```

## Backward compatibility

The older device-scoped endpoint remains available:

```http
POST /api/tenant/devices/:deviceId/upcoming-payment-reminder
```

New tenant-app screens that operate on borrower or upcoming-EMI rows should use the new borrower-scoped endpoint:

```http
POST /api/tenant/users/:userId/upcoming-emi-reminder
```

## Integration checklist

- [ ] Use the borrower `userId`, not the device ID, in the new endpoint path.
- [ ] Include the tenant-admin bearer token.
- [ ] Do not send `tenantId` in the request.
- [ ] Keep `windowDays` between `1` and `30`.
- [ ] Treat only `queued: true` as a successfully queued reminder.
- [ ] Handle `NO_UPCOMING_EMI` and `DEVICE_NOT_REACHABLE` as non-error outcomes.
- [ ] Prevent duplicate taps while the request is in progress.
- [ ] Do not assume queued means delivered or viewed.
