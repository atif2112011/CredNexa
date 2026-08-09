# Tenant Credit Contract

This contract covers the tenant/distributor app changes for borrower creation credits.

For tenant credit purchase request screens and APIs, use `credit_purchase_system_for_tenant.md`.

## Credit Rule

- One tenant credit is consumed when a tenant successfully creates one borrower.
- Failed borrower creation does not consume credit.
- Existing tenants start with `0` credits unless super admin adds credits.
- The tenant app should block or warn on borrower creation when available credits are `0`.

## Dashboard API

### Request

```http
GET /api/distributor/dashboard
Authorization: Bearer <tenant_admin_access_token>
```

Alias:

```http
GET /api/tenant/dashboard
Authorization: Bearer <tenant_admin_access_token>
```

### Response Change

The dashboard response now includes:

```json
{
  "credits": {
    "available": 12
  }
}
```

### App Usage

- Show `credits.available` on the tenant dashboard.
- If `credits.available <= 0`, disable borrower creation or show a clear warning before opening the borrower form.

## Create Borrower API

### Request

```http
POST /api/distributor/users/register
Authorization: Bearer <tenant_admin_access_token>
Content-Type: application/json
```

Alias:

```http
POST /api/tenant/users/register
Authorization: Bearer <tenant_admin_access_token>
Content-Type: application/json
```

Request body is unchanged.

### Success Response Change

On successful borrower creation, the response now includes the remaining credits:

```json
{
  "userId": "665f...",
  "tenantId": "665f...",
  "loanId": "LOAN-001",
  "enrollmentToken": "token...",
  "tokenExpiresAt": "2026-06-12T10:00:00.000Z",
  "credits": {
    "remaining": 11
  }
}
```

### Insufficient Credits Response

If the tenant has no credits:

```http
HTTP 402 Payment Required
```

```json
{
  "success": false,
  "error": "Insufficient credits to create borrower"
}
```

### App Usage

- On success, update the local/dashboard credit count from `credits.remaining`.
- On `402`, show a message such as: `No credits available. Please contact admin to add credits.`
- Do not retry automatically on `402`; the tenant needs credits added first.

## Important Notes

- The tenant app can request credit purchases through the credit purchase APIs documented separately.
- Super admin can still manage direct credit additions/deductions outside the tenant app.
- Borrower creation request body remains unchanged, so only response/error handling and dashboard display need app changes.
- For normal paid key purchases, use the tenant credit purchase-request flow. The backend calculates gross amount, applies the matching tenant discount slab, stores net `purchaseAmount`, and calculates partner payout credit from that discounted net amount.
- The direct positive admin adjustment endpoint is a legacy compatibility path. It continues using `purchaseAmount = credits * perKeyPrice`, does not apply discount slabs, and must not be used for new paid purchase integrations.
- See `slab_based_key_purchase_tenant.md` for the current Tenant App purchase contract.
