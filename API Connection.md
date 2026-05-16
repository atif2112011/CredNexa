# EMI Shield — Android App API Connection Guide

> **For:** Android App Developers  
> **Purpose:** Maps every app use case (UC-1 to UC-32) to the exact API calls required, the request payloads to send, and how to handle the response.  
> **Base URL:** `https://api.emishield.in/api/v1`  
> **Auth:** All `/app/*` and `/device/*` routes require `Authorization: Bearer <accessToken>` (tokenType: `user`)

---

## Quick Index

| Group | Use Cases |
|---|---|
| [Onboarding](#1-onboarding) | UC-1, UC-2, UC-3, UC-4 |
| [App Launch & Session](#2-app-launch--session) | UC-5, UC-6 |
| [Device State Display](#3-device-state-display) | UC-7, UC-8, UC-9, UC-10, UC-11 |
| [EMI & Payment](#4-emi--payment) | UC-12, UC-13, UC-14, UC-15 |
| [Unlock Request & Escalation](#5-unlock-request--escalation) | UC-16, UC-17, UC-18, UC-19 |
| [Notifications](#6-notifications) | UC-20, UC-21, UC-22, UC-23 |
| [Offline & Sync](#7-offline--sync) | UC-24, UC-25, UC-26, UC-27 |
| [Security Events](#8-security-events) | UC-28, UC-29, UC-30 |
| [Support & Info](#9-support--info) | UC-31, UC-32 |

---

## Auth Token Reference

| Token | Issued by | Used for |
|---|---|---|
| `accessToken` | `/auth/verify-otp` | All API calls (short-lived, ~15 min) |
| `refreshToken` | `/auth/verify-otp` | Get a new accessToken when expired |

Store both tokens securely in Android **EncryptedSharedPreferences**.  
When any API returns `401`, call `POST /auth/refresh-token` before retrying.

---

## 1. Onboarding

### UC-1 — First Launch: Check If Device Is Already Registered

**Trigger:** App opens for the first time (no stored token).  
**Purpose:** If this device's IMEI is already registered (device re-installed or transferred), skip the onboarding flow and prompt login instead.

**Step 1 — Read device IMEI, then call:**

```
POST /app/check-device
Content-Type: application/json
(No auth token required — public endpoint)

Body:
{
  "imei": "<device IMEI1>"
}
```

**Response:**
```json
// Device already registered
{
  "registered": true,
  "userId": "...",
  "requiresLogin": true
}

// Not registered — proceed with onboarding
{
  "registered": false
}
```

**App action:**
- `registered: true` → skip onboarding, go to **Login screen** (UC-2)
- `registered: false` → proceed to consent flow (UC-3)

---

### UC-2 — User Login (Returning User)

**Trigger:** Returning user opens app, or UC-1 returned `registered: true`.

**Step 1 — Request OTP:**
```
POST /auth/send-otp
(No auth token required)

Body:
{
  "mobile": "9876543210",
  "purpose": "login"
}
```

**Response:**
```json
{ "success": true, "expiresInSeconds": 600 }
```

**Step 2 — Verify OTP:**
```
POST /auth/verify-otp
(No auth token required)

Body:
{
  "mobile": "9876543210",
  "otp": "123456",
  "purpose": "login"
}
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "user",
  "user": {
    "id": "...",
    "name": "Ramesh Kumar",
    "mobile": "9876543210"
  }
}
```

**App action:**
- Store `accessToken` and `refreshToken` in EncryptedSharedPreferences
- Navigate to Dashboard (UC-7)

---

### UC-3 — Consent Flow (New User — Aadhaar OTP Backed)

**Trigger:** First-time user, after UC-1 returned `registered: false`.  
**This flow is legally mandatory. Do not skip or allow bypassing.**

**Step 1 — Fetch consent document to display to user:**
```
GET /app/consent/terms
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

**App action:** Display the full agreement text. User must scroll to bottom and check a checkbox. Do not allow proceeding until checkbox is ticked.

**Step 2 — Initiate Aadhaar OTP (after user checks checkbox):**
```
POST /app/consent/initiate
Authorization: Bearer <accessToken>

Body:
{
  "aadhaarLinkedMobile": "9876543210"
}
```

**Response:**
```json
{
  "otpSent": true,
  "maskedMobile": "98****3210",
  "expiresInSeconds": 600
}
```

**Step 3 — Submit consent with OTP:**
```
POST /app/consent/confirm
Authorization: Bearer <accessToken>

Body:
{
  "otp": "482910",
  "consentCheckboxAccepted": true,
  "consentVersion": "1.1"
}
```

**Response:**
```json
{
  "consentRecordId": "...",
  "consentAccepted": true,
  "message": "Consent recorded successfully"
}
```

**App action:** Store `consentRecordId`. Proceed to device registration (UC-4).

---

### UC-4 — Device Registration

**Trigger:** Immediately after consent is confirmed (UC-3).  
**Purpose:** Register this physical device (IMEI + hardware fingerprint + FCM token) with the server.

```
POST /app/device/register
Authorization: Bearer <accessToken>

Body:
{
  "imei": "123456789012345",
  "imei2": "123456789012346",
  "deviceModel": "Samsung Galaxy A15",
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

**Response:**
```json
{
  "deviceId": "...",
  "state": "ACTIVE",
  "message": "Device registered successfully"
}
```

**App action:**
- Store `deviceId` locally
- Navigate to main Dashboard
- Start background FCM listener service

> **Note:** Always send a fresh FCM token. Firebase rotates tokens — update it via `POST /app/device/ping` whenever `FirebaseMessagingService.onNewToken()` fires.

---

## 2. App Launch & Session

### UC-5 — App Opens (Has Stored Token)

**Trigger:** App opens and there is a stored `accessToken`.  
**Purpose:** Validate that the token is still valid and the device is still trusted.

```
GET /app/session/validate
Authorization: Bearer <accessToken>
```

**Response:**
```json
// Token valid
{
  "valid": true,
  "user": { "id": "...", "name": "Ramesh Kumar" },
  "deviceState": "ACTIVE"
}

// Token expired
{ "valid": false, "reason": "token_expired" }

// Device tampered or deregistered
{ "valid": false, "reason": "device_invalid" }
```

**App action:**
- `valid: true` → proceed to `GET /app/device/state` (UC-7)
- `valid: false, reason: token_expired` → call `POST /auth/refresh-token` with `refreshToken`
- `valid: false, reason: device_invalid` → clear local storage, force re-onboarding

---

### UC-6 — Device Integrity Check on Launch

**Trigger:** After session is validated (UC-5).  
**Purpose:** Check for root, tampering, or SIM change and report to server.

> This is handled by the **security event reporting** API.  
> Run integrity checks locally (root detection libraries, SafetyNet/Play Integrity API) and report findings immediately.

If root detected:
```
POST /app/security/event
Authorization: Bearer <accessToken>

Body:
{ "eventType": "ROOT_DETECTED", "details": { "method": "supersu_binary" } }
```

If SIM changed (compare against stored simSerial):
```
POST /app/security/event
Body:
{ "eventType": "SIM_CHANGE_DETECTED", "details": { "newSimSerial": "..." } }
```

**Response:** `{ "received": true }`  
Server will create a `riskFlag` and notify the tenant dashboard. The device state may change as a result — re-fetch `GET /app/device/state` after reporting.

---

## 3. Device State Display

> All device state rendering is driven by a **single API call**. Every screen in the app should call this when it comes to the foreground.

```
GET /app/device/state
Authorization: Bearer <accessToken>
```

**Full Response Shape:**
```json
{
  "state": "LOCKED",
  "stateUpdatedAt": "2024-01-09T10:00:00Z",
  "tempUnlockExpiresAt": null,
  "pendingCommand": {
    "commandId": "...",
    "type": "UNLOCK",
    "status": "pending"
  },
  "pendingCase": {
    "caseId": "CASE-2024-00123",
    "status": "ESCALATED",
    "slaDeadline": "2024-01-10T10:00:00Z"
  }
}
```

**Possible `state` values and what the app should show:**

---

### UC-7 — Device is ACTIVE (Normal State)

`state: "ACTIVE"` → Show normal home screen.  
No restrictions. User can use the device freely.  
Show EMI due date reminder if DPD is approaching.

---

### UC-8 — Device is in GRACE_PERIOD

`state: "GRACE_PERIOD"` → Show warning banner.  
EMI is overdue but within grace period. Device still functional.  
Show: days remaining in grace period, amount due, Pay Now button.

---

### UC-9 — Device is LOCKED

`state: "LOCKED"` → Display lock screen UI.  
Restrict device to lock screen. Show:
- "Your device has been locked due to an overdue EMI"
- Amount due
- Pay Now button → navigates to payment flow (UC-12)
- Request Unlock button → navigates to unlock request flow (UC-16)
- Emergency call button (always visible — calls 112)

> **CRITICAL:** Emergency calls (112) must remain accessible even on lock screen. This is non-negotiable.

---

### UC-10 — Device is in TEMP_UNLOCK

`state: "TEMP_UNLOCK"` → Show unlock timer banner.  
Device temporarily unlocked. Show:
- Countdown timer to `tempUnlockExpiresAt`
- "Your device will re-lock when the temporary unlock expires"
- Pay Now button

When `tempUnlockExpiresAt` is reached locally → show lock screen again. The server will also send an FCM command to re-lock.

---

### UC-11 — Device is UNLOCK_PENDING

`state: "UNLOCK_PENDING"` → Show "Unlock in progress" screen.  
Payment was received. Unlock command is queued but not yet delivered to device.  
Show: "Your payment was received. Your device is being unlocked..."  
Poll `GET /app/device/state` every 10 seconds until state changes to `ACTIVE`.

---

## 4. EMI & Payment

### UC-12 — Initiate EMI Payment

**Trigger:** User taps "Pay Now" from lock screen or dashboard.

**Step 1 — Get current EMI summary:**
```
GET /app/emi/summary
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "amountDue": 3500,
  "dueDate": "2024-01-05",
  "dpd": 4,
  "overdueInstallments": 1,
  "penaltyAmount": 0,
  "totalPayable": 3500
}
```

**Step 2 — Initiate payment:**
```
POST /app/payment/initiate
Authorization: Bearer <accessToken>

Body:
{
  "amount": 3500,
  "method": "upi",
  "upiId": "borrower@paytm"
}
```

**Response:**
```json
{
  "orderId": "ORD-20240109-001",
  "txnRef": "EMI-TXN-001",
  "upiDeepLink": "upi://pay?pa=emishield@axis&pn=EMI+Shield&am=3500&tr=EMI-TXN-001&tn=EMI+Payment"
}
```

**App action:**
- Open `upiDeepLink` using `Intent.ACTION_VIEW` to launch UPI app
- Store `txnRef` and `orderId` locally for callback handling

---

### UC-13 — Handle UPI App Return

**Trigger:** User returns from UPI app to EMI Shield app.

```
POST /app/payment/callback
Authorization: Bearer <accessToken>

Body:
{
  "txnRef": "EMI-TXN-001",
  "orderId": "ORD-20240109-001",
  "upiStatus": "SUCCESS",
  "gatewayTxnId": "UPI123456789"
}
```

**Response:**
```json
{
  "paymentStatus": "pending",
  "message": "Payment received. Verifying with gateway..."
}
```

**App action:**  
Do **not** unlock the device based on this response. The server awaits the payment gateway webhook for authoritative confirmation. Show a "Payment submitted, verifying..." screen.  
Poll `GET /app/device/state` every 10 seconds.

---

### UC-14 — Payment Confirmed (Server-Side, App Notified via FCM)

**Trigger:** The payment gateway sends a webhook to the server. The server validates the payment, evaluates the tenant policy, and sends an FCM data message to the device.

**App does NOT call any API here.** The FCM message arrives at the app's `FirebaseMessagingService`.

**FCM Data Message Payload (received by app):**
```json
{
  "type": "COMMAND",
  "commandId": "...",
  "commandType": "UNLOCK",
  "reason": "payment_verified"
}
```

**App action upon receiving FCM:**
1. Do NOT apply the command yet
2. Call `GET /app/device/state` to verify the command is legitimate (the server will reflect the new state)
3. If `state` is `UNLOCK_PENDING` → apply unlock via Device Admin API
4. Acknowledge the command (UC-26)

---

### UC-15 — View Payment History

**Trigger:** User navigates to Payment History screen.

```
GET /app/payment/history
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "payments": [
    {
      "paymentId": "...",
      "txnRef": "EMI-TXN-001",
      "amount": 3500,
      "status": "success",
      "method": "upi",
      "completedAt": "2024-01-09T11:30:00Z"
    }
  ]
}
```

**For a single payment's details:**
```
GET /app/payment/:paymentId
Authorization: Bearer <accessToken>
```

---

## 5. Unlock Request & Escalation

### UC-16 — Submit Manual Unlock Request

**Trigger:** User taps "Request Unlock" from the lock screen.  
**Use case:** User disputes the lock, or made a payment through a channel not reflected yet.

```
POST /app/unlock-request
Authorization: Bearer <accessToken>

Body:
{
  "reason": "I have paid EMI on 9th Jan via NEFT. Transaction ID: NEFT20240109001",
  "reasonCategory": "payment_made"
}
```

**`reasonCategory` options:**

| Value | When to use |
|---|---|
| `payment_made` | User claims to have already paid |
| `temporary_emergency` | Medical/emergency access needed |
| `gateway_issue` | Payment app had an error |
| `payment_mismatch` | Amount mismatch or delayed reflection |
| `other` | Everything else |

**Response:**
```json
{
  "caseId": "CASE-2024-00123",
  "status": "PENDING_TENANT",
  "slaDeadline": "2024-01-10T10:00:00Z",
  "message": "Your request has been submitted. Expected response by Jan 10, 10:00 AM"
}
```

**App action:** Store `caseId`. Show confirmation screen with SLA deadline.

---

### UC-17 — Upload Payment Proof

**Trigger:** After submitting an unlock request (UC-16), user wants to attach a screenshot or document.

```
POST /app/unlock-request/:requestId/proof
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

Body:
{
  "file": <image or PDF file>
}
```

**Response:**
```json
{
  "documentUrl": "https://storage.emishield.in/proofs/...",
  "uploaded": true
}
```

---

### UC-18 — Track Active Unlock Request Status

**Trigger:** User opens "My Request" screen, or app polls after submission.

```
GET /app/unlock-request/active
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "caseId": "CASE-2024-00123",
  "status": "ESCALATED",
  "slaDeadline": "2024-01-10T10:00:00Z",
  "slaBreached": false,
  "submittedAt": "2024-01-09T08:00:00Z",
  "resolutionNote": null
}
```

**Possible `status` values and what to show:**

| Status | User-facing message |
|---|---|
| `PENDING_TENANT` | "Your request is under review by your lender" |
| `UNDER_REVIEW` | "Your request is being reviewed" |
| `ESCALATED` | "Your request has been escalated to EMI Shield support" |
| `RESOLVED_TENANT` | "Your request was resolved by your lender" |
| `RESOLVED_SUPER_ADMIN` | "Your request was resolved by EMI Shield support" |
| `REJECTED` | "Your request was rejected. Reason: {resolutionNote}" |
| `CLOSED` | "This request has been closed" |

---

### UC-19 — Escalation Status Tracking

**Trigger:** User wants to know if their case was escalated (status is `ESCALATED`).  
This is already covered by `GET /app/unlock-request/active`.

Additionally, get the full history of all past requests:
```
GET /app/unlock-request/history
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "requests": [
    {
      "caseId": "CASE-2024-00120",
      "status": "CLOSED",
      "reason": "payment_made",
      "submittedAt": "2023-12-15T09:00:00Z",
      "resolvedAt": "2023-12-15T14:00:00Z"
    }
  ]
}
```

---

## 6. Notifications

### UC-20 — Receive Push Notification (FCM)

**Trigger:** Server sends an FCM push to the device.  
**No API call needed** — handled by `FirebaseMessagingService.onMessageReceived()`.

**FCM notification types the app will receive:**

| `type` in FCM payload | What happened | App action |
|---|---|---|
| `COMMAND` | Lock/unlock command issued | See UC-26 — verify + execute + ack |
| `EMI_REMINDER` | EMI due soon | Show local notification |
| `OVERDUE_WARNING` | EMI is overdue | Show warning notification |
| `GRACE_PERIOD_START` | Grace period started | Show notification + banner |
| `DEVICE_LOCKED` | Device has been locked | Apply lock if not already |
| `UNLOCK_SUCCESS` | Device unlocked | Remove lock screen |
| `UNLOCK_REQUEST_RECEIVED` | Server received your unlock request | Show notification |
| `ESCALATION_UPDATE` | Case status changed | Refresh UC-18 screen |
| `TEMP_UNLOCK_APPROVED` | Temp unlock granted | Apply temp unlock |
| `TEMP_UNLOCK_EXPIRING` | Temp unlock expires in 30 min | Show countdown notification |
| `CASE_RESOLVED` | Unlock request resolved | Refresh device state |
| `PAYMENT_CONFIRMED` | Payment verified | Show success notification |

---

### UC-21 — View In-App Notification List

```
GET /app/notifications
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "notifications": [
    {
      "id": "...",
      "type": "PAYMENT_CONFIRMED",
      "title": "Payment Confirmed",
      "body": "Your EMI payment of ₹3,500 has been confirmed.",
      "read": false,
      "createdAt": "2024-01-09T11:30:00Z",
      "data": { "paymentId": "..." }
    }
  ],
  "unreadCount": 3
}
```

---

### UC-22 — Mark Notification as Read

**Trigger:** User taps a notification in the list.

```
PATCH /app/notifications/:notificationId/read
Authorization: Bearer <accessToken>
```

**Response:** `{ "updated": true }`

---

### UC-23 — Notification Deep Linking

Use the `data` field in the notification response to deep-link to the relevant screen:

| `data` field | Navigate to |
|---|---|
| `{ "paymentId": "..." }` | Payment detail screen |
| `{ "caseId": "..." }` | Unlock request status screen (UC-18) |
| `{ "deviceState": "LOCKED" }` | Lock screen / pay now |
| `{ "tempUnlockExpiresAt": "..." }` | Temp unlock countdown screen |

---

## 7. Offline & Sync

### UC-24 — App Opens After Being Offline

**Trigger:** Device reconnects to internet. App's network listener fires.

```
POST /device/sync
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "pendingCommands": [
    {
      "commandId": "abc123",
      "commandType": "LOCK",
      "payload": { "reason": "EMI overdue 35 days" }
    }
  ],
  "deviceState": "LOCKED"
}
```

**App action:**
- For each command in `pendingCommands` → execute it locally (apply lock/unlock via Device Admin API)
- After executing each → acknowledge it (UC-26)
- Update local device state to match `deviceState`

---

### UC-25 — Boot Receiver (Device Restarted)

**Trigger:** `BootCompletedReceiver` fires after device restart.  
**App must register `BOOT_COMPLETED` broadcast receiver in manifest.**

On boot:
1. Read stored `accessToken` from EncryptedSharedPreferences
2. If token exists → call `POST /device/sync` (same as UC-24)
3. Apply any pending commands
4. If the last known state was `LOCKED` → **immediately apply lock** before calling the server (fail-safe)

> **Do not wait for the sync response to apply the lock on boot.** Apply it from local state first, then sync to get any updates.

---

### UC-26 — Acknowledge Executed Command

**Trigger:** After successfully applying a lock or unlock command from FCM or sync.

```
POST /device/command/:commandId/ack
Authorization: Bearer <accessToken>

Body:
{
  "executedAt": "2024-01-09T11:45:00Z",
  "result": "success"
}
```

**Response:** `{ "acknowledged": true }`

**App action:** Update local command queue — remove the acknowledged command.

---

### UC-27 — FCM Token Rotation

**Trigger:** `FirebaseMessagingService.onNewToken()` is called by Firebase.

```
POST /app/device/ping
Authorization: Bearer <accessToken>

Body:
{
  "fcmTokenChanged": true,
  "newFcmToken": "<new FCM token>"
}
```

**Response:**
```json
{
  "updated": true,
  "pendingCommands": []
}
```

> Always check `pendingCommands` in the ping response. The server piggybacks any queued commands onto this call.

---

## 8. Security Events

### UC-28 — Root Detected

**Trigger:** App detects root on startup (via RootBeer or similar library).

```
POST /app/security/event
Authorization: Bearer <accessToken>

Body:
{
  "eventType": "ROOT_DETECTED",
  "details": {
    "method": "supersu_binary"
  }
}
```

**Response:** `{ "received": true }`

Server creates a `riskFlag` and notifies the tenant dashboard. The device state may change — call `GET /app/device/state` after reporting.

---

### UC-29 — SIM Change Detected

**Trigger:** App compares current SIM serial against stored SIM serial on every launch.

```
POST /app/security/event
Authorization: Bearer <accessToken>

Body:
{
  "eventType": "SIM_CHANGE_DETECTED",
  "details": {
    "previousSimSerial": "8991101200003204510",
    "newSimSerial": "8991100200003891234",
    "newOperator": "Airtel"
  }
}
```

**Response:** `{ "received": true }`

Update the locally stored SIM serial after reporting.

---

### UC-30 — App Tamper Detected

**Trigger:** App's self-integrity check (Play Integrity API or signature verification) fails.

```
POST /app/security/event
Authorization: Bearer <accessToken>

Body:
{
  "eventType": "APP_TAMPER_DETECTED",
  "details": {
    "integrityVerdict": "FAILED",
    "method": "play_integrity_api"
  }
}
```

**Response:** `{ "received": true }`

---

## 9. Support & Info

### UC-31 — View Lender Support Contact

**Trigger:** User taps "Contact Support" from lock screen or help screen.

```
GET /app/support/contact
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "tenantName": "Easy Finance NBFC",
  "supportPhone": "1800-XXX-XXXX",
  "supportEmail": "support@easyfinance.in",
  "supportHours": "Mon–Sat, 9 AM – 6 PM"
}
```

> This shows the borrower's **lender's** contact, not EMI Shield's contact. Each tenant configures this in their dashboard.

---

### UC-32 — View Full EMI Schedule

**Trigger:** User navigates to "My EMI" or "Loan Details" screen.

```
GET /app/emi/schedule
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "loanId": "LOAN-2024-001",
  "totalAmount": 18000,
  "tenureMonths": 6,
  "installments": [
    {
      "installmentNumber": 1,
      "dueDate": "2024-02-01",
      "emiAmount": 3000,
      "penaltyAmount": 0,
      "status": "paid",
      "paidAt": "2024-01-31T10:00:00Z"
    },
    {
      "installmentNumber": 2,
      "dueDate": "2024-03-01",
      "emiAmount": 3000,
      "penaltyAmount": 0,
      "status": "overdue",
      "paidAt": null
    }
  ],
  "dpd": 8,
  "overdueAmount": 3000
}
```

**`status` values per installment:**

| Value | Meaning |
|---|---|
| `pending` | Not yet due |
| `paid` | Paid on time or within grace |
| `overdue` | Due date passed, unpaid |
| `partial` | Partially paid |

---

## Error Handling Reference

All API errors follow this shape:
```json
{
  "error": true,
  "code": "CONSENT_NOT_FOUND",
  "message": "No valid consent record found for this device",
  "statusCode": 403
}
```

**Common error codes the app must handle:**

| HTTP | Code | What to do |
|---|---|---|
| 401 | `TOKEN_EXPIRED` | Call `POST /auth/refresh-token`, retry |
| 401 | `TOKEN_INVALID` | Clear storage, redirect to login |
| 403 | `CONSENT_INVALID` | Redirect to consent flow (UC-3) |
| 403 | `DEVICE_LOCKED` | Show lock screen |
| 409 | `ACTIVE_REQUEST_EXISTS` | Show existing open case (UC-18) |
| 409 | `DUPLICATE_PAYMENT` | Inform user payment already recorded |
| 422 | `IMEI_ALREADY_REGISTERED` | Redirect to login (UC-2) |
| 503 | `GATEWAY_UNAVAILABLE` | Show retry screen |

---

## Full Onboarding Sequence (First-Time User)

```
App Install
    │
    ▼
UC-1: POST /app/check-device
    │ registered: false
    ▼
UC-2: POST /auth/send-otp  (purpose: "login")
    │
    ▼
UC-2: POST /auth/verify-otp → get accessToken
    │
    ▼
UC-3: GET /app/consent/terms  (display agreement)
    │ user checks checkbox
    ▼
UC-3: POST /app/consent/initiate  (Aadhaar OTP sent)
    │
    ▼
UC-3: POST /app/consent/confirm  (OTP + checkbox)
    │
    ▼
UC-4: POST /app/device/register  (IMEI + FCM token)
    │
    ▼
Start background FCM service + boot receiver
    │
    ▼
UC-7: GET /app/device/state → Navigate to Home
```

---

## App Launch Sequence (Returning User)

```
App Opens
    │
    ▼
Read accessToken from EncryptedSharedPreferences
    │ token found
    ▼
UC-5: GET /app/session/validate
    │ valid: true
    ▼
UC-6: Run device integrity checks locally
    │ issue found?  → POST /app/security/event
    ▼
UC-24: POST /device/sync  (pick up any pending commands)
    │
    ▼
UC-7–11: GET /app/device/state → Render correct screen
```
