# Partner App — Slab Change Approval Update

This document is for the Partner App developer.

## What Changed

The existing **Key Purchase Discounts** editor remains on the Dealer/Tenant Details screen. Do not create a separate slab-approval screen.

Previously, submitting new discount percentages immediately changed the tenant's live slabs. That behavior has changed.

Now, submitting slab changes creates a request for Admin approval:

```text
Partner submits slab changes
-> Backend creates a PENDING request
-> Admin is notified by email
-> Admin approves or rejects the request
-> Slabs change only after approval
```

The Partner App does not need to implement Admin approval or rejection controls.

## Existing API Path

Continue using the existing endpoint:

```http
PUT /api/partner/tenants/:tenantId/credit-purchase-discounts
Authorization: Bearer <partnerAdminAccessToken>
Content-Type: application/json
```

The request format has not changed. Send the latest configuration version and the complete seven-slab array.

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

Important rules remain unchanged:

- Send all seven slabs, not only the changed rows.
- Quantity ranges cannot be changed.
- The `0–25` slab must remain fixed at `0%`.
- Other percentages must be between `0` and `50`, inclusive.
- Send the latest `creditPurchaseDiscountVersion` as `discountConfigVersion`.

## Request Created Successfully

Status: `201 Created`

```json
{
  "success": true,
  "message": "Discount change request created successfully",
  "data": {
    "discountChangeRequest": {
      "_id": "requestId",
      "tenantId": "tenantId",
      "channelPartnerId": "channelPartnerId",
      "baseConfigVersion": 1,
      "currentSlabs": [
        { "minKeys": 0, "maxKeys": 25, "discountPercentage": 0 },
        { "minKeys": 26, "maxKeys": 75, "discountPercentage": 10 },
        { "minKeys": 76, "maxKeys": 150, "discountPercentage": 15 },
        { "minKeys": 151, "maxKeys": 250, "discountPercentage": 20 },
        { "minKeys": 251, "maxKeys": 450, "discountPercentage": 25 },
        { "minKeys": 451, "maxKeys": 750, "discountPercentage": 30 },
        { "minKeys": 751, "maxKeys": null, "discountPercentage": 35 }
      ],
      "requestedSlabs": [
        { "minKeys": 0, "maxKeys": 25, "discountPercentage": 0 },
        { "minKeys": 26, "maxKeys": 75, "discountPercentage": 12 },
        { "minKeys": 76, "maxKeys": 150, "discountPercentage": 17.5 },
        { "minKeys": 151, "maxKeys": 250, "discountPercentage": 20 },
        { "minKeys": 251, "maxKeys": 450, "discountPercentage": 25 },
        { "minKeys": 451, "maxKeys": 750, "discountPercentage": 30 },
        { "minKeys": 751, "maxKeys": null, "discountPercentage": 35 }
      ],
      "status": "PENDING",
      "requestedAt": "2026-08-15T10:30:00.000Z"
    }
  }
}
```

Required app behavior:

1. Read and display the server's `message`.
2. Recommended presentation: success toast, snackbar, or dialog.
3. Do not replace the displayed current slab values with `requestedSlabs`.
4. Do not increment the locally stored configuration version.
5. Do not show the requested values as active.

The suggested user-facing result is:

```text
Discount change request created successfully
```

The live tenant configuration remains unchanged until Admin approval.

## A Pending Request Already Exists

Only one pending slab-change request is allowed for a tenant.

Status: `409 Conflict`

```json
{
  "success": false,
  "error": "A discount change request is already pending approval",
  "data": {
    "requestId": "pendingRequestId"
  }
}
```

Required app behavior:

1. Read and display the server's `error`.
2. Do not automatically retry the request.
3. Keep the existing live slab values on screen.
4. No separate pending-request or approval screen is required.

The user-facing result should be:

```text
A discount change request is already pending approval
```

## Configuration Version Changed

If the tenant's live slab configuration changed after the Partner App loaded the details, the API returns:

Status: `409 Conflict`

```json
{
  "success": false,
  "error": "Discount configuration changed. Refresh before submitting the request"
}
```

Required app behavior:

1. Display the server's `error`.
2. Fetch the tenant details again.
3. Replace the displayed slabs and stored version with the latest server values.
4. Do not automatically resubmit the old changes.

## Validation Errors

Validation errors continue to use `400 Bad Request`. Display the returned `error` message.

Possible messages include:

```text
Exactly 7 discount slabs are required
The 0-25 key discount slab is fixed at 0%
Discount for 26-75 keys must be between 0 and 50
Discount slab 2 must keep the 26-75 key range
discountConfigVersion must be a positive integer
Invalid tenant ID
```

For a field-specific validation error, show the message near the related input when possible. A toast or snackbar may also be used.

## Tenant and Authorization Errors

Possible responses:

```text
401 Unauthorized
403 Forbidden
404 Tenant not found
```

Continue using the Partner App's existing token-refresh, sign-in, and not-found handling.

## Displaying Server Messages

Use the following response priority:

```text
Successful response: display response.message
Failed response: display response.error
Missing message/error: display the Partner App's generic request-failed message
```

Do not hardcode success handling based only on HTTP `200`. The successful submission status is now `201 Created`.

## Final App Flow

```text
Open Dealer/Tenant Details
-> Render the current live slabs and configuration version
-> Partner edits allowed percentages
-> Partner taps Update Discounts
-> Disable inputs and button while submitting
-> PUT the complete slab array and current version
-> If 201: show response.message
-> If 409 pending: show response.error
-> If 409 stale version: show response.error and refresh tenant details
-> Otherwise: show response.error
-> Re-enable inputs and button
```

No separate slab-request list, detail, status, approval, or rejection screen is required in the Partner App.
