# EMI Shield plan: one dealer workflow for new and running devices

**Prepared:** 5 October 2026  
**Status:** Implementation plan; no backend or app changes have been made  
**Audience:** Backend, dealer app, running-device app, super-admin portal, QA, product  
**Companion:** [Running-device APK analysis](running_device_apk_analysis_and_architecture.md)

## 1. Product decision and scope

The dealer/tenant app should register a borrower once, then let the dealer choose **New device (Device Owner QR)** or **Running device (app enrollment QR)**. Both choices create the same borrower, EMI schedule, consent record, device record, command history, and audit history. The QR payload and what can actually be enforced differ.

Both the dealer app and super-admin panel should present five actions for an eligible running-device enrollment: **Lock, Unlock, Send reminder, Get location, Release**. They should use the same API/domain rules as the existing managed-device controls, with an enrollment-mode and capability check on every operation. A running app must be labeled **lower assurance** throughout. Its “Lock” is a request for the app to enter EMI-restricted state plus, if the borrower has enabled Device Admin, a one-time Android `lockNow()` call. This cannot prevent the borrower from unlocking Android with their credential, revoking Device Admin, force-stopping, or uninstalling the app. “Unlock” removes EMI Shield's own restriction; it does not unlock Android's keyguard. [Android `lockNow()` reference](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()).

**Working assumptions for this plan:** the existing credit charge remains **one credit when a borrower is registered**, whichever QR is chosen. The running app asks the borrower to manually enter IMEI 1 and IMEI 2 after consent, and uses the existing IMEI registration fields. Enrollment mode does not change `EMI_AUTOMATED` versus `MANUAL`; those are the tenant's payment-control modes. Keep the existing `Device.state` and `DeviceCommand.status` values; add no new lifecycle-state enum for this rollout. If product pricing changes, make that an explicit separate ledger/pricing change.

### Tenant control mode applies to both enrollment paths

Treat `enrollmentMode` (`DEVICE_OWNER_QR` or `RUNNING_APP`) and `TenantPolicy.deviceControlRules.mode` (`EMI_AUTOMATED` or `MANUAL`) as independent fields. Resolve the tenant's control mode once in the shared EMI scheduler and command policy; the running app consumes the same server-provided `deviceControlMode` and EMI configuration as the owner app. Do not create a second schedule or a running-device-specific definition of manual mode. Delivery and enforcement then depend on the enrolled app's capabilities.

| Tenant policy | Scheduled EMI reminders | Scheduled EMI grace/lock | Operator actions on either enrollment mode |
|---|---|---|---|
| `EMI_AUTOMATED`, `lockOnGraceExpiry=true` | Upcoming and overdue reminders on the existing schedule | Existing grace transition and final `LOCK` after the configured DPD/grace period | Authorized manual lock, unlock, reminder, location, and settlement-gated release remain available |
| `EMI_AUTOMATED`, `lockOnGraceExpiry=false` | Same scheduled reminders | Grace processing can continue; final scheduled EMI `LOCK` is disabled | Same authorized manual actions |
| `MANUAL` | No **scheduled** EMI reminders under the contract in `Tenant Mode.md`; a dealer/admin may still explicitly send one | No scheduled EMI grace transition or final EMI `LOCK` | Authorized manual lock, unlock, reminder, location, and settlement-gated release |

All scheduled and manual `LOCK` requests for a running app use the same `LOCK` command and existing device state, with a mode-aware capability check and separate acknowledgement of the app restriction and one-time Android screen lock. `Device.state=LOCKED` means the server requested a restriction; it is not evidence of durable Android lock. A missing notification grant or offline app can prevent a reminder from being shown; expose that in command outcome rather than silently calling it delivered.

**Existing behavior to reconcile before launch:** [`scheduledJobs.js`](backend/src/jobs/scheduledJobs.js) currently queues upcoming and overdue reminders *before* it skips `MANUAL` tenants for scheduled EMI lock. That contradicts [`Tenant Mode.md`](Tenant%20Mode.md), which disables scheduled reminders in manual mode. Gate both scheduler reminder branches on `!isManualDeviceControl`, while leaving explicit operator reminders available in both modes. The current [`getBorrowerAppConfig`](backend/src/services/tenantDeviceControl.service.js) and its tests also keep EMI details, payment history, and EMI notifications enabled for `MANUAL`, whereas `Tenant Mode.md` says those borrower views are hidden. Decide the intended borrower presentation once and apply it to both apps; do not make the running app diverge merely because of its enrollment mode. `riskManagement.service.js` can separately queue a critical-security `LOCK` when `riskRules.autoLockOnCriticalSecurityRisk` permits it, including in `MANUAL`; show that as a separate risk policy and apply the running-app capability gate there as well. If “manual” is meant to prohibit **every** automatic lock, explicitly disable/gate risk auto-lock too.

## 2. What the repository already provides

| Area | Current implementation | Change required |
|---|---|---|
| Dealer registration | [`registerBorrower`](backend/src/modules/distributor/distributor.controller.js) creates `User`, `EmiSchedule`, `EnrollmentToken`, and deducts one credit. | Add an enrollment-mode choice while preserving the existing response/default for older dealer builds. |
| New-device QR | [`generateEnrollmentQr`](backend/src/modules/distributor/distributor.controller.js) builds Android `PROVISIONING_*` QR data. `regenerateEnrollmentQr` can reuse an active token. | Keep this flow for `DEVICE_OWNER_QR`; add a separate running-app deep-link QR. Never let one mode reuse the other's token. |
| Token | [`EnrollmentToken`](backend/src/models/EnrollmentToken.js) has user/tenant/expiry/consumption but no mode. | Bind each token to an immutable mode and one borrower/tenant; add a safe reissue/switch flow. |
| Device registration | [`registerDevice`](backend/src/modules/app/app.controller.js) requires IMEI, accepts optional `imei2`, looks up an active token by user, then marks `isDeviceLinked`. | Reuse the same IMEI fields for both modes. For running mode, accept borrower-entered IMEIs and require the exact scanned mode-bound token; do not let any active token satisfy registration. |
| Device model | [`Device`](backend/src/models/Device.js) requires IMEI and has `deviceOwnerStatus`, `state`, versions, location, and FCM token. | Keep required IMEI and existing device states. Add enrollment mode, an installation authentication binding, and a timestamped capability snapshot; derive applied status from current command acknowledgements. |
| Dealer actions | [`distributor.routes.js`](backend/src/modules/distributor/distributor.routes.js) already exposes lock, unlock, EMI reminders, and location. | Make them mode-aware; add dealer release after settlement and a single device action summary. |
| Admin actions | [`admin.routes.js`](backend/src/modules/admin/admin.routes.js) exposes lock, unlock, location, and settled-device release. The portal has override, location, release, restrictions, and security-control panels. | Add a dedicated admin EMI reminder action; filter/display modes; show only supported controls and true outcomes. |
| Command execution | [`DeviceCommand`](backend/src/models/DeviceCommand.js), app sync/ack, FCM delivery, cron, risk auto-lock, and payment unlock already exist. | Put a shared capability gate on every command producer, not just the UI. Stop `LOCKED` from implying a running phone is unusable. |
| Release | [`queueDeviceRelease`](backend/src/services/deviceRelease.service.js) requires settled installments. Ack currently sets `deviceOwnerStatus=RELEASED`. | Preserve settlement gate; use mode-specific cleanup/ack. A running app has no Device Owner status to release. |
| App builds/integrity | [`appUpdate.service.js`](backend/src/services/appUpdate.service.js) validates only `com.crednexa.app`; [`app.controller.js`](backend/src/modules/app/app.controller.js) decodes/checks Play Integrity against one configured package. | Register the separately signed running-app package, build channel, and mode-specific integrity rules without weakening checks for the owner app. |

The dealer Android source is **not in this repository**. The dealer-app section below is an API/UI contract for that team. The super-admin portal source is available in [`super-admin-portal/src`](super-admin-portal/src).

### Important existing access-control gap

[`ensureDistributorAccess`](backend/src/modules/distributor/distributor.controller.js) verifies `tenant_admin` and `distribute` capability. Lock, unlock, and location routes currently call it as well. A distribute-only outlet may therefore reach controls that project context says belong to the **credit originator** (`lend` capability). Before exposing the same actions to running devices, separate **onboarding authority** from **lending-control authority**:

- Registration and QR issuance: active tenant with `distribute`, scoped to its own tenant.
- Lock, unlock, reminder, location, and release: an active lender with `lend`, or a distributor with an explicit, narrowly scoped delegation from the lender. Do not infer authority merely from a parent-tenant relationship.
- Super-admin: existing override authority, mandatory reason, settlement/consent rules, and audit trail. An admin action is an exception, not a transfer of the lender's ordinary authority.

Where an outlet registers the borrower for a parent lender, persist **registering tenant** and **lender tenant** explicitly on the loan/device or resolve them through an auditable loan ownership record. Check the lender relationship on every command. Keep all reads scoped to the correct tenant/channel-partner relationship; do not expose borrower data because a user happens to share a mobile number.

## 3. Shared data model

### 3.1 Enrollment and device identity

Add `enrollmentMode: DEVICE_OWNER_QR | RUNNING_APP` to `EnrollmentToken` and `Device`. This identifies the onboarding method; it is **not** a new device lifecycle state. New registrations must set it deliberately; migrate existing records to `DEVICE_OWNER_QR` after checking that they represent the current managed app. Keep `deviceOwnerStatus` as an actual owner-status signal. For running devices, retain its existing `UNKNOWN` value and display “Not Device Owner” based on `enrollmentMode`; do not add a new owner-status enum value merely for display, or mark a running device `CONFIRMED`/`RELEASED` because a normal app reported success.

Keep `Device.imei` required and `Device.imei2` optional in the schema. For `DEVICE_OWNER_QR`, the owner app may populate them from Android where authorized. For `RUNNING_APP`, show **IMEI 1** and **IMEI 2** entry fields after OTP and consent; explain where to find the values in Android settings. Require both values when the handset presents two; if it genuinely has only one, record IMEI 2 as absent instead of inventing a value. Normalize digits, validate format/check digit where applicable, ensure the two entries are different, and flag duplicates against either IMEI field on another active device for dealer review. Show masked values to the dealer for visual confirmation against the target phone before handover. Record `identifierSource=borrower_entered` in enrollment/audit metadata. Android 10+ generally restricts direct IMEI access to privileged or specially eligible apps, so **manual entry is not device verification**. The app must not claim it read or attested those numbers. [Android identifier rules](https://developer.android.com/about/versions/10/privacy/changes#non-resettable-device-ids).

Keep a separate `installationId` (random app-generated) and public-key fingerprint or equivalent signed installation binding to authenticate later app requests. The typed IMEI remains the familiar inventory/search field; it must not be the sole credential or proof that the app runs on the phone whose IMEI was entered. FCM token, phone number, and Android ID are also insufficient alone. Google's Play user-data policy restricts linking persistent identifiers such as IMEI to personal data, with limited exceptions including Device Owner management. A normally installed running app does not gain that exception through manual entry. Treat Play distribution of this exact IMEI-linked flow as blocked until a specific policy review establishes eligibility; the stated downloaded-APK channel still needs privacy/consent review. [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311).

Extend the token with `mode`, `issuedForUserId`, `issuedForTenantId`, `createdBy`, `expiresAt`, `consumedAt`, `cancelledAt`, `supersededBy`, and a token hash for newly issued running codes. Return the raw running activation secret only when issuing the QR; do not include it in ordinary list/detail/audit responses or logs. The QR contains an opaque, short-lived app link and no borrower name, phone number, EMI amount, or server credentials. App-link install fallback must preserve the one-time claim safely.

The existing `User.isDeviceLinked`/`linkedDeviceId` suggests one active device per borrower. Maintain that product rule for the first release. A replacement must be a separate audited operation that invalidates the old installation, command queue, FCM token, and activation token. Do not let the new running app call existing sync/ack using only a borrower JWT and accidentally select a prior or other device with `Device.findOne({userId})`.

### 3.2 Reuse the existing states and command results

Keep [`DEVICE_STATES`](backend/src/constants/deviceStates.js) (`ACTIVE`, `GRACE_PERIOD`, `LOCKED`, `TEMP_UNLOCK`, `UNLOCK_PENDING`, `OFFLINE_PENDING`, `CONSENT_INVALID`, `RELEASE_PENDING`, `RELEASED`) and the existing `DeviceCommand.status` values (`pending`, `sent`, `acknowledged`, `failed`, `expired`). Do not create `READY`, `LIMITED`, `STALE`, `PARTIAL`, or a second lock-state machine in MongoDB. Use `EnrollmentToken` expiry/consumption, `User.isDeviceLinked`, consent, `Device.state`, `desiredPolicyVersion`, `lastAppliedPolicyVersion`, latest command and its `ackPayload`, `lastSeenAt`, and `lastSyncAt` as the source of truth. Enrollment readiness and warning text can be **derived API/UI fields**, not persisted states.

Add only a timestamped capability snapshot (`deviceAdminActive`, `screenLockAvailable`, `notificationsAllowed`, `locationGrant`, `appVersion`, `sdkInt`, `observedAt`, `serverReceivedAt`) and compute effective actions server-side. A client report is not proof of device control; expire stale reports. Keep location permission separate from consent and distribution eligibility. Record the actual running lock outcome (`appRestrictionApplied`, `screenLockCalled`, failure reason, observed time) in the existing `DeviceCommand.ackPayload` instead of introducing a new command or state enum.

`Device.state=LOCKED` remains the requested business/policy state. For running devices, the operator view pairs it with the latest relevant command's existing status and ack details: “Lock queued,” “App restriction reported applied,” “Screen lock called,” or “Result unknown/offline.” An acknowledgement does not prove the whole phone is unusable. For owner devices, retain present state behavior and show the same command-result detail where available.

### 3.3 State transitions for a running-device enrollment

Registration ends in the existing `ACTIVE` state once the token, OTP, consent, and installation binding are complete. QR issuance and the steps before device creation live on `EnrollmentToken`/`User` records; they are not device states. Tenant control mode is also not a device state. The same state machine is used for owner and running devices, but the running app reports a weaker enforcement outcome.

| Existing `Device.state` | When it applies to the running app | What the operator should see |
|---|---|---|
| `ACTIVE` | Successful enrollment, or an `UNLOCK` acknowledgement that cleared the app restriction | Active; show last sync and permission health separately |
| `GRACE_PERIOD` | The existing EMI scheduler enters grace for an `EMI_AUTOMATED` tenant | Grace period; app must apply any supported grace UI/policy and acknowledge the `POLICY_UPDATE`; no grace transition for `MANUAL` |
| `LOCKED` | A scheduled/manual/risk `LOCK` was requested; the server currently sets this before app acknowledgement | “Lock requested” until the command result is known; after acknowledgement, show app restriction and Android screen-lock outcomes separately |
| `UNLOCK_PENDING` | Dealer/admin/payment flow queued `UNLOCK`; `ACTIVE` follows a successful app acknowledgement | “Unlock pending”; do not imply the app restriction has cleared while offline |
| `TEMP_UNLOCK` | Existing temporary-unlock feature only, if deliberately supported by the running app | Show expiry and latest `TEMP_UNLOCK` result; the existing expiry job can requeue `LOCK`, so it needs the same mode/capability gate. The five requested running controls do not require exposing this action in the first release |
| `RELEASE_PENDING` | Settlement-gated `RELEASE_DEVICE` was queued | Release pending until the app completes local cleanup and acknowledges, or an audited recovery process resolves an unreachable installation |
| `RELEASED` | Successful running-app release acknowledgement | Financing controls ended; do not set or display Device Owner release status for this app |
| `OFFLINE_PENDING`, `CONSENT_INVALID` | Existing enum values, but no general transition currently writes them in the normal command paths | Do not repurpose either as a QR step, permission-warning label, or proof of lock failure. Derive offline/consent warnings from last contact, consent, capability, and command data unless a dedicated transition is implemented |

`EMI_REMINDER` and `GET_LOCATION` do not change `Device.state`. A missed reminder, stale location, revoked Device Admin grant, or failed lock is a command/capability outcome, not a new lifecycle state. The current backend sets `LOCKED` before a `LOCK` ack and `TEMP_UNLOCK` before its ack; a failed or expired command can therefore leave a desired state that was never applied. Add a reconciliation rule and tests for failed, offline, duplicate, and out-of-order commands: preserve the server's requested policy, report `pending`/`failed`/stale enforcement separately, and advance applied-policy evidence only after a valid acknowledgement. On reconnect the running app fetches the latest desired policy version, ignores superseded commands, and reports what it actually applied. The admin/dealer UI must never convert a requested state into a claim that the Android phone is secured.

## 4. One dealer onboarding experience, two QR formats

1. Dealer enters borrower/loan details as today, then selects **New device** or **Running device**. Show concise capability/assurance differences before generating a QR. The selection is saved server-side with the borrower's enrollment record.
2. `POST /distributor/users/register` accepts optional `enrollmentMode`. Omission defaults to `DEVICE_OWNER_QR` for older dealer builds. Existing one-credit debit and EMI schedule creation remain once per borrower. The response includes `enrollmentMode`, `enrollmentId`, and token expiry.
3. A mode-aware QR service issues exactly one active token for the borrower and selected mode. Existing `POST /distributor/enrollment/qr` continues to accept only owner-mode tokens. Add `POST /distributor/users/:userId/enrollment/running-qr`, or evolve the per-user regeneration route to dispatch **from the stored token mode**. The response has `qrType`, `qrText`, `qrCodeDataUrl`, `expiresAt`, and an operator-safe status; it must never return Android provisioning extras for running mode.
4. **New-device path:** current Android setup/provisioning QR and Device Owner borrower app continue. Record actual owner confirmation during enrollment.
5. **Running-device path:** the borrower downloads/opens the separately signed app, scans the QR shown on the dealer phone (or opens its verified app link), checks the lender/loan shown by the backend, completes existing OTP and versioned consent, and manually enters IMEI 1 and IMEI 2 as shown in phone settings. The app submits the exact activation token, entered IMEIs, a fresh signed challenge from a Keystore key, app/package information, and its installation ID. The backend atomically consumes the matching `RUNNING_APP` token and links the device using the existing `imei`/`imei2` fields. Permission grants are recorded in the capability snapshot. The dealer visually confirms the masked IMEI values and linked borrower before handover.
6. Dealer app polls an enrollment-ID-based status endpoint. Derive operator text such as “QR active,” “OTP/consent pending,” “Device linked,” “Access missing,” or “Expired” from existing token/user/consent/device fields; these are **presentation labels**, not new database states. A linked running app is not Device Owner. Use an operator-safe enrollment ID in polling instead of placing the raw activation secret in URLs.
7. QR reissue invalidates the prior token in one transaction, keeps the original mode, and records actor/reason. A mode change before device binding is a distinct audited cancel-and-reissue action. Once linked, changing mode requires a controlled device replacement/re-enrollment workflow.

The existing `registerDevice` currently finds an active enrollment token by user, without requiring the specific token in its request. Fix this during integration: token user, tenant, **mode**, expiry, cancellation, consumption, and challenge must match the pending enrollment. Reuse its IMEI storage, consent check, device creation, and `User.isDeviceLinked` transaction; add mode-specific token/key verification and manual-identifier provenance. Roll out a compatible owner-app update or introduce a versioned owner registration endpoint before removing the legacy path. Never silently let an owner token register a running app or vice versa. The current enrollment-status response also echoes the raw token; the new ID-based status response must omit it.

## 5. Five running-device actions

| Action | Existing backend route/service | Running-device meaning and backend gate | Operator result to display |
|---|---|---|---|
| **Lock** | Dealer `POST /distributor/devices/:id/lock`; admin `POST /admin/devices/:deviceId/lock`; automated jobs also queue `LOCK`. | Require valid consent, lender authority or audited admin override, active enrollment, no release, and a current capability snapshot. Reuse `LOCK`; the running app applies its finance UI state and optionally calls `lockNow()` if Device Admin is active. Put both results in that command's `ackPayload`. | `Queued → delivered → app state reported applied`, plus `screen lock called` if true. Never say “phone unusable.” If Device Admin is absent, show the missing-control warning or reject if the tenant requires it. |
| **Unlock** | Dealer/admin `UNLOCK` routes; payment approval and other paths also queue unlock. | Authorization and policy/version checks remain. Clear the running app's EMI-restricted state and cancel any pending/superseded lock locally; reconcile latest server state. It cannot dismiss Android keyguard. This action must still work when Device Admin has been revoked. | `Unlock requested → app restriction cleared`; show pending/offline until observed. |
| **Send reminder** | Dealer overdue/upcoming reminder routes; `queueEmiReminder`; admin has testing/custom notification paths but no dedicated normal EMI reminder action. | Reuse `EMI_REMINDER` with validated amount/due-date/schedule context. Add a normal admin reminder route/service with mandatory reason; do not route production reminders through a testing action. Rate-limit, deduplicate, and honor borrower notification permission. | `Queued`, `delivered`, `displayed/acknowledged` when the app can report it; `notifications disabled` when applicable. |
| **Get location** | Dealer/admin `location-request`; `queueGetLocationCommand`; location accepted only on matching `GET_LOCATION` ack. | Require explicit, current consent; authorized actor/purpose; valid location capability; request expiry; and a distribution-policy gate. Ask only on demand. The running app may be unable to fetch fresh location while backgrounded; it returns a specific failure or waits for user opening it. | Last fix with accuracy, capture time, receipt time, and a `stale` label. Never show an old fix as a fresh answer. |
| **Release** | Admin settled-device release and shared `queueDeviceRelease`; no dealer release route. | Add dealer release only for an authorized lender or delegated actor, after all installments are paid/waived. Keep super-admin retry. Queue `RELEASE_DEVICE`, supersede all other commands, and let running app clear its EMI state, session/key binding, local data, and future work; revoke the server binding. | `Release pending → confirmed` or `offline/retry needed`. Running-mode ack must **not** set `deviceOwnerStatus=RELEASED` or claim DPM removal. |

Return `409 UNSUPPORTED_FOR_ENROLLMENT_MODE`, `409 CAPABILITY_UNAVAILABLE`, `403 LENDER_AUTHORITY_REQUIRED`, `403 CONSENT_REQUIRED`, `409 DEVICE_RELEASE_IN_PROGRESS`, or another stable code with `allowedActions`/reason so clients can explain disabled buttons. Do **not** create a command when preconditions fail. All five actions need actor, tenant/lender, borrower, device, reason/purpose, mode, capability snapshot, command ID, delivery attempt, final app result, and timestamps in the audit/command record. Require an idempotency key for repeated operator taps and use existing policy versions to discard stale lock/unlock orders.

### Lock contract must be honest

`DevicePolicyManager.lockNow()` is an immediate screen lock available to an active Device Admin that declared `force-lock`; it does not create a persistent lender-owned kiosk. If there is no secure device credential, the API can only put the device to sleep. The user can unlock it with their credential, and Android can limit background activity launches. Define running-mode success as **the app's own policy applied** plus a separate **system screen-lock call outcome**. Do not use Accessibility to prevent users disabling security settings or uninstalling. [Android `lockNow()` reference](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()), [background activity launch limits](https://developer.android.com/guide/components/activities/secure-bal).

### Location release gate

Google Play's current Financial Services policy prohibits `ACCESS_FINE_LOCATION` for personal-loan and related app categories, including certain facilitator/accessory apps. Device-finance classification and distribution need a specific product/policy decision before promising running-device location. If that classification applies, do not put prohibited fine-location permission in the Play build; assess whether a disclosed approximate, user-initiated flow is eligible and useful. Android also restricts location foreground services started while an app is in the background. Thus **Get location is a conditional product action**, and the portal/dealer app must hide or disable it when the published app cannot support it. [Google Play Financial Services policy](https://support.google.com/googleplay/android-developer/answer/9876821), [Android background location limits](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

## 6. Shared command architecture and API contracts

Create one server-side `deviceActionPolicy`/`queueDeviceAction` service used by dealer controllers, admin controllers, payment approval, scheduled EMI lock, risk auto-lock, release, and future partner overrides. The service takes `(actor, device, action, reason, requestId)` and checks role/lender scope, consent, release state, enrollment mode, current capability, supported command, and target policy version **before** any state mutation. A model hook is a useful final safety net, but controller/service gates are needed for clear API errors. The present code creates commands in multiple modules, including [`scheduledJobs.js`](backend/src/jobs/scheduledJobs.js) and [`riskManagement.service.js`](backend/src/services/riskManagement.service.js); audit every producer before launch.

Suggested normalized response from existing dealer/admin list and detail routes:

```json
{
  "deviceId": "...",
  "borrower": { "id": "...", "name": "...", "loanId": "..." },
  "enrollmentMode": "RUNNING_APP",
  "assurance": "LOWER",
  "imeiMasked": "***********2345",
  "imei2Masked": "***********2352",
  "identifierSource": "borrower_entered",
  "state": "LOCKED",
  "lastCommand": { "commandType": "LOCK", "status": "sent", "ackPayload": null },
  "lastSeenAt": "...",
  "lastCapabilityCheckAt": "...",
  "capabilities": { "screenLock": true, "notifications": true, "location": false },
  "allowedActions": {
    "lock": { "enabled": true },
    "unlock": { "enabled": true },
    "reminder": { "enabled": true },
    "location": { "enabled": false, "reason": "LOCATION_NOT_AVAILABLE" },
    "release": { "enabled": false, "reason": "EMI_NOT_SETTLED" }
  }
}
```

The server computes `allowedActions` for the authenticated operator; the frontend does not decide from `enrollmentMode` alone. A stale capability report should show an assurance warning, and a server action must recheck it at execution time. Keep the existing IMEI search/display in [`getDistributorDevices`](backend/src/modules/distributor/distributor.controller.js) and [`listDevices`](backend/src/modules/admin/admin.controller.js), but mark running-mode identifiers as manually entered and mask them in routine lists.

Suggested endpoint work (names for new endpoints are proposals):

| Endpoint | Work |
|---|---|
| `POST /distributor/users/register` | Optional `enrollmentMode`; default owner for backward compatibility. |
| Existing owner QR routes | Reject running tokens; leave provisioning payload/response compatible for old dealer builds. |
| `POST /distributor/users/:userId/enrollment/running-qr` | Issue/reissue a running-app link QR with a one-time, mode-bound token. |
| `GET /distributor/enrollments/:enrollmentId/status` | Mode, lifecycle, readiness, and limitations without exposing a raw token. |
| `POST /app/running-enrollment/challenge`; existing `POST /app/device/register` | Challenge proves the running installation key. Reuse `registerDevice` for both modes, adding the exact token, `imei`/`imei2`, challenge signature, and mode-aware validation while preserving legacy owner registration during migration. The server derives mode from the token; the client cannot upgrade itself. |
| `POST /app/device/capabilities` | Update timestamped reported grants; verify enrolled device identity. |
| Existing `/app/device/ping`, `/sync`, `/command/ack` | Select the authenticated **device**, not merely the first device belonging to borrower; return only commands supported by its mode and versions. |
| `POST /distributor/devices/:id/release` | Settled-only, lender-authorized dealer release using shared service. |
| `POST /admin/devices/:deviceId/emi-reminder` | Normal admin reminder with explicit reason and reminder type. |
| Existing dealer/admin action routes | Return normalized command and observed-status fields; reject unsupported actions. |

For running `LOCK`, an acknowledgement might carry `result=APP_RESTRICTION_APPLIED`, `systemScreenLock=CALLED|SKIPPED_ADMIN_DISABLED|FAILED`, and `observedAt`. For `GET_LOCATION`, require matching unexpired command, latitude/longitude, accuracy, captured time, and grant provenance; retain existing validation. For `RELEASE_DEVICE`, require `localReleaseCompleted=true`, then clear server binding and mark the device released without fabricating Device Owner removal. FCM is a wake-up signal; the app fetches authenticated desired state and acks only what it performed. [Android persistent work guidance](https://developer.android.com/develop/background-work/background-tasks/persistent).

## 7. Dealer app and admin-panel screens

### Dealer/tenant app

- **Registration:** a two-choice “Device setup” step with clear descriptions; same borrower/loan fields and credit outcome. The QR screen varies by mode and contains instructions for scanning from Android setup (new) or the already running phone/app (running). Show expiry, regenerate, cancel, and enrollment status.
- **Fleet list:** filter `All / New managed / Running`; show borrower, normalized device ID, mode badge, payment status, last contact, and actual enforcement health. A running device without Device Admin should show “Screen-lock access off,” not “tampered” by default.
- **Device detail:** display the five actions, each with `allowedActions` reason, command status, last app observation, and an audit timeline. Show only lender-authorized actions to that operator. Keep EMI installment detail and consent evidence available.
- **Lock/unlock:** require a reason. For running mode, confirmation copy says what the action can do and that Android remains unlockable by the borrower's credential. Show separate command delivery and app result, with a clear offline state.
- **Reminder:** overdue/upcoming templates and EMI context; show rate limits and notification availability. No unrestricted debt-collection message entry without content review.
- **Location:** show consent/purpose and age/accuracy of last fix; no automatic refresh on opening the screen. If unavailable, explain whether permission, Android background limits, or distribution policy is the reason.
- **Release:** show EMI settlement proof and a final confirmation. When queued, all other controls become unavailable. Show retry/escalation path if the phone is offline.

### Super-admin portal

Update [`devices/page.tsx`](<super-admin-portal/src/app/(dashboard)/devices/page.tsx>) with mode and assurance filters and a masked IMEI column. Update [`devices/[deviceId]/page.tsx`](<super-admin-portal/src/app/(dashboard)/devices/[deviceId]/page.tsx>) to show mode, manually entered IMEI provenance, grant health, existing device state beside latest command result, and the five supported actions. Adapt [`device-override-panel.tsx`](super-admin-portal/src/components/devices/device-override-panel.tsx), [`device-telemetry-panel.tsx`](super-admin-portal/src/components/devices/device-telemetry-panel.tsx), and [`device-release-panel.tsx`](super-admin-portal/src/components/devices/device-release-panel.tsx) to use `allowedActions` and mode-specific copy. Add the production EMI reminder panel. Hide/disable [`device-restrictions-panel.tsx`](super-admin-portal/src/components/devices/device-restrictions-panel.tsx), [`device-security-controls-panel.tsx`](super-admin-portal/src/components/devices/device-security-controls-panel.tsx), and Device Owner testing/manual-override controls for running devices. The server must reject those calls even if a client sends them manually. The command and audit views should expose actual enforcement method, failure code, and latest observation.

## 8. Authorization, consent, and rollout prerequisites

1. Disable or remove public `POST /api/app/testing/access-token` before launch. In [`app.controller.js`](backend/src/modules/app/app.controller.js), its production guard is commented out; [`app.routes.js`](backend/src/modules/app/app.routes.js) exposes the route without a JWT guard. A user token minted through that path can defeat device binding.
2. Require borrower OTP and a versioned, immutable consent record covering the **running-app mode**, exact available controls, location (if enabled), app removal/revocation consequences, and support/release process. Do not reuse managed-device consent wording if it promises Device Owner enforcement.
3. Restrict operator actions to the lender/delegation model above; require reason and audit evidence for lock, unlock, location, and release. Rate-limit reminders and location requests. Do not allow a disbursement/outlet account to gain lending authority from its `distribute` capability alone.
4. Separate command **authorization** from **delivery**. FCM data is never the authority. Device API calls must be bound to enrolled installation credentials and the exact `deviceId`/command ID. Record stale/offline/revoked capability as a failed or unknown outcome, not as success.
5. Give the borrower an obvious way to pay, seek support, see enabled permissions, and complete release. Emergency calling must remain accessible. No photos, chats, contacts, or messages should be collected for collection activity.
6. Extend app-build upload/update checks and the admin build page for the new package/signing identity. Existing update validation accepts only the current borrower package, and Play Integrity decode/verification currently uses one configured package name. Choose the expected package from a **server-bound enrollment mode**, never from an arbitrary client field; keep per-package signing/version rules and test both distribution channels. A sideloaded build may not produce the same Play-recognition signal as a Play-distributed build, so integrity policy needs an explicit mode/channel decision rather than a blanket bypass. FCM delivery may share infrastructure, but each device must retain its own app/package identity, token, and delivery logs so a running-app token is not mistaken for an owner-app installation.

## 9. Delivery sequence and acceptance checks

| Phase | Backend and migration | Dealer app / portal / running app | Gate to finish phase |
|---|---|---|---|
| **0. Security and product contract** | Close testing-token route; define lender authority, running-lock wording, location distribution classification, and release eligibility. | Review consent/operator copy. | Written action semantics and policy decision for location. |
| **1. Additive schema/API** | Add mode to token/device, manual-identifier provenance, capability snapshot, indexes, and migration. Keep existing state enums and required IMEI. Default old API to owner mode. Extend build/update and integrity package registry. | Dealer registration gains mode selection; admin/dealer lists gain mode and IMEI-source label; admin builds page handles the second package. | Existing owner QR, registration, update, integrity, state, and command tests still pass. |
| **2. Running enrollment** | Add mode-bound QR, explicit-token challenge, mode-aware existing device registration, IMEI 1/2 validation, installation binding, derived status, reissue/replacement. | Dealer QR/status flow; new borrower app OTP/consent, manual IMEI entry, and permission health. | Wrong-mode/replayed/expired/other-tenant token fails; borrower-entered IMEIs are stored in existing fields and labeled unverified. |
| **3. Shared action policy** | Centralize authorization/capability gates for all controllers, payment jobs, scheduled jobs, risk jobs, and delivery; adapt ack/state. | Dealer and admin use `allowedActions`; running app executes lock, unlock, reminder, location if eligible, release. | All five actions have an auditable queue/result path; unsupported DPM commands cannot be queued for running mode. |
| **4. Operator experience** | Add dealer release and admin reminder routes; normalized device summary/filter fields. | Dealer fleet/detail/QR controls; admin mode filter, reminder, status/health, conditional panels. | Same loan/device visible in both operator surfaces with identical mode and command outcome. |
| **5. Pilot and rollout** | Feature flag per tenant, metrics for enrollment completion, grant loss, delivery latency, false-lock claims, location failures, and release retry. | Physical-device pilot across OEMs/Android versions and install channels. | No regression in new-device onboarding; no running device shown as Device Owner or durably locked. |

Minimum automated tests: old owner registration compatibility; one credit per borrower; token cross-mode and cross-tenant rejection; concurrent token consumption/reissue; running registration with manual IMEI 1/2, single-IMEI exception, invalid/check-digit/duplicate identifier handling; no new device-state enum; device-bound sync/ack; lender/delegation denial; every command producer's mode gate; lock/unlock idempotency and offline ordering; reminder rate/deduplication; location consent/expiry; settled-only release and different owner/running ack behavior; list/detail filtering; public testing-token route absent in production. Physical tests must include Device Admin granted/revoked, no secure PIN, notifications denied, location denied, force-stop, reboot, missed/duplicate FCM, payment approval while offline, and app reinstall/replacement.

**Launch acceptance:** a dealer can onboard either device type from one registration flow; both dealer and super-admin can see the true mode and safely use the five eligible controls; a running device is never described or processed as Device Owner; every action has a truthful last result; and the existing new-device QR path remains functional.
