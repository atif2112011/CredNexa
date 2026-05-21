# EMI Shield — Android Device Owner Onboarding Flow

## Overview

This document explains the complete onboarding flow for the EMI Shield ecosystem, from device purchase to the first policy enforcement.

### Architecture Components

- Shield Android App (Device Owner App — installed on borrower's device)
- Distributor Android App (used by `tenant_admin` accounts with `distribute` capability to register users and generate QR codes)
- Tenant Android App (used by `tenant_admin` accounts for daily lock/unlock operations)
- Backend REST API (`/api/v1`)
- Firebase Cloud Messaging (FCM)
- QR-based Android Device Owner provisioning
- Backend-proxied third-party Aadhaar OTP Verification Service

> **Note:** This implementation does **not** use Android Management API (AMAPI) because EMI-based device restriction policies are not compatible with AMAPI usage policies. Instead, we use Android Device Owner provisioning via `DevicePolicyManager` APIs and a custom backend policy engine.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Device Owner** | Highest Android device management privilege — granted via QR provisioning |
| **DeviceAdminReceiver** | Android admin component registered in the Shield app manifest |
| **DevicePolicyManager** | Android API for applying device restrictions (lock mode, app blocking, factory reset) |
| **QR Provisioning** | Android enterprise-style enrollment from a factory-reset device |
| **Enrollment Token** | Opaque one-time token embedded in the QR code — resolves to `userId` + `tenantId` server-side |
| **FCM** | Firebase Cloud Messaging — delivers `POLICY_UPDATE` signals to the app |
| **Policy Engine** | Backend logic that maps device state → active `devicePolicies` key per tenant |
| **devicePolicies** | Per-tenant enforcement policies keyed by device state (`EMI_PAID`, `EMI_LOCKED`, etc.) |

---

## Identity Model

| Term | Meaning |
|---|---|
| `userId` | ObjectId referencing the `users` collection — the borrower |
| `tenantId` | ObjectId referencing the `tenants` collection — the org that sold the device |
| `enrollmentToken` | Opaque short-lived token generated when the loan enrollment is created |

> **Security rule:** Never put `userId` or `tenantId` in the QR payload extras. Use only the opaque `enrollmentToken`. The backend resolves all identifiers from the token.

---

## High-Level Architecture

```text
┌──────────────────────┐
│   Tenant Dashboard   │
│   (Tenant Admin)     │
└──────────┬───────────┘
           │ POST /distributor/users/register
           ▼
┌──────────────────────┐
│       Backend        │
│  Enrollment Engine   │
│  Consent Engine      │
│  Policy Engine       │
└──────────┬───────────┘
           │ REST + FCM (POLICY_UPDATE)
           ▼
┌──────────────────────┐
│     Shield App       │
│  Device Owner App    │
└──────────┬───────────┘
           │
           ▼
  Android DevicePolicyManager
```

---

## Onboarding Flow

### Step 1 — Distributor App Creates Enrollment

Tenant admin logs into the **Distributor Android App** and registers the borrower + loan details.

**API Call:**
```
POST /api/v1/distributor/users/register
Authorization: Bearer <tenantAdminToken>

Body:
{
  "name": "Ramesh Kumar",
  "mobile": "9876543210",
  "email": "ramesh@email.com",
  "aadhaarLinkedMobile": "9876543210",
  "loanId": "LOAN-2024-001",
  "loanAmount": 18000,
  "emiAmount": 3500,
  "tenureMonths": 6,
  "disbursementDate": "2024-01-01"
}
```

**Backend actions:**
1. Creates a `users` record (linked to the tenant)
2. Creates an `emiSchedules` record for the loan
3. Generates a one-time `enrollmentToken` linked to the `userId` + `tenantId`

**Response:**
```json
{
  "userId": "<ObjectId>",
  "loanId": "LOAN-2024-001",
  "enrollmentToken": "TEMP_TOKEN_ABC123",
  "tokenExpiresAt": "2024-01-08T23:59:59Z"
}
```

---

### Step 2 — Backend Generates QR Payload

The **Distributor Android App** calls the backend to generate the Android Device Owner provisioning QR, which is then displayed on-screen for scanning.

**API Call:**
```
POST /api/v1/distributor/enrollment/qr
Authorization: Bearer <tenantAdminToken>

Body:
{ "enrollmentToken": "TEMP_TOKEN_ABC123" }
```

**QR Payload (Android provisioning format):**
```json
{
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME":
    "com.emishield.app/.AdminReceiver",

  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION":
    "https://cdn.emishield.in/releases/shield.apk",

  "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM":
    "<SHA256_OF_APK_SIGNING_CERT>",

  "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": false,

  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
    "enrollmentToken": "TEMP_TOKEN_ABC123"
  }
}
```

> The extras bundle contains **only** the opaque `enrollmentToken`. No `userId`, `tenantId`, or loan data is embedded in the QR.

---

### Step 3 — Device Provisioning (Factory Reset Required)

**Precondition:** Brand-new phone or factory-reset device.

**Steps:**
1. Boot device to Android setup screen
2. Tap the setup screen 6 times to enter QR provisioning mode
3. Connect to WiFi
4. Scan QR code

Android Device Owner provisioning begins automatically.

---

### Step 4 — Android Downloads APK

Android OS performs:
```
GET https://cdn.emishield.in/releases/shield.apk
```
Downloaded before the launcher/home screen setup completes. Android validates the APK signature, checksum, and `DeviceAdminReceiver` existence.

---

### Step 5 — Device Owner Assignment

Android locates the `DeviceAdminReceiver` declared in the app manifest:

```xml
<receiver
    android:name=".AdminReceiver"
    android:permission="android.permission.BIND_DEVICE_ADMIN">
  <meta-data
      android:name="android.app.device_admin"
      android:resource="@xml/device_admin_policies"/>
</receiver>
```

Android grants **Device Owner** + Device Administration privileges. The Shield app is now the privileged device controller.

---

### Step 6 — Shield App Initializes

The app's `DeviceAdminReceiver.onProfileProvisioningComplete()` callback fires. The app extracts the `enrollmentToken` from the QR provisioning extras:

```java
@Override
public void onProfileProvisioningComplete(Context context, Intent intent) {
    PersistableBundle extras = intent.getParcelableExtra(
        DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE);
    String enrollmentToken = extras.getString("enrollmentToken");
    // Store token locally, proceed to consent flow
}
```

---

### Step 7 — Consent Flow (Legally Mandatory)

> ⚠️ **This step is a legal requirement. Do not skip or allow bypassing.**

The consent flow uses a **backend-proxied** Aadhaar OTP verification service. The app never calls the Aadhaar provider directly — all provider calls are made by the backend. This ensures API keys are never exposed on-device and that the verified identity data is trusted server-side.

#### Step 7a — Fetch Consent Terms

```
GET /api/v1/app/consent/terms
(No auth token required)
```

**Response:**
```json
{
  "version": "1.1",
  "title": "EMI Shield Device Control Agreement",
  "borrowerAgreementText": "...",
  "deviceControlConsentText": "...",
  "privacyPolicyText": "...",
  "tripartiteAckText": "..."
}
```

**App action:** Display the full agreement. The user must scroll to the bottom and tick a checkbox. Do not allow proceeding until the checkbox is ticked.

---

#### Step 7b — Initiate Aadhaar OTP

After the user ticks the checkbox, the app calls:

```
POST /api/v1/app/consent/initiate
(No auth token required)

Body:
{
  "enrollmentToken": "TEMP_TOKEN_ABC123",
  "aadhaarLinkedMobile": "9876543210"
}
```

**What the backend does:**
1. Validates the `enrollmentToken` (exists, not expired, not yet consumed)
2. Calls the third-party Aadhaar OTP provider to send an OTP to the provided mobile
3. Stores the provider's `verificationSessionId` internally (linked to the enrollment)

**Response:**
```json
{
  "verificationSessionId": "VS_XYZ789",
  "otpSent": true,
  "maskedMobile": "98****3210",
  "expiresInSeconds": 600
}
```

**App action:** Show OTP input screen. The user enters the OTP received on their Aadhaar-linked mobile.

---

#### Step 7c — Confirm Consent + Verify Aadhaar OTP

```
POST /api/v1/app/consent/confirm
(No auth token required)

Body:
{
  "enrollmentToken": "TEMP_TOKEN_ABC123",
  "verificationSessionId": "VS_XYZ789",
  "otp": "482910",
  "consentCheckboxAccepted": true,
  "consentVersion": "1.1"
}
```

**What the backend does:**
1. Calls the Aadhaar provider to verify the OTP using `verificationSessionId`
2. Provider returns verified identity (`name`, `dob`, `address`) — stored as `verifiedProfile` on the `users` record (not overwriting the distributor-entered fields)
3. Creates an immutable `consentRecords` document with `aadhaarVerificationRef` from the provider
4. Marks the `enrollmentToken` as consumed
5. Issues a JWT (`tokenType: "user"`) for the borrower

**Response:**
```json
{
  "consentRecordId": "<ObjectId>",
  "consentAccepted": true,
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "user",
  "user": {
    "id": "<userId>",
    "name": "Ramesh Kumar",
    "tenantId": "<tenantId>"
  }
}
```

**App action:** Store `accessToken` and `refreshToken` in `EncryptedSharedPreferences`. Proceed to device registration.

---

### Step 8 — Device Registration

The Shield app collects device hardware details and registers with the backend.

**Data collected by the app:**

| Field | Source |
|---|---|
| `imei` | `TelephonyManager.getImei(0)` (requires Device Owner privilege) |
| `imei2` | `TelephonyManager.getImei(1)` (SIM slot 2, if present) |
| `deviceModel` | `Build.MODEL` |
| `manufacturer` | `Build.MANUFACTURER` |
| `androidVersion` | `Build.VERSION.RELEASE` |
| `appVersion` | `PackageManager` |
| `fcmToken` | Firebase |

> IMEI access requires Device Owner privileges — satisfied by QR provisioning in Steps 3–5.

**API Call:**
```
POST /api/v1/app/device/register
Authorization: Bearer <accessToken>

Body:
{
  "imei": "123456789012345",
  "imei2": "123456789012346",
  "deviceModel": "Samsung Galaxy M14",
  "manufacturer": "Samsung",
  "androidVersion": "14",
  "appVersion": "1.0.0",
  "fcmToken": "<Firebase FCM registration token>"
}
```

> `userId` and `tenantId` are resolved from the JWT — do not include them in the request body.

**Backend actions:**
1. Validates JWT + confirms a `consentRecord` exists for this user
2. Creates a `devices` record with `imei` as the primary unique identifier
3. Sets `currentPolicyKey` to the tenant's default active policy (e.g., `EMI_PAID`)
4. Returns the initial policy for the device

**Response:**
```json
{
  "deviceId": "<ObjectId>",
  "state": "ACTIVE",
  "currentPolicyKey": "EMI_PAID",
  "policy": {
    "policyKey": "EMI_PAID",
    "policyVersion": 1,
    "restrictions": {
      "lockMode": false,
      "allowedApps": [],
      "blockedApps": [],
      "disableFactoryReset": true,
      "disableStatusBar": false
    }
  }
}
```

---

### Step 9 — Apply Initial Policy

The Shield app applies the received policy using `DevicePolicyManager`:

```kotlin
// Always prevent factory reset (regardless of policy)
dpm.setFactoryResetProtectionPolicy(admin, frpPolicy)

// Prevent Shield app from being uninstalled
dpm.setUninstallBlocked(admin, "com.emishield.app", true)

// Apply lock mode if required by policy
if (policy.restrictions.lockMode) {
    dpm.setLockTaskPackages(admin, policy.restrictions.allowedApps.toTypedArray())
    activity.startLockTaskMode()
}
```

**App action:** Store `deviceId` and `policyVersion` locally. Start FCM listener service.

---

## Policy Synchronization Flow

### Policy Source of Truth

Policies are stored in the `devicePolicies` collection, scoped per tenant. On tenant creation, the backend copies centralized default device policies into one document per `policyKey`:

| `policyKey` | Device `state` | Typical Restrictions |
|---|---|---|
| `EMI_PAID` | `ACTIVE` | No lock — full device access |
| `EMI_GRACE` | `GRACE_PERIOD` | No lock — warning banner shown |
| `EMI_LOCKED` | `LOCKED` | Lock mode on — restricted app allowlist |
| `TEMP_UNLOCKED` | `TEMP_UNLOCK` | No lock — expiry countdown shown |
| `CONSENT_INVALID` | `CONSENT_INVALID` | Minimal UI — show error + support contact |

**Example `devicePolicies` document (EMI_LOCKED):**
```json
{
  "tenantId": "<ObjectId>",
  "policyKey": "EMI_LOCKED",
  "version": 2,
  "restrictions": {
    "lockMode": true,
    "allowedApps": ["com.emishield.app", "com.android.dialer"],
    "blockedApps": [],
    "disableFactoryReset": true,
    "disableStatusBar": true
  }
}
```

---

### State Change → Policy Update Flow

When an EMI event occurs (payment received, DPD threshold exceeded, manual lock by tenant):

1. **Backend updates device state** in `devices.state` and sets `devices.currentPolicyKey`
2. **Backend sends FCM** data message:
   ```json
   { "type": "POLICY_UPDATE", "policyVersion": 2 }
   ```
3. **Shield App receives FCM** → calls:
   ```
   GET /api/v1/app/device/policy
   Authorization: Bearer <accessToken>
   ```
4. **Backend response:**
   ```json
   {
     "policyKey": "EMI_LOCKED",
     "policyVersion": 2,
     "deviceState": "LOCKED",
     "restrictions": {
       "lockMode": true,
       "allowedApps": ["com.emishield.app", "com.android.dialer"],
       "blockedApps": [],
       "disableFactoryReset": true,
       "disableStatusBar": true
     },
     "tempUnlockExpiresAt": null
   }
   ```
5. **App enforces** restrictions via `DevicePolicyManager`

---

### Policy Fetch Triggers

The app must call `GET /app/device/policy` in all of the following scenarios — not just on FCM:

| Trigger | Why |
|---|---|
| FCM `POLICY_UPDATE` received | Primary update path |
| App launch / foreground resume | Catch missed FCMs |
| `BOOT_COMPLETED` broadcast | Re-enforce after device restart |
| `/device/sync` returns `forceApplyPolicy: true` | Missed update while offline |
| Heartbeat (`POST /app/device/ping`) detects version drift | `desiredPolicyVersion > lastAppliedPolicyVersion` |

---

## FCM Token Refresh

When Firebase rotates the FCM token (`FirebaseMessagingService.onNewToken()` fires):

```
POST /api/v1/app/device/ping
Authorization: Bearer <accessToken>

Body:
{
  "fcmToken": "<new FCM token>",
  "battery": 71,
  "network": "wifi",
  "rootDetected": false,
  "developerMode": false,
  "lastAppliedPolicyVersion": 1
}
```

**Response:** `{ "received": true, "desiredPolicyVersion": 1 }`

> If `desiredPolicyVersion > lastAppliedPolicyVersion` in the response, the app must immediately fetch and apply the latest policy.

**Recommended heartbeat interval:** Every 15–30 minutes.

---

## Offline Sync (Device Reconnects)

When the device comes back online after an offline period:

```
POST /api/v1/device/sync
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "deviceState": "LOCKED",
  "currentPolicyKey": "EMI_LOCKED",
  "policyVersion": 2,
  "forceApplyPolicy": true
}
```

**App action:** If `forceApplyPolicy: true`, call `GET /app/device/policy` and re-apply restrictions immediately.

---

## Security Events

Report tamper, root, or SIM change events immediately after detection:

```
POST /api/v1/app/security/event
Authorization: Bearer <accessToken>

Body:
{ "eventType": "ROOT_DETECTED", "details": { "method": "supersu_binary" } }
```

| `eventType` | When to report |
|---|---|
| `ROOT_DETECTED` | Root access detected on launch |
| `SIM_CHANGE_DETECTED` | SIM serial differs from stored value |
| `APP_TAMPER_DETECTED` | APK signature mismatch |
| `DEVELOPER_MODE_ENABLED` | Developer options turned on |

After reporting, re-fetch `GET /app/device/policy` — the backend may have changed the device state in response to the security event.

---

## Tenant Dashboard — Policy Configuration

Tenant admins configure enforcement policies for each device state via the Partner Dashboard:

```
GET  /api/v1/partner/device-policies               — list all policies for the tenant
POST /api/v1/partner/device-policies               — create a policy for a policyKey
PUT  /api/v1/partner/device-policies/:policyKey    — update enforcement restrictions
```

**Example — Update `EMI_LOCKED` policy:**
```
PUT /api/v1/partner/device-policies/EMI_LOCKED
Authorization: Bearer <tenantAdminToken>

Body:
{
  "restrictions": {
    "lockMode": true,
    "allowedApps": ["com.emishield.app", "com.android.dialer", "com.paytm.android"],
    "blockedApps": [],
    "disableFactoryReset": true,
    "disableStatusBar": true
  }
}
```

