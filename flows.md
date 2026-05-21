# EMI Shield — End-to-End Flows

> **Purpose:** Step-by-step flows for every actor from initial partner setup through device onboarding.
> Each step maps to the exact API call, the data it needs, and what the backend does.
> **Base URL for all calls:** `https://api.emishield.in/api/v1`

---

## Table of Contents

1. [Flow 1 — Partner Creation (Admin Panel)](#flow-1--partner-creation-admin-panel)
2. [Flow 2 — Tenant Admin Operational Login](#flow-2--tenant-admin-operational-login)
3. [Flow 3 — User Registration + QR Generation (Distributor App)](#flow-3--user-registration--qr-generation-distributor-app)
4. [Flow 4 — Device Onboarding (Target Device / Borrower App)](#flow-4--device-onboarding-target-device--borrower-app)
5. [Flow 5 — FCM Policy Update Flow (Server → Device)](#flow-5--fcm-policy-update-flow-server--device)
6. [Flow 6 — QR Payment + Tenant Approval + Device Unlock](#flow-6--qr-payment--tenant-approval--device-unlock)
7. [Flow 7 — Unlock Request + Two-Tier Escalation](#flow-7--unlock-request--two-tier-escalation)
8. [Super Admin Flows](super-admin-flows.md)

---

## Actors & Apps

| Actor | App/Interface | Auth |
|---|---|---|
| Super Admin | Admin Panel (Web) | Email + password → `tokenType: account`, `role: super_admin` |
| Partner Admin | Partner App (Android) | Email + password → `tokenType: account`, `role: partner_admin` |
| Tenant Admin | Partner App / Distributor App (Android) | Email + password → `tokenType: account`, `role: tenant_admin` |
| Borrower | Borrower App (Android) | Mobile OTP → `tokenType: user` |

---

## Flow 1 — Partner Creation (Admin Panel)

> **Actor:** Super Admin on the Admin Panel (web)
> **Outcome:** A Channel Partner is registered, a Tenant is created under them, tenant policies and device policies are configured, a `tenant_admin` account is created, and the tenant is ready for the Partner App and Distributor App.

### Step 1.1 — Super Admin Logs In

```
POST /auth/login

Body:
{
  "email": "admin@emishield.in",
  "password": "<password>"
}
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "tokenType": "account",
  "account": { "id": "...", "role": "super_admin", "name": "Admin" }
}
```

> Store `accessToken` in the Admin Panel session. The backend sets the refresh token as an HTTP-only cookie. All subsequent requests use `Authorization: Bearer <accessToken>`.

---

### Step 1.2 — Create Channel Partner

A Channel Partner is the B2B entity (e.g. an NBFC group, retail chain group) that resells EMI Shield to their network of tenants.

```
POST /admin/channel-partners
Authorization: Bearer <superAdminToken>

Body:
{
  "name": "Bharat Finance Group",
  "type": "nbfc_group",
  "contactEmail": "ops@bharatfinance.in",
  "contactPhone": "9800000001"
}
```

**Collection written:** `channelPartners`

**Response:**
```json
{
  "channelPartnerId": "<ObjectId>",
  "name": "Bharat Finance Group",
  "createdAt": "2024-01-01T10:00:00Z"
}
```

---

### Step 1.3 — Create Tenant

A Tenant is the organisation that sells financed devices and/or holds lock/unlock authority (e.g. a specific NBFC branch, a standalone shop, a retail chain outlet).

```
POST /admin/tenants
Authorization: Bearer <superAdminToken>

Body:
{
  "name": "Bharat Finance – Pune Branch",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "channelPartnerId": "<channelPartnerId>",
  "supportPhone": "9800000002",
  "supportEmail": "support@bharatpune.in",
  "address": {
    "street": "12, MG Road",
    "city": "Pune",
    "state": "Maharashtra",
    "pincode": "411001"
  }
}
```

**Collection written:** `tenants`

**Backend creates on tenant creation (important):**
1. `tenantPolicies` — copied from centralized `DEFAULT_TENANT_POLICY`
2. `devicePolicies` — one document per policyKey copied from centralized `DEFAULT_DEVICE_POLICIES`:

| policyKey | lockMode | disableFactoryReset | disableStatusBar |
|---|---|---|---|
| `EMI_PAID` | false | true | false |
| `EMI_GRACE` | false | true | false |
| `EMI_LOCKED` | true | true | true |
| `TEMP_UNLOCKED` | false | true | false |
| `CONSENT_INVALID` | false | true | false |

**Response:**
```json
{
  "tenantId": "<ObjectId>",
  "name": "Bharat Finance – Pune Branch",
  "capabilities": ["lend", "distribute"],
  "channelPartnerId": "<channelPartnerId>"
}
```

---

### Step 1.4 — Create Tenant Admin Account

Creates the login account for the tenant's admin — the person who will use the **Partner App** and, when the tenant has `distribute`, the **Distributor App**.

```
POST /admin/accounts
Authorization: Bearer <superAdminToken>

Body:
{
  "name": "Priya Sharma",
  "email": "priya@bharatpune.in",
  "mobile": "9800000003",
  "role": "tenant_admin",
  "tenantId": "<tenantId>",
  "temporaryPassword": "Welcome@123"
}
```

**Collection written:** `accounts`

**Backend actions:**
1. Creates the `accounts` record scoped to `tenantId`
2. Hashes the `temporaryPassword`
3. Sends a welcome email with login instructions

**Response:**
```json
{
  "accountId": "<ObjectId>",
  "email": "priya@bharatpune.in",
  "role": "tenant_admin",
  "tenantId": "<tenantId>"
}
```

> The tenant admin can now log into the **Partner App** using email + password.

---

### Flow 1 Summary

```
Super Admin (Admin Panel)
        │
        ├── POST /admin/channel-partners  →  channelPartners record created
        │
        ├── POST /admin/tenants           →  tenants record created
        │                                    + tenantPolicies copied from centralized defaults
        │                                    + devicePolicies (x5) copied from centralized defaults
        │
        └── POST /admin/accounts          →  accounts record (tenant_admin) created
                                              welcome email sent
```

---

## Flow 2 — Tenant Admin Operational Login

> **Actor:** Tenant Admin on the Partner App (Android)
> **Outcome:** The same `tenant_admin` account can operate the Partner App for `lend` workflows and the Distributor App for `distribute` workflows. No subordinate tenant accounts are used.

### Step 2.1 — Tenant Admin Logs In (Partner App)

```
POST /auth/login

Body:
{
  "email": "priya@bharatpune.in",
  "password": "Welcome@123"
}
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "tokenType": "account",
  "account": {
    "id": "...",
    "role": "tenant_admin",
    "tenantId": "<tenantId>",
    "name": "Priya Sharma"
  }
}
```

> Store the access token securely on device. The refresh token is held in an HTTP-only cookie. `tenantId` is embedded in the JWT, so all subsequent API calls are automatically scoped to this tenant.

---

### Step 2.2 — Capability-Based App Access

The backend checks the authenticated account and tenant capabilities:

| App | Required role | Required tenant capability |
|---|---|---|
| Partner App | `tenant_admin` | `lend` |
| Distributor App | `tenant_admin` | `distribute` |

No account is created in this flow. If another admin is needed, the Super Admin creates another `tenant_admin` from the Admin Dashboard.

---

### Flow 2 Summary

```
Tenant Admin (Partner App)
        │
        └── Uses Partner App if tenant has lend capability
        └── Uses Distributor App if tenant has distribute capability
```

---

## Flow 3 — User Registration + QR Generation (Distributor App)

> **Actor:** Tenant Admin on the Distributor App (Android), for a tenant with `distribute` capability
> **Outcome:** A borrower user is registered with their loan + EMI details, an enrollment token is generated, and the QR code is displayed on-screen for scanning during device provisioning.

### About EMI Details

EMI details (loan amount, per-EMI amount, tenure, disbursement date) are entered by the `tenant_admin` **during user registration**, at the time the device is sold. This is the correct moment — the loan agreement is being signed, all figures are known, and the QR code generation follows immediately in the same session.

---

### Step 3.1 — Tenant Admin Logs In (Distributor App)

```
POST /auth/login

Body:
{
  "email": "priya@bharatpune.in",
  "password": "Welcome@123"
}
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "account",
  "account": {
    "id": "...",
    "role": "tenant_admin",
    "tenantId": "<tenantId>",
    "name": "Priya Sharma"
  }
}
```

---

### Step 3.2 — Register New User (Borrower) with Loan + EMI Details

The tenant admin fills in a form with the borrower's personal details and the loan/EMI details from the loan agreement.

```
POST /distributor/users/register
Authorization: Bearer <distributorToken>

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

> `tenantId` is resolved from the distributor's JWT. Do NOT include it in the body.

**Collections written:**
- `users` — borrower record linked to `tenantId`
- `emiSchedules` — 6 installment records generated from `emiAmount`, `tenureMonths`, `disbursementDate`

**Backend actions:**
1. Creates `users` record
2. Generates `emiSchedules` with `tenureMonths` installment entries, each with a calculated `dueDate` and `emiAmount`
3. Generates a one-time `enrollmentToken` (opaque, short-lived, linked to `userId` + `tenantId`)

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

### Step 3.3 — Generate Android Device Owner Provisioning QR

The Distributor App immediately calls the QR endpoint using the `enrollmentToken` received above.

```
POST /distributor/enrollment/qr
Authorization: Bearer <distributorToken>

Body:
{
  "enrollmentToken": "TEMP_TOKEN_ABC123"
}
```

**Response — the QR JSON payload (Android provisioning format):**
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

> The extras bundle contains **only** the opaque `enrollmentToken`. No `userId`, `tenantId`, or loan data is embedded in the QR. The backend resolves all identifiers from the token.

**Distributor App action:** Render this JSON as a QR code on screen. Hand the borrower's new phone to them (factory-reset or brand new) and ask them to scan it during the Android setup screen.

---

### Flow 3 Summary

```
Tenant Admin (Distributor App)
        │
        ├── POST /distributor/users/register   →  users record created
        │       (name, mobile, EMI details)        emiSchedules created
        │                                           enrollmentToken generated
        │
        └── POST /distributor/enrollment/qr    →  QR payload returned
                (enrollmentToken)                   displayed on-screen for scanning
```

---

## Flow 4 — Device Onboarding (Target Device / Borrower App)

> **Actor:** Borrower, using their new (factory-reset) device
> **Prerequisite:** Distributor App is showing the QR code (from Flow 3, Step 3.3)
> **Outcome:** Shield App is installed as Device Owner, borrower consent is captured (Aadhaar OTP), device is registered, and the initial EMI policy is enforced.

---

### Step 4.1 — Android Device Owner QR Provisioning

**Precondition:** Brand-new phone or factory-reset device.

1. Boot device to Android setup screen
2. Tap the setup screen **6 times** to enter QR provisioning mode
3. Connect to WiFi
4. Scan the QR code displayed on the Distributor App

Android begins Device Owner provisioning automatically:
- Downloads `https://cdn.emishield.in/releases/shield.apk`
- Validates APK signature checksum
- Locates `DeviceAdminReceiver` declared in the manifest
- Grants Device Owner + Device Administration privileges to the Shield App

---

### Step 4.2 — Shield App Initializes + Extracts Enrollment Token

The app's `DeviceAdminReceiver.onProfileProvisioningComplete()` fires. It extracts the `enrollmentToken` from the QR provisioning extras:

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

### Step 4.3 — Fetch Consent Terms

The app fetches the current legal consent document to display to the borrower.

```
GET /app/consent/terms
(No auth required)
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

**App action:** Display the full agreement. The borrower must scroll to the bottom and tick a checkbox. **Do not allow proceeding until the checkbox is ticked.** This step is a legal requirement and must not be skipped or bypassed.

---

### Step 4.4 — Initiate Aadhaar OTP

After the borrower ticks the consent checkbox, the app initiates Aadhaar OTP verification via the backend. The backend proxies the call to the third-party Aadhaar provider — the app never contacts the provider directly.

```
POST /app/consent/initiate
(No auth required — uses enrollmentToken)

Body:
{
  "enrollmentToken": "TEMP_TOKEN_ABC123",
  "aadhaarLinkedMobile": "9876543210"
}
```

**Backend actions:**
1. Validates the `enrollmentToken` (exists, not expired, not yet consumed)
2. Calls the Aadhaar OTP provider to send an OTP to the borrower's Aadhaar-linked mobile
3. Stores the provider's `verificationSessionId` internally

**Response:**
```json
{
  "verificationSessionId": "VS_XYZ789",
  "otpSent": true,
  "maskedMobile": "98****3210",
  "expiresInSeconds": 600
}
```

**App action:** Show OTP input screen.

---

### Step 4.5 — Confirm Consent + Verify Aadhaar OTP

The borrower enters the OTP received on their Aadhaar-linked mobile. The app submits it along with consent confirmation.

```
POST /app/consent/confirm
(No auth required — uses enrollmentToken)

Body:
{
  "enrollmentToken": "TEMP_TOKEN_ABC123",
  "verificationSessionId": "VS_XYZ789",
  "otp": "482910",
  "consentCheckboxAccepted": true,
  "consentVersion": "1.1"
}
```

**Backend actions:**
1. Calls the Aadhaar provider to verify the OTP using `verificationSessionId`
2. Stores the provider-returned verified identity (`name`, `dob`, `address`) as `verifiedProfile` on the `users` record
3. Creates an immutable `consentRecords` document with the `aadhaarVerificationRef` from the provider
4. Marks the `enrollmentToken` as consumed (cannot be reused)
5. Issues a JWT (`tokenType: user`) for the borrower

**Collections written:** `consentRecords` (immutable — never modified after creation)

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

### Step 4.6 — Register Device

The Shield App collects device hardware details and registers the device with the backend.

| Field | Source |
|---|---|
| `imei` | `TelephonyManager.getImei(0)` (requires Device Owner privilege) |
| `imei2` | `TelephonyManager.getImei(1)` (SIM slot 2, if present) |
| `deviceModel` | `Build.MODEL` |
| `manufacturer` | `Build.MANUFACTURER` |
| `androidVersion` | `Build.VERSION.RELEASE` |
| `appVersion` | `PackageManager` |
| `fcmToken` | Firebase |

```
POST /app/device/register
Authorization: Bearer <accessToken>

Body:
{
  "imei": "123456789012345",
  "imei2": "123456789012346",
  "deviceModel": "Samsung Galaxy M14",
  "manufacturer": "Samsung",
  "androidVersion": "14",
  "appVersion": "1.0.0",
  "simInfo": {
    "simOperator": "Jio",
    "simSerial": "8991101200003204510",
    "phoneNumber": "9876543210"
  },
  "fcmToken": "<Firebase FCM registration token>"
}
```

> `userId` and `tenantId` are resolved from the JWT — do not include them in the request body.

**Backend actions:**
1. Validates JWT + confirms a `consentRecord` exists for this user (consent gate — no registration without consent)
2. Creates a `devices` record with `imei` as the primary unique identifier
3. Sets `currentPolicyKey` to `EMI_PAID` (tenant's default active policy)
4. Sets `state` to `ACTIVE`
5. Writes an `auditLogs` entry (`DEVICE_REGISTERED`)

**Collections written:** `devices`, `auditLogs`

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

### Step 4.7 — Apply Initial Policy

The Shield App applies the received policy via `DevicePolicyManager`:

```kotlin
// Always prevent factory reset (regardless of policy state)
dpm.setFactoryResetProtectionPolicy(admin, frpPolicy)

// Prevent Shield app from being uninstalled
dpm.setUninstallBlocked(admin, "com.emishield.app", true)

// Lock mode only activated if policy.restrictions.lockMode == true
// (will be false for EMI_PAID — device starts unlocked)
if (policy.restrictions.lockMode) {
    dpm.setLockTaskPackages(admin, policy.restrictions.allowedApps.toTypedArray())
    activity.startLockTaskMode()
}
```

**App action:** Store `deviceId` and `policyVersion` locally. Start the FCM listener background service. Device is now live and managed.

---

### Flow 4 Summary

```
Borrower (new device)
        │
        ├── [QR scan]  →  Android downloads APK, grants Device Owner
        │
        ├── GET  /app/consent/terms              →  consent document fetched
        │
        ├── POST /app/consent/initiate           →  Aadhaar OTP sent (via backend proxy)
        │       (enrollmentToken + mobile)
        │
        ├── POST /app/consent/confirm            →  OTP verified
        │       (enrollmentToken + OTP)              consentRecords created (immutable)
        │                                            enrollmentToken consumed
        │                                            JWT (tokenType: user) issued
        │
        ├── POST /app/device/register            →  devices record created
        │       (IMEI + FCM token)                   state = ACTIVE
        │                                            currentPolicyKey = EMI_PAID
        │                                            auditLogs written
        │
        └── [Local]  DevicePolicyManager         →  EMI_PAID policy enforced
                     FCM service started              disableFactoryReset = true
                                                      lockMode = false (full access)
```

---

## Complete End-to-End Summary

```
[Admin Panel — Web]
Super Admin
  1.1  POST /auth/login
  1.2  POST /admin/channel-partners     →  channelPartners
  1.3  POST /admin/tenants              →  tenants + default tenantPolicies + devicePolicies (x5)
  1.4  POST /admin/accounts             →  accounts (tenant_admin)
          │
          ▼
[Partner App — Android]
Tenant Admin
  2.1  POST /auth/login
  2.2  [Capability check]               →  lend/distribute app access
          │
          ▼
[Distributor App — Android]
Tenant Admin
  3.1  POST /auth/login
  3.2  POST /distributor/users/register →  users + emiSchedules + enrollmentToken
  3.3  POST /distributor/enrollment/qr  →  QR displayed on screen
          │
          ▼ [QR Scanned on new device]
[Borrower App — Android]
Borrower
  4.3  GET  /app/consent/terms
  4.4  POST /app/consent/initiate       →  Aadhaar OTP sent
  4.5  POST /app/consent/confirm        →  consentRecords + JWT issued
  4.6  POST /app/device/register        →  devices + auditLogs
  4.7  [Local] DevicePolicyManager      →  policy enforced, FCM service started
```

---

## API Routes Referenced (Quick Index)

| Step | Method | Route | Auth |
|---|---|---|---|
| 1.1, 2.1, 3.1 | POST | `/auth/login` | Public |
| 1.2 | POST | `/admin/channel-partners` | super_admin |
| 1.3 | POST | `/admin/tenants` | super_admin |
| 1.4 | POST | `/admin/accounts` | super_admin |
| 3.2 | POST | `/distributor/users/register` | tenant_admin + distribute |
| 3.3 | POST | `/distributor/enrollment/qr` | tenant_admin + distribute |
| 4.3 | GET | `/app/consent/terms` | Public |
| 4.4 | POST | `/app/consent/initiate` | Public (uses enrollmentToken) |
| 4.5 | POST | `/app/consent/confirm` | Public (uses enrollmentToken) |
| 4.6 | POST | `/app/device/register` | tokenType: user |

> **Note:** `/admin/accounts` is used by Super Admin to create `partner_admin` and `tenant_admin` accounts. There are no subordinate account routes in Partner App.

---

## Flow 5 — FCM Policy Update Flow (Server → Device)

> **Actors:** Backend server (automated) and Borrower App (Android device)
> **Outcome:** When a device's policy changes (lock, unlock, temp unlock), the server reliably delivers the new policy to the device using FCM and tracks the delivery end-to-end.
>
> **Key design:** The app does **not** trust the FCM payload alone. It uses FCM as a wake-up signal, then fetches the authoritative policy from the API.

---

### FCM Message Types

The server sends three distinct FCM message types. All use Firebase Admin SDK targeting `devices.fcmToken`.

| FCM `type` | Delivery mode | Purpose | Stored in |
|---|---|---|---|
| `POLICY_UPDATE` | Data message (silent) | Policy/state changed — app must fetch and enforce | `deviceCommands` |
| `NOTIFICATION` | Notification + data | User-facing alert (locked, unlocked, EMI reminder, etc.) | `notifications` |
| `SECURITY_ALERT` | Data message (high priority) | Tamper events, consent missing, SIM swap | `notifications` |

---

### Step 5.1 — Trigger: State Change Detected

A device state change can be triggered by:

| Trigger source | Example | `triggeredBy` value |
|---|---|---|
| Scheduler (auto) | EMI DPD Calculator detects unpaid EMI → lock device | `auto_policy` |
| Scheduler (auto) | Temp Unlock Expiry — `tempUnlockExpiresAt` passed | `temp_unlock_expiry` |
| Payment webhook | Payment validated → unlock device | `payment_unlock` |
| Tenant admin (manual) | Partner App: Grant temp unlock | `manual_tenant` |
| Super Admin (override) | Admin Panel: Force unlock with reason | `super_admin` |

For this example we trace: **EMI DPD Calculator fires at midnight — a device transitions GRACE_PERIOD → LOCKED.**

---

### Step 5.2 — Backend: Update Device State + Create Command

**Executed by:** EMI DPD Calculator scheduled job (or equivalent trigger)

```
[Server — internal, no HTTP call]

1. Query:
   emiSchedules where status = 'overdue'
   AND dpd > tenantPolicies.gracePeriodDays
   AND devices.state = 'GRACE_PERIOD'

2. For each matching device:
   a. UPDATE devices:
      { state: 'LOCKED', policyKey: 'EMI_LOCKED', policyVersion: N+1 }

   b. INSERT deviceCommands:
      {
        deviceId:    <ObjectId>,
        userId:      <ObjectId>,
        tenantId:    <ObjectId>,
        commandType: 'LOCK',
        triggeredBy: 'auto_policy',
        payload:     { policyVersion: N+1 },
        status:      'pending'
      }

   c. INSERT auditLogs:
      { event: 'DEVICE_LOCKED', actorType: 'system', ... }
```

**Collections written:** `devices`, `deviceCommands`, `auditLogs`

---

### Step 5.3 — Backend: Send FCM `POLICY_UPDATE` to Device

```
[Server — Firebase Admin SDK]

FCM data message (silent):
{
  "token": "<devices.fcmToken>",
  "data": {
    "type":          "POLICY_UPDATE",
    "commandId":     "<deviceCommands._id>",
    "policyVersion": "N+1"
  },
  "android": {
    "priority": "HIGH"
  }
}
```

**Backend actions:**
1. Firebase Admin SDK sends the message
2. Receives `fcmMessageId` from Firebase
3. Updates `deviceCommands`:
   ```
   { status: 'sent', fcmMessageId: '...', sentAt: <now> }
   ```

**Note:** FCM delivers to the device but does **not** guarantee the app processes it (device may be off, app killed, etc.). Delivery is tracked via the ack flow below.

---

### Path A — Device Is Online (Happy Path)

#### Step 5.4a — App Receives FCM and Fetches Policy

App running in foreground or background receives the data message.

```
[Borrower App — onMessageReceived handler]

FCM message arrives:
{
  "type":          "POLICY_UPDATE",
  "commandId":     "cmd_ABC123",
  "policyVersion": "5"
}

App action:
  Store commandId and policyVersion locally
  Call GET /app/device/policy immediately
```

```
GET /app/device/policy
Authorization: Bearer <userJwt>

Response:
{
  "policyKey":             "EMI_LOCKED",
  "policyVersion":         5,
  "lockMode":              true,
  "allowedApps":           ["com.android.dialer", "com.emishield.app"],
  "disableFactoryReset":   true,
  "disableStatusBar":      true,
  "disableAdb":            true
}
```

**Backend actions:** Verifies JWT and `deviceId` match, returns `devicePolicies` document for the device's current `policyKey`. Read-only.

---

#### Step 5.5a — App Enforces Policy

```
[Borrower App — DevicePolicyManager + UI layer]

1. DevicePolicyManager.lockNow()  (if lockMode = true)
2. Set allowedApps restriction via DPC
3. Apply disableFactoryReset, disableStatusBar, disableAdb flags
4. UI transitions to LOCKED state (full-screen lock screen shown)
```

---

#### Step 5.6a — App Sends Explicit Ack

After successfully applying the policy, the app calls the ack endpoint.

```
POST /app/device/command/ack
Authorization: Bearer <userJwt>

Body:
{
  "commandId":            "cmd_ABC123",
  "appliedPolicyVersion": 5,
  "appliedAt":            "2024-01-15T00:03:47.000Z"
}
```

**Backend actions:**
1. Validates `commandId` belongs to the authenticated device
2. Updates `deviceCommands`:
   ```
   { status: 'acknowledged', acknowledgedAt: <appliedAt> }
   ```
3. Confirms device state:
   - LOCK command → state stays `LOCKED`
   - UNLOCK command → state transitions to `ACTIVE`
4. Writes `auditLogs` entry: `POLICY_ACKNOWLEDGED`

**Response:**
`json
{ "success": true }
`

---

#### Step 5.7a — Backend Sends User-Facing NOTIFICATION FCM

After the command is acknowledged, the server sends a separate `NOTIFICATION`-type FCM so the borrower sees a push notification.

```
[Server — Firebase Admin SDK]

FCM notification message:
{
  "token": "<devices.fcmToken>",
  "notification": {
    "title": "Device Restricted",
    "body":  "Your EMI payment is overdue. Your device has been restricted."
  },
  "data": {
    "type":             "NOTIFICATION",
    "notificationType": "DEVICE_LOCKED",
    "notificationId":   "<notifications._id>",
    "deepLink":         "emishield://pay"
  },
  "android": {
    "priority": "HIGH"
  }
}
```

**Backend actions:**
1. Inserts `notifications` document (`channel: 'fcm'`, `type: 'DEVICE_LOCKED'`, `status: 'pending'`)
2. After FCM send: updates `notifications.status` → `sent`, sets `sentAt`

**App action:** Display push notification. On tap → open Borrower App to Pay Now screen.

---

### Path B — Device Is Offline

#### Step 5.4b — FCM Delivery Fails

```
[Server — FCM failure handler]

Firebase reports delivery failure (token unreachable, device offline, token stale)

Backend actions:
1. deviceCommands stays 'pending' (not failed yet)
   Sets nextRetryAt = now + initial_backoff
   retryCount remains 0
2. devices.state → 'OFFLINE_PENDING'
```

---

#### Step 5.5b — Command Retry Job Retries FCM

**Runs every 10 minutes.**

```
[Server — Command Retry Job]

Query:
  deviceCommands where status = 'pending'
  AND nextRetryAt < now
  AND retryCount < maxRetries (default: 5)

For each:
  Re-send FCM POLICY_UPDATE
  If FCM accepted: status → 'sent', fcmMessageId updated
  If still failing: retryCount++, nextRetryAt += (retryCount * 10 min backoff)
  If retryCount >= maxRetries: status → 'failed'
```

---

#### Step 5.6b — Device Reconnects: Ping Detects Stale Policy

When the device comes back online, the Borrower App calls the ping endpoint (runs in background periodically).

```
POST /app/device/ping
Authorization: Bearer <userJwt>

Body:
{
  "fcmToken":                 "<current_fcm_token>",
  "lastAppliedPolicyVersion": 3,
  "batteryLevel":             72,
  "networkType":              "WIFI"
}
```

**Backend actions:**
1. Updates `devices.fcmToken` (in case token rotated while offline)
2. Compares `lastAppliedPolicyVersion` vs `devices.policyVersion`
3. If mismatch → includes `forceApplyPolicy: true` and pending commands in response

**Response (when policy mismatch detected):**
`json
{
  "deviceState": "LOCKED",
  "forceApplyPolicy": true,
  "policyVersion": 5,
  "pendingCommands": [
    { "commandId": "cmd_ABC123", "commandType": "LOCK" }
  ]
}
`

---

#### Step 5.7b — App Fetches and Applies Policy on Reconnect

```
[Borrower App]

1. Sees forceApplyPolicy: true in ping response
2. Call GET /app/device/policy           (same as Step 5.4a)
3. Apply policy via DevicePolicyManager  (same as Step 5.5a)
4. Call POST /app/device/command/ack
   for each commandId in pendingCommands (same as Step 5.6a)
```

After ack, `devices.state` is confirmed as the target state (`LOCKED` or `ACTIVE`).

---

### Flow 5 Summary Diagram

```
               [Trigger: Scheduler / Payment Webhook / Manual]
                                   │
                                   ▼
               [Server] Update devices.state + policyKey + policyVersion
                        Insert deviceCommands (status: pending)
                        Write auditLogs
                                   │
                                   ▼
               [Server] Firebase Admin SDK → FCM POLICY_UPDATE
                        Update deviceCommands (status: sent, fcmMessageId)
                                   │
               ┌───────────────────┴───────────────────┐
               │ Device ONLINE                          │ Device OFFLINE
               ▼                                        ▼
     [App] Receives FCM POLICY_UPDATE        FCM delivery fails
     [App] GET /app/device/policy            deviceCommands → pending
     [App] Enforce via DevicePolicyManager   devices.state → OFFLINE_PENDING
     [App] POST /app/device/command/ack      Command Retry Job (every 10 min)
               │                                        │
               ▼                                        ▼ (device reconnects)
     [Server] commandStatus → acknowledged   [App] POST /app/device/ping
     [Server] devices.state confirmed         ← forceApplyPolicy: true
               │                              [App] GET /app/device/policy
               │                              [App] Enforce + ack
               │                                        │
               └───────────────────┬───────────────────┘
                                   ▼
               [Server] Send FCM NOTIFICATION (user-visible push alert)
                        Insert notifications record (status: sent)
               [App] Show push notification to borrower
```

---

### API Routes Referenced in Flow 5

| Step | Method | Route | Auth |
|---|---|---|---|
| 5.4a / 5.7b | GET | `/app/device/policy` | `tokenType: user` |
| 5.6a / 5.7b | POST | `/app/device/command/ack` | `tokenType: user` |
| 5.6b | POST | `/app/device/ping` | `tokenType: user` |

> **Note:** `POST /app/device/command/ack` is a new route — see architecture.md for its full specification.

---

## Flow 6 — QR Payment + Tenant Approval + Device Unlock

> **Actors:** Borrower (Borrower App), Tenant Admin (Partner App), Backend Server
> **Precondition:** Device is in LOCKED state. Tenant has at least one active QR code configured.
> **Outcome:** Borrower pays via the tenant's UPI QR, tenant approves, device unlocks.

---

### Step 6.1 — Borrower Taps "Pay Now"

Borrower is on the lock screen. They tap the **Pay Now** button.

```
GET /app/payment/qr
Authorization: Bearer <userJwt>
```

**Backend actions:**
1. Identifies the tenant from the device's 	enantId
2. Finds the entry in 	enants.qrCodes where isActive: true
3. Returns the QR image URL and label

**Response:**
`json
{
  "qrCodeId": "<ObjectId>",
  "label": "HDFC UPI",
  "imageUrl": "https://storage.emishield.in/qr/tenant123_hdfc.png"
}
`

> If no active QR exists: 404 — "Payment not available — contact your lender"

---

### Step 6.2 — Borrower Scans QR and Pays

The Borrower App loads the QR image from the imageUrl and displays it full-screen.

```
[Borrower App — UI]

1. Display QR image (loaded from imageUrl)
2. Show label: "HDFC UPI"
3. Show instruction: "Scan this QR with any UPI app and pay your EMI amount"
4. Show "I have paid" button
```

The borrower opens their own UPI app (PhonePe, GPay, Paytm, etc.), scans the QR, and completes the payment externally. No app integration needed — the payment happens entirely in the borrower's UPI app.

---

### Step 6.3 — Borrower Taps "I Have Paid"

After paying, the borrower taps the confirmation button.

```
POST /app/payment/submit
Authorization: Bearer <userJwt>

Body:
{
  "qrCodeId": "<ObjectId>",
  "amount": 3500
}
```

**Backend actions:**
1. Validates JWT — device belongs to this tenant
2. Checks no pproval_pending payment already exists for this device (prevents duplicate submissions)
3. Creates payments document:
   `
   {
     userId, tenantId, deviceId,
     amount: 3500, currency: 'INR',
     paymentMethod: 'qr',
     qrCodeId: <ObjectId>,
     status: 'approval_pending',
     approvalStatus: 'pending_approval',
     submittedAt: <now>
   }
   `
4. Sends FCM NOTIFICATION to tenant admin devices (all accounts with this tenantId):
   `
   notificationType: 'PAYMENT_APPROVAL_REQUIRED'
   deepLink: 'emishield://partner/payments/pending'
   `
5. Writes uditLogs entry: PAYMENT_SUBMITTED

**Collections written:** payments, uditLogs, 
otifications

**Response:**
`json
{
  "paymentId": "<ObjectId>",
  "status": "approval_pending",
  "message": "Payment submitted — awaiting lender confirmation"
}
`

**Borrower App UX:** Shows "Payment submitted — waiting for confirmation" with a spinner/status screen.

---

### Step 6.4 — Tenant Admin Reviews Pending Payment

Tenant admin receives FCM notification on their Partner App. They open the pending payments list.

```
GET /partner/payments/pending-approval
Authorization: Bearer <tenantAdminJwt>
```

**Response:**
`json
{
  "payments": [
    {
      "paymentId": "<ObjectId>",
      "user": { "name": "Ramesh Kumar", "phone": "9876543210" },
      "device": { "model": "Samsung Galaxy A15", "imei": "..." },
      "amount": 3500,
      "submittedAt": "2024-01-15T14:22:00.000Z",
      "qrLabel": "HDFC UPI"
    }
  ]
}
`

The tenant admin verifies the payment in their own bank/UPI app (checks inward credit).

---

### Step 6.5 — Tenant Approves Payment

```
POST /partner/payments/:paymentId/approve
Authorization: Bearer <tenantAdminJwt>
```

**Backend actions:**
1. Validates payment belongs to this tenant and is pprovalStatus: 'pending_approval'
2. Updates payments:
   `
   {
     status: 'success',
     approvalStatus: 'approved',
     approvedBy: <tenantAdminAccountId>,
     approvedAt: <now>,
     completedAt: <now>
   }
   `
3. Matches payment amount → miSchedules installments — marks matched installments as paid, sets matchedInstallments
4. Evaluates 	enantPolicies.unlockRules — determines unlock type
5. Updates devices:
   `
   { state: 'UNLOCK_PENDING', policyKey: 'EMI_PAID', policyVersion: N+1 }
   `
6. Creates deviceCommands record:
   `
   { commandType: 'UNLOCK', triggeredBy: 'payment_unlock', payload: { policyVersion: N+1 } }
   `
7. Sends FCM POLICY_UPDATE to the borrower's device
8. Writes uditLogs entry: PAYMENT_APPROVED, UNLOCK_TRIGGERED

**Collections written:** payments, miSchedules, devices, deviceCommands, uditLogs

**Response:**
`json
{
  "success": true,
  "paymentId": "<ObjectId>",
  "unlockCommandId": "<ObjectId>",
  "matchedInstallments": ["<ObjectId>"]
}
`

---

### Step 6.6 — Device Receives Policy Update and Unlocks

The Borrower App receives the POLICY_UPDATE FCM (same as Flow 5 — online path).

```
FCM message received:
{ "type": "POLICY_UPDATE", "commandId": "<cmd_id>", "policyVersion": "N+1" }

[Borrower App]
1. Call GET /app/device/policy
   → returns { policyKey: 'EMI_PAID', lockMode: false, ... }
2. Apply via DevicePolicyManager (lockMode = false → unlock device)
3. Call POST /app/device/command/ack
   → server confirms devices.state → 'ACTIVE'
```

---

### Step 6.7 — Borrower Receives Unlock Confirmation

Server sends NOTIFICATION FCM to borrower after command is acknowledged.

```
[Server — Firebase Admin SDK]

notificationType: 'UNLOCK_SUCCESS'
title: 'Device Unlocked'
body: 'Your payment has been confirmed. Your device is now fully unlocked.'
deepLink: 'emishield://home'
```

**Borrower App UX:** Full-screen unlock success screen. Device returns to normal operation.

---

### QR Management Sub-Flow (Tenant — Partner App)

> **When:** Tenant wants to add, update, or switch their active payment QR code.

#### Upload a New QR Code

```
POST /partner/qr-codes
Authorization: Bearer <tenantAdminJwt>
Content-Type: multipart/form-data

Fields:
  image: <QR image file, PNG/JPG, max 2MB>
  label: "PhonePe Business QR"
```

**Backend actions:**
1. Validate image type and size
2. Upload image to S3 → get imageUrl
3. Append to 	enants.qrCodes:
   `
   { label: 'PhonePe Business QR', imageUrl, isActive: false, uploadedBy }
   `
4. If this is the tenant's first QR code, auto-set isActive: true

#### Set Active QR

```
PUT /partner/qr-codes/:qrId/activate
Authorization: Bearer <tenantAdminJwt>
```

**Backend actions:**
1. Atomically set all 	enants.qrCodes[].isActive → alse
2. Set target entry isActive → 	rue

#### Delete QR

```
DELETE /partner/qr-codes/:qrId
Authorization: Bearer <tenantAdminJwt>
```

> Returns 400 if the target QR is the currently active one. Tenant must activate a different QR first.

---

### Flow 6 Summary Diagram

```
[Borrower App — LOCKED state]
  6.1  GET  /app/payment/qr              ← fetch active QR imageUrl from tenants.qrCodes
  6.2  [Display QR image full-screen]
       [User pays with their own UPI app externally]
  6.3  POST /app/payment/submit          → payments (status: approval_pending)
                                         → FCM NOTIFICATION to tenant admins
         │
         ▼
[Partner App — Tenant Admin]
  6.4  GET  /partner/payments/pending-approval
       [Tenant admin verifies payment in bank/UPI app]
  6.5  POST /partner/payments/:id/approve
         → payments (status: success, approvalStatus: approved)
         → emiSchedules (installments marked paid)
         → devices (state: UNLOCK_PENDING, policyKey: EMI_PAID)
         → deviceCommands (UNLOCK command created)
         → FCM POLICY_UPDATE → borrower device
         │
         ▼
[Borrower App — receives FCM]
  6.6  GET  /app/device/policy           ← fetch EMI_PAID policy
       [DevicePolicyManager: lockMode = false]
       POST /app/device/command/ack      → devices.state → ACTIVE
  6.7  [Receives FCM NOTIFICATION: UNLOCK_SUCCESS]
       [Full-screen unlock confirmation shown]
```

---

### API Routes Referenced in Flow 6

| Step | Method | Route | Auth |
|---|---|---|---|
| 6.1 | GET | /app/payment/qr | 	okenType: user |
| 6.3 | POST | /app/payment/submit | 	okenType: user |
| 6.4 | GET | /partner/payments/pending-approval | 	okenType: account, tenant |
| 6.5 | POST | /partner/payments/:paymentId/approve | 	okenType: account, tenant |
| 6.6 | GET | /app/device/policy | 	okenType: user |
| 6.6 | POST | /app/device/command/ack | 	okenType: user |
| QR | GET | /partner/qr-codes | 	okenType: account, tenant |
| QR | POST | /partner/qr-codes | 	okenType: account, 	enant_admin |
| QR | PUT | /partner/qr-codes/:qrId/activate | 	okenType: account, 	enant_admin |
| QR | DELETE | /partner/qr-codes/:qrId | 	okenType: account, 	enant_admin |

---

## Flow 7 -- Unlock Request + Two-Tier Escalation

> **Actors:** Borrower (Borrower App), Tenant Admin (Partner App), Partner Admin (Partner App), Super Admin (Admin Dashboard), Backend Server
> **Precondition:** Device is in LOCKED state. Borrower has not paid or needs temporary access.
> **Outcome:** Device is unlocked (full or temp) OR request is rejected. If tenant/CP do not respond in time, the case automatically escalates up the chain.

---

### Step 7.1 -- Borrower Submits Unlock Request

Borrower is on the lock screen and taps "Request Unlock". A form is presented:

| Field | Required | Description |
|---|---|---|
| **Reason** | YES | Short mandatory explanation |
| **Details** | NO | Optional longer description (e.g. "I paid on Jan 5, UPI ref below") |
| **Category** | NO | payment_made / temporary_emergency / payment_mismatch / other |
| **Image** | NO | Optional JPEG evidence (max 5MB -- screenshot of payment, invoice, etc.) |

Request -- POST /app/unlock-request
  Content-Type: multipart/form-data
  Fields: reason, reasonCategory, details (optional), image (optional JPEG)

**Backend actions:**
1. Checks no active case (PENDING_TENANT / ESCALATED_*) already exists for this device -- 409 if one is open
2. Uploads image to S3 if provided, stores imageUrl
3. Resolves slaHours from tenantPolicies.escalationRules.slaHours
4. Creates unlockRequests: { caseId: "CASE-2024-00123", status: "PENDING_TENANT", slaDeadline: now + slaHours, details, imageUrl, reasonCategory }
5. Sends FCM NOTIFICATION to all tenant admin devices: UNLOCK_REQUEST_RECEIVED
6. Writes auditLogs: UNLOCK_REQUEST_CREATED

**Response:**
```json
{
  "caseId": "CASE-2024-00123",
  "status": "PENDING_TENANT",
  "slaDeadline": "2024-01-10T10:00:00Z",
  "message": "Request submitted. Your lender has been notified."
}
```

**Borrower App UX:** Shows a "Request Submitted" screen with the caseId and a progress tracker. Borrower can check status anytime via GET /app/unlock-request/active.

---

### Step 7.2 -- Tenant Reviews the Request (Partner App)

Tenant admin receives a push notification and opens the case in the Partner App.

    GET /partner/unlock-requests/:requestId
    Authorization: Bearer <tenantAdminJwt>

**Response includes:**
- Borrower name, phone, device model/IMEI
- reason, details, reasonCategory
- imageUrl (displayed as a thumbnail they can expand)
- slaDeadline with time remaining countdown
- EMI schedule summary (which installments are overdue)

---

### Step 7.3A -- Tenant Fully Unlocks (with optional EMI Waive)

Tenant verifies the borrower's claim and chooses to unlock the device.

    POST /partner/unlock-requests/:requestId/approve
    Authorization: Bearer <tenantAdminJwt>

    Body:
    {
      "note": "Verified borrower UPI screenshot. Payment confirmed.",
      "emiAction": "waive"
    }

**emiAction options:**
- "waive" -- marks the current overdue installment as waived in emiSchedules. Device policy becomes EMI_PAID; DPD scheduler will not re-lock this installment. waiveReason is set to caseId.
- "none" (default) -- device unlocked but installment remains overdue. DPD scheduler may re-lock next cycle -- use with caution.

**Backend actions:**
1. If emiAction = "waive": updates overdue installment { status: "waived", waivedBy, waivedAt, waiveReason: caseId }
2. Updates devices: { state: "UNLOCK_PENDING", policyKey: "EMI_PAID", policyVersion: N+1 }
3. Creates deviceCommands: UNLOCK command (triggeredBy: "manual_tenant")
4. Sends FCM POLICY_UPDATE to device (same pipeline as Flow 5/6)
5. Updates unlockRequests: { status: "RESOLVED_TENANT", resolutionAction: "waived" | "unlocked", resolvedBy, resolvedAt, resolutionNote }
6. Sends FCM NOTIFICATION to borrower: UNLOCK_SUCCESS
7. Writes auditLogs: CASE_RESOLVED, UNLOCK_TRIGGERED (+ CASE_WAIVED if emiAction = waive)

---

### Step 7.3B -- Tenant Grants Temporary Unlock

Tenant gives the borrower a time-limited window.

    POST /partner/unlock-requests/:requestId/temp-unlock
    Authorization: Bearer <tenantAdminJwt>

    Body:
    { "durationHours": 24, "note": "Borrower travelling, will pay on return" }

**Backend actions:**
1. Updates devices: { state: "TEMP_UNLOCK", policyKey: "TEMP_UNLOCKED", tempUnlockExpiresAt: now + 24h }
2. Creates deviceCommands: TEMP_UNLOCK command
3. Sends FCM POLICY_UPDATE to device
4. Updates unlockRequests: { status: "RESOLVED_TENANT", resolutionAction: "temp_unlocked", tempUnlockDurationHours: 24, resolvedBy, resolvedAt, resolutionNote }
5. Sends FCM NOTIFICATION to borrower: TEMP_UNLOCK_APPROVED (includes expiry time)

**After expiry:** The Temp Unlock Expiry scheduler (every 1 min) re-evaluates and relocks to LOCKED state.

---

### Step 7.3C -- Tenant Rejects the Request

    POST /partner/unlock-requests/:requestId/reject
    Authorization: Bearer <tenantAdminJwt>

    Body: { "note": "No payment received per bank records. Please use Pay Now." }

**Backend actions:**
1. Updates unlockRequests: { status: "REJECTED", resolutionAction: "rejected", resolvedBy, resolvedAt, resolutionNote }
2. Sends FCM NOTIFICATION to borrower: ESCALATION_UPDATE with rejection note
3. Writes auditLogs: CASE_RESOLVED

---

### Step 7.4 -- Tenant SLA Breach -> Escalation to Channel Partner

If the tenant does not action the case before slaDeadline, the SLA Escalation Checker (runs every 5 minutes) catches it.

```
[Scheduler -- SLA Escalation Checker -- Tier 1]

Query: unlockRequests WHERE status = "PENDING_TENANT" AND slaDeadline < now

For each matched case:
  1. unlockRequests.status -> "ESCALATED_PARTNER"
  2. escalatedToPartnerAt = now
  3. partnerSlaDeadline = now + policy.escalationRules.partnerEscalationSlaHours
  4. Write auditLogs: ESCALATION_RAISED, SLA_BREACHED
  5. Create riskFlag if tenant has >= 3 SLA breaches this month
  6. FCM NOTIFICATION (CASE_ESCALATED_TO_PARTNER) -> partner admins
  7. FCM NOTIFICATION (ESCALATION_UPDATE) -> borrower: "Your request has been escalated"
```

---

### Step 7.5 -- Channel Partner Reviews and Acts

Partner admin receives the FCM notification and opens their escalation queue.

    GET /cp/escalations
    Authorization: Bearer <partnerAdminJwt>

Response shows all ESCALATED_PARTNER cases from tenants under this channel partner, including:
- Full case history (why the borrower submitted, what the tenant did or didn't do)
- Evidence image
- Borrower and device details
- Time remaining on partnerSlaDeadline

**CP takes one of the same three actions (same mechanics as tenant):**
- POST /cp/escalations/:caseId/approve  -> RESOLVED_PARTNER
- POST /cp/escalations/:caseId/temp-unlock -> RESOLVED_PARTNER
- POST /cp/escalations/:caseId/reject -> REJECTED

---

### Step 7.6 -- Channel Partner SLA Breach -> Escalation to Super Admin

If the channel partner also doesn't act before partnerSlaDeadline:

```
[Scheduler -- SLA Escalation Checker -- Tier 2]

Query: unlockRequests WHERE status = "ESCALATED_PARTNER" AND partnerSlaDeadline < now

For each matched case:
  1. unlockRequests.status -> "ESCALATED_ADMIN"
  2. escalatedToAdminAt = now
  3. Write auditLogs: ESCALATION_RAISED, SLA_BREACHED
  4. Create riskFlag for channel partner SLA breach
  5. FCM NOTIFICATION (CASE_ESCALATED_TO_ADMIN) -> super admin
  6. FCM NOTIFICATION (ESCALATION_UPDATE) -> borrower: "Escalated to platform support"
```

---

### Step 7.7 -- Super Admin Override

Super admin reviews the fully-escalated case with complete history.

    GET /admin/escalations/:caseId

    POST /admin/escalations/:caseId/unlock
    Body: { "reason": "Tenant + CP both SLA breached. Borrower payment screenshot verified." }

All super admin actions require a mandatory reason field. The action is recorded in auditLogs as OVERRIDE_EXECUTED.

**Backend actions (same pipeline as approve flow):**
- Device unlocked, deviceCommands created with triggeredBy: "super_admin"
- unlockRequests.status -> RESOLVED_SUPER_ADMIN
- FCM NOTIFICATION to borrower: UNLOCK_SUCCESS

---

### Flow 7 Summary Diagram

```
[Borrower App -- LOCKED state]
  7.1  POST /app/unlock-request (reason + details + optional JPEG image)
       -> unlockRequests created (PENDING_TENANT)
       -> FCM NOTIFICATION to tenant admins
         |
         v
[Partner App -- Tenant Admin]   (SLA: configurable, default 24h)
  7.2  GET  /partner/unlock-requests/:id    <- review case + image
         |
    +----+-----------------------------------+
    v                  v                     v
  APPROVE          TEMP-UNLOCK            REJECT
  7.3A             7.3B                   7.3C
  (full unlock     (X hours,              (denied,
   + optional      auto-relock)            notify
   EMI waive)                              borrower)
    +----+-----------------------------------+
         |
         | (if tenant doesn't act before SLA)
         v
[Scheduler -- Tier 1 SLA Checker]   -> ESCALATED_PARTNER
  FCM CASE_ESCALATED_TO_PARTNER -> partner admins
         |
         v
[Partner App -- Partner Admin]   (SLA: configurable, default 48h)
  7.5  GET  /cp/escalations
         | (same 3 options: approve / temp-unlock / reject)
         | (if CP doesn't act before SLA)
         v
[Scheduler -- Tier 2 SLA Checker]   -> ESCALATED_ADMIN
  FCM CASE_ESCALATED_TO_ADMIN -> super admin
         |
         v
[Admin Dashboard -- Super Admin]
  7.7  GET  /admin/escalations
       POST /admin/escalations/:id/unlock (mandatory reason)
       -> RESOLVED_SUPER_ADMIN
       -> FCM UNLOCK_SUCCESS to borrower
```

---

### API Routes Referenced in Flow 7

| Step | Method | Route | Auth |
|---|---|---|---|
| 7.1 | POST | /app/unlock-request | tokenType: user |
| 7.1 | POST | /app/unlock-request/:id/image | tokenType: user |
| 7.1 | GET | /app/unlock-request/active | tokenType: user |
| 7.2 | GET | /partner/unlock-requests | tokenType: account, tenant |
| 7.2 | GET | /partner/unlock-requests/:id | tokenType: account, tenant |
| 7.3A | POST | /partner/unlock-requests/:id/approve | tokenType: account, tenant |
| 7.3B | POST | /partner/unlock-requests/:id/temp-unlock | tokenType: account, tenant |
| 7.3C | POST | /partner/unlock-requests/:id/reject | tokenType: account, tenant |
| 7.5 | GET | /cp/escalations | tokenType: account, partner_admin |
| 7.5 | GET | /cp/escalations/:caseId | tokenType: account, partner_admin |
| 7.5 | POST | /cp/escalations/:caseId/approve | tokenType: account, partner_admin |
| 7.5 | POST | /cp/escalations/:caseId/temp-unlock | tokenType: account, partner_admin |
| 7.5 | POST | /cp/escalations/:caseId/reject | tokenType: account, partner_admin |
| 7.7 | GET | /admin/escalations | tokenType: account, super_admin |
| 7.7 | POST | /admin/escalations/:caseId/unlock | tokenType: account, super_admin |
| 7.7 | POST | /admin/escalations/:caseId/temp-unlock | tokenType: account, super_admin |
| 7.7 | POST | /admin/escalations/:caseId/reject | tokenType: account, super_admin |
