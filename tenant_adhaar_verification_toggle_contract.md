# Tenant Aadhaar Verification Toggle API Contract

This document describes the tenant API used to enable or disable Aadhaar-based borrower onboarding verification for the authenticated tenant.

## Purpose

This API controls the tenant-level flag:

```text
isAdhaarVerificationEnabled
```

The borrower onboarding flow reads this flag to decide which verification path to use during consent OTP initiation:

- `true` -> Aadhaar-linked mobile / Aadhaar consent flow
- `false` -> standard registered mobile consent flow

## Endpoint

```http
PATCH /api/distributor/settings/adhaar-verification
Authorization: Bearer <tenantAdminAccessToken>
Content-Type: application/json
```

Only `tenant_admin` account access can call this route. Tenant scope is resolved from the authenticated account token.

## Request Body

```json
{
  "isAdhaarVerificationEnabled": true,
  "reason": "High-risk tenant requires Aadhaar consent flow"
}
```

## Required Fields

| Field | Required | Notes |
| --- | --- | --- |
| `isAdhaarVerificationEnabled` | Yes | Must be a JSON boolean |
| `reason` | No | Optional audit/support note |

## Behavior

When this API is called, backend:

1. resolves the authenticated tenant from the account token
2. validates that `isAdhaarVerificationEnabled` is a boolean
3. updates the tenant document
4. writes an audit log with event:

```text
TENANT_ADHAAR_VERIFICATION_UPDATED
```

## Success Response

```json
{
  "success": true,
  "message": "Tenant Aadhaar verification setting updated successfully",
  "data": {
    "tenantId": "665f6f0b6f0f6f0b6f0f6f0b",
    "isAdhaarVerificationEnabled": true
  }
}
```

## Validation Errors

Tenant scope missing or inaccessible:

```json
{
  "success": false,
  "error": "tenant_admin role is required"
}
```

Missing or invalid boolean:

```json
{
  "success": false,
  "error": "isAdhaarVerificationEnabled boolean is required"
}
```

Tenant not found:

```json
{
  "success": false,
  "error": "Active tenant not found"
}
```

## App/Backend Effect

The borrower onboarding API checks this tenant flag during consent OTP initiation.

Effective meaning:

- `true` -> borrower onboarding expects Aadhaar-linked mobile matching and Aadhaar consent flow
- `false` -> borrower onboarding uses the normal borrower mobile verification flow
