# Optional Aadhaar Verification - Partner App Contract

This document is for the Partner App developer.

## What Changed

Tenant creation now has two separate checkbox-controlled settings:

1. Verify this tenant creation now using normal OTP or Aadhaar OTP.
2. Configure whether future borrower onboarding for this tenant uses Aadhaar-backed OTP.

These fields are different and should not be mixed.

Tenant creation verification uses:

```json
{
  "tenantCreationVerificationMode": "mobile_otp"
}
```

When the Partner App checkbox is checked, send:

```json
{
  "tenantCreationVerificationMode": "aadhaar_otp"
}
```

Borrower onboarding preference uses:

```json
{
  "isAdhaarVerificationEnabled": false
}
```

Default value is `false`.

When this is `true`, borrowers under that tenant go through Aadhaar-backed OTP verification during onboarding.

When this is `false`, borrowers under that tenant go through normal mobile OTP verification during onboarding.

## UI Change Required

Add two checkboxes in the Create Tenant screen.

### Checkbox 1: Tenant Creation Verification

```text
Use Aadhaar OTP to verify this tenant admin now
```

Default state:

```text
Unchecked
```

When unchecked, send:

```json
"tenantCreationVerificationMode": "mobile_otp"
```

When checked, send:

```json
"tenantCreationVerificationMode": "aadhaar_otp"
```

OTP is sent to `supportPhone`. Both modes are mocked with OTP `123456` for now.

### Checkbox 2: Borrower Onboarding Aadhaar

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

## API Flow: Create Tenant From Partner App

### Step 1: Initiate Tenant Creation Verification

```http
POST /api/partner/tenants/initiate-verification
Authorization: Bearer <partnerAdminAccessToken>
Content-Type: application/json
```

Request:

```json
{
  "name": "Bharat Finance - Jaipur Branch",
  "supportPhone": "9800000010",
  "tenantCreationVerificationMode": "mobile_otp"
}
```

Future Aadhaar readiness: when real Aadhaar OTP is connected, backend will match Aadhaar document name and mobile against the submitted `name` and `supportPhone`.

Response:

```json
{
  "success": true,
  "message": "Tenant creation OTP sent successfully",
  "data": {
    "verificationSessionId": "otp_...",
    "otpSent": true,
    "tenantCreationVerificationMode": "mobile_otp",
    "expiresInSeconds": 600
  }
}
```

### Step 2: Verify Tenant Creation OTP

```http
POST /api/partner/tenants/verify-verification
Authorization: Bearer <partnerAdminAccessToken>
Content-Type: application/json
```

Request:

```json
{
  "supportPhone": "9800000010",
  "tenantCreationVerificationMode": "mobile_otp",
  "verificationSessionId": "otp_...",
  "otp": "123456"
}
```

Response:

```json
{
  "success": true,
  "message": "Tenant creation OTP verified successfully",
  "data": {
    "verified": true,
    "verificationSessionId": "otp_...",
    "tenantCreationVerificationMode": "mobile_otp",
    "nextStep": "CREATE_TENANT"
  }
}
```

### Step 3: Create Tenant

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
  "tenantCreationVerificationMode": "mobile_otp",
  "tenantCreationVerificationSessionId": "otp_...",
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

The Partner App must verify the tenant creation OTP before calling the create tenant API.

Flow:

```text
Fill tenant form
POST /api/partner/tenants/initiate-verification
Show OTP modal
POST /api/partner/tenants/verify-verification
POST /api/partner/tenants?app=true
```

The create tenant API rejects the request if the verification session is missing, unverified, expired, consumed, or does not match `name`, `supportPhone`, and `tenantCreationVerificationMode`.

## Important Notes

- If the checkbox is not shown or the field is omitted, backend stores `false`.
- Existing tenants without this field behave as `false`.
- `tenantCreationVerificationMode` affects this tenant creation only.
- `isAdhaarVerificationEnabled` affects the Borrower/User App onboarding flow only.
- A verified tenant creation OTP can be used only once.
