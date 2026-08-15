# Tenant Key Discount Change Approval Contract

Partner-requested slab changes are stored separately from the tenant's live pricing configuration. One pending request is allowed per tenant.

## Partner Submission

```http
PUT /api/partner/tenants/:tenantId/credit-purchase-discounts
Authorization: Bearer <partnerAdminAccessToken>
Content-Type: application/json
```

The request body remains the complete seven-slab array plus `discountConfigVersion`. Success returns `201 Created` with `message: "Discount change request created successfully"` and `data.discountChangeRequest`. The tenant's live slabs and version remain unchanged.

If a pending request already exists, the API returns `409 Conflict` with `error: "A discount change request is already pending approval"` and `data.requestId`.

Request creation sends an approval email to the configured Admin recipient. Email failure is logged and does not roll back the created request.

## Admin APIs

List requests:

```http
GET /api/admin/tenant-credit-discount-changes?status=PENDING&page=1&limit=20
```

Optional filters: `tenantId`, `channelPartnerId`, and `search` by tenant or partner name.

Fetch details:

```http
GET /api/admin/tenant-credit-discount-changes/:requestId
```

Approve:

```http
POST /api/admin/tenant-credit-discount-changes/:requestId/approve

{
  "note": "Approved requested dealer discounts"
}
```

Approval atomically applies `requestedSlabs`, increments `creditPurchaseDiscountVersion`, and marks the request `APPROVED`. If the live tenant version no longer matches the request's `baseConfigVersion`, approval returns `409 Conflict` and does not apply the slabs.

Reject:

```http
POST /api/admin/tenant-credit-discount-changes/:requestId/reject

{
  "reason": "Requested percentages are not approved"
}
```

Rejection requires a reason, marks the request `REJECTED`, and leaves the tenant configuration unchanged.

The Admin portal exposes these operations under **Discount Requests**.
