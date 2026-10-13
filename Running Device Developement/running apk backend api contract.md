# Running borrower APK: backend API contract

**Implementation snapshot:** 2026-10-09. This contract describes the APIs currently implemented in `backend/src/modules/app`. It is for the separately installed `RUNNING_APP` borrower APK. The existing `/api/app` APIs remain usable; the running APK shares the borrower account, EMI, payment, and support APIs with the managed-device APK. Differences and required request/response fields are specified below. Examples use placeholder values and show the fields the running APK must handle; MongoDB documents may contain additional fields.

## 1. Base rules

- Base path: `/api/app`. Send JSON with `Content-Type: application/json` unless the endpoint explicitly accepts a file upload.
- On the dealer app's borrower list, an unlinked running borrower has **Generate QR**. The dealer app calls the existing borrower-scoped QR endpoint according to the borrower's saved `enrollmentMode` and displays its `qrCodeDataUrl`. The running APK scans this QR **inside the installed app**; it is an HTTPS `qrText` value with an opaque `code` query parameter. Extract that code and pass it as `enrollmentToken`. The internal `enrollmentId` is **not** a substitute for the secret. Never log, cache in analytics, or expose the code in screenshots.
- `Authorization: Bearer <accessToken>` is required where the tables say **Bearer**. The OTP verification or consent acceptance response supplies the token. `/refresh-token` uses the existing HTTP-only refresh cookie.
- Running and managed-device borrowers use the same JWT convention: send the Bearer token on authenticated `/api/app` calls. No installation-signature headers or separate installation challenge are used. Public endpoints remain public; refresh uses the existing cookie.
- Before the running device is linked, the borrower JWT may call consent acceptance and device registration. Device operations return `403` until activation completes. Once linked, the backend resolves the exact `User.linkedDeviceId` for running app calls. Play Integrity endpoints return `409` for this enrollment mode at both stages.
- Common success envelope: `{ "success": true, "message": "...", "data": { ... } }`. Common failure envelope: `{ "success": false, "error": "...", "data": { "code": "..." } }` when a structured code exists. Check HTTP status and `success`; not every older error has a `data.code`.
- Dates in request bodies are ISO 8601 strings unless a field explicitly says Unix milliseconds. IDs are MongoDB ObjectId strings. `{{ENROLLMENT_CODE}}` in examples means the opaque `code` extracted from the scanned running QR; it is unrelated to payment QR IDs.
- Running-device controls are app-enforced overlays and notifications. The APK must not claim Device Owner or kiosk enforcement. `TEMP_UNLOCK` is supported: the app clears its lock overlay until the server expiry and then restores it locally and through the expiry `LOCK` command. Managed per-app restrictions, wipe, and manual override remain unavailable for `RUNNING_APP`.

## 2. Authentication and activation retry

The existing OTP and consent flow issues a borrower JWT. Use it exactly as the managed-device borrower app does:

```http
Authorization: Bearer {{ACCESS_TOKEN}}
```

For activation, generate a random URL-safe `activationRequestId` of 16–128 characters and include it **in the registration JSON body**. Persist the same value locally until the request succeeds. If the registration response is lost, retry with the same JWT, scanned enrollment code, and `activationRequestId`; the backend returns the linked device. This value is an idempotency marker, **not** an authenticator. A different value after activation conflicts.

There is no cryptographic binding to the APK installation. A party with a valid borrower JWT can make authenticated requests until that token expires or is revoked. The running app must protect tokens using Android secure storage, use HTTPS, and report permission health honestly. A controlled replacement process is still needed to prevent accidental re-enrollment, but the backend does not prove that subsequent requests came from the original installation.

## 3. Enrollment sequence and endpoint index

The running app opens its QR scanner first. Scan the dealer's running QR, extract its `code`, call the preview endpoint, then show the manual IMEI screen and the permissions screen. Continue with OTP and consent, and recheck required grants just before registration because the submitted capability observation must be fresh. The owner provisioning QR is a different Android setup payload and must be rejected by this in-app scanner. This UI order changes no API endpoint or request field. Camera access is requested for the scanner, but the backend's final activation gates are notification and overlay access.

| Step | Endpoint | Status | Authentication |
| --- | --- | --- | --- |
| 1 | `POST /running-enrollment/preview` | New | Public |
| 2 | `POST /consent/terms` | Existing, mode-aware | Public |
| 3 | `POST /consent/initiate` | Existing, mode-aware | Public |
| 3a | `POST /consent/resend-otp` | Existing, reusable | Public |
| 4 | `POST /consent/verify-otp` | Existing, mode-aware | Public |
| 5 | `POST /consent/accept` | Existing, extended | Bearer |
| 6 | `POST /device/register` | Existing, running branch added | Bearer |
| After activation | `POST /device/capabilities` | New | Bearer |

The server creates a device **only at step 6**. The borrower enters IMEI 1 and IMEI 2 manually. Both must be 15 digits with valid check digits and distinct; set `singleImeiDevice: true` only for an actual single-IMEI phone. The server records these values as `BORROWER_ENTERED`, not hardware-verified identifiers.

### 3.1 `POST /api/app/running-enrollment/preview`

Request:

```json
{ "enrollmentToken": "{{ENROLLMENT_CODE}}" }
```

Response `200`:

```json
{
  "success": true,
  "message": "Running enrollment preview fetched",
  "data": {
    "enrollmentId": "{{ENROLLMENT_ID}}",
    "enrollmentMode": "RUNNING_APP",
    "lenderName": "Example Dealer",
    "borrowerName": "A****",
    "loanIdSuffix": "1234",
    "expiresAt": "2026-10-08T12:30:00.000Z",
    "requirementsVersion": 1,
    "requiredCapabilities": ["notificationsAllowed", "overlayAllowed"],
    "assurance": "APP_OVERLAY_LOWER_ASSURANCE"
  }
}
```

An invalid, expired, cancelled, consumed, disabled-tenant, or already-linked claim returns `400` with `data.code: "INVALID_ENROLLMENT_TOKEN"`. Preview neither consumes the claim nor authenticates the borrower. Show the masked identity and obtain OTP/consent before activation.

### 3.2 `POST /api/app/consent/terms`

**Use POST with the code extracted from the scanned running QR.** The existing `GET /consent/terms` has no claim parameter and returns the default managed-device terms.

Request:

```json
{ "enrollmentToken": "{{ENROLLMENT_CODE}}" }
```

Response `200` (relevant fields):

```json
{
  "success": true,
  "message": "Consent terms fetched successfully",
  "data": {
    "_id": "{{CONSENT_VERSION_ID}}",
    "version": "running-1.0",
    "enrollmentMode": "RUNNING_APP",
    "title": "Running Device Agreement",
    "borrowerAgreementText": "{{RENDERED_TEXT}}",
    "deviceControlConsentText": "{{RENDERED_TEXT}}",
    "privacyPolicyText": "{{RENDERED_TEXT}}",
    "tripartiteAckText": "{{RENDERED_TEXT}}",
    "renderedConsentHash": "{{SHA256_HEX}}"
  }
}
```

Display the returned rendered text. Keep `version` and `renderedConsentHash` for `/consent/accept`. The terms are selected by the scanned claim's enrollment mode; a running consent version must be published by the backend administrator.

### 3.3 `POST /api/app/consent/initiate`

Request:

```json
{ "mobile": "9876543210", "enrollmentToken": "{{ENROLLMENT_CODE}}" }
```

Response `200`:

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "verificationSessionId": "{{OTP_SESSION_ID}}",
    "otpSent": true,
    "flowType": "ONBOARDING_CONSENT",
    "nextStep": "VERIFY_OTP",
    "maskedMobile": "98****3210",
    "expiresInSeconds": 300,
    "retryAfterSeconds": 30
  }
}
```

`flowType` can instead be `ONBOARDING_RESUME` when consent was already recorded and the device is not linked. OTP delivery times are server supplied; the numbers above are illustrative. The tenant's Aadhaar verification setting affects which registered mobile is accepted.

### 3.4 `POST /api/app/consent/resend-otp`

Request:

```json
{ "mobile": "9876543210", "verificationSessionId": "{{OTP_SESSION_ID}}", "retryType": "{{OPTIONAL_RETRY_TYPE}}" }
```

Response `200`:

```json
{
  "success": true,
  "message": "OTP resent successfully",
  "data": {
    "verificationSessionId": "{{OTP_SESSION_ID}}",
    "otpSent": true,
    "maskedMobile": "98****3210",
    "expiresInSeconds": 300,
    "retryAfterSeconds": 30
  }
}
```

Omit `retryType` unless the existing OTP UI uses a supported value. The session must still be unverified and unexpired.

### 3.5 `POST /api/app/consent/verify-otp`

Request:

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "{{OTP_SESSION_ID}}",
  "otp": "123456",
  "enrollmentToken": "{{ENROLLMENT_CODE}}"
}
```

Response `200` for first consent:

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "accessToken": "{{JWT}}",
    "tokenType": "user",
    "flowType": "ONBOARDING_CONSENT",
    "nextStep": "SHOW_CONSENT",
    "user": {
      "id": "{{USER_ID}}",
      "name": "A Borrower",
      "mobile": "9876543210",
      "tenantId": "{{TENANT_ID}}",
      "consentRecordId": null,
      "isDeviceLinked": false,
      "linkedDeviceId": null
    }
  }
}
```

For a verified resume OTP, `flowType` is `ONBOARDING_RESUME` and `nextStep` is `REGISTER_DEVICE`. The exact scanned code must match the OTP session's unconsumed claim. An OTP cannot be reused after QR rotation.

### 3.6 `POST /api/app/consent/accept`

Headers: `Authorization: Bearer {{JWT}}`. Request:

```json
{
  "enrollmentToken": "{{ENROLLMENT_CODE}}",
  "consentCheckboxAccepted": true,
  "consentVersion": "running-1.0",
  "renderedConsentHash": "{{SHA256_HEX_FROM_TERMS}}",
  "locationConsentAccepted": false
}
```

Response `201` on first acceptance:

```json
{
  "success": true,
  "message": "Consent accepted successfully",
  "data": {
    "consentRecordId": "{{CONSENT_RECORD_ID}}",
    "consentAccepted": true,
    "renderedConsentHash": "{{SHA256_HEX}}",
    "accessToken": "{{JWT}}",
    "tokenType": "user",
    "nextStep": "REGISTER_DEVICE",
    "user": { "id": "{{USER_ID}}", "name": "A Borrower", "tenantId": "{{TENANT_ID}}", "consentRecordId": "{{CONSENT_RECORD_ID}}" }
  }
}
```

`locationConsentAccepted` is an explicit, optional location choice; default is `false`. A repeat acceptance for an already accepted claim returns `200` with `consentAccepted`, `accessToken`, `nextStep`, and `user`. Preserve the refreshed token/cookie. A rotated running enrollment link requires a new OTP and consent tied to the new claim. `renderedConsentHash` is accepted as a change-detection check; send it even though the handler currently treats an omitted hash as acceptable.

### 3.7 `POST /api/app/device/register`

Headers: `Authorization: Bearer {{JWT}}`. Request:

```json
{
  "enrollmentToken": "{{ENROLLMENT_CODE}}",
  "activationRequestId": "{{STABLE_RANDOM_URL_SAFE_ID_16_TO_128_CHARS}}",
  "requirementsVersion": 1,
  "imei": "490154203237518",
  "imei2": "{{SECOND_VALID_DISTINCT_15_DIGIT_IMEI}}",
  "singleImeiDevice": false,
  "capabilities": {
    "notificationsAllowed": true,
    "overlayAllowed": true,
    "deviceAdminActive": true,
    "locationGrant": "none",
    "observedAt": "2026-10-08T12:00:00.000Z"
  },
  "fcmToken": "{{FCM_REGISTRATION_TOKEN}}",
  "deviceModel": "Example model",
  "manufacturer": "Example manufacturer",
  "androidVersion": "14",
  "appVersion": "1.0.0"
}
```

Response `201` (relevant fields):

```json
{
  "success": true,
  "message": "Running device registered successfully",
  "data": {
    "deviceId": "{{DEVICE_ID}}",
    "userId": "{{USER_ID}}",
    "tenantId": "{{TENANT_ID}}",
    "enrollmentMode": "RUNNING_APP",
    "state": "ACTIVE",
    "currentPolicyKey": "EMI_PAID",
    "appConfig": {
      "deviceControlMode": "EMI_AUTOMATED",
      "showEmiDetails": true,
      "paymentSubmissionEnabled": true,
      "showPaymentHistory": true,
      "emiNotificationsEnabled": true,
      "unlockRequestEnabled": true
    },
    "policy": { "policyKey": "EMI_PAID", "version": 1, "restrictions": {} }
  }
}
```

Activation requires fresh `capabilities.observedAt` (within five minutes), notifications and overlay set to `true`, a valid FCM token, matching running consent, and an unused claim. The stored device starts `ACTIVE`; `deviceOwnerStatus` remains `UNKNOWN`. For a real single-IMEI phone send `singleImeiDevice: true` and omit `imei2`. Ask the borrower to activate Device Admin so ordinary uninstall requires a prior deactivation step; if declined, enrollment still proceeds. Report its actual `deviceAdminActive` state as an optional observed capability. It does not substitute for the two required grants, does not provide Device Owner powers, and is not used for `lockNow()`. A successful idempotent retry using the same `activationRequestId` returns `200` and `{ deviceId, userId, tenantId, state, enrollmentMode }`; do not expect the full first-registration policy in that response.

### 3.8 `POST /api/app/device/capabilities`

Headers: Bearer JWT. Call at app startup, after a grant/FCM change, and at least once every 24 hours. Request:

```json
{
  "capabilities": {
    "notificationsAllowed": true,
    "overlayAllowed": true,
    "deviceAdminActive": true,
    "locationGrant": "precise",
    "observedAt": "2026-10-08T12:15:00.000Z"
  },
  "fcmToken": "{{OPTIONAL_NEW_FCM_TOKEN}}",
  "appVersion": "1.0.1"
}
```

Response `200`:

```json
{
  "success": true,
  "message": "Running capabilities updated",
  "data": {
    "deviceId": "{{DEVICE_ID}}",
    "capabilitiesObservedAt": "2026-10-08T12:15:00.000Z",
    "capabilitiesReceivedAt": "2026-10-08T12:15:02.000Z"
  }
}
```

`notificationsAllowed` and `overlayAllowed` must be booleans here, so report `false` when revoked. `observedAt` must be within five minutes of server time. Optional `locationGrant` values recognized for a location request are `approximate`, `precise`, `coarse`, `fine`, `foreground`, or `background`; use `none` when unavailable. The backend checks that the last capability report was received within 24 hours before allowing lock, reminder, or location controls. Reporting loss updates operational eligibility but does not erase historical consent.

## 4. Shared OTP login and token refresh after activation

The same existing OTP APIs can log a linked borrower back in. Call `/consent/initiate` with `{ "mobile": "9876543210" }` **without** an enrollment token. Its response has `flowType: "DEVICE_LOGIN"` and `nextStep: "VERIFY_OTP"`. Then call `/consent/verify-otp` with `mobile`, `verificationSessionId`, and `otp` (no claim).

Linked running-device login response `200`:

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "accessToken": "{{JWT}}",
    "tokenType": "user",
    "flowType": "DEVICE_LOGIN",
    "nextStep": "SYNC_DEVICE",
    "user": { "id": "{{USER_ID}}", "isDeviceLinked": true, "linkedDeviceId": "{{DEVICE_ID}}" },
    "device": { "deviceId": "{{DEVICE_ID}}", "state": "ACTIVE", "currentPolicyKey": "EMI_PAID", "desiredPolicyVersion": 1, "lastAppliedPolicyVersion": 0, "tempUnlockExpiresAt": null }
  }
}
```

The actual `user` object also includes name, mobile, tenant, and consent ID. Linked running borrowers follow the existing device-login response and may receive current device sync data. The app should still call `/device/sync` after login to reconcile commands and policy. OTP login authenticates the account; the backend does not prove which APK installation uses the resulting JWT.

`POST /api/app/refresh-token` remains usable. Its request body is `{}`; it requires the existing refresh cookie and returns `200` with `data: { "accessToken": "{{JWT}}", "tokenType": "user", "expiresIn": "{{SERVER_CONFIG_VALUE}}" }`. Use the returned JWT on protected calls.

## 5. Authenticated operational APIs

All endpoints in this section use the borrower Bearer JWT after activation. An FCM push is a wake-up hint; call `/device/sync` to read the authoritative command and acknowledge the real device outcome.

### 5.1 `POST /api/app/device/sync`

Request:

```json
{ "lastAppliedPolicyVersion": 3, "isRooted": false, "isTampered": false }
```

Response `200` (representative subset):

```json
{
  "success": true,
  "message": "Device sync completed",
  "data": {
    "serverTime": "2026-10-08T12:20:00.000Z",
    "scheduledLockAt": "2026-11-14T00:00:00.000Z",
    "telemetryWarnings": [],
    "deviceState": "GRACE_PERIOD",
    "tempUnlockExpiresAt": null,
    "appConfig": { "deviceControlMode": "EMI_AUTOMATED", "paymentSubmissionEnabled": true },
    "currentPolicyKey": "EMI_GRACE",
    "desiredPolicyVersion": 3,
    "restrictionState": {},
    "securityControlState": {},
    "policy": { "policyKey": "EMI_GRACE", "version": 2, "restrictions": {} },
    "pendingCommands": [
      {
        "_id": "{{COMMAND_ID}}",
        "commandId": "{{COMMAND_ID}}",
        "commandType": "EMI_REMINDER",
        "status": "pending",
        "payload": {
          "reminderType": "UPCOMING",
          "message": "Your EMI payment is due soon.",
          "amount": 3500,
          "dueDate": "2026-10-10T00:00:00.000Z",
          "installmentNumber": 2,
          "totalInstallments": 12
        }
      }
    ]
  }
}
```

`scheduledLockAt` can be `null`, especially for MANUAL tenants. Running policy restrictions are `{}`. The response also contains legacy restriction/security state objects; do not interpret those as authority to apply Device Owner controls. Pending commands can include additional database fields. If request body includes routine `location`, the backend ignores that location and returns `LOCATION_COMMAND_REQUIRED` in `telemetryWarnings`; location must be sent only in a `GET_LOCATION` acknowledgement. A running sync carrying `manualOverride.active` or `manualOverride.tokenId` is rejected with `409 UNSUPPORTED_FOR_ENROLLMENT_MODE`.

### 5.2 `POST /api/app/device/ping`

Request:

```json
{ "batteryLevel": 79, "networkType": "wifi", "appVersion": "1.0.1", "fcmToken": "{{FCM_TOKEN}}" }
```

Response `200` has the same `deviceState`, `appConfig`, `currentPolicyKey`, `desiredPolicyVersion`, `policy`, and `pendingCommands` fields as sync, plus `deviceId`, `serverTime`, `lastAppliedPolicyVersion`, and `telemetryWarnings`. A representative envelope is:

```json
{
  "success": true,
  "message": "Device ping received",
  "data": {
    "deviceId": "{{DEVICE_ID}}",
    "serverTime": "2026-10-08T12:20:00.000Z",
    "lastAppliedPolicyVersion": 3,
    "telemetryWarnings": [],
    "deviceState": "ACTIVE",
    "pendingCommands": []
  }
}
```

Ping updates reachability, battery/network/app version, and optionally FCM token. It does **not** refresh the capability observation; call `/device/capabilities` separately.

### 5.3 `GET /api/app/device/policy`

Request body: none. Response `200`:

```json
{
  "success": true,
  "message": "Device policy fetched successfully",
  "data": {
    "deviceState": "LOCKED",
    "appConfig": { "deviceControlMode": "EMI_AUTOMATED", "paymentSubmissionEnabled": true },
    "policyKey": "EMI_LOCKED",
    "policyVersion": 4,
    "restrictions": {},
    "tempUnlockExpiresAt": null
  }
}
```

For running devices, `restrictions` is always `{}`. `tempUnlockExpiresAt` is `null` outside temporary unlock and is the saved ISO deadline while `deviceState` is `TEMP_UNLOCK`. The authoritative overlay command comes from sync/FCM, and the current desired state is also reflected here.

During a running temporary unlock, the same response has `deviceState: "TEMP_UNLOCK"`, `policyKey: "TEMP_UNLOCKED"`, and `tempUnlockExpiresAt: "2026-10-09T10:00:00.000Z"`. Sync and ping also include that deadline. The APK should persist it for offline relock and clear it only when a newer full unlock or release is confirmed.

### 5.4 `POST /api/app/device/command/ack`

All command acknowledgements use the same endpoint and `commandId` from sync/FCM. Set `status` to `acknowledged` only after the action actually happened; otherwise use `failed` and include `failureReason`.

Requests for the agreed running commands:

```json
{ "commandId": "{{LOCK_COMMAND_ID}}", "status": "acknowledged", "appliedPolicyVersion": 4, "appRestrictionApplied": true, "lockOverlayShown": true }
```

```json
{ "commandId": "{{UNLOCK_COMMAND_ID}}", "status": "acknowledged", "appliedPolicyVersion": 5, "appRestrictionCleared": true, "lockOverlayCleared": true }
```

```json
{ "commandId": "{{TEMP_UNLOCK_COMMAND_ID}}", "status": "acknowledged", "appliedPolicyVersion": 6, "appRestrictionCleared": true, "lockOverlayCleared": true }
```

```json
{ "commandId": "{{UPCOMING_REMINDER_ID}}", "status": "acknowledged", "presentationResult": "OVERLAY_SHOWN", "soundPlayed": true }
```

```json
{ "commandId": "{{OVERDUE_REMINDER_ID}}", "status": "acknowledged", "presentationResult": "NOTIFICATION_POSTED" }
```

```json
{
  "commandId": "{{LOCATION_COMMAND_ID}}",
  "status": "acknowledged",
  "location": { "latitude": 28.6139, "longitude": 77.209, "accuracyMeters": 25, "capturedAt": "2026-10-08T12:20:00.000Z" }
}
```

```json
{ "commandId": "{{RELEASE_COMMAND_ID}}", "status": "acknowledged", "releaseCompleted": true }
```

For `TEMP_UNLOCK`, clear both the EMI restriction and lock overlay before a successful ACK. Read `tempUnlockExpiresAt` from the command/sync/policy; never clear an overlay for a stale or already-expired command. Persist the deadline locally and re-show the overlay when it expires even without FCM, then sync to receive the expiry `LOCK` command. A full payment unlock or release supersedes the deadline. For an upcoming or pending reminder, show an overlay and play sound when Android permits it; report the actual result. Valid `presentationResult` values are `OVERLAY_SHOWN`, `NOTIFICATION_POSTED`, and `DEFERRED`. If `OVERLAY_SHOWN`, `soundPlayed` must be a boolean. For `OVERDUE`, the backend rejects `OVERLAY_SHOWN`; use a notification only. A `GET_LOCATION` result must include latitude/longitude, nonnegative `accuracyMeters`, and `capturedAt`; stale or future locations are rejected. A successful release clears the overlay locally before ACK, moves backend state to `RELEASED`, and clears the device's FCM token. The app should clear its stored JWT/refresh state and stop management calls.

Representative response `200`:

```json
{
  "success": true,
  "message": "Device command acknowledgement saved",
  "data": {
    "commandId": "{{COMMAND_ID}}",
    "status": "acknowledged",
    "deviceState": "LOCKED",
    "restrictionState": {},
    "securityControlState": {},
    "lastLocation": null
  }
}
```

The state depends on the command (`ACTIVE`, `LOCKED`, `RELEASED`, etc.). A repeat ACK with the same terminal status returns `200`; a conflicting status returns `409`. For an `EMI_GRACE` `POLICY_UPDATE` command, acknowledge with `commandId`, `status: "acknowledged"`, and the applied policy version; do not apply managed restrictions. Owner-only commands are blocked at creation and filtered from running sync/FCM. A successful ACK for one of them remains prohibited.

If the running APK has already encountered an existing stale or misrouted owner-only command, it may report that specific command as failed:

```json
{ "commandId": "{{EXISTING_UNSUPPORTED_COMMAND_ID}}", "status": "failed", "failureReason": "UNSUPPORTED_FOR_ENROLLMENT_MODE" }
```

The backend requires a valid command ID belonging to the authenticated running device, a command type or payload that is unsupported for `RUNNING_APP`, and the exact `failed` status and failure reason above. It returns HTTP `200` with the ordinary ACK envelope and `data.status: "failed"`; the command becomes terminal with `failureSource: "device_enforcement"` and an audit record, while the device state stays unchanged. Repeating the same failed ACK returns `200` without a second audit entry. A success ACK or another failure reason still returns `409 UNSUPPORTED_FOR_ENROLLMENT_MODE`. A missing command returns `404 COMMAND_NOT_FOUND`. The APK must not fabricate command IDs or treat receipt of FCM as successful enforcement.

Representative failed-ACK response (`200`; `deviceState` remains whatever the server requested before this report):

```json
{
  "success": true,
  "message": "Device command acknowledgement saved",
  "data": {
    "commandId": "{{EXISTING_UNSUPPORTED_COMMAND_ID}}",
    "status": "failed",
    "deviceState": "ACTIVE",
    "restrictionState": {},
    "securityControlState": {},
    "lastLocation": null
  }
}
```

## 6. Existing account, payment, and support APIs

These APIs remain usable by the running APK; they are not duplicated under a new route tree. Use the existing borrower JWT on authenticated endpoints unless listed as public. MANUAL tenant mode keeps EMI details and history visible but disables borrower payment submission through `appConfig.paymentSubmissionEnabled: false`; dealer/admin payment management remains separate.

| Endpoint | Request body / parameters | Response `data` / running note |
| --- | --- | --- |
| `GET /dashboard` | No body. | `userDetails`, `appConfig`, `device`; when enabled, `loanDetails`, `recentActivity`, `currentEmiDue`. |
| `GET /utility/tenant` | No body. | `tenantId`, `tenantName`, `appConfig`. |
| `GET /installments` | No body. | `loanDetails`, `installments[]` with installment ID, due date, amount, paid amount, status. |
| `GET /installments/:installmentId` | Path ID; no body. | `installment`, `loanDetails`, optional `payment`. |
| `GET /payment/qr` | No body. | `qrCodeId`, `label`, `imageUrl`; returns 403 when borrower payment submission is disabled. |
| `POST /payment/submit` | JSON `{ "qrCodeId": "{{ID}}", "amount": 3500, "reference": "UPI123", "note": "Optional" }`; multipart also accepts `qrCodeId`, `amount`, `reference`, `note`, `proofImage`. | `paymentId`, `status`, `approvalStatus`, `proof`; typically `201` pending dealer approval. 403 for MANUAL tenant borrower submission. |
| `GET /payment/history` | No body. | Existing `Payment[]`, newest first. |
| `GET /payment/:paymentId` | Path ID; no body. | Existing `Payment` document. |
| `POST /unlock-request` | Existing request body/upload contract. | Existing borrower request/case. The borrower does not self-approve a temporary unlock; dealer/admin/partner resolution may choose temporary or full unlock. |
| `GET /unlock-requests` | No body. | Existing request list. |
| `GET /unlock-request/active` | No body. | Existing active request. |
| `GET` or `POST /update/check` | Query/body: `platform`, `packageName`, `channel`, `currentVersionCode`. Public. | Existing update decision. Publish a build for the running APK package or the endpoint returns 503. |
| `GET /support-contact` | No body. Public. | `supportEmail`, `supportPhone`, `supportWhatsapp`, `updatedAt`. |

### Automatic-dealer lock overlay: Pay Now and Temp Unlock

For an `EMI_AUTOMATED` running borrower, show **Pay Now** and **Temp Unlock** on the lock overlay and use the same screens as the managed borrower app. Keep access to those screens while the overlay restricts the rest of the app. The overlay is an ordinary-app window, not Android kiosk/lock task. Read `appConfig.paymentSubmissionEnabled` and `appConfig.unlockRequestEnabled` rather than assuming the tenant mode from the APK package. `MANUAL` borrowers keep the existing payment-submission denial; do not make a disabled Pay Now action appear functional.

**Pay Now** opens the payment QR and proof flow. These are existing endpoints and response envelopes:

```http
GET /api/app/payment/qr
Authorization: Bearer {{JWT}}
```

```json
{ "success": true, "message": "Payment QR fetched successfully", "data": { "qrCodeId": "{{QR_CODE_ID}}", "label": "Dealer UPI", "imageUrl": "https://example.invalid/payment-qr.png" } }
```

```http
POST /api/app/payment/submit
Authorization: Bearer {{JWT}}
Content-Type: application/json
```

```json
{ "qrCodeId": "{{QR_CODE_ID}}", "amount": 3500, "reference": "UPI123", "note": "Optional" }
```

```json
{ "success": true, "message": "Payment submitted for tenant approval", "data": { "paymentId": "{{PAYMENT_ID}}", "status": "approval_pending", "approvalStatus": "pending_approval" } }
```

The existing multipart request may include `proofImage`. Submission alone does not unlock. The dealer approval path updates the EMI schedule and queues the existing `UNLOCK` for a non-final payment or `RELEASE_DEVICE` when settled. The running APK clears the overlay only after processing the authorized command; a temporary-unlock timer is superseded by that later state.

**Temp Unlock** opens the existing borrower unlock-request form. It creates a case for an operator decision; it does not grant access immediately:

```http
POST /api/app/unlock-request
Authorization: Bearer {{JWT}}
Content-Type: application/json
```

```json
{ "reason": "Emergency access needed", "reasonCategory": "temporary_emergency", "details": "Explain the need" }
```

```json
{ "success": true, "message": "Unlock request created successfully", "data": { "caseId": "{{CASE_ID}}", "status": "PENDING_TENANT", "slaDeadline": "2026-10-10T10:00:00.000Z", "imageUrl": null } }
```

Poll `GET /api/app/unlock-request/active` or use the existing unlock-request list to display the case status. The dealer may resolve it through `POST /api/distributor/unlock-requests/:caseId/temp-unlock` with `{ "durationHours": 2, "note": "Emergency approved" }`; escalated cases use the existing partner/admin temporary-unlock endpoint. A direct operator action can use `POST /api/distributor/devices/:id/temp-unlock` with `{ "durationHours": 2, "reason": "Emergency approved" }`. On approval the device enters `TEMP_UNLOCK`, receives a `TEMP_UNLOCK` command with a server expiry, and the APK clears the overlay after a truthful ACK. The shared expiry job queues `LOCK` for both enrollment modes. Existing endpoint paths, request validation, and response envelopes remain in force.

Representative dealer case-resolution response (`200`; documents also include other persisted fields):

```json
{
  "success": true,
  "message": "Temporary unlock request approved successfully",
  "data": {
    "unlockRequest": { "caseId": "{{CASE_ID}}", "status": "RESOLVED_TENANT", "resolutionAction": "temp_unlocked", "tempUnlockDurationHours": 2 },
    "command": { "_id": "{{TEMP_UNLOCK_COMMAND_ID}}", "commandType": "TEMP_UNLOCK", "status": "pending", "payload": { "durationHours": 2, "tempUnlockExpiresAt": "2026-10-09T10:00:00.000Z" } }
  }
}
```

The direct dealer device endpoint responds `200` with `message: "Temporary unlock queued successfully"` and `data.device` (`state: "TEMP_UNLOCK"`, `tempUnlockExpiresAt`) plus `data.command` (`commandType: "TEMP_UNLOCK"`, expiry payload). The admin direct route is `POST /api/admin/devices/:deviceId/temp-unlock` with `{ "durationHours": 2, "reason": "Emergency approved" }`; admin escalation is `POST /api/admin/escalations/:caseId/temp-unlock` with the same fields. The partner escalated-case route is `POST /api/partner/escalations/:caseId/temp-unlock` with `{ "durationHours": 2, "note": "Emergency approved" }`. These are operator APIs; the borrower APK should observe their result through authenticated sync and must never call them with a borrower JWT.

Representative shared dashboard request/response:

```http
GET /api/app/dashboard
Authorization: Bearer {{JWT}}
```

```json
{
  "success": true,
  "message": "Dashboard fetched successfully",
  "data": {
    "userDetails": { "id": "{{USER_ID}}", "isDeviceLinked": true, "linkedDeviceId": "{{DEVICE_ID}}" },
    "appConfig": { "deviceControlMode": "MANUAL", "showEmiDetails": true, "paymentSubmissionEnabled": false, "showPaymentHistory": true, "emiNotificationsEnabled": true, "unlockRequestEnabled": true },
    "device": { "deviceId": "{{DEVICE_ID}}", "state": "ACTIVE", "currentPolicyKey": "EMI_PAID", "desiredPolicyVersion": 1, "lastSeenAt": "2026-10-08T12:20:00.000Z" },
    "loanDetails": { "loanId": "{{LOAN_ID}}", "emiAmount": 3500, "overdueAmount": 0, "overdueInstallments": 0, "dpd": 0 },
    "recentActivity": { "paidInstallments": [] }
  }
}
```

### Play Integrity is owner-only

The running APK must **not** call `POST /integrity/challenge`, `POST /integrity/verify`, `POST /integrity/risk/challenge`, or `POST /integrity/risk/verify` during onboarding or regular operation. Each route accepts the existing borrower Bearer JWT but returns HTTP `409` for `RUNNING_APP`, before or after device activation, regardless of the request body. No Play Integrity challenge, verification record, or associated risk lock is created. The QR-provisioned APK continues using these routes as before.

Example response if an old running build calls any of the four endpoints:

```json
{
  "success": false,
  "error": "Play Integrity is not supported for running-device enrollment",
  "data": { "code": "UNSUPPORTED_FOR_ENROLLMENT_MODE" }
}
```

The running APK's eventual Android package ID is not required for borrower registration, QR generation, or device activation. The running app does not call Play Integrity and no Integrity result is required by `POST /device/register`. Keep the separate `POST /security/event` route for actual local security observations and `POST /device/capabilities` for Android grant changes:

| Endpoint | Request body | Success response `data` |
| --- | --- | --- |
| `POST /security/event` | `{ "type": "TAMPER_DETECTED", "severity": "high", "message": "Example observation", "metadata": {} }` | `201` with `{ "riskFlagId": "{{ID}}", "status": "{{STATUS}}", "autoLock": { ... } }`. A critical event may queue a separate risk lock. |

Example security-event request/response:

```json
{ "type": "TAMPER_DETECTED", "severity": "high", "message": "Example observation", "metadata": {} }
```

```json
{
  "success": true,
  "message": "Security event recorded",
  "data": {
    "riskFlagId": "{{RISK_FLAG_ID}}",
    "status": "{{RISK_FLAG_STATUS}}",
    "autoLock": { "queued": false, "reason": "RISK_RULE_NOT_MATCHED" }
  }
}
```

## 7. FCM and command handling contract

FCM messages are not HTTP API responses and may arrive late, out of order, or not at all. On receipt, sync and process `pendingCommands`. The running messages use high Android priority:

```json
{ "data": { "type": "EMI_REMINDER", "commandId": "{{ID}}", "commandType": "EMI_REMINDER", "reminderType": "UPCOMING", "message": "Your EMI payment is due soon.", "amount": "3500", "dueDate": "2026-10-10T00:00:00.000Z", "installmentNumber": "2", "totalInstallments": "12" } }
```

```json
{ "data": { "type": "LOCK", "commandId": "{{ID}}", "commandType": "LOCK", "reason": "EMI grace period expired" } }
```

```json
{ "data": { "type": "TEMP_UNLOCK", "commandId": "{{ID}}", "commandType": "TEMP_UNLOCK", "durationHours": "2", "tempUnlockExpiresAt": "2026-10-09T10:00:00.000Z" } }
```

`UNLOCK`, `TEMP_UNLOCK`, `GET_LOCATION`, and `RELEASE_DEVICE` use their command name as `type`. FCM `data` values are strings; sync command payload values retain their JSON types. The FCM timestamp is a wake-up hint; authenticated sync/policy is authoritative. `UPCOMING` and `PENDING` reminders use overlay + sound when presented; `OVERDUE` is notification-only. Do not create a kiosk screen for a running device. A release must clear the overlay before the final ACK.

## 8. Errors and implementation decisions

| Condition | Typical response | APK behavior |
| --- | --- | --- |
| QR invalid/expired/rotated/claimed | `400`, `INVALID_ENROLLMENT_TOKEN` | Stop that enrollment and request a fresh QR. |
| Running tenant disabled | `409`, `RUNNING_ENROLLMENT_DISABLED` | Stop activation; dealer/admin must enable the tenant. |
| Consent missing or mismatched | `403 CONSENT_REQUIRED` or `400` | Repeat the OTP/consent steps for the current enrollment link. |
| Requirements changed | `409 REQUIREMENTS_CHANGED` | Reload preview/permissions and repeat final check. |
| Required grant unavailable | `409 CAPABILITY_UNAVAILABLE` | Show the specific grant and offer a Settings retry. |
| Existing active IMEI | `409 IMEI_REVIEW_REQUIRED` | Stop; send borrower to dealer review. |
| Borrower already linked | `409 DEVICE_ALREADY_LINKED` | Do not silently bind another phone. |
| Running device not enrolled | `403` on device operations | Finish activation with the current enrollment link, OTP/consent, IMEIs, and required grants. |
| Missing/invalid/expired JWT | `401` or `403` | Log in again through the existing borrower OTP flow or refresh the token when eligible. |
| Different activation request ID after linkage | `409 DEVICE_ALREADY_LINKED` | Reuse the original `activationRequestId` only for a genuine lost-response retry; otherwise use the reviewed replacement flow. |
| Owner-only feature attempted | `409 UNSUPPORTED_FOR_ENROLLMENT_MODE` | Hide/disable that action. |
| Running temporary unlock command arrives after its deadline or after another state superseded it | `409 COMMAND_EXPIRED` on ACK | Keep or restore the overlay as indicated by the latest sync state; do not clear it for the stale command. |
| Release completed | `200` ACK, backend `RELEASED` | Clear local enforcement and stored borrower tokens; cease management calls. |

The running app should present actual Android permission results, keep a durable local queue for command ACK retries, and reconcile on every startup/FCM message. An active Device Admin generally blocks a normal direct uninstall until the borrower deactivates it; the borrower can still do so. On authorized release, the APK should remove its own active admin and confirm removal before reporting local release complete. The backend records desired state and command outcomes; it cannot guarantee an ordinary installed APK remains installed or keeps its overlay access.

## 9. Source of truth and validation

- Routes: `backend/src/modules/app/app.routes.js`.
- Running activation: `backend/src/modules/app/runningEnrollment.controller.js` and `backend/src/services/runningEnrollment.service.js`.
- Shared OTP, consent, sync, payment, and ACK: `backend/src/modules/app/app.controller.js`.
- Linked running-device resolution: `backend/src/middleware/resolveRunningDevice.js` (after the existing JWT middleware).
- Commands/FCM: `backend/src/services/runningDevicePolicy.service.js`, `backend/src/services/emiReminder.service.js`, and `backend/src/jobs/fcmDeliveryWorker.js`.

Local backend lint and 101 tests passed for this implementation snapshot. The examples have not been validated against a production database or physical running APK. The dealer/admin APIs and rollout procedure are documented separately in `backend API implementation.md` and `master plan.md`.
