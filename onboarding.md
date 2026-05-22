# EMI Shield - Tested Onboarding Flow

## Purpose

This document matches the onboarding flow that is currently implemented and tested in the backend. It covers the Tenant App flow used by `tenant_admin` accounts and the Shield App flow used on the borrower's financed device.

**Base URL:** `http://localhost:<PORT>/api/v1`

In production this becomes the deployed API host, for example:

```text
https://api.emishield.in/api/v1
```

---

## Implemented API Summary

| Step | API | Auth | Status |
|---|---|---|---|
| Tenant admin login | `POST /auth/login` | Public | Implemented |
| Refresh tenant/admin token | `POST /auth/refresh-token` | HTTP-only refresh cookie | Implemented |
| Tenant dashboard | `GET /distributor/dashboard` | `tenant_admin` access token | Implemented |
| Register borrower | `POST /distributor/users/register` | `tenant_admin` access token | Implemented |
| Generate enrollment QR | `POST /distributor/enrollment/qr` | `tenant_admin` access token | Implemented |
| Track enrollment status | `GET /distributor/enrollments/:token/status` | `tenant_admin` access token | Implemented |
| View borrower detail | `GET /distributor/users/:id` | `tenant_admin` access token | Implemented |
| View device inventory | `GET /distributor/devices` | `tenant_admin` access token | Implemented |
| View device detail | `GET /distributor/devices/:id` | `tenant_admin` access token | Implemented |
| Regenerate enrollment QR | `POST /distributor/enrollment/:token/regenerate` | `tenant_admin` access token | Implemented |
| Fetch consent terms | `GET /app/consent/terms` | Public | Implemented |
| Initiate Aadhaar OTP | `POST /app/consent/initiate` | Public | Implemented with mock Cashfree flow |
| Confirm Aadhaar OTP | `POST /app/consent/confirm` | Public | Implemented with mock Cashfree flow |
| Register device | `POST /app/device/register` | Borrower user access token | Implemented |
| Fetch device policy | `GET /app/device/policy` | Borrower user access token | Implemented |
| Device ping | `POST /app/device/ping` | Borrower user access token | Implemented |
| Device sync | `POST /app/device/sync` | Borrower user access token | Implemented |
| Device command acknowledgement | `POST /app/device/command/ack` | Borrower user access token | Implemented |
| Device security event | `POST /app/security/event` | Borrower user access token | Implemented |
| Borrower payment QR | `GET /app/payment/qr` | Borrower user access token | Implemented |
| Borrower payment submit | `POST /app/payment/submit` | Borrower user access token | Implemented |
| Borrower payment history | `GET /app/payment/history` | Borrower user access token | Implemented |
| Borrower payment detail | `GET /app/payment/:paymentId` | Borrower user access token | Implemented |
| Borrower unlock request create | `POST /app/unlock-request` | Borrower user access token | Implemented |
| Borrower active unlock request | `GET /app/unlock-request/active` | Borrower user access token | Implemented |
| FCM command delivery worker | `npm run worker:fcm` | Backend worker | Implemented, mock by default |
| Scheduled SLA/temp-unlock jobs | `npm run jobs:scheduled` | Backend worker | Implemented |

---

## Actors

| Actor | Meaning |
|---|---|
| `super_admin` | Platform admin who creates partners, tenants, accounts, and consent versions |
| `tenant_admin` | Tenant app user who registers borrowers and manages onboarding |
| Borrower user | Financed device user created during borrower registration |
| Shield App | Android Device Owner app installed/provisioned on the financed device |

There is no `tenant_staff` role in the current flow.

---

## Core Rules

1. The tenant admin access token is a JWT returned from `/auth/login`.
2. The account refresh token is stored only as an HTTP-only cookie.
3. The QR payload contains only an opaque `enrollmentToken`.
4. The QR payload must not contain `userId`, `tenantId`, loan data, or EMI details.
5. The borrower access token is issued only after consent OTP confirmation.
6. The borrower access token is used for device registration and device policy fetch.
7. Tenant and device policies are created for every tenant from centralized constants during tenant creation.

---

## Pre-Test Setup

Before running onboarding, these records should already exist:

1. One active tenant.
2. One active `tenant_admin` account linked to that tenant.
3. One active/current consent version.
4. Tenant device policies created during tenant creation.

The tenant must have the `distribute` capability because distributor routes require it.

---

## Step 1 - Tenant Admin Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "tenantadmin@example.com",
  "password": "Welcome@123"
}
```

Expected result:

- Response contains `accessToken`.
- Response account has `role: "tenant_admin"`.
- Response account has `tenantId`.
- Refresh token is set in an HTTP-only cookie.

Use this access token as:

```text
Authorization: Bearer <tenantAdminAccessToken>
```

---

## Step 2 - Check Tenant Dashboard

```http
GET /api/v1/distributor/dashboard
Authorization: Bearer <tenantAdminAccessToken>
```

Expected result:

- Total borrowers count.
- Borrowers registered today count.
- Enrollment token counts: `active`, `consumed`, `expired`, `cancelled`.
- Device counts: `activated`, `pendingActivation`, `byState`.
- Recent enrollments with status.

This is useful before and after onboarding to confirm counts change correctly.

---

## Step 3 - Register Borrower And EMI Details

```http
POST /api/v1/distributor/users/register
Authorization: Bearer <tenantAdminAccessToken>
Content-Type: application/json

{
  "name": "Ramesh Kumar",
  "mobile": "9876543210",
  "email": "ramesh@example.com",
  "aadhaarLinkedMobile": "9876543210",
  "loanId": "LOAN-TEST-001",
  "loanAmount": 18000,
  "emiAmount": 3000,
  "tenureMonths": 6,
  "disbursementDate": "2026-05-21"
}
```

Backend actions:

1. Validates `tenant_admin` and tenant scope.
2. Confirms the tenant is active and can distribute devices.
3. Creates the borrower in `users` with `tenantId` from the JWT.
4. Creates the EMI schedule in `emiSchedules`.
5. Creates a short-lived enrollment token in `enrollmentTokens`.
6. Writes an audit log.

Save these response values:

- `userId`
- `tenantId`
- `emiScheduleId`
- `enrollmentToken`
- `tokenExpiresAt`

Initial enrollment status at this point is usually:

```text
USER_REGISTERED
```

---

## Step 4 - Generate Enrollment QR

```http
POST /api/v1/distributor/enrollment/qr
Authorization: Bearer <tenantAdminAccessToken>
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>"
}
```

Backend actions:

1. Validates tenant admin access.
2. Confirms the token belongs to the same tenant.
3. Rejects expired, consumed, or cancelled tokens.
4. Builds the Android Device Owner provisioning payload.
5. Generates a QR image data URL.
6. Stores `lastQrGeneratedAt`.
7. Writes an audit log.

Expected response includes:

```json
{
  "qrPayload": {
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.emishield.app/.AdminReceiver",
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": "https://cdn.emishield.in/releases/shield.apk",
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": "<SHA256_OF_APK_SIGNING_CERT>",
    "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": false,
    "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
      "enrollmentToken": "<enrollmentToken>"
    }
  },
  "qrCodeDataUrl": "data:image/png;base64,...",
  "qrCodeMimeType": "image/png",
  "enrollmentToken": "<enrollmentToken>",
  "tokenExpiresAt": "2026-05-28T..."
}
```

Tenant App action:

- Render `qrCodeDataUrl` as an image.
- The QR image is now available directly from the API response.

Enrollment status after QR generation:

```text
QR_GENERATED
```

---

## Step 5 - Android Device Owner Provisioning

Precondition:

- Device is new or factory reset.

Manual Android setup:

1. Boot the device to the Android setup screen.
2. Tap the setup screen 6 times to open QR provisioning mode.
3. Connect to WiFi.
4. Scan the QR shown by the Tenant App.
5. Android downloads and installs the Shield APK.
6. Android assigns Device Owner privileges to the Shield App.

The QR extras bundle contains:

```json
{
  "enrollmentToken": "<enrollmentToken>"
}
```

No borrower, tenant, or loan identifiers are exposed in the QR.

---

## Step 6 - Fetch Consent Terms

The Shield App fetches the current consent version before OTP.

```http
GET /api/v1/app/consent/terms
```

Expected result:

- Active/current consent version.
- Borrower agreement text.
- Device control consent text.
- Privacy policy text.
- Tripartite acknowledgement text.

The borrower must accept the consent checkbox before OTP confirmation.

---

## Step 7 - Initiate Mock Cashfree Aadhaar OTP

```http
POST /api/v1/app/consent/initiate
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "aadhaarLinkedMobile": "9876543210"
}
```

Backend actions:

1. Validates token exists.
2. Rejects expired, consumed, or cancelled tokens.
3. Loads the borrower from the token.
4. Confirms `aadhaarLinkedMobile` matches the registered borrower.
5. Confirms an active consent version exists.
6. Creates an `otpRecords` document.
7. Writes an audit log.

Current simulation response includes the mock OTP:

```json
{
  "verificationSessionId": "cf_mock_...",
  "otpSent": true,
  "maskedMobile": "98****3210",
  "expiresInSeconds": 600,
  "mockOtp": "123456"
}
```

For testing, use:

```text
123456
```

---

## Step 8 - Confirm Consent OTP

```http
POST /api/v1/app/consent/confirm
Content-Type: application/json

{
  "enrollmentToken": "<enrollmentToken>",
  "verificationSessionId": "cf_mock_...",
  "otp": "123456",
  "consentCheckboxAccepted": true,
  "consentVersion": "1.0"
}
```

Backend actions:

1. Validates token exists.
2. Rejects expired, consumed, or cancelled tokens.
3. Validates OTP session.
4. Verifies mock OTP.
5. Builds a mock Cashfree Aadhaar profile.
6. Compares Aadhaar profile name with borrower name.
7. Creates a `consentRecords` document.
8. Marks the borrower as Aadhaar verified.
9. Saves `consentRecordId` on the user.
10. Marks the enrollment token as consumed.
11. Writes an audit log.
12. Issues a borrower user access token.

Expected response:

```json
{
  "consentRecordId": "<consentRecordId>",
  "consentAccepted": true,
  "accessToken": "<borrowerUserAccessToken>",
  "tokenType": "user",
  "user": {
    "id": "<userId>",
    "name": "Ramesh Kumar",
    "tenantId": "<tenantId>",
    "consentRecordId": "<consentRecordId>"
  }
}
```

Important:

- The current borrower flow returns an access token.
- It does not return a borrower refresh token in the tested implementation.

Enrollment status after consent confirmation, before device registration:

```text
CONSENT_COMPLETED
```

---

## Step 9 - Register Device

Use the borrower user access token from consent confirmation.

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

Backend actions:

1. Validates borrower user JWT.
2. Confirms borrower is active.
3. Confirms `consentRecordId` exists.
4. Rejects duplicate IMEI.
5. Loads the tenant's active `EMI_PAID` device policy.
6. Creates a `devices` document.
7. Sets device state to `ACTIVE`.
8. Sets `currentPolicyKey` to `EMI_PAID`.
9. Writes an audit log.

Expected response:

```json
{
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
```

Enrollment status after device registration:

```text
ACTIVATION_COMPLETE
```

---

## Step 10 - Fetch Current Device Policy

```http
GET /api/v1/app/device/policy
Authorization: Bearer <borrowerUserAccessToken>
```

Expected response:

```json
{
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
```

Shield App action:

- Store the `deviceId`.
- Store the last applied policy version.
- Apply restrictions through Android `DevicePolicyManager`.

---

## Step 10A - Device Ping

```http
POST /api/v1/app/device/ping
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json

{
  "batteryLevel": 79,
  "networkType": "wifi",
  "appVersion": "1.0.1",
  "fcmToken": "latest-fcm-token"
}
```

Backend actions:

1. Updates `devices.lastSeenAt`, online state, battery/network metadata, and FCM token if changed.
2. Writes a `deviceEvents` heartbeat record.
3. Returns desired and applied policy versions.

---

## Step 10B - Device Sync

```http
POST /api/v1/app/device/sync
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json

{
  "lastAppliedPolicyVersion": 1,
  "state": "ACTIVE",
  "isRooted": false,
  "isTampered": false
}
```

Backend actions:

1. Updates device sync timestamps and security booleans.
2. Returns current policy plus pending/sent commands.

---

## Step 10C - Command Acknowledgement

After the app applies a command locally:

```http
POST /api/v1/app/device/command/ack
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json

{
  "commandId": "<deviceCommandId>",
  "status": "acknowledged",
  "appliedPolicyVersion": 2
}
```

Backend actions:

1. Marks command `acknowledged` or `failed`.
2. Updates `lastAppliedPolicyVersion`.
3. Moves device state to `ACTIVE`, `LOCKED`, or `TEMP_UNLOCK` based on the command type.

---

## Step 10D - Security Event

```http
POST /api/v1/app/security/event
Authorization: Bearer <borrowerUserAccessToken>
Content-Type: application/json

{
  "type": "ROOT_DETECTED",
  "severity": "high",
  "message": "su binary found",
  "metadata": {
    "path": "/system/xbin/su"
  }
}
```

Backend actions:

1. Writes a `deviceEvents` security record.
2. Creates a `riskFlags` entry for tenant/admin review.
3. Marks the device as rooted or tampered for known event types.

---

## Step 11 - Verify From Tenant App

### Track enrollment status

```http
GET /api/v1/distributor/enrollments/<enrollmentToken>/status
Authorization: Bearer <tenantAdminAccessToken>
```

Expected final status:

```text
ACTIVATION_COMPLETE
```

Possible statuses:

- `USER_REGISTERED`
- `QR_GENERATED`
- `CONSENT_COMPLETED`
- `ACTIVATION_COMPLETE`
- `TOKEN_EXPIRED`
- `TOKEN_CONSUMED`
- `TOKEN_CANCELLED`

### View borrower detail

```http
GET /api/v1/distributor/users/<userId>
Authorization: Bearer <tenantAdminAccessToken>
```

Expected response includes:

- Borrower profile.
- EMI schedule.
- Latest enrollment token details.
- Consent record summary.
- Linked device.
- `activationStatus`.

### View device inventory

```http
GET /api/v1/distributor/devices
Authorization: Bearer <tenantAdminAccessToken>
```

Expected response:

- Devices scoped to the tenant admin's tenant.
- Newest first.

### View device detail

```http
GET /api/v1/distributor/devices/<deviceId>
Authorization: Bearer <tenantAdminAccessToken>
```

Expected response includes:

- Device hardware details.
- Linked borrower.
- Current state.
- Current policy key/version.
- Active current policy restrictions.

---

## Regenerate QR Recovery Flow

Use this only before the device is registered.

```http
POST /api/v1/distributor/enrollment/<oldEnrollmentToken>/regenerate
Authorization: Bearer <tenantAdminAccessToken>
```

Backend actions:

1. Finds the old token by tenant scope.
2. Rejects if a device is already registered.
3. Rejects if the token is already consumed.
4. Rejects if the token was already regenerated.
5. Marks the old token as cancelled.
6. Creates a new enrollment token for the same borrower.
7. Returns a fresh QR payload and `qrCodeDataUrl`.
8. Writes an audit log.

Expected response includes:

```json
{
  "oldEnrollmentToken": "<oldEnrollmentToken>",
  "oldEnrollmentTokenId": "<oldEnrollmentTokenId>",
  "qrPayload": {},
  "qrCodeDataUrl": "data:image/png;base64,...",
  "qrCodeMimeType": "image/png",
  "enrollmentToken": "<newEnrollmentToken>",
  "tokenExpiresAt": "2026-05-28T..."
}
```

The old token status becomes:

```text
TOKEN_CANCELLED
```

Use the new token for consent initiation and confirmation.

---

## EMI Schedule Behavior In Current Simulation

During borrower registration, the backend creates EMI installments from:

- `emiAmount`
- `tenureMonths`
- `disbursementDate`

For each installment:

- `installmentNumber` starts at 1.
- `dueDate` is calculated monthly from `disbursementDate`.
- `emiAmount` is copied from the request.
- `status` starts as `pending`.

Example:

```json
{
  "emiAmount": 3000,
  "tenureMonths": 3,
  "disbursementDate": "2026-05-21"
}
```

Creates installments due around:

```text
2026-06-21
2026-07-21
2026-08-21
```

The automatic EMI state scheduler is not implemented yet. Device state currently becomes `ACTIVE` during device registration with `currentPolicyKey: "EMI_PAID"`.

---

## Access Token Expiry Flow

For account tokens:

1. Client calls protected API with access token.
2. If access token is expired, `verifyJwt` returns `401`.
3. Client calls:

```http
POST /api/v1/auth/refresh-token
```

4. The server validates the HTTP-only refresh cookie.
5. If valid, server returns a new account access token.
6. Client retries the original request.
7. If refresh also returns `401`, client clears local token state and redirects to login.

In this implementation:

- Account access token is a JWT.
- Account refresh token is stored as an HTTP-only cookie.
- Borrower user access token is issued after consent confirmation.

---

## Final Happy Path Checklist

1. Login tenant admin.
2. Check dashboard.
3. Register borrower.
4. Generate QR and confirm `qrCodeDataUrl` is returned.
5. Check enrollment status is `QR_GENERATED`.
6. Fetch consent terms.
7. Initiate consent OTP with Aadhaar-linked mobile.
8. Confirm consent OTP with `123456`.
9. Save borrower user access token.
10. Register device.
11. Fetch device policy.
12. Check enrollment status is `ACTIVATION_COMPLETE`.
13. View borrower detail.
14. View device detail.
15. Recheck dashboard counts.

---

## Post-Onboarding Payment And Unlock Simulation

### Borrower fetches active QR

```http
GET /api/v1/app/payment/qr
Authorization: Bearer <borrowerUserAccessToken>
```

### Borrower submits payment

```http
POST /api/v1/app/payment/submit
Authorization: Bearer <borrowerUserAccessToken>

{
  "qrCodeId": "<tenantQrCodeId>",
  "amount": 3000,
  "reference": "UPI123456"
}
```

### Tenant approves payment

```http
POST /api/v1/distributor/payments/:paymentId/approve
Authorization: Bearer <tenantAdminAccessToken>

{
  "note": "Verified UPI credit"
}
```

This marks EMI installments paid, queues an `UNLOCK` command, and the FCM worker delivers a policy update.

### Borrower creates unlock request

```http
POST /api/v1/app/unlock-request
Authorization: Bearer <borrowerUserAccessToken>

{
  "reason": "Payment made but device is still locked",
  "reasonCategory": "payment_made",
  "details": "UPI ref UPI123456",
  "imageUrl": "https://storage.example.com/evidence.png"
}
```

Tenant reviews it from:

```http
GET /api/v1/distributor/unlock-requests
POST /api/v1/distributor/unlock-requests/:caseId/approve
POST /api/v1/distributor/unlock-requests/:caseId/temp-unlock
POST /api/v1/distributor/unlock-requests/:caseId/reject
```
