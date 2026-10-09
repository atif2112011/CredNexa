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

Create a **running-device build variant** from the current borrower app source. Reuse its visual design, OTP and consent screens, borrower session, EMI dashboard, installments, payment, unlock-request, support, update, and notification flows. Keep the QR-provisioned build working as it does now. The running variant needs its own application/package ID, signing and release configuration, Firebase/FCM configuration, app-link handling, update channel, and Play Integrity package registration because the backend identifies its package separately through `RUNNING_ENROLLMENT_PACKAGE_NAME`.

The two variants may share most code, but enforcement must be selected by the **persisted enrollment mode** rather than by a screen assumption:

| Area | Existing QR-provisioned build | Running-device build |
| --- | --- | --- |
| Entry | Android provisioning QR during new-device setup | Install on an already-running phone; scan the dealer's running-app QR inside the app |
| Enrollment | Existing Device Owner registration | Same OTP/consent account flow, plus manual IMEI and permission screens before running activation |
| Lock presentation | Existing managed kiosk/lock-task flow | App-controlled overlay with borrower actions |
| Temporary unlock | Existing timed flow | Same case/approval and `TEMP_UNLOCK` state; clear overlay until expiry, then restore it |
| Managed per-app controls | Existing supported dialer/WhatsApp/YouTube restrictions | Never apply these restrictions; handle an unexpected command safely |
| EMI/payment/support | Existing borrower behavior | Reuse existing screens, APIs, validation, and server `appConfig` switches |

Do not copy Device Owner provisioning, kiosk setup, package restriction, factory-reset blocking, unknown-source install blocking, USB-debugging blocking, wipe, or manual-override logic into the running variant. Ordinary Device Admin activation does not grant these Device Owner controls. Keep shared components where the outcome is genuinely identical; keep enforcement adapters separate so an owner policy cannot be executed on a running installation by mistake.

## 2. Running enrollment journey

1. Install and open the running APK. Scan the dealer's **running-device QR in the app**. It is an app link containing an opaque `code`; it is not the Android Device Owner provisioning QR. Call `POST /api/app/running-enrollment/preview` with that code as `enrollmentToken` and show the verified lender/borrower preview.
2. Reuse the existing OTP, versioned consent, and borrower JWT flow. Fetch terms with `POST /api/app/consent/terms` and the scanned token so the running-specific consent is shown. Bind OTP and consent to that same token. Do not silently fall back to managed-device terms.
3. Show **new screen A: IMEI entry**. Collect IMEI 1 and IMEI 2 manually, or the explicit single-IMEI exception. Continue only when the entered values pass local validation; the backend validates again at registration.
4. Show **new screen B: permissions and access**. Explain each requested access, open the relevant Android permission/settings screen from its row, recheck the actual grant when the borrower returns, and show its current status. Notification and overlay access must be granted before final activation under the current backend contract.
5. Only when the borrower taps **Finish enrollment**, call the existing authenticated `POST /api/app/device/register` with the running QR secret, stable body `activationRequestId`, `requirementsVersion`, `imei`, `imei2` or `singleImeiDevice`, current capabilities, FCM token, and device/app information. The backend creates the linked device at this step. Do not mark onboarding complete after OTP or permission clicks alone.
6. Save the returned linked device/session and call `/api/app/device/sync`. Restore this flow after process death or network failure while the QR remains valid. Reuse the **same** `activationRequestId` for an uncertain registration retry; a new ID after linkage is a conflict.

The existing bearer JWT is used on protected `/api/app` requests. No installation-signature headers are part of the current backend contract. Never log the running QR secret, OTP, JWT, or full IMEIs.

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
| Location | Only the agreed on-demand Get location feature | Optional; request with separate consent, report the actual `locationGrant`, and permit enrollment if denied |
| Camera | Scan QR, only if the chosen scanner needs camera access | Request when scanning; provide a suitable fallback if denied |

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
3. **Do not send `status: "acknowledged"` for an ignored control.** That would falsely tell the backend the app restriction was applied. The desired acknowledgement is a terminal `status: "failed"` with `failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE"` if the backend accepts that report.
4. **Current contract conflict:** the backend presently filters these commands from running sync/FCM and rejects even a direct `/api/app/device/command/ack` for an unsupported running command with HTTP `409 UNSUPPORTED_FOR_ENROLLMENT_MODE`. Until the senior developer decides whether to add a failed-ACK exception, treat that `409` as terminal, keep the local ignored-command diagnostic, and do not retry forever or claim success. This is a server/app integration decision, not an app-only workaround.

Other Device Owner-only commands (wipe, manual override, reprovision, testing) follow the same **ignore locally and never success-ACK** rule if they are somehow encountered. The backend should remain the primary rejection layer.

## 6. Build sequence and acceptance tests

| Phase | Developer work | Acceptance evidence |
| --- | --- | --- |
| 1. Variant and shared-code audit | Create separate running package/build configuration; identify reusable screens/services and isolate owner enforcement behind an interface | Owner APK builds and follows its current QR/kiosk path; running APK installs on an already-set-up phone |
| 2. Enrollment | Add in-app running QR entry, existing OTP/consent reuse, IMEI screen, permissions screen, final running registration and retry | Wrong/expired QR and consent fail safely; one linked device; no device before Finish |
| 3. Overlay and actions | Native overlay adapter with EMI details, Pay Now and Temp Unlock routes, grant recheck, local expiry | Automatic-dealer screen matches existing payment/request flows; MANUAL follows server config; temporary access ends at deadline |
| 4. Commands and health | FCM wake-up/sync reducer, truthful ACK, capability reporting, offline recovery, unsupported-command failsafe | Duplicate/out-of-order commands do not reapply; owner-only commands never execute or success-ACK |
| 5. Regression and release | Test Android/OEM versions, app restart, force-stop, reboot, grant revoke, FCM delay, payment, release, and separate update channel | Existing owner APK has no regression; running device is described as app-controlled, with actual overlay outcome visible to operators |

Minimum physical-device scenarios: dual-IMEI and single-IMEI enrollment; denied/revoked notification and overlay grants; optional Device Admin denied/revoked; automatic Pay Now submission followed by dealer approval; Temp Unlock case pending, approved, expired while offline, and superseded by payment; manual-dealer existing behavior; upcoming overlay+sound versus overdue notification; location denied/granted; release; duplicate FCM; stale managed restriction command and each of `SET_FACTORY_RESET_BLOCKED`, `SET_UNKNOWN_APP_INSTALL_BLOCKED`, and `SET_USB_DEBUGGING_BLOCKED` injected in a test environment. Verify that each is ignored without a success ACK or change to local state, while the next supported command still executes. Use a test backend and test borrowers; do not use real customer records for this suite.

## 7. Questions for the senior developer before sign-off

1. **Unsupported-command acknowledgement:** Should the backend accept a `status: "failed"` ACK for an unexpected managed restriction command on a running device, or is HTTP 409 plus local ignored-command telemetry the agreed terminal outcome? The current API rejects that ACK, so the requested “acknowledge and ignore” behavior needs this decision.
2. **Device Admin requirement:** Is Device Admin activation required for product launch, or only an optional one-time `lockNow()` enhancement? The current backend requires notification and overlay access for activation and treats Device Admin as optional. Changing that gate needs coordinated consent, UI, API, and test updates.
3. **Existing screen parity:** Confirm exactly which Pay Now, Temp Unlock, EMI-detail, emergency, and support elements the current managed lock screen shows for `EMI_AUTOMATED` and `MANUAL`, then reuse those rules in the running overlay. Resolve any mismatch with the senior developer rather than inventing a new tenant-mode rule in the APK.

Other than the running enrollment, overlay, and unsupported-command handling described here, retain the current borrower app behavior and API contracts. Escalate any source-code or product-flow conflict to the senior developer with the current behavior, proposed running behavior, and the backend response that creates the conflict.
