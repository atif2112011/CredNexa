# Credit Purchase System - Tenant App Contract

This document is for the Tenant App developer.

## Feature Summary

Tenant can request credits by paying Admin externally through UPI/QR and uploading payment proof.

Backend creates a pending approval request. Credits are added only after Admin approves.

All amounts are rupee numbers.

## Screens To Add

### 1. Purchase Credits Screen

Show:

```text
Current available credits
Total credits purchased
Per credit/key price
Minimum purchase quantity
Maximum purchase quantity
Admin UPI ID
Admin UPI name
Admin QR image
Requested credits input
Calculated amount
Upload proof button
Reference number input optional
Request Credit button
```

API:

```http
GET /api/tenant/credits/purchase/options
Authorization: Bearer <tenantAdminAccessToken>
```

Alias:

```http
GET /api/distributor/credits/purchase/options
Authorization: Bearer <tenantAdminAccessToken>
```

Response:

```json
{
  "success": true,
  "message": "Credit purchase options fetched successfully",
  "data": {
    "credits": {
      "available": 12,
      "totalPurchased": 100,
      "lifetimePurchaseAmount": 10000
    },
    "pricing": {
      "currency": "INR",
      "perKeyPrice": 100,
      "source": "default"
    },
    "limits": {
      "minCredits": 1,
      "maxCredits": 500,
      "hasMaximumCap": true
    },
    "adminPayment": {
      "upiId": "test@ybl.in",
      "upiName": "Test Admin",
      "qrImageUrl": "https://placehold.co/600x400"
    }
  }
}
```

UI logic:

```text
amount = requestedCredits * pricing.perKeyPrice
```

Show this calculated amount before the tenant pays.

Do not let the user manually edit the amount.

## 2. Payment Proof Modal/Section

After tenant pays externally, collect:

```text
requestedCredits
proofImage
referenceNumber optional
```

The proof image field name must be:

```text
proofImage
```

Allowed image types:

```text
JPEG
PNG
WebP
```

Max size:

```text
5 MB
```

## Submit Credit Purchase Request

API:

```http
POST /api/tenant/credits/purchase/requests
Authorization: Bearer <tenantAdminAccessToken>
Content-Type: multipart/form-data
```

Alias:

```http
POST /api/distributor/credits/purchase/requests
Authorization: Bearer <tenantAdminAccessToken>
Content-Type: multipart/form-data
```

Multipart fields:

```text
requestedCredits = 10
referenceNumber = UTR123456 optional
proofImage = image file
```

Response:

```json
{
  "success": true,
  "message": "Credit purchase request submitted successfully",
  "data": {
    "creditPurchaseRequest": {
      "_id": "requestId",
      "tenantId": "tenantId",
      "channelPartnerId": "channelPartnerId",
      "requestedCredits": 10,
      "perKeyPrice": 100,
      "purchaseAmount": 1000,
      "currency": "INR",
      "status": "PENDING",
      "adminPaymentSnapshot": {
        "upiId": "test@ybl.in",
        "upiName": "Test Admin",
        "qrImageUrl": "https://placehold.co/600x400"
      },
      "referenceNumber": "UTR123456"
    }
  }
}
```

After success:

```text
Show request submitted
Clear form
Navigate to Credit Purchase History or refresh list
Do not update available credits locally yet
```

Credits are added only after Admin approval.

## 3. Credit Purchase History Screen

API:

```http
GET /api/tenant/credits/purchase/requests?page=1&limit=20
Authorization: Bearer <tenantAdminAccessToken>
```

Optional status filter:

```http
GET /api/tenant/credits/purchase/requests?status=PENDING&page=1&limit=20
```

Alias:

```http
GET /api/distributor/credits/purchase/requests?page=1&limit=20
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
  "message": "Credit purchase requests fetched successfully",
  "data": {
    "items": [
      {
        "_id": "requestId",
        "requestedCredits": 10,
        "perKeyPrice": 100,
        "purchaseAmount": 1000,
        "status": "PENDING",
        "referenceNumber": "UTR123456",
        "requestedAt": "2026-06-20T00:00:00.000Z",
        "approvedAt": null,
        "rejectedAt": null,
        "rejectionReason": null,
        "paymentProof": {
          "imageUrl": "https://..."
        }
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
PENDING: Waiting for admin approval
APPROVED: Credits added
REJECTED: Show rejection reason
```

## 4. Credit Purchase Detail Screen

API:

```http
GET /api/tenant/credits/purchase/requests/:requestId
Authorization: Bearer <tenantAdminAccessToken>
```

Alias:

```http
GET /api/distributor/credits/purchase/requests/:requestId
```

Use this screen to show:

```text
requested credits
per key price
total amount
status
UPI details used at request time
proof image
reference number
approved date
rejected date
rejection reason
```

## Client-Side Validations

Requested credits:

```text
required
integer
>= limits.minCredits
<= limits.maxCredits when hasMaximumCap is true
```

Proof image:

```text
required
JPEG, PNG, or WebP
<= 5 MB
```

Reference number:

```text
optional
trim whitespace
```

Amount:

```text
display only
calculated as requestedCredits * perKeyPrice
do not allow manual edit
```

## Important Backend Rules

- Backend calculates `purchaseAmount`.
- Backend rejects mismatched frontend `purchaseAmount` or `amount` if sent.
- Backend requires payment proof image.
- Backend allows only one pending credit purchase request per tenant.
- Backend does not add credits on submit.
- Backend adds credits only after Admin approval.
- Backend updates partner payout credit on approval if the tenant belongs to a partner.

## Empty States

No requests:

```text
No credit purchase requests yet
```

No credits available:

```text
No credits available
```

Pending request exists:

```text
A credit purchase request is already pending approval
```

## Common Errors

Show backend error messages directly.

Possible messages:

```text
requestedCredits must be a positive integer
Payment proof image is required
Minimum credit purchase is 1
Maximum credit purchase is 500
purchaseAmount must equal requestedCredits * perKeyPrice
A credit purchase request is already pending approval
Invalid credit purchase status
Credit purchase request not found
```
