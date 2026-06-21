# Partner Payout System - Partner App Contract

This document is for the Partner App developer.

## Feature Summary

Partner earns payout credit when tenants under that partner purchase keys.

Partner can:

```text
view payout balance
view payout range
add or confirm UPI details
request payout
track payout requests
see approval/rejection result
```

All amounts are rupee numbers.

## Screens To Add

### 1. Payout Summary Screen

Use this as the main payout screen.

Show:

```text
Available payout balance
On-hold payout balance
Lifetime earned
Lifetime paid
Payout range
UPI ID
UPI name
Request Payout button
Recent payout requests
```

API:

```http
GET /api/partner/payout/summary
Authorization: Bearer <partnerAdminAccessToken>
```

Response:

```json
{
  "success": true,
  "message": "Partner payout summary fetched successfully",
  "data": {
    "channelPartner": {
      "id": "channelPartnerId",
      "name": "Bharat Partner",
      "type": "independent"
    },
    "creditPercentage": 15,
    "balances": {
      "available": 1500,
      "onHold": 500,
      "lifetimeEarned": 2500,
      "lifetimePaid": 500
    },
    "payoutRange": {
      "currency": "INR",
      "min": 0,
      "max": 1500,
      "available": 1500,
      "hasMaximumCap": false
    },
    "upi": {
      "upiId": "partner@upi",
      "upiName": "Bharat Partner",
      "isComplete": true
    }
  }
}
```

UI logic:

```text
Disable Request Payout if available balance <= 0.
Disable Request Payout if UPI details are incomplete and user has not entered them.
Show payoutRange.min and payoutRange.max near amount input.
```

## 2. Request Payout Modal

Open this modal when user taps:

```text
Request Payout
```

Fields:

```text
Amount
UPI ID
UPI Name
```

Pre-fill:

```text
UPI ID from summary.upi.upiId
UPI Name from summary.upi.upiName
```

If UPI fields are missing, user must enter them.

### Client-Side Validations

Amount:

```text
required
must be number
must be > 0
must be >= payoutRange.min when min > 0
must be <= payoutRange.max
```

UPI ID:

```text
required
basic format: name@bank
```

UPI Name:

```text
required
non-empty
```

Do not rely only on frontend validation. Backend also validates.

### Request API

```http
POST /api/partner/payout/requests
Authorization: Bearer <partnerAdminAccessToken>
Content-Type: application/json
```

Request:

```json
{
  "amount": 1000,
  "upiId": "partner@upi",
  "upiName": "Bharat Partner"
}
```

Response:

```json
{
  "success": true,
  "message": "Partner payout requested successfully",
  "data": {
    "payoutRequest": {
      "_id": "payoutRequestId",
      "channelPartnerId": "channelPartnerId",
      "amount": 1000,
      "status": "PENDING",
      "upiId": "partner@upi",
      "upiName": "Bharat Partner",
      "requestedAt": "2026-06-20T00:00:00.000Z"
    },
    "ledgerEntryId": "ledgerEntryId",
    "balances": {
      "available": 500,
      "onHold": 1500
    }
  }
}
```

After success:

```text
Close modal
Refresh payout summary
Refresh payout request list
Show success message
```

Important backend behavior:

```text
Requested amount is moved from available balance to hold balance immediately.
This prevents duplicate payout requests for the same available balance.
```

## 3. Payout History Screen

Show list of payout requests.

API:

```http
GET /api/partner/payout/requests?page=1&limit=20
Authorization: Bearer <partnerAdminAccessToken>
```

Optional status filter:

```http
GET /api/partner/payout/requests?status=PENDING&page=1&limit=20
```

Allowed statuses:

```text
PENDING
APPROVED
REJECTED
```

Response:

```json
{
  "success": true,
  "message": "Partner payout requests fetched successfully",
  "data": {
    "items": [
      {
        "_id": "payoutRequestId",
        "amount": 1000,
        "status": "PENDING",
        "upiId": "partner@upi",
        "upiName": "Bharat Partner",
        "requestedAt": "2026-06-20T00:00:00.000Z",
        "approvedAt": null,
        "rejectedAt": null,
        "rejectionReason": null,
        "adminReferenceId": null,
        "paymentProof": null
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

UI states:

```text
PENDING: show waiting for admin approval
APPROVED: show approved date, reference ID, payment proof image if present
REJECTED: show rejection reason
```

## Empty States

No balance:

```text
No payout balance available yet
```

No UPI:

```text
Add UPI details to request payout
```

No payout history:

```text
No payout requests yet
```

## Error Handling

Show backend error messages directly.

Common errors:

```text
Valid payout amount is required
Minimum payout amount is X
Payout amount exceeds available payout range
UPI ID and UPI name are required
Valid UPI ID is required
Insufficient available payout balance
Invalid payout status
```

## Important App Logic

- Always call summary before opening request modal.
- Use `payoutRange.max` as the maximum selectable amount.
- If user changes UPI in modal, submit the new UPI details with payout request.
- After request success, refresh summary because available and hold balances change.
- Payout amounts are rupees, not paisa.
- Do not calculate partner earnings in the app. Backend calculates earnings from approved tenant key purchases.
