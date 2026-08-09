# Slab-Based Key Purchase — Tenant App Contract

This document is for the Tenant App developer.

## Required Migration

The Tenant App must move from the old single per-key-price purchase flow to the new slab-based purchase flow.

The old calculation was:

```text
purchaseAmount = requestedCredits × perKeyPrice
```

Do not use that formula by itself anymore.

The options API still returns the tenant's base per-key price, but it now also returns:

- Tenant-specific discount slabs.
- The discount-configuration version.
- Minimum and maximum purchase limits.
- Admin payment details.

The app must select the matching quantity slab and apply its discount before showing the final amount payable.

## Authentication and API Paths

All APIs require a tenant-admin access token:

```http
Authorization: Bearer <tenantAdminAccessToken>
```

Primary path:

```text
/api/tenant/...
```

Backward-compatible alias:

```text
/api/distributor/...
```

Use the `/api/tenant` paths in new Tenant App development.

The authenticated account must:

- Have the `tenant_admin` role.
- Belong to an active tenant.
- Belong to a tenant with the `distribute` capability.

## 1. Purchase Options API

Call this API when the key-purchase screen opens. Call it again after a stale-pricing/version error.

### Request

```http
GET /api/tenant/credits/purchase/options
Authorization: Bearer <tenantAdminAccessToken>
```

No request body is required.

### Success Response

Status: `200 OK`

```json
{
  "success": true,
  "message": "Credit purchase options fetched successfully",
  "data": {
    "credits": {
      "available": 20,
      "totalPurchased": 500,
      "lifetimePurchaseAmount": 42500
    },
    "pricing": {
      "currency": "INR",
      "perKeyPrice": 100,
      "basePerKeyPrice": 100,
      "source": "tenant_override",
      "discountConfigVersion": 2,
      "discountSlabs": [
        { "minKeys": 0, "maxKeys": 25, "discountPercentage": 0 },
        { "minKeys": 26, "maxKeys": 75, "discountPercentage": 10 },
        { "minKeys": 76, "maxKeys": 150, "discountPercentage": 15 },
        { "minKeys": 151, "maxKeys": 250, "discountPercentage": 20 },
        { "minKeys": 251, "maxKeys": 450, "discountPercentage": 25 },
        { "minKeys": 451, "maxKeys": 750, "discountPercentage": 30 },
        { "minKeys": 751, "maxKeys": null, "discountPercentage": 35 }
      ]
    },
    "limits": {
      "minCredits": 1,
      "maxCredits": 2000,
      "hasMaximumCap": true
    },
    "adminPayment": {
      "upiId": "admin@upi",
      "upiName": "CredNexa Admin",
      "qrImageUrl": "https://storage.example.com/admin-payment-qr.webp"
    }
  }
}
```

## Options Response Fields

### `data.credits`

| Field | Description |
|---|---|
| `available` | Current usable key-credit balance |
| `totalPurchased` | Total approved key credits purchased historically |
| `lifetimePurchaseAmount` | Total approved net purchase amount paid historically |

### `data.pricing`

| Field | Description |
|---|---|
| `currency` | Currently `INR` |
| `perKeyPrice` | Backward-compatible base per-key price field |
| `basePerKeyPrice` | Base per-key price to use for the gross calculation |
| `source` | `tenant_override` when tenant-specific; otherwise `default` |
| `discountConfigVersion` | Version that must be retained and submitted with the purchase request |
| `discountSlabs` | Tenant-specific quantity ranges and discount percentages |

`perKeyPrice` and `basePerKeyPrice` currently contain the same value. New code should use `basePerKeyPrice` because it makes clear that the value is before discount.

### `data.limits`

| Field | Description |
|---|---|
| `minCredits` | Minimum allowed purchase quantity |
| `maxCredits` | Maximum allowed purchase quantity |
| `hasMaximumCap` | When `true`, enforce `maxCredits`; when `false`, no configured maximum applies |

### `data.adminPayment`

Use these fields to show where the tenant must make the external payment before uploading proof.

Do not hardcode the UPI ID, UPI name, or QR image.

## 2. Calculate the Final Purchase Amount

There is no separate estimate API. The Tenant App calculates the displayed estimate locally from the latest options response.

The backend repeats the same calculation during submission and remains authoritative.

### Step 1: Validate Quantity

```text
requestedCredits must be an integer
requestedCredits >= limits.minCredits
requestedCredits <= limits.maxCredits when limits.hasMaximumCap is true
```

### Step 2: Find the Matching Slab

Find the slab where:

```text
requestedCredits >= slab.minKeys
and
slab.maxKeys is null OR requestedCredits <= slab.maxKeys
```

`minKeys` and `maxKeys` are inclusive.

### Step 3: Calculate Gross Amount

```text
grossPurchaseAmount = requestedCredits × pricing.basePerKeyPrice
```

### Step 4: Calculate Discount

```text
discountAmount =
  grossPurchaseAmount × matchingSlab.discountPercentage / 100
```

### Step 5: Calculate Final Amount

```text
purchaseAmount = grossPurchaseAmount - discountAmount
```

Round monetary values to two decimal places, matching normal INR display precision.

### Example

```text
Requested keys: 100
Base per-key price: ₹100
Matching slab: 76–150
Discount: 15%

Gross amount = 100 × ₹100 = ₹10,000
Discount amount = ₹10,000 × 15 / 100 = ₹1,500
Final purchase amount = ₹10,000 - ₹1,500 = ₹8,500
```

The purchase screen should show:

```text
Base per-key price
Requested key quantity
Matching slab
Discount percentage
Gross amount
Discount amount
Final amount payable
```

The amount fields must be display-only. The user must not be allowed to manually edit them.

## 3. Submit Key Purchase Request

The tenant first pays the final amount externally using the Admin UPI/QR details. The app then uploads the payment proof and submits the purchase request.

### Request

```http
POST /api/tenant/credits/purchase/requests
Authorization: Bearer <tenantAdminAccessToken>
Content-Type: multipart/form-data
```

### Multipart Fields

| Field | Required | Description |
|---|---|---|
| `requestedCredits` | Yes | Positive integer quantity |
| `discountConfigVersion` | Yes for the new app flow | Version received from the options API |
| `purchaseAmount` | Recommended | Final discounted amount displayed by the app; backend verifies it |
| `referenceNumber` | No | Payment reference/UTR |
| `proofImage` | Yes | Payment-proof image |

Example multipart values:

```text
requestedCredits = 100
discountConfigVersion = 2
purchaseAmount = 8500
referenceNumber = UTR123456
proofImage = <JPEG, PNG, or WebP file>
```

Do not send or trust locally stored values for:

```text
perKeyPrice
grossPurchaseAmount
discountPercentage
discountAmount
discountSlabSnapshot
```

The backend obtains and calculates those values from the latest tenant configuration.

### Payment Proof Rules

```text
Field name: proofImage
Allowed types: JPEG, PNG, WebP
Maximum size: 5 MB
```

### JSON Fallback

If the image was already uploaded through an approved flow, the backend also accepts:

```http
POST /api/tenant/credits/purchase/requests
Content-Type: application/json
```

```json
{
  "requestedCredits": 100,
  "discountConfigVersion": 2,
  "purchaseAmount": 8500,
  "referenceNumber": "UTR123456",
  "paymentProofImageUrl": "https://storage.example.com/payment-proof.webp"
}
```

The normal Tenant App flow should use multipart upload with `proofImage`.

## Submission Success Response

Status: `201 Created`

```json
{
  "success": true,
  "message": "Credit purchase request submitted successfully",
  "data": {
    "creditPurchaseRequest": {
      "_id": "purchaseRequestId",
      "tenantId": "tenantId",
      "channelPartnerId": "channelPartnerId",
      "requestedCredits": 100,
      "perKeyPrice": 100,
      "grossPurchaseAmount": 10000,
      "discountPercentage": 15,
      "discountAmount": 1500,
      "purchaseAmount": 8500,
      "discountSlabSnapshot": {
        "minKeys": 76,
        "maxKeys": 150,
        "discountPercentage": 15
      },
      "discountConfigVersion": 2,
      "currency": "INR",
      "status": "PENDING",
      "adminPaymentSnapshot": {
        "upiId": "admin@upi",
        "upiName": "CredNexa Admin",
        "qrImageUrl": "https://storage.example.com/admin-payment-qr.webp"
      },
      "paymentProof": {
        "imageUrl": "https://storage.example.com/payment-proof.webp",
        "mimeType": "image/webp",
        "uploadedAt": "2026-08-09T10:30:00.000Z"
      },
      "referenceNumber": "UTR123456",
      "requestedAt": "2026-08-09T10:30:00.000Z",
      "createdAt": "2026-08-09T10:30:00.000Z",
      "updatedAt": "2026-08-09T10:30:00.000Z"
    }
  }
}
```

The backend snapshots all pricing values. A later change to the tenant's price or discount slabs does not modify this pending or historical request.

After success:

- Show that the request is pending Admin approval.
- Clear the purchase form.
- Do not increase the available key balance locally.
- Refresh or navigate to purchase history.

Credits are added only after Admin approval.

If the tenant belongs to a channel partner, Admin approval also awards partner credit from this request's snapshotted discounted net `purchaseAmount`. The Tenant App does not calculate or display that partner earning.

## Backend Submission Checks

The backend:

1. Confirms the tenant-admin scope and tenant capability.
2. Validates the requested quantity.
3. Requires payment proof.
4. Rejects a second request while another request is pending.
5. Enforces current minimum and maximum limits.
6. Fetches the latest tenant base price and discount slabs.
7. Verifies `discountConfigVersion` when supplied.
8. Selects the matching slab.
9. Recalculates gross amount, discount, and final amount.
10. Verifies `purchaseAmount` when supplied.
11. Creates a `PENDING` request with pricing snapshots.

Partner payout balance is not changed during submission. It is updated only if Admin later approves the request, using the stored net `purchaseAmount`.

## Submission Errors

### Discount Configuration Changed

Status: `409 Conflict`

```json
{
  "success": false,
  "error": "Discount configuration changed. Refresh pricing before submitting the purchase"
}
```

Required app behavior:

1. Fetch the options API again.
2. Recalculate the payable amount.
3. Show the updated price to the user.
4. Do not silently resubmit using the old amount.

### Another Request Is Pending

Status: `409 Conflict`

```json
{
  "success": false,
  "error": "A credit purchase request is already pending approval"
}
```

Navigate the user to the pending request or purchase history.

### Purchase Amount Mismatch

Status: `400 Bad Request`

```json
{
  "success": false,
  "error": "purchaseAmount must equal the backend-calculated discounted amount"
}
```

Fetch options again and recalculate before retrying.

### Other Possible Errors

```text
requestedCredits must be a positive integer
Payment proof image is required
Minimum credit purchase is X
Maximum credit purchase is 2000
Payment proof image must be JPEG, PNG, or WebP
Payment proof image must be 5 MB or smaller
tenant_admin role is required
Active tenant not found
Tenant does not have distribute capability
```

## Purchase History APIs

List the authenticated tenant's requests:

```http
GET /api/tenant/credits/purchase/requests?page=1&limit=20
```

Optional status filter:

```http
GET /api/tenant/credits/purchase/requests?status=PENDING&page=1&limit=20
```

Fetch one request:

```http
GET /api/tenant/credits/purchase/requests/:requestId
```

Allowed statuses:

```text
PENDING
APPROVED
REJECTED
```

History and detail screens should display the snapshotted gross amount, discount, and final amount rather than recalculating old requests from the current slabs.

## Required Tenant App Flow

```text
Open key-purchase screen
-> GET /api/tenant/credits/purchase/options
-> Store base price, slabs, version, limits, and payment details
-> Dealer enters requested quantity
-> App finds the matching slab
-> App displays gross, discount, and final payable amount
-> Dealer pays the final amount
-> Dealer uploads payment proof
-> POST /api/tenant/credits/purchase/requests
-> Backend recalculates and snapshots pricing
-> App displays the PENDING request
-> Credits are added only after Admin approval
```

The Tenant App must not continue using the old single-price calculation after this migration.
