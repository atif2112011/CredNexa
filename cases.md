# EMI Shield - Device Onboarding Test Cases

## Assumption

The tenant-side borrower already exists and you have:

- `tenantAdminAccessToken`
- `enrollmentToken`
- borrower mobile number

Mock OTP is always:

```text
123456
```

`POST /app/consent/initiate` does not return the OTP.

---

## Case 1 - Happy Path: New Device Onboarding

### 1. Generate Enrollment QR

```http
POST /api/v1/distributor/enrollment/qr
Authorization: Bearer <tenantAdminAccessToken>
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>"
}
```

Expected response:

```json
{
  "success": true,
  "message": "Enrollment QR generated successfully",
  "data": {
    "qrPayload": {
      "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
        "enrollmentToken": "<enrollmentToken>"
      }
    },
    "qrCodeDataUrl": "data:image/png;base64,...",
    "qrCodeMimeType": "image/png",
    "enrollmentToken": "<enrollmentToken>",
    "tokenExpiresAt": "2026-06-13T10:30:00.000Z"
  }
}
```

### 2. Initiate OTP

```http
POST /api/v1/app/consent/initiate
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "mobile": "9876543210"
}
```

Expected response:

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

### 3. Verify OTP

```http
POST /api/v1/app/consent/verify-otp
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "mobile": "9876543210",
  "verificationSessionId": "otp_...",
  "otp": "123456"
}
```

Expected response:

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

### 4. Fetch Consent Terms

```http
GET /api/v1/app/consent/terms
```

Expected response:

```json
{
  "success": true,
  "message": "Consent terms fetched successfully",
  "data": {
    "version": "1.0",
    "title": "EMI Shield Device Control Agreement",
    "borrowerAgreementText": "...",
    "deviceControlConsentText": "...",
    "privacyPolicyText": "...",
    "tripartiteAckText": "..."
  }
}
```

### 5. Accept Consent

```http
POST /api/v1/app/consent/accept
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json

{
  "consentCheckboxAccepted": true,
  "consentVersion": "1.0"
}
```

Expected response:

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

### 6. Register Device

```http
POST /api/v1/app/device/register
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json

{
  "imei": "123456789012345",
  "imei2": "123456789012346",
  "deviceModel": "Samsung Galaxy M14",
  "manufacturer": "Samsung",
  "androidVersion": "14",
  "appVersion": "1.0.0",
  "fcmToken": "mock-fcm-token"
}
```

Expected response:

```json
{
  "success": true,
  "message": "Device registered successfully",
  "data": {
    "deviceId": "<deviceId>",
    "userId": "<userId>",
    "tenantId": "<tenantId>",
    "state": "ACTIVE",
    "currentPolicyKey": "EMI_PAID",
    "policy": {
      "policyKey": "EMI_PAID",
      "version": 1,
      "restrictions": {
        "lockMode": false,
        "allowedApps": [],
        "blockedApps": [],
        "disableFactoryReset": true,
        "disableStatusBar": false,
        "disableAdb": false
      }
    }
  }
}
```

### 7. Fetch Current Policy

```http
GET /api/v1/app/device/policy
Authorization: Bearer <borrowerUserAccessToken>
```

Expected response:

```json
{
  "success": true,
  "message": "Device policy fetched successfully",
  "data": {
    "deviceState": "ACTIVE",
    "policyKey": "EMI_PAID",
    "policyVersion": 1,
    "restrictions": {
      "lockMode": false,
      "allowedApps": [],
      "blockedApps": [],
      "disableFactoryReset": true,
      "disableStatusBar": false,
      "disableAdb": false
    },
    "tempUnlockExpiresAt": null
  }
}
```

---

## Case 2 - Crash After OTP Verify, Before Consent

State:

- Enrollment token is valid.
- User has no consent.
- Device is not linked.

### 1. Initiate OTP Again

```http
POST /api/v1/app/consent/initiate
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "mobile": "9876543210"
}
```

Expected response:

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

### 2. Verify OTP Again

```http
POST /api/v1/app/consent/verify-otp
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "mobile": "9876543210",
  "verificationSessionId": "otp_...",
  "otp": "123456"
}
```

Expected response:

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "accessToken": "<borrowerUserAccessToken>",
    "tokenType": "user",
    "flowType": "ONBOARDING_CONSENT",
    "nextStep": "SHOW_CONSENT"
  }
}
```

Then continue:

```text
GET /app/consent/terms -> POST /app/consent/accept -> POST /app/device/register
```

---

## Case 3 - Crash After Consent Accept, Before Device Register

State:

- Enrollment token is still unconsumed.
- User has consent.
- Device is not linked.

### 1. Initiate OTP Again

```http
POST /api/v1/app/consent/initiate
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "mobile": "9876543210"
}
```

Expected response:

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "verificationSessionId": "otp_...",
    "otpSent": true,
    "flowType": "ONBOARDING_RESUME",
    "nextStep": "VERIFY_OTP",
    "maskedMobile": "98****3210",
    "expiresInSeconds": 600
  }
}
```

### 2. Verify OTP

```http
POST /api/v1/app/consent/verify-otp
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "mobile": "9876543210",
  "verificationSessionId": "otp_...",
  "otp": "123456"
}
```

Expected response:

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "accessToken": "<borrowerUserAccessToken>",
    "tokenType": "user",
    "flowType": "ONBOARDING_RESUME",
    "nextStep": "REGISTER_DEVICE",
    "user": {
      "id": "<userId>",
      "mobile": "9876543210",
      "consentRecordId": "<consentRecordId>",
      "isDeviceLinked": false,
      "linkedDeviceId": null
    }
  }
}
```

Then call:

```text
POST /app/device/register
```

No consent screen is needed again.

---

## Case 4 - App Data Cleared After Device Already Registered

State:

- Enrollment token is absent, invalid, or already consumed.
- User exists by mobile.
- User has a linked device.

### 1. Initiate Returning Device OTP

```http
POST /api/v1/app/consent/initiate
Content-Type: application/json

{
  "mobile": "9876543210"
}
```

Expected response:

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "verificationSessionId": "otp_...",
    "otpSent": true,
    "flowType": "DEVICE_LOGIN",
    "nextStep": "VERIFY_OTP",
    "maskedMobile": "98****3210",
    "expiresInSeconds": 600
  }
}
```

### 2. Verify Returning Device OTP

```http
POST /api/v1/app/consent/verify-otp
Content-Type: application/json

{
  "mobile": "9876543210",
  "verificationSessionId": "otp_...",
  "otp": "123456"
}
```

Expected response:

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "accessToken": "<borrowerUserAccessToken>",
    "tokenType": "user",
    "flowType": "DEVICE_LOGIN",
    "nextStep": "SYNC_DEVICE",
    "user": {
      "id": "<userId>",
      "name": "Ramesh Kumar",
      "mobile": "9876543210",
      "tenantId": "<tenantId>",
      "consentRecordId": "<consentRecordId>",
      "isDeviceLinked": true,
      "linkedDeviceId": "<deviceId>"
    },
    "device": {
      "deviceId": "<deviceId>",
      "state": "ACTIVE",
      "currentPolicyKey": "EMI_PAID",
      "desiredPolicyVersion": 1,
      "lastAppliedPolicyVersion": 1,
      "tempUnlockExpiresAt": null
    },
    "deviceState": "ACTIVE",
    "currentPolicyKey": "EMI_PAID",
    "desiredPolicyVersion": 1,
    "policy": {},
    "pendingCommands": []
  }
}
```

Then immediately call:

```http
POST /api/v1/app/device/sync
Authorization: Bearer <borrowerUserAccessToken>
```

---

## Case 5 - Invalid Or Missing Token, User Not Linked

State:

- Enrollment token is absent or invalid.
- Mobile may exist, but the user has no linked device.

```http
POST /api/v1/app/consent/initiate
Content-Type: application/json

{
  "mobile": "9876543210"
}
```

Expected response:

```json
{
  "success": false,
  "error": "Valid enrollment token or registered linked device is required"
}
```

---

## Case 6 - Valid Token But Wrong Mobile

State:

- Enrollment token is valid.
- Entered mobile does not match borrower mobile or Aadhaar-linked mobile.

```http
POST /api/v1/app/consent/initiate
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "mobile": "9999999999"
}
```

Expected response:

```json
{
  "success": false,
  "error": "Mobile does not match registered borrower"
}
```

---

## Case 7 - Register Device Before Consent

State:

- OTP was verified and access token was issued.
- Consent was not accepted.

```http
POST /api/v1/app/device/register
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json

{
  "imei": "123456789012345",
  "deviceModel": "Samsung Galaxy M14",
  "manufacturer": "Samsung",
  "androidVersion": "14",
  "appVersion": "1.0.0",
  "fcmToken": "mock-fcm-token"
}
```

Expected response:

```json
{
  "success": false,
  "error": "Consent record is required before device registration"
}
```

---

## Case 8 - Try To Reuse Enrollment Token After Device Registration

State:

- Device registration succeeded.
- Enrollment token is consumed.

```http
POST /api/v1/app/device/register
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json

{
  "imei": "123456789012345",
  "deviceModel": "Samsung Galaxy M14",
  "manufacturer": "Samsung",
  "androidVersion": "14",
  "appVersion": "1.0.0",
  "fcmToken": "mock-fcm-token"
}
```

Expected response:

```json
{
  "success": false,
  "error": "User is already linked to a device"
}
```

If the app has no local token after this point, use Case 4 instead of QR onboarding.
