# Resend OTP API Documentation

This document covers the OTP resend endpoints added for borrower app OTP, partner signup OTP, and partner tenant creation verification OTP.

Base API prefix:

```txt
/api
```

## Provider Behavior

OTP delivery uses the backend `OTP_PROVIDER` env var:

```env
OTP_PROVIDER=mock
```

Supported values:

```txt
mock
msg91
```

In mock mode, the OTP remains:

```txt
123456
```

In MSG91 mode, resend calls the MSG91 OTP retry API through the backend. The frontend/app should never call MSG91 directly.

Required MSG91 env variables:

```env
MSG91_AUTH_KEY=
MSG91_OTP_TEMPLATE_ID=
MSG91_DEFAULT_COUNTRY_CODE=91
MSG91_RESEND_RETRY_TYPE=text
```

## 1. Borrower App Resend OTP

Use this after a borrower OTP session has already been created through:

```txt
POST /api/app/consent/initiate
```

Endpoint:

```http
POST /api/app/consent/resend-otp
```

Auth:

```txt
Public
```

Request body:

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "otp_..."
}
```

Optional:

```json
{
  "retryType": "text"
}
```

Success response:

```json
{
  "success": true,
  "message": "OTP resent successfully",
  "data": {
    "verificationSessionId": "otp_...",
    "otpSent": true,
    "maskedMobile": "98****3210",
    "expiresInSeconds": 540
  }
}
```

Validation notes:

- `mobile` and `verificationSessionId` are required.
- The OTP session must be unverified and unexpired.
- Allowed borrower OTP purposes are consent, Aadhaar consent, onboarding resume, and device login.
- Resend does not create a new `verificationSessionId`; it reuses the current session.

## 2. Partner Signup Resend OTP

Use this after partner signup OTP initiation:

```txt
POST /api/partner/signup/initiate-otp
```

Endpoint:

```http
POST /api/partner/signup/resend-otp
```

Auth:

```txt
Public
```

Request body:

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "otp_..."
}
```

Optional:

```json
{
  "retryType": "text"
}
```

Success response:

```json
{
  "success": true,
  "message": "OTP resent successfully",
  "data": {
    "verificationSessionId": "otp_...",
    "otpSent": true,
    "expiresInSeconds": 540
  }
}
```

Validation notes:

- `mobile` must be a valid 10 digit Indian mobile number.
- The OTP session must be for `partner_signup`.
- The OTP session must be unverified and unexpired.

## 3. Tenant Creation Resend OTP

Use this after tenant creation verification initiation:

```txt
POST /api/partner/tenants/initiate-verification
```

Endpoint:

```http
POST /api/partner/tenants/resend-verification
```

Auth:

```txt
Partner admin JWT required
```

Request body:

```json
{
  "supportPhone": "9876543210",
  "tenantCreationVerificationMode": "mobile_otp",
  "verificationSessionId": "otp_..."
}
```

Optional:

```json
{
  "retryType": "text"
}
```

Success response:

```json
{
  "success": true,
  "message": "Tenant creation OTP resent successfully",
  "data": {
    "verificationSessionId": "otp_...",
    "otpSent": true,
    "tenantCreationVerificationMode": "mobile_otp",
    "expiresInSeconds": 540
  }
}
```

Validation notes:

- `supportPhone`, `tenantCreationVerificationMode`, and `verificationSessionId` are required.
- `supportPhone` must be a valid 10 digit Indian mobile number.
- `tenantCreationVerificationMode` must be `mobile_otp` or `aadhaar_otp`.
- The OTP session must belong to the authenticated partner.
- The OTP session must be for `tenant_creation`.
- The OTP session must be unverified, unconsumed, and unexpired.

## Common Errors

Missing required fields:

```json
{
  "success": false,
  "message": "Mobile and verification session are required"
}
```

Invalid or expired session:

```json
{
  "success": false,
  "message": "Invalid OTP session"
}
```

Provider failure:

```json
{
  "success": false,
  "message": "Unable to send OTP right now"
}
```

## Client Notes

- Always keep the same `verificationSessionId` after resend.
- Do not reset the verification flow unless the initiate endpoint is called again.
- In mock mode, users should still enter `123456`.
- In MSG91 mode, users should enter the latest OTP received on the same mobile number.
