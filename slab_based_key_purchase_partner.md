# Slab-Based Key Purchase Discounts — Partner App Contract

This document is for the Partner App developer.

## Feature Summary

Every dealer/tenant has its own key-purchase discount configuration. The discount applied to a key purchase depends on the number of keys in that individual purchase.

The initial configuration is:

| Key quantity | Default discount | Editable |
|---|---:|---|
| 0–25 | 0% | No — permanently fixed |
| 26–75 | 10% | Yes |
| 76–150 | 15% | Yes |
| 151–250 | 20% | Yes |
| 251–450 | 25% | Yes |
| 451–750 | 30% | Yes |
| 751–2000 | 35% | Yes |

The last stored slab has `maxKeys: null`, meaning unlimited. The Partner App may display it as `751–2000` because the current default maximum key purchase is 2,000.

Only discount percentages are editable. Quantity ranges are controlled by the backend and must not be changed by the Partner App.

## Partner App Placement

Add the slab editor to the existing **Dealer Details / Tenant Details** page.

Place it after the dealer's existing profile, support-contact, and POC sections.

Suggested section title:

```text
Key Purchase Discounts
```

Suggested helper text:

```text
Set the discount percentage for each key purchase slab.
```

Each row should display:

```text
Slab | Current value | New percentage input
```

Example:

```text
0–25      | 0%  | Disabled input: 0% (Fixed)
26–75     | 10% | Input: 10%
76–150    | 15% | Input: 15%
151–250   | 20% | Input: 20%
251–450   | 25% | Input: 25%
451–750   | 30% | Input: 30%
751–2000  | 35% | Input: 35%
```

Add one button after all rows:

```text
Update Discounts
```

While the request is running:

- Disable every input.
- Disable the update button.
- Show a loading indicator.
- Change the button text to `Updating...` or `Saving...`.
- Prevent duplicate submissions.

## Fetch Dealer/Tenant Details

Use the existing tenant-detail endpoint:

```http
GET /api/partner/tenants/:tenantId
Authorization: Bearer <partnerAdminAccessToken>
```

The authenticated partner can fetch only a tenant belonging to that partner.

### Sample Response

```json
{
  "success": true,
  "message": "Partner tenant fetched successfully",
  "data": {
    "_id": "tenantId",
    "name": "Apex Rural - Tenant-1",
    "type": "standalone_outlet",
    "channelPartnerId": "channelPartnerId",
    "creditPurchasePerKeyPrice": 100,
    "creditPurchaseDiscountVersion": 1,
    "creditPurchaseDiscountSlabs": [
      { "minKeys": 0, "maxKeys": 25, "discountPercentage": 0 },
      { "minKeys": 26, "maxKeys": 75, "discountPercentage": 10 },
      { "minKeys": 76, "maxKeys": 150, "discountPercentage": 15 },
      { "minKeys": 151, "maxKeys": 250, "discountPercentage": 20 },
      { "minKeys": 251, "maxKeys": 450, "discountPercentage": 25 },
      { "minKeys": 451, "maxKeys": 750, "discountPercentage": 30 },
      { "minKeys": 751, "maxKeys": null, "discountPercentage": 35 }
    ],
    "creditPurchaseDiscountUpdatedAt": "2026-08-08T17:30:00.000Z",
    "creditPurchaseDiscountUpdatedBy": "accountId"
  }
}
```

Use `creditPurchaseDiscountSlabs` to render the rows. Keep `creditPurchaseDiscountVersion` in the page state because it is required for safe updates.

## Update Dealer/Tenant Discount Slabs

```http
PUT /api/partner/tenants/:tenantId/credit-purchase-discounts
Authorization: Bearer <partnerAdminAccessToken>
Content-Type: application/json
```

The Partner App must send the complete slab array, including the locked first slab. Do not send only the changed row.

### Sample Request

```json
{
  "discountConfigVersion": 1,
  "slabs": [
    { "minKeys": 0, "maxKeys": 25, "discountPercentage": 0 },
    { "minKeys": 26, "maxKeys": 75, "discountPercentage": 12 },
    { "minKeys": 76, "maxKeys": 150, "discountPercentage": 17.5 },
    { "minKeys": 151, "maxKeys": 250, "discountPercentage": 20 },
    { "minKeys": 251, "maxKeys": 450, "discountPercentage": 25 },
    { "minKeys": 451, "maxKeys": 750, "discountPercentage": 30 },
    { "minKeys": 751, "maxKeys": null, "discountPercentage": 35 }
  ]
}
```

### Sample Success Response

```json
{
  "success": true,
  "message": "Tenant credit purchase discounts updated successfully",
  "data": {
    "tenantId": "tenantId",
    "discountConfigVersion": 2,
    "slabs": [
      { "minKeys": 0, "maxKeys": 25, "discountPercentage": 0 },
      { "minKeys": 26, "maxKeys": 75, "discountPercentage": 12 },
      { "minKeys": 76, "maxKeys": 150, "discountPercentage": 17.5 },
      { "minKeys": 151, "maxKeys": 250, "discountPercentage": 20 },
      { "minKeys": 251, "maxKeys": 450, "discountPercentage": 25 },
      { "minKeys": 451, "maxKeys": 750, "discountPercentage": 30 },
      { "minKeys": 751, "maxKeys": null, "discountPercentage": 35 }
    ]
  }
}
```

After success:

- Replace the displayed current values with `data.slabs`.
- Replace the locally stored version with `data.discountConfigVersion`.
- Clear any field errors.
- Show a success message such as `Discount slabs updated successfully`.

## Validation Rules

The Partner App should validate before submission, but the backend remains authoritative.

- The full seven-slab array is required.
- Quantity ranges cannot change.
- The `0–25` discount must remain `0`.
- Every other discount must be a numeric value from `0` through `50`, inclusive.
- Decimal percentages are supported up to the normal two-decimal money precision used by the backend.
- Empty, negative, non-numeric, and greater-than-50 values must not be submitted.
- Send the latest `creditPurchaseDiscountVersion` received from the backend.

## Error Responses

### Invalid Percentage

Status: `400 Bad Request`

```json
{
  "success": false,
  "error": "Discount for 26-75 keys must be between 0 and 50"
}
```

Show the message beside the affected input and optionally as a toast/snackbar.

### Attempt to Change the Fixed Slab

Status: `400 Bad Request`

```json
{
  "success": false,
  "error": "The 0-25 key discount slab is fixed at 0%"
}
```

The app should prevent this by keeping the first input disabled.

### Quantity Range Changed

Status: `400 Bad Request`

```json
{
  "success": false,
  "error": "Discount slab 2 must keep the 26-75 key range"
}
```

### Invalid Configuration Version

Status: `400 Bad Request`

```json
{
  "success": false,
  "error": "discountConfigVersion must be a positive integer"
}
```

### Configuration Changed by Another User

Status: `409 Conflict`

```json
{
  "success": false,
  "error": "Discount configuration changed. Refresh before saving"
}
```

When this happens:

1. Do not automatically resubmit the old values.
2. Fetch the dealer details again.
3. Show the latest current values.
4. Inform the user that the configuration was updated elsewhere.

### Tenant Not Found or Not Owned by Partner

Status: `404 Not Found`

```json
{
  "success": false,
  "error": "Tenant not found"
}
```

The same response is used when the tenant exists but belongs to another partner, preventing cross-partner access.

### Authentication/Authorization Errors

Possible statuses:

```text
401 Unauthorized
403 Forbidden
```

Follow the Partner App's existing token-refresh and sign-in handling.

## How the New Purchase Calculation Works

The discount applies to the complete key purchase, not progressively to portions of the quantity.

Example for 100 keys at ₹100 per key:

```text
Matching slab = 76–150
Gross amount = 100 × ₹100 = ₹10,000
Discount = 15% = ₹1,500
Net amount payable = ₹8,500
```

The backend snapshots the base price, gross amount, matched slab, percentage, discount amount, net amount, and discount configuration version when the dealer submits the purchase request.

Existing pending and historical requests do not change when a partner later edits the tenant's percentages.

## Important Integration Boundary

The Partner App endpoint in this document manages discount percentages. The dealer/tenant key-purchase screen must separately use slab-aware purchase APIs and must not continue estimating the payable amount using only:

```text
quantity × perKeyPrice
```

Before providing the final dealer-app integration contract, we need the current dealer key-purchase implementation details requested below.

## Questionnaire for the Dealer Key-Purchase Flow

Please return the following information from the current dealer/tenant app implementation.

### Estimated Price Screen

1. Which API is called when the dealer opens the key-purchase screen?
2. Which API is called after the dealer enters or changes the key quantity?
3. Is the estimated amount calculated locally in the app or returned by the backend?
4. Which response fields are currently used to show:
   - per-key price;
   - selected key quantity;
   - estimated payable amount;
   - minimum and maximum purchase limits;
   - UPI ID, UPI name, and QR image?
5. Please provide a sample response from the API currently used for the estimated price.
6. Please share the relevant request/response model names used by the app, if applicable.

### Create Key Purchase Request

7. Which API creates/submits the key-purchase request?
8. Is the request JSON or multipart form data?
9. Which fields are sent in the request? Include the exact field names for:
   - requested key quantity;
   - per-key price, if sent;
   - estimated or purchase amount, if sent;
   - payment proof;
   - payment reference/UTR;
   - any pricing/configuration version.
10. Please provide a sample request payload currently sent by the app.
11. Please provide a sample success response currently consumed by the app.
12. Which response fields are saved or displayed in key-purchase history and detail screens?
13. How does the app currently handle a changed price or mismatched purchase amount?
14. Does the app allow more than one pending key-purchase request?

Please return the current API paths, sample payloads/responses, and field mappings. After receiving them, we will provide the newer slab-aware dealer purchase APIs and data contract so estimated pricing and purchase creation remain fully synchronized with the new discount system.
