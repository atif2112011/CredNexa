# Optional Aadhaar Verification - User App Contract

This document is for the Borrower/User App developer.

## What Changed

Borrower onboarding OTP behavior now depends on the tenant setting:

```json
{
  "isAdhaarVerificationEnabled": true
}
```

The User App does not set this value. It is configured when the tenant is created from the Partner/Admin side.

## Two Possible Backend Behaviors

### 1. Aadhaar Verification Enabled

If the tenant has:

```json
"isAdhaarVerificationEnabled": true
```

then onboarding uses Aadhaar-backed OTP behavior.

Backend behavior:

- Mobile can match borrower mobile or Aadhaar-linked mobile.
- Backend uses OTP purpose `aadhaar_consent`.
- Backend performs Aadhaar profile/name verification.
- Consent acceptance stores Aadhaar verification proof.
- User is marked `aadhaarVerified: true`.

### 2. Aadhaar Verification Disabled

If the tenant has:

```json
"isAdhaarVerificationEnabled": false
```

then onboarding uses normal mobile OTP behavior.

Backend behavior:

- Mobile must match the borrower registered mobile.
- Backend uses OTP purpose `consent`.
- Backend skips Aadhaar profile/name verification.
- Consent acceptance stores mobile OTP proof.
- User is marked `aadhaarVerified: false`.

## UI Change Required

No new API screen is required.

Recommended UI behavior:

- Keep the same mobile number + OTP screen.
- Do not hardcode the text as Aadhaar OTP.
- Use neutral text such as:

```text
Enter the OTP sent to your registered mobile number
```

Avoid text like:

```text
Enter Aadhaar OTP
```

because some tenants will not use Aadhaar verification.

## Step 1: Initiate OTP

```http
POST /api/app/consent/initiate
Content-Type: application/json
```

Request:

```json
{
  "mobile": "9876543210",
  "enrollmentToken": "<enrollmentToken>"
}
```

Success response is the same for both modes:

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "verificationSessionId": "otp_...",
    "otpSent": true,
    "flowType": "ONBOARDING_CONSENT",
    "nextStep": "VERIFY_OTP",
    "maskedMobile": "98****3210",
    "expiresInSeconds": 600
  }
}
```

## Step 2: Verify OTP

```http
POST /api/app/consent/verify-otp
Content-Type: application/json
```

Request:

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "otp_...",
  "otp": "123456",
  "enrollmentToken": "<enrollmentToken>"
}
```

Success response for new onboarding:

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "accessToken": "<borrowerUserAccessToken>",
    "tokenType": "user",
    "flowType": "ONBOARDING_CONSENT",
    "nextStep": "SHOW_CONSENT",
    "user": {
      "id": "<userId>",
      "name": "Ramesh Kumar",
      "mobile": "9876543210",
      "tenantId": "<tenantId>",
      "consentRecordId": null,
      "isDeviceLinked": false,
      "linkedDeviceId": null
    }
  }
}
```

The response shape is the same whether Aadhaar is enabled or disabled.

## Step 3: Show Consent Screen

After `nextStep: "SHOW_CONSENT"`, fetch and show consent terms:

```http
GET /api/app/consent/terms
```

The user must accept the checkbox before device registration.

## Step 4: Accept Consent

```http
POST /api/app/consent/accept
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json
```

Request:

```json
{
  "consentCheckboxAccepted": true,
  "consentVersion": "1.0"
}
```

Success response:

```json
{
  "success": true,
  "message": "Consent accepted successfully",
  "data": {
    "consentRecordId": "<consentRecordId>",
    "consentAccepted": true,
    "accessToken": "<borrowerUserAccessToken>",
    "tokenType": "user",
    "nextStep": "REGISTER_DEVICE",
    "user": {
      "id": "<userId>",
      "name": "Ramesh Kumar",
      "tenantId": "<tenantId>",
      "consentRecordId": "<consentRecordId>"
    }
  }
}
```

## Error Differences

When Aadhaar verification is enabled, this error can happen:

```json
{
  "success": false,
  "error": "Aadhaar Mobile does not match registered borrower"
}
```

When Aadhaar verification is disabled, this error can happen:

```json
{
  "success": false,
  "error": "Mobile does not match registered borrower"
}
```

## Important Notes

- User App request body does not change.
- User App does not need to know the tenant setting in advance.
- Do not display Aadhaar-specific UI copy unless the backend later exposes the tenant setting to the app.
- Use the existing `flowType` and `nextStep` values to drive navigation.
- Mock OTP remains `123456` in local/mock mode.
