# Borrower Unlock Request Fetch Guide

This guide is for the borrower app developer.

It explains how to fetch the borrower's unlock requests, how to fetch pending or resolved requests, and how to get the status of the latest unlock request.

## Endpoint

```http
GET /api/app/unlock-requests
Authorization: Bearer <userAccessToken>
```

This endpoint returns the authenticated borrower's own unlock requests only.

## Default Behavior

By default, unlock requests are sorted by newest first.

That means:

- latest unlock request appears at the top
- default sort is effectively:

```text
sortBy=createdAt
sortOrder=desc
```

## Query Parameters

| Field | Required | Notes |
| --- | --- | --- |
| `page` | No | Default `1` |
| `limit` | No | Default `20`, max `100` |
| `status` | No | Exact unlock request status |
| `statusGroup` | No | `pending`, `open`, `resolved`, or `rejected` |
| `search` | No | Searches `caseId`, `reason`, `details`, `reasonCategory`, `status`, and `resolutionNote` |
| `sortBy` | No | Allowed: `createdAt`, `updatedAt`, `resolvedAt`, `status` |
| `sortOrder` | No | `asc` or `desc` |

## Success Response

```json
{
  "success": true,
  "message": "Unlock requests fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f6f0b6f0f6f0b6f0f6f0b",
        "caseId": "CASE-2026-ABCDE",
        "userId": "665f6f0b6f0f6f0b6f0f6f0c",
        "deviceId": "665f6f0b6f0f6f0b6f0f6f0d",
        "tenantId": "665f6f0b6f0f6f0b6f0f6f0e",
        "channelPartnerId": "665f6f0b6f0f6f0b6f0f6f0f",
        "status": "PENDING_TENANT",
        "reason": "Payment made but device is still locked",
        "reasonCategory": "payment_made",
        "details": "UPI ref UPI123456",
        "imageUrl": "https://...",
        "resolutionAction": null,
        "resolutionNote": null,
        "resolvedAt": null,
        "createdAt": "2026-07-02T10:00:00.000Z",
        "updatedAt": "2026-07-02T10:00:00.000Z"
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

## Fetch All Unlock Requests

Use the plain endpoint:

```http
GET /api/app/unlock-requests
```

This returns the borrower’s full paginated history, latest first.

## Fetch Pending Unlock Requests

Use the grouped pending filter:

```http
GET /api/app/unlock-requests?statusGroup=pending
```

This includes:

```text
PENDING_TENANT
ESCALATED_PARTNER
ESCALATED_ADMIN
UNDER_REVIEW
```

You can also use:

```http
GET /api/app/unlock-requests?statusGroup=open
```

It behaves the same as `pending`.

## Fetch Resolved Unlock Requests

Use:

```http
GET /api/app/unlock-requests?statusGroup=resolved
```

This includes:

```text
RESOLVED_TENANT
RESOLVED_PARTNER
RESOLVED_SUPER_ADMIN
CLOSED
```

## Fetch Rejected Unlock Requests

Use:

```http
GET /api/app/unlock-requests?statusGroup=rejected
```

This includes:

```text
REJECTED_TENANT
REJECTED_PARTNER
REJECTED_SUPER_ADMIN
```

## Fetch Exact Status

If the app needs only one exact status, use the `status` parameter.

Example:

```http
GET /api/app/unlock-requests?status=PENDING_TENANT
```

## Search Unlock Requests

Example:

```http
GET /api/app/unlock-requests?search=CASE-2026
```

Search matches:

- `caseId`
- `reason`
- `details`
- `reasonCategory`
- `status`
- `resolutionNote`

## Sorting

Default newest first:

```http
GET /api/app/unlock-requests
```

Explicit newest first:

```http
GET /api/app/unlock-requests?sortBy=createdAt&sortOrder=desc
```

Oldest first:

```http
GET /api/app/unlock-requests?sortBy=createdAt&sortOrder=asc
```

Resolved latest first:

```http
GET /api/app/unlock-requests?statusGroup=resolved&sortBy=resolvedAt&sortOrder=desc
```

## How To Fetch Status Of Latest Unlock Request

Use:

```http
GET /api/app/unlock-requests?limit=1
```

Because the default ordering is newest first, `data.items[0]` is the latest unlock request.

The app can read:

```text
data.items[0].status
```

If no unlock request exists, `items` will be an empty array.

## Existing Active Unlock Request Endpoint

The borrower app can still use:

```http
GET /api/app/unlock-request/active
```

This is useful only for the latest open request.

Use the new paginated endpoint when the app needs:

- full history
- search
- resolved requests
- rejected requests
- sorted lists
- latest request status from all requests, not only open ones
