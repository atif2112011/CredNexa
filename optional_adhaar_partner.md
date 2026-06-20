# Optional Aadhaar Verification - Partner App Contract

This document is for the Partner App developer.

## What Changed

Tenant creation now supports a checkbox-controlled Aadhaar verification setting:

```json
{
  "isAdhaarVerificationEnabled": false
}
```

Default value is `false`.

When this is `true`, borrowers under that tenant go through Aadhaar-backed OTP verification during onboarding.

When this is `false`, borrowers under that tenant go through normal mobile OTP verification during onboarding.

## UI Change Required

Add a checkbox in the Create Tenant screen.

Recommended label:

```text
Enable Aadhaar verification for borrower onboarding
```

Default state:

```text
Unchecked
```

When unchecked, send:

```json
"isAdhaarVerificationEnabled": false
```

When checked, send:

```json
"isAdhaarVerificationEnabled": true
```

## API: Create Tenant From Partner App

```http
POST /api/partner/tenants?app=true
Authorization: Bearer <partnerAdminAccessToken>
Content-Type: application/json
```

Example request:

```json
{
  "name": "Bharat Finance - Jaipur Branch",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "parentTenantId": null,
  "supportPhone": "9800000010",
  "supportEmail": "support@bharatjaipur.in",
  "supportWhatsapp": "9800000010",
  "isAdhaarVerificationEnabled": false,
  "address": {
    "street": "20 MI Road",
    "city": "Jaipur",
    "state": "Rajasthan",
    "pincode": "302001"
  },
  "tenantAdmin": {
    "name": "Priya Sharma",
    "email": "priya@bharatjaipur.in",
    "mobile": "9800000011",
    "temporaryPassword": "optional"
  }
}
```

## Success Response

The tenant object includes the setting:

```json
{
  "success": true,
  "message": "Partner tenant created successfully",
  "data": {
    "tenant": {
      "_id": "tenantId",
      "name": "Bharat Finance - Jaipur Branch",
      "type": "nbfc",
      "capabilities": ["lend", "distribute"],
      "isAdhaarVerificationEnabled": false,
      "channelPartnerId": "channelPartnerId"
    },
    "tenantAdmin": {
      "accountId": "accountId",
      "name": "Priya Sharma",
      "email": "priya@bharatjaipur.in",
      "mobile": "9800000011",
      "role": "tenant_admin"
    },
    "credentials": {
      "email": "priya@bharatjaipur.in",
      "temporaryPassword": "generated-or-requested-password"
    }
  }
}
```

## App Behavior

The Partner App only needs to send the checkbox value during tenant creation.

No other Partner App API changes are required.

## Important Notes

- If the checkbox is not shown or the field is omitted, backend stores `false`.
- Existing tenants without this field behave as `false`.
- This setting affects the Borrower/User App onboarding flow only.
- The Partner App does not need to handle the OTP behavior directly.
