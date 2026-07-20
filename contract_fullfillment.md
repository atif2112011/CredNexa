# Tenant App Backend Contract Fulfillment

## Status

The backend supports the required Tenant App workflows. This document defines the exact API contract the frontend should use and records the agreed limitations and frontend adaptations.

The device-detail response has been updated to expose the authoritative borrower disbursement date. The remaining differences are contract mappings and do not require backend changes.

All endpoints below are relative to the API base path and require an authenticated tenant account token.

```text
/api/tenant
```

The same handlers are also mounted under `/api/distributor`, but the Tenant App should use `/api/tenant`.

## Standard Response Envelope

Successful responses use:

```json
{
  "success": true,
  "message": "Success message",
  "data": {}
}
```

Failed responses use:

```json
{
  "success": false,
  "error": "Error message"
}
```

Paginated list responses use:

```json
{
  "success": true,
  "message": "Records fetched successfully",
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 16,
      "total": 42,
      "pages": 3
    }
  }
}
```

Frontend mapping:

- `pagination.pages` is the total number of pages and is equivalent to the requested `totalPages`.
- `hasNextPage` can be calculated as `page < pages`.
- `hasPreviousPage` can be calculated as `page > 1`.
- The backend caps `limit` at 100 and defaults it to 20.
- When there are no records, `pages` is currently `1`.

## 1. Payment Approval Requests

### List endpoint

```http
GET /api/tenant/payments/approval-requests
```

Supported query parameters:

| Parameter | Values | Notes |
| --- | --- | --- |
| `page` | positive integer | Optional; defaults to `1`. |
| `limit` | `1` to `100` | Optional; defaults to `20`. |
| `search` | string | Optional; case-insensitive. |
| `status` | `pending_approval`, `approved`, `rejected`, `all` | Optional. Omit it or use `all` for all statuses. |

These parameters can be combined. There are no client-controlled sort parameters. Results are always sorted by `submittedAt` descending and then `_id` descending.

Do not send `PENDING`. The pending approval value is `pending_approval`.

Approval-status meanings:

| `approvalStatus` | Meaning |
| --- | --- |
| `pending_approval` | Submitted and waiting for tenant review. |
| `approved` | Tenant approved the payment. |
| `rejected` | Tenant rejected the payment. |

The separate payment `status` field uses `approval_pending`, `success`, and `rejected`. Use `approvalStatus` for list filtering and approval UI state.

Search currently covers:

- borrower name
- borrower mobile
- borrower email
- borrower loan ID
- payment reference at `metadata.reference`

Search does not cover payment `_id` or device IMEI. The frontend should describe the search control accordingly and must not promise those two search modes.

Example:

```http
GET /api/tenant/payments/approval-requests?page=1&limit=16&search=9876543210&status=pending_approval
```

Response data:

```json
{
  "items": [
    {
      "_id": "PAYMENT_OBJECT_ID",
      "userId": {
        "_id": "USER_OBJECT_ID",
        "name": "Ravi Kumar",
        "mobile": "9876543210",
        "email": "ravi@example.com",
        "loanId": "LOAN-1001"
      },
      "deviceId": {
        "_id": "DEVICE_OBJECT_ID",
        "imei": "123456789012345",
        "deviceModel": "Model name",
        "manufacturer": "Manufacturer",
        "state": "LOCKED"
      },
      "emiScheduleId": "EMI_SCHEDULE_OBJECT_ID",
      "amount": 2500,
      "currency": "INR",
      "status": "approval_pending",
      "approvalStatus": "pending_approval",
      "submittedAt": "2026-07-18T12:30:00.000Z",
      "rejectionReason": null,
      "proof": {
        "imageUrl": "https://example.com/payment-proof.jpg"
      },
      "metadata": {
        "reference": "UTR123456"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 16,
    "total": 1,
    "pages": 1
  }
}
```

The identifier used by payment detail, approve, and reject is `item._id`.

### Payment detail and actions

```http
GET  /api/tenant/payments/:paymentId
POST /api/tenant/payments/:paymentId/approve
POST /api/tenant/payments/:paymentId/reject
```

Approve accepts an optional note:

```json
{ "note": "Verified UPI credit" }
```

Reject requires:

```json
{ "reason": "No matching credit found" }
```

The payment detail endpoint returns the payment record but does not embed the complete EMI schedule.

### EMI schedule

Use the populated payment `userId._id` with:

```http
GET /api/tenant/users/:userId/emi-installments
```

The response data contains `borrower`, `emiScheduleId`, `installments`, `overdueAmount`, `overdueInstallments`, and `dpd`. Installments are sorted by due date descending.

## 2. Borrower Device-Linkage Filter

### Endpoint

```http
GET /api/tenant/users
```

Supported parameters are `page`, `limit`, `search`, and `onboardingStatus`. They can be combined.

Frontend filter mapping:

| UI filter | Request |
| --- | --- |
| All | omit `onboardingStatus` |
| Linked | `onboardingStatus=onboarded` |
| Not Linked | `onboardingStatus=pending` |

Despite the parameter name, these two values are explicitly implemented as device-linkage filters:

- `onboarded` filters `isDeviceLinked === true`.
- `pending` filters borrowers whose `isDeviceLinked` is not true.

Examples:

```http
GET /api/tenant/users?page=1&limit=16&search=Ravi&onboardingStatus=onboarded
GET /api/tenant/users?page=1&limit=16&onboardingStatus=pending
```

Each borrower item includes:

- `isDeviceLinked`: authoritative linkage boolean
- `linkedDeviceId`: populated linked-device summary or `null`
- `deviceLinkedAt`: linkage timestamp when available

The frontend may use `onboardingStatus` for the request and `isDeviceLinked` for rendering the returned borrower state.

Example linked borrower item:

```json
{
  "_id": "USER_OBJECT_ID",
  "name": "Ravi Kumar",
  "mobile": "9876543210",
  "loanId": "LOAN-1001",
  "isDeviceLinked": true,
  "linkedDeviceId": {
    "_id": "DEVICE_OBJECT_ID",
    "imei": "123456789012345",
    "deviceModel": "Model name",
    "manufacturer": "Manufacturer",
    "state": "LOCKED",
    "lastSeenAt": "2026-07-18T12:30:00.000Z"
  },
  "deviceLinkedAt": "2026-07-10T09:00:00.000Z"
}
```

For an unlinked borrower, `isDeviceLinked` is `false` and `linkedDeviceId` is absent or `null`. The frontend should normalize an absent `linkedDeviceId` to `null`.

## 3. Device Detail Disbursement Date

### Endpoint

```http
GET /api/tenant/devices/:deviceId
```

The authoritative field is:

```text
data.borrower.disbursementDate
```

It is the fund-disbursement date entered when the borrower and EMI schedule were registered. It is serialized as an ISO 8601 date-time string by the API. When a linked borrower has no recorded date, `borrower.disbursementDate` is `null`. When the device has no linked borrower, `borrower` itself is `null`.

Relevant response excerpt:

```json
{
  "success": true,
  "message": "Device detail fetched successfully",
  "data": {
    "device": {
      "_id": "DEVICE_OBJECT_ID",
      "imei": "123456789012345"
    },
    "borrower": {
      "_id": "USER_OBJECT_ID",
      "name": "Ravi Kumar",
      "mobile": "9876543210",
      "loanId": "LOAN-1001",
      "loanAmount": 30000,
      "emiAmount": 2500,
      "tenureMonths": 12,
      "disbursementDate": "2026-07-01T00:00:00.000Z"
    },
    "emiSchedule": {},
    "currentPolicy": {}
  }
}
```

The frontend should show `borrower.disbursementDate` in the Linked Borrower card instead of the loan ID.

## 4. Unlock Request Listing

### Endpoint

```http
GET /api/tenant/unlock-requests
```

Supported query parameters are `search`, one `status`, `page`, and `limit`. They can be combined. Multiple statuses and `statusGroup` are not supported.

The frontend will allow only one raw status filter at a time. Use the exact uppercase status strings returned by the backend. To show a group such as Escalated, Resolved, or Rejected, present its raw statuses as individual selectable options.

Tenant workflow statuses:

```text
PENDING_TENANT
ESCALATED_PARTNER
ESCALATED_ADMIN
RESOLVED_SUPER_ADMIN
RESOLVED_PARTNER
RESOLVED_TENANT
REJECTED_PARTNER
REJECTED_SUPER_ADMIN
REJECTED_TENANT
```

The model can also contain `UNDER_REVIEW` and `CLOSED`. Omitting `status` returns every request owned by the tenant, including those statuses if present. Therefore, the All filter must omit `status` and the frontend should tolerate unknown/new status values.

Search currently covers:

- borrower name
- borrower mobile
- borrower email
- borrower loan ID
- case ID
- unlock reason

Search does not cover device IMEI, request details, reason category, status, or resolution note. The frontend should describe search using only the supported fields.

Example:

```http
GET /api/tenant/unlock-requests?page=1&limit=16&search=CASE-2026&status=PENDING_TENANT
```

Response data uses the standard `items` and `pagination` structure documented above, with `pagination.pages` representing total pages. Each item includes populated `userId` and `deviceId` summaries.

## 5. Unlock Request Detail and Resolution

### Detail endpoint

```http
GET /api/tenant/unlock-requests/:caseId
```

Response data contains:

```json
{
  "unlockRequest": {},
  "emiSchedule": {},
  "commands": [],
  "auditLogs": []
}
```

Frontend field paths:

| Meaning | Field |
| --- | --- |
| Resolved time | `data.unlockRequest.resolvedAt` |
| Resolution action | `data.unlockRequest.resolutionAction` |
| Temporary-unlock duration | `data.unlockRequest.tempUnlockDurationHours` |
| Duration unit | hours |

Resolution action values include `unlocked`, `temp_unlocked`, `rejected`, `waived`, and `override`.

For a temporary unlock, calculate the display expiry as:

```text
temporaryUnlockUntil = resolvedAt + tempUnlockDurationHours hours
```

Only perform this calculation when `resolutionAction === "temp_unlocked"` and both values are present. Treat the duration and calculated expiry as `null` for pending, escalated, rejected, or non-temporary-unlock resolutions.

The temporary-unlock command and audit log also contain the backend-generated `tempUnlockExpiresAt`, but the frontend contract does not depend on searching those arrays. The requested top-level `temporaryUnlockUntil` field is not returned.

Example temporary-unlock `unlockRequest` excerpt:

```json
{
  "status": "RESOLVED_TENANT",
  "resolvedAt": "2026-07-18T12:30:00.000Z",
  "resolutionAction": "temp_unlocked",
  "tempUnlockDurationHours": 1
}
```

Example rejected `unlockRequest` excerpt:

```json
{
  "status": "REJECTED_TENANT",
  "resolvedAt": "2026-07-18T12:30:00.000Z",
  "resolutionAction": "rejected",
  "resolutionNote": "No matching payment found"
}
```

Example escalated `unlockRequest` after frontend normalization:

```json
{
  "status": "ESCALATED_PARTNER",
  "resolvedAt": null,
  "resolutionAction": null,
  "tempUnlockDurationHours": null
}
```

Unset optional properties may be omitted by the API. The frontend should normalize absent `resolvedAt`, `resolutionAction`, and `tempUnlockDurationHours` values to `null` before rendering.

### Tenant resolution actions

```http
POST /api/tenant/unlock-requests/:caseId/approve
POST /api/tenant/unlock-requests/:caseId/temp-unlock
POST /api/tenant/unlock-requests/:caseId/reject
```

All three actions use the request `caseId`, not the MongoDB `_id`.

## Frontend Implementation Summary

- Use `/api/tenant` endpoints exactly as documented above.
- Read total pages from `pagination.pages`.
- Use the single raw `status` filter for unlock requests.
- Calculate temporary-unlock display expiry from `resolvedAt` and `tempUnlockDurationHours` only for `temp_unlocked` resolutions.
- Describe payment search without payment-ID or IMEI search.
- Describe unlock search without IMEI search.
- Use `onboardingStatus=onboarded|pending` for device-linkage filtering and render state from `isDeviceLinked`.
- Read the device-detail disbursement date from `data.borrower.disbursementDate`.
