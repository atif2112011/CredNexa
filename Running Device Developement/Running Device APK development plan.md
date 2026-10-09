# Running Device APK development plan

**Handoff to:** Borrower app developer and senior app developer  
**Date:** 9 October 2026  
**Target:** A separately installable `RUNNING_APP` borrower APK built from the existing QR-provisioned borrower app codebase.  
**Status:** Implementation handoff. The running APK source is held by the app team and is not part of this backend workspace; UI class names and exact refactoring points must be confirmed in that source.

## Developer handoff package

Forward these **three files together** to the running APK developer:

| File | How to use it |
| --- | --- |
| [Running Device APK development plan.md](Running%20Device%20APK%20development%20plan.md) | Implement the agreed borrower-app flow, screens, overlay behavior, and command handling described here. |
| [running apk backend api contract.md](running%20apk%20backend%20api%20contract.md) | Use the implemented endpoints, authentication, request and response bodies, status codes, and command acknowledgement rules. This is the source of truth for the API wire contract. |
| [running_device_apk_analysis_and_architecture.md](running_device_apk_analysis_and_architecture.md) | Read the supplied APK analysis and Android capability findings as background. Its architecture ideas are suggestive, not the final implementation contract. |

If these files differ, use this plan for agreed app behavior and the backend API contract for exact API fields and responses; raise any remaining conflict with the senior developer. The [master plan](master%20plan.md) covers dealer/admin and backend work.

The existing borrower APIs and the running APK backend API contract cover almost all expected app flows. If implementation reveals a genuinely missing API, the app developer may prepare a proposed API contract for the backend developer to implement. Specify the use case, endpoint and method, authentication, request body, success and error responses, and how it fits the existing flow. Review the proposal with the senior and backend developers before the app depends on it; reuse an existing endpoint when it already covers the need.

## 1. Build from the existing borrower app

Create a **running-device build variant** from the current borrower app source. Reuse its visual design, OTP and consent screens, borrower session, EMI dashboard, installments, payment, unlock-request, support, update, and notification flows. Keep the QR-provisioned build working as it does now. The running variant needs its own application/package ID, signing and release configuration, Firebase/FCM configuration, in-app QR scanning, and update channel. The backend still requires `RUNNING_ENROLLMENT_PACKAGE_NAME` for running-enrollment configuration; it is **not** a requirement to register the running APK for Play Integrity.

Disable inherited Play Integrity initialization, onboarding checks, startup checks, periodic checks, and risk rechecks in the running build. Do not call any of the four `/api/app/integrity/*` endpoints. They return HTTP `409` with `data.code: "UNSUPPORTED_FOR_ENROLLMENT_MODE"` for `RUNNING_APP`, before or after activation. Keep Play Integrity behavior in the existing QR-provisioned build. The running build may still report actual local security observations through `POST /api/app/security/event`; those reports follow the separate risk auto-lock policy.

The two variants may share most code, but enforcement must be selected by the **persisted enrollment mode** rather than by a screen assumption:

| Area | Existing QR-provisioned build | Running-device build |
| --- | --- | --- |
| Entry | Android provisioning QR during new-device setup | Install and open the app on an already-running phone; scan the running QR displayed by the dealer app **inside** the borrower app |
| Enrollment | Existing Device Owner registration | Scan and preview first, then manual IMEI screen, permissions screen, existing OTP/consent, and final running activation |
| Lock presentation | Existing managed kiosk/lock-task flow | App-controlled overlay with borrower actions |
| Temporary unlock | Existing timed flow | Same case/approval and `TEMP_UNLOCK` state; clear overlay until expiry, then restore it |
| Managed per-app controls | Existing supported dialer/WhatsApp/YouTube restrictions | Never apply these restrictions; handle an unexpected command safely |
| EMI/payment/support | Existing borrower behavior | Reuse existing screens, APIs, validation, and server `appConfig` switches |

Do not copy Device Owner provisioning, kiosk setup, package restriction, factory-reset blocking, unknown-source install blocking, USB-debugging blocking, wipe, or manual-override logic into the running variant. Ordinary Device Admin activation does not grant these Device Owner controls. Keep shared components where the outcome is genuinely identical; keep enforcement adapters separate so an owner policy cannot be executed on a running installation by mistake.

## 2. Running enrollment journey

1. The dealer has already created the borrower with an enrollment type. In the dealer app's **borrower list**, an unlinked borrower has a **Generate QR** button. On that button press, the dealer app reads the saved borrower enrollment type and requests the matching QR: the existing Device Owner provisioning QR for `DEVICE_OWNER_QR`, or the running-app QR for `RUNNING_APP`. For the running mode, the borrower-scoped `POST /api/distributor/users/:userId/enrollment/qr` request includes `{ "enrollmentMode": "RUNNING_APP" }`; it returns `qrCodeDataUrl` and `qrText`. The button reuses a still-valid claim by default; rotation is a separate, explicit action. A linked borrower must not be offered Generate QR.
2. Install and open the running APK on the already-set-up phone. Show an **in-app QR scanner as the entry screen** and request camera access for scanning. Scan the dealer's running-app QR, which encodes an HTTPS string with an opaque `code` parameter. Extract and retain only that code securely for the in-progress enrollment; do not treat the QR as verified borrower, loan, or Device Owner data. Call `POST /api/app/running-enrollment/preview` with the code as `enrollmentToken`, then show the backend-verified lender and masked borrower/loan details. Reject an owner provisioning QR, a malformed/expired/rotated running QR, or a claim for the wrong borrower; ask the dealer to show a valid running QR.
3. Show **new screen A: IMEI entry**. Collect IMEI 1 and IMEI 2 manually, or the explicit single-IMEI exception. Continue only when the entered values pass local validation; the backend validates again at registration.
4. Show **new screen B: permissions and access**. Explain each requested access, open the relevant Android permission/settings screen from its row, recheck the actual grant when the borrower returns, and show its current status. Notification and overlay access must be granted before final activation under the current backend contract.
5. Reuse the existing OTP, versioned consent, and borrower JWT flow. Fetch terms with `POST /api/app/consent/terms` and the **same scanned code** so the running-specific consent is shown. Bind OTP and consent to that code. Do not silently fall back to managed-device terms. If shared onboarding code calls Play Integrity before consent or registration, bypass that step for the running build only.
6. Just before **Finish enrollment**, recheck the required grants and create a fresh `capabilities.observedAt`; the backend requires that observation to be no more than five minutes old, so the earlier permissions screen alone is insufficient after OTP/consent. When the borrower taps Finish, call the existing authenticated `POST /api/app/device/register` with the same code, stable body `activationRequestId`, `requirementsVersion`, `imei`, `imei2` or `singleImeiDevice`, current capabilities, FCM token, and device/app information. The backend creates the linked device at this step. Do not mark onboarding complete after scanning, IMEI entry, permission clicks, or OTP alone.
7. Save the returned linked device/session and call `/api/app/device/sync`. Restore this flow after process death or network failure while the scanned claim remains valid. Reuse the **same** `activationRequestId` for an uncertain registration retry; a new ID after linkage is a conflict. Clear the enrollment code after activation.

The existing bearer JWT is used on protected `/api/app` requests. No installation-signature headers are part of the current backend contract. Never log the scanned enrollment code, OTP, JWT, or full IMEIs.

### Dealer Generate QR and running-app scan

The dealer does **not** choose enrollment type when pressing **Generate QR**. That type was saved on the borrower during Add Borrower. The borrower-list row or detail reads `User.enrollmentMode`; for an unlinked owner borrower it requests and displays the existing provisioning QR, and for an unlinked running borrower it calls the borrower-scoped QR route with `enrollmentMode: "RUNNING_APP"` and displays the returned PNG. The running APK scans that PNG in its own camera screen. The same endpoint can show the current valid QR again; only an explicit `rotate: true` action invalidates it. Never substitute an owner QR for a running borrower or vice versa.

The running QR is an HTTPS **data format**, not an Android provisioning QR and not a requirement to open a website or configure Android App Links. The scanner parses the URL locally, accepts only the configured enrollment URL shape, extracts `code`, and sends the code to the backend preview endpoint. The preview, OTP, and consent APIs remain the trust checks. Treat the code as a bearer secret until consumed: keep it out of logs and analytics, store it only as long as enrollment or a safe retry requires, and clear it afterward. If the borrower denies camera access, a complete-link entry fallback may be offered; it must use the same preview and validation path.

### Generate a running-device QR in Postman while the dealer app is unavailable

This is the temporary dealer workflow. It uses the **existing** login, borrower-registration, and borrower-scoped Generate QR APIs; there is no separate running QR endpoint. Perform it against a configured **test backend and test dealer** first. A real registration creates a borrower and EMI schedule and consumes **one dealer credit**; generating or redisplaying its QR does not consume another credit. Obtain an unused test borrower mobile number. Keep the dealer password, access token, and QR private; the QR contains a bearer enrollment secret.

Before starting, the dealer account must be active with role `tenant_admin`, an active tenant with `DISTRIBUTE` capability and at least one credit, and that tenant's `TenantPolicy.runningEnrollmentEnabled` must be `true`. The server must have valid `RUNNING_ENROLLMENT_SECRET_KEY`, `RUNNING_ENROLLMENT_LINK_BASE` (HTTPS), and `RUNNING_ENROLLMENT_PACKAGE_NAME` configuration. If one is missing, fix the test environment rather than changing the request body. In Postman, create local environment variables `BASE_URL` (server origin, **without** `/api`), `DEALER_EMAIL`, `DEALER_PASSWORD`, `BORROWER_MOBILE`, and `AADHAAR_LINKED_MOBILE`. Use a local/private environment and avoid exporting or syncing its secrets.

1. **Log in as the dealer.** Create a `POST {{BASE_URL}}/api/auth/login` request with `Content-Type: application/json`, no bearer token, and this JSON body:

   ```json
   {
     "email": "{{DEALER_EMAIL}}",
     "password": "{{DEALER_PASSWORD}}",
     "targetApp": "tenant_app"
   }
   ```

   The login API also accepts `identifier` instead of `email` for an email or mobile login. `targetApp: "tenant_app"` selects the `tenant_admin` role if an identifier belongs to more than one account. Expect HTTP `200`, `success: true`, `data.tokenType: "account"`, `data.account.role: "tenant_admin"`, and `data.accessToken`. In the **Tests/Post-response** tab, use `pm.environment.set("ACCESS_TOKEN", pm.response.json().data.accessToken);`. Postman may also retain an HTTP-only refresh cookie; the next two calls need the **access token** as a bearer token. If it expires, log in again or use the existing refresh-token flow.

2. **Register the running borrower.** Create `POST {{BASE_URL}}/api/distributor/users/register` with `Authorization: Bearer {{ACCESS_TOKEN}}` and `Content-Type: application/json`:

   ```json
   {
     "name": "Test Running Borrower",
     "mobile": "{{BORROWER_MOBILE}}",
     "aadhaarLinkedMobile": "{{AADHAAR_LINKED_MOBILE}}",
     "loanAmount": 12000,
     "emiAmount": 2000,
     "tenureMonths": 6,
     "disbursementDate": "YYYY-MM-DD",
     "enrollmentMode": "RUNNING_APP"
   }
   ```

   Replace `YYYY-MM-DD` with an actual disbursement date accepted by the server (today is suitable); the backend rejects a date earlier than yesterday. `tenureMonths` must equal `ceil(loanAmount / emiAmount)`. The two mobile fields may be the same if that matches the test borrower; `mobile` must be unique. Expect HTTP `201`, `data.userId`, `data.enrollmentMode: "RUNNING_APP"`, `data.enrollmentId`, `data.tokenExpiresAt`, and `data.credits.remaining`. Registration creates the initial enrollment claim but deliberately does **not** return a running QR secret or an `enrollmentToken`. In the Tests/Post-response tab, use `pm.environment.set("BORROWER_ID", pm.response.json().data.userId);`. If registration fails, do **not** proceed with a guessed borrower ID.

3. **Generate/display that borrower's QR.** Create `POST {{BASE_URL}}/api/distributor/users/{{BORROWER_ID}}/enrollment/qr` with `Authorization: Bearer {{ACCESS_TOKEN}}`, `Content-Type: application/json`, and:

   ```json
   { "enrollmentMode": "RUNNING_APP" }
   ```

   For the fresh, valid claim created in step 2, expect HTTP `200`, `data.enrollmentMode: "RUNNING_APP"`, `data.qrType: "RUNNING_APP_LINK"`, `data.reusedExistingToken: true`, `data.qrText` (an HTTPS URL with an opaque `code`), `data.qrCodeDataUrl` (a `data:image/png;base64,...` image), and `data.tokenExpiresAt`. Show `qrCodeDataUrl` on a **separate screen** for the running APK's in-app scanner. A convenient Postman **Tests/Post-response** script is:

   ```javascript
   const data = pm.response.json().data;
   pm.visualizer.set('<img alt="Running enrollment QR" src="{{qr}}" />', {
     qr: data.qrCodeDataUrl
   });
   ```

   Open the response's **Visualize** tab to display the QR. A repeat of this request while the claim remains valid shows the **same** code. If it has expired or an operator explicitly sends `{ "enrollmentMode": "RUNNING_APP", "rotate": true }`, the endpoint may return HTTP `201` with `reusedExistingToken: false` and a new code. Rotation cancels the old claim and may require OTP/consent again. Do not rotate merely to redisplay. The running APK scans this QR, calls the preview API, and then follows the IMEI, permissions, OTP, consent, and activation steps above.

**Common errors:** `401` means the access token is missing/expired; `403` means the account is not an eligible dealer; `402` on registration means insufficient credits; `409 RUNNING_ENROLLMENT_DISABLED` or `RUNNING_ENROLLMENT_NOT_CONFIGURED` means a server/dealer prerequisite is missing. For Generate QR, `409 DEALER_APP_UPGRADE_REQUIRED` means the required running mode was omitted; `409 ENROLLMENT_MODE_MISMATCH` means it does not match the saved borrower mode; a linked borrower cannot generate another enrollment QR. Do not use the legacy `POST /api/distributor/enrollment/qr` route for a running borrower: it accepts Device Owner tokens only.

**Verification performed:** the backend test `test/dealerRunningQrPostmanFlow.test.js` exercised these three HTTP requests in order against isolated in-memory model fakes. It verified the response status and fields, the one-credit registration debit, running QR image/link, reuse on a second Generate QR request, and no separate running `enrollmentToken` response. This is an API-flow test, **not** a live Postman run against a configured dealer database; no real borrower or credit was created.

### Screen A — IMEI 1 and IMEI 2

- Label the fields **IMEI 1** and **IMEI 2** and explain where to find the numbers in Android settings. Do not claim the app read or verified them from the hardware. Android restricts IMEI access for an ordinary installed app; these are **borrower-entered identifiers**. [Android identifier restrictions](https://developer.android.com/about/versions/10/privacy/changes#non-resettable-device-ids).
- Accept and normalize spaces or hyphens for display, but submit 15 digits per IMEI. Validate the check digit and reject identical IMEI 1/IMEI 2 values. Provide an explicit **This phone has only one IMEI** choice; only then send `singleImeiDevice: true` and omit `imei2`.
- Keep values through normal back navigation and a short network retry. Treat backend duplicate-IMEI or claim-mismatch responses as a stop/review outcome, not a prompt to invent another identifier.
- Show a final confirmation that the borrower entered the identifiers. Mask them in ordinary post-enrollment UI and logs.

### Screen B — permissions and access

| Access | Why the running build uses it | Enrollment rule under the current backend |
| --- | --- | --- |
| Notifications | EMI reminders and command/user messages | Required: report `notificationsAllowed: true` |
| Draw over other apps | Running lock overlay and pending/upcoming EMI reminder overlay | Required: report `overlayAllowed: true`; verify with Android's overlay grant API after Settings returns. [Android overlay permission](https://developer.android.com/reference/android/Manifest.permission#SYSTEM_ALERT_WINDOW) |
| Device Admin (`force-lock`) | Optional one-time Android screen lock if this enhancement is enabled | **Not a current backend activation gate.** Active Device Admin does not grant overlay permission or Device Owner privileges. Show its true state separately. [Device Admin guide](https://developer.android.com/work/device-admin) |
| Location | Only the agreed on-demand Get location feature | Optional; let the borrower defer it. Do not collect a location until the later versioned consent records `locationConsentAccepted: true` and Android grants access; report the actual `locationGrant`. Enrollment can continue if denied. |

The scanner requests camera access at scan time. Camera access is needed to use that scanner, but is separate from the backend's final activation gates (`notificationsAllowed` and `overlayAllowed`). A complete-link fallback can allow enrollment when camera access is denied, if approved for this build.

Battery-optimization exemption, OEM Auto Start, Usage Access, Write Settings, and Accessibility are **not blanket enrollment gates** in the current backend. Do not request them merely because they appeared in the photographed sample APK. If an existing borrower-app feature truly requires one, have the senior developer approve its purpose, disclosure, and failure behavior before adding it to this screen. Verify permission state using Android APIs/native bridge; a tapped row, Activity result, or green UI icon alone is not evidence of a grant.

Implement the checklist UI in the existing app framework. Android-specific pieces—overlay grant/settings navigation, `WindowManager` overlay lifecycle, optional `DeviceAdminReceiver`/`lockNow()`, notification state, FCM wake-up, and permission rechecks—belong in the Android module or a well-tested native bridge. Keep native callbacks and Flutter/other UI state in sync if the existing app is cross-platform.

## 3. Lock overlay and borrower actions

The running `LOCK` command represents an **EMI Shield app restriction**, not Android kiosk mode. Present an interactive overlay when Android permits it. Preserve the same borrower-facing EMI details and actions as the existing lock screen. For a borrower under an **automatic dealer**, show **Pay Now** and **Temp Unlock** buttons and reuse the existing follow-on screens. Use the server's `appConfig` (`deviceControlMode`, `paymentSubmissionEnabled`, `unlockRequestEnabled`) to decide what is available; preserve the existing manual-dealer behavior instead of hardcoding it by APK type.

- **EMI Details:** reuse the current dashboard/installment data and display logic. Do not fabricate paid/overdue amounts from local time alone.
- **Pay Now:** open the existing payment QR and proof-submission flow using `GET /api/app/payment/qr` and `POST /api/app/payment/submit`. Submission waits for dealer approval; do not clear the overlay merely because proof was submitted. Apply the later server `UNLOCK` or `RELEASE_DEVICE` command.
- **Temp Unlock:** open the existing unlock-request screen using `POST /api/app/unlock-request`, typically with `reasonCategory: "temporary_emergency"`. Creating a case does not unlock. Show pending/resolved status from the existing request APIs. After an authorized operator resolution, apply `TEMP_UNLOCK` and clear the overlay only until `tempUnlockExpiresAt`.
- **Temporary-unlock expiry:** persist the server deadline locally; re-show the overlay when it passes even if FCM/network is unavailable. The backend expiry job also changes requested state to `LOCKED` and queues a `LOCK` command. On reconnection, sync and let a newer payment/full unlock/release supersede the old deadline. Do not clear the overlay for an already-expired or superseded temporary command.
- **Emergency/support access:** retain the existing emergency and support actions and avoid obscuring Android's emergency UI. An overlay may be dismissed or its permission revoked by the user, so report actual presentation rather than saying the whole phone is secured.

Device Admin can optionally call `lockNow()` when active, but it does **not** create a persistent kiosk or authorize WhatsApp/dialer/YouTube package controls. Report any one-time system-screen-lock attempt separately from `lockOverlayShown`; the borrower can still unlock Android with their own credential. [DevicePolicyManager reference](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()).

## 4. Command and sync adapter

Keep the existing FCM registration and authenticated `/api/app/device/ping`, `/device/sync`, `/device/policy`, and `/device/command/ack` flows. Treat FCM as a wake-up signal, then fetch server state and commands. Use command ID and desired policy version to avoid duplicate or out-of-order application. Acknowledge **what happened**, not merely receipt of FCM.

Do not run a Play Integrity task on a timer, app startup, foreground entry, policy sync, or an inherited `RUN_INTEGRITY_CHECK` command. The backend excludes that command from running-device delivery and sync; if one appears through a stale local queue, ignore it and continue processing supported commands.

| Command | Running APK behavior | Successful ACK evidence |
| --- | --- | --- |
| `LOCK` | Apply running restriction and show lock overlay | `appRestrictionApplied: true`, `lockOverlayShown: true`; optional screen-lock outcome separate |
| `UNLOCK` | Clear restriction and overlay; cancel a superseded temporary deadline | `appRestrictionCleared: true`, `lockOverlayCleared: true` |
| `TEMP_UNLOCK` | Clear restriction and overlay until the server expiry | Same cleared flags; retain expiry locally and check it before acting |
| `EMI_REMINDER` upcoming/pending | Present short overlay with sound, or one notification fallback | Actual `presentationResult`; if overlay shown, actual boolean `soundPlayed` |
| `EMI_REMINDER` overdue | Post notification only | `presentationResult: "NOTIFICATION_POSTED"` when posted |
| `GET_LOCATION` | Obtain a location only when enabled, consented, and granted | Actual latitude/longitude, accuracy, and capture time |
| `RELEASE_DEVICE` | Clear local restriction, finish release cleanup, stop management work | `releaseCompleted: true` only after local cleanup |
| `POLICY_UPDATE` for EMI grace | Update the running app's EMI presentation; no managed package restrictions | Applied policy version, with no Device Owner control claim |

Use `status: "failed"` and a concrete `failureReason` when a supported command cannot be carried out. Report capability changes through `POST /api/app/device/capabilities` at startup, after returning from Settings, after a grant/FCM change, and at least daily. A capability report is health data, not proof that an overlay was displayed. Reconcile on app start, process recovery, and after every FCM wake-up.

## 5. Failsafe for unsupported managed-device commands

The dealer/admin backend is configured to **not queue** dialer/caller, WhatsApp, or YouTube app-blocking/unblocking controls for `RUNNING_APP`. The admin panel must also disable factory-reset, unknown-app-install, and USB-debugging controls for running devices; their direct APIs reject this mode. The running APK must still defend against a malformed, stale, or misrouted command:

1. Inspect the persisted enrollment mode and command type before dispatch. For `RESTRICTIONS_UPDATE`, a managed `POLICY_UPDATE` carrying package restrictions, or a named per-app block/unblock action, **do not call any package-policy or Accessibility blocking code** and do not change local restriction state. Likewise, ignore both block and unblock requests represented by `SET_FACTORY_RESET_BLOCKED`, `SET_UNKNOWN_APP_INSTALL_BLOCKED`, and `SET_USB_DEBUGGING_BLOCKED`. Do not invoke `DevicePolicyManager.addUserRestriction` or claim that Device Admin applied any of those restrictions.
2. Record the command ID/type and `UNSUPPORTED_FOR_ENROLLMENT_MODE` locally, without logging secrets. Discard it from local execution so the app cannot repeatedly attempt an impossible control. Continue processing unrelated valid commands.
3. **Do not send `status: "acknowledged"` for an ignored control.** That would falsely tell the backend the app restriction was applied. If an existing unsupported command has a real `commandId`, send `POST /api/app/device/command/ack` with `{ "commandId": "...", "status": "failed", "failureReason": "UNSUPPORTED_FOR_ENROLLMENT_MODE" }`. The backend records a terminal failed command and retains the audit trail without changing device state. A repeated matching failed ACK is idempotent.
4. The backend still blocks owner-only command creation and filters those commands from running sync/FCM. This failed-ACK path is only for a stale or incorrectly routed command that the APK already encountered. Do not invent a command ID. A successful ACK or a different failure reason for an unsupported running command still receives `409 UNSUPPORTED_FOR_ENROLLMENT_MODE`.

Other Device Owner-only commands (wipe, manual override, reprovision, testing) follow the same **ignore locally and never success-ACK** rule if they are somehow encountered. The backend should remain the primary rejection layer.

## 6. Build sequence and acceptance tests

| Phase | Developer work | Acceptance evidence |
| --- | --- | --- |
| 1. Variant and shared-code audit | Create separate running package/build configuration; identify reusable screens/services and isolate owner enforcement behind an interface | Owner APK builds and follows its current QR/kiosk path; running APK installs on an already-set-up phone |
| 2. Enrollment | Scan the dealer's running QR in the installed app, preview it, then show IMEI and permissions, reuse OTP/consent, and perform final running registration and retry | Owner/malformed/expired/rotated QR and consent fail safely; one linked device; no device before Finish |
| 3. Overlay and actions | Native overlay adapter with EMI details, Pay Now and Temp Unlock routes, grant recheck, local expiry | Automatic-dealer screen matches existing payment/request flows; MANUAL follows server config; temporary access ends at deadline |
| 4. Commands and health | FCM wake-up/sync reducer, truthful ACK, capability reporting, offline recovery, unsupported-command failsafe | Duplicate/out-of-order commands do not reapply; owner-only commands never execute or success-ACK |
| 5. Regression and release | Test Android/OEM versions, app restart, force-stop, reboot, grant revoke, FCM delay, payment, release, and separate update channel | Existing owner APK has no regression; running device is described as app-controlled, with actual overlay outcome visible to operators |

Minimum physical-device scenarios: the borrower list shows **Generate QR** only for unlinked borrowers and displays the correct QR from saved `enrollmentMode`; repeat Generate QR reuses the current code while explicit rotation invalidates it; scanner rejects an owner QR and malformed, expired, or rotated running QR; preview appears before IMEI and permissions; camera denied with an approved complete-link fallback; dual-IMEI and single-IMEI enrollment; denied/revoked notification and overlay grants; optional Device Admin denied/revoked; automatic Pay Now submission followed by dealer approval; Temp Unlock case pending, approved, expired while offline, and superseded by payment; manual-dealer existing behavior; upcoming overlay+sound versus overdue notification; location denied/granted; release; duplicate FCM; stale managed restriction command and each of `SET_FACTORY_RESET_BLOCKED`, `SET_UNKNOWN_APP_INSTALL_BLOCKED`, and `SET_USB_DEBUGGING_BLOCKED` injected in a test environment. Verify that each is ignored without a success ACK or change to local state, while the next supported command still executes. Use a test backend and test borrowers; do not use real customer records for this suite.

Verify that running enrollment, app startup, foreground return, daily work, and policy sync make **no** `/api/app/integrity/*` request. A stale `RUN_INTEGRITY_CHECK` must not start an Integrity flow; an unexpected `409 UNSUPPORTED_FOR_ENROLLMENT_MODE` from one of those routes is terminal for that request. Repeat the existing Play Integrity tests on the QR-provisioned build.

Other than the running enrollment, overlay, and unsupported-command handling described here, retain the current borrower app behavior and API contracts. Escalate any source-code or product-flow conflict to the senior developer with the current behavior, proposed running behavior, and the backend response that creates the conflict.
