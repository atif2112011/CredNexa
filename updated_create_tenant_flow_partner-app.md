# Updated Create Tenant Flow - Partner App

This document is for the Partner App developer.

## What Changed

Partner App tenant creation is no longer a single API call.

New flow:

```text
Fill Create Tenant form
Initiate tenant creation OTP
Show OTP modal/screen
Verify OTP
Create tenant with verified OTP session
Show tenant admin credentials
```

The create tenant API now requires proof that the tenant creation OTP was verified.

## UI Changes Required

### 1. Create Tenant Form

Keep the existing Create Tenant form fields.

Add this checkbox:

```text
Use Aadhaar OTP to verify this tenant admin now
```

Default:

```text
Unchecked
```

When unchecked, send:

```json
{
  "tenantCreationVerificationMode": "mobile_otp"
}
```

When checked, send:

```json
{
  "tenantCreationVerificationMode": "aadhaar_otp"
}
```

This checkbox controls the OTP used before creating the tenant.

### 2. Borrower Aadhaar Checkbox

Keep the existing borrower onboarding checkbox separate:

```text
Enable Aadhaar verification for borrower onboarding
```

It maps to:

```json
{
  "isAdhaarVerificationEnabled": false
}
```

Important:

```text
tenantCreationVerificationMode = verifies this tenant creation now
isAdhaarVerificationEnabled = controls future borrower onboarding
```

### 3. OTP Screen Or Modal

After the user submits the Create Tenant form, do not call create tenant directly.

First call the initiate OTP API. If successful, show an OTP modal/screen.

For now, OTP is mocked as:

```text
123456
```

After OTP verification succeeds, call the create tenant API with the verified session ID.

## API Flow

Base URL:

```text
/api
```

All APIs require:

```http
Authorization: Bearer <partnerAdminAccessToken>
Content-Type: application/json
```

## Step 1: Initiate Tenant Creation OTP

```http
POST /api/partner/tenants/initiate-verification
```

Request:

```json
{
  "name": "Bharat Finance - Jaipur Branch",
  "supportPhone": "9800000010",
  "tenantCreationVerificationMode": "mobile_otp"
}
```

Use the tenant form's `name` and `supportPhone`.

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

App behavior:

```text
Store data.verificationSessionId temporarily.
Show OTP modal/screen.
```

## Step 2: Verify Tenant Creation OTP

```http
POST /api/partner/tenants/verify-verification
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

App behavior:

```text
If verified is true and nextStep is CREATE_TENANT, call create tenant API.
```

## Step 3: Create Tenant

```http
POST /api/partner/tenants?app=true
```

Request:

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

Rules:

- `supportPhone` must match the phone used in OTP initiate and verify.
- `name` must match the name used in OTP initiate.
- `tenantCreationVerificationMode` must match the mode used in OTP initiate and verify.
- `tenantCreationVerificationSessionId` must be the verified session ID.
- The verified OTP session can be used only once.
- If the session is missing, expired, unverified, already used, or mismatched, tenant creation fails.

Success response:

```json
{
  "success": true,
  "message": "Partner tenant created successfully",
  "data": {
    "tenant": {
      "_id": "tenantId",
      "name": "Bharat Finance - Jaipur Branch",
      "type": "nbfc",
      "supportPhone": "9800000010",
      "isAdhaarVerificationEnabled": false,
      "adminAccountId": "accountId"
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

App behavior:

```text
Show tenant admin credentials after success.
Do not show the temporary password again after leaving this screen.
```

## Suggested Screen Flow

```text
Create Tenant Form
  Submit
  -> POST /partner/tenants/initiate-verification

OTP Modal
  Enter OTP
  -> POST /partner/tenants/verify-verification

Create Tenant API
  -> POST /partner/tenants?app=true

Success Screen
  Show tenant admin email and temporary password
```

## Error Handling

If initiate fails:

```text
Stay on Create Tenant form and show the backend error.
```

Common reasons:

- Missing `supportPhone`
- Invalid `supportPhone`
- Invalid `tenantCreationVerificationMode`

If verify fails:

```text
Stay on OTP modal and show the backend error.
```

Common reasons:

- Wrong OTP
- Expired OTP
- Maximum OTP attempts exceeded
- Phone or mode mismatch

If create tenant fails:

```text
Return to form or keep the submitted state and show the backend error.
```

Common reasons:

- OTP session not verified
- OTP session already used
- OTP session expired
- Tenant name mismatch
- `supportPhone` mismatch
- `tenantCreationVerificationMode` mismatch
- Tenant admin email already exists

## Implementation Notes

- Do not call `POST /api/partner/tenants?app=true` before OTP verification succeeds.
- Do not allow changing `name`, `supportPhone`, or `tenantCreationVerificationMode` after OTP verification without restarting OTP verification.
- If the user edits `name` after OTP is sent, discard the old `verificationSessionId` and initiate OTP again.
- If the user edits `supportPhone` after OTP is sent, discard the old `verificationSessionId` and initiate OTP again.
- If the user toggles the Aadhaar OTP checkbox after OTP is sent, discard the old `verificationSessionId` and initiate OTP again.
- Keep `tenantCreationVerificationMode` separate from `isAdhaarVerificationEnabled`.
