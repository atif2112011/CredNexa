# EMI Shield master plan: new and running-device enrollment

**Prepared:** 8 October 2026; reconciled with timed running-overlay unlock on 9 October 2026  
**Status:** Backend API implementation is in the workspace; dealer UI, admin UI, the new borrower APK, high-volume cron hardening, live database migration, and physical-device validation remain pending.
**Audience:** Backend, Android borrower app, dealer app, super-admin portal, QA, and product teams.

This is the execution plan for adding a separately installed borrower app on an already-running Android phone while retaining the existing Device Owner QR flow. The [running APK backend API contract](running%20apk%20backend%20api%20contract.md) gives the borrower app team endpoint requests and responses. The [dual-mode technical plan](dual_mode_enrollment_and_controls_plan.md) contains the detailed API audit and cron findings; the [APK analysis](running_device_apk_analysis_and_architecture.md) contains the static reverse-engineering evidence and [photographed permission checklist](running_device_apk_analysis_and_architecture.md#photographed-checklist-and-emi-shield-enrollment-decision). The photographed app and its bundled code are evidence, not instructions for EMI Shield.

## Decisions and boundaries

| Decision | Contract |
|---|---|
| Enrollment type | `DEVICE_OWNER_QR` (New device) or `RUNNING_APP` (Running device); independent of tenant payment-control mode. |
| Default | Add Borrower preselects **New device**. An omitted API field also means `DEVICE_OWNER_QR`, preserving older dealer clients. |
| Enrollment handoff | Save `enrollmentMode` when adding the borrower. In the dealer borrower list, show **Generate QR** only while the borrower is unlinked; on click, request the QR for the saved mode. A new-device QR is scanned during Android setup; a running QR is scanned inside the separately installed running borrower app. |
| Borrower and credit | Reuse one borrower, EMI schedule, tenant/lender association, consent, device inventory, command history, and audit history. Keep the existing one-credit charge when the borrower is created; reissuing a QR does not charge again. |
| Identifiers | Running-app borrower manually enters IMEI 1 and IMEI 2 where present. Store in existing `Device.imei`/`imei2` fields, mark them borrower-entered, and do not treat them as verified device identity. |
| States | Keep current `Device.state` and `DeviceCommand.status` enums. Enrollment readiness, capability loss, and applied-command outcome are derived fields, not new lifecycle states. |
| Running controls | Dealer and admin may offer **Lock, Unlock, Send reminder, Get location, Release**, plus the existing **Temporary unlock** action and borrower case resolution where authorized. Reject managed per-app and Device Owner controls in the backend. |
| Temporary unlock | Reuse the existing `TEMP_UNLOCK` state, borrower unlock-request flow, operator endpoints, and expiry job. On a running phone, clear the app lock overlay until `tempUnlockExpiresAt`, then restore it through the existing expiry `LOCK` command and a local deadline. On an owner phone, retain the kiosk behavior. The running app's lock overlay shows **Pay Now** and **Temp Unlock** buttons and the same payment/unlock-request screens and flow for an automatic dealer. |
| Reminder presentation | Overdue reminder: notification only. Pending/upcoming: existing managed-device kiosk with sound; running app uses an overlay with sound and one notification fallback if the overlay cannot be presented. |
| Tenant `MANUAL` mode | Keep automatic upcoming/overdue reminders and readable EMI details/payment history. Disable borrower payment submission and scheduled EMI grace/final lock. Critical-security-risk auto-lock remains a separate `riskRules` policy for either tenant mode. |
| EMI dates | Keep existing UTC calendar-day calculations for both enrollment types. Automatic overdue notifications retain the current DPD/grace-window timing, every 12 hours during that window. |
| Assurance | A running app is lower assurance. Its `LOCK` requests an app-controlled lock overlay and may call `DevicePolicyManager.lockNow()` once when Device Admin is active; it cannot claim durable Device Owner kiosk control. FCM sent, `Device.state=LOCKED`, lock-overlay presentation, and a one-time screen-lock call are distinct outcomes. |

## Newer Running Device Provisioning

### Dealer starts the correct enrollment

1. Dealer opens **Add Borrower** and enters the existing borrower, loan, and EMI fields. Add **Enrollment type** with **New device** selected initially and **Running device** available. Show a short explanation of the two setup paths before submission.
2. `POST /api/distributor/users/register` validates the optional `enrollmentMode`, defaults omission to `DEVICE_OWNER_QR`, and creates `User`, `EmiSchedule`, the first mode-bound `EnrollmentToken`, credit-ledger entry, and audit record in the existing registration transaction. Unknown values return HTTP `400`.
3. The saved `User.enrollmentMode` determines all later QR regeneration. The same borrower cannot accidentally receive a QR of the other type because the dealer changed a UI selection after registration.
4. In the dealer app's borrower list, show **Generate QR** for a borrower who is not linked to a device. The button reads the already-saved `User.enrollmentMode`; it does not ask the dealer to choose a type again. For a new device, display the existing Android setup/provisioning QR. For a running device, request the running QR from the borrower-scoped route and display its `qrCodeDataUrl` for the installed running APK to scan. The running QR contains an opaque, expiring code, never provisioning extras, borrower PII, EMI amount, or a server credential.

### Borrower completes running-app enrollment

1. Borrower downloads and installs the separately signed running borrower APK on the already-set-up phone and opens it. The app opens its QR scanner and requests camera access at scan time. It scans the **running QR** displayed by the dealer's borrower-list Generate QR action. The scanner parses the HTTPS QR text locally, extracts the opaque `code`, and rejects an owner provisioning QR or malformed input. The app sends the code to the rate-limited preview endpoint and displays the server-verified lender, masked borrower/loan details, expiry, and running-device limitations. Preview does not consume the code or create a device.
2. The next screen collects borrower-entered **IMEI 1** and **IMEI 2** as shown in Android settings. Permit an absent second value only for a genuine single-IMEI handset. Normalize and validate values, check duplicates for review, and label the data `borrower_entered`. Typed IMEIs do not authenticate the installation.
3. The following screen is a feature-specific permission checklist. Require notification access for reminders where Android requires it and overlay access for the running lock overlay and pending/upcoming reminder presentation. Device Admin with `force-lock` is optional for a separate one-time system screen-lock action and does not block overlay enrollment. Location is optional, subject to separate borrower consent and tenant enablement. Camera is used for the initial QR scanner but is separate from the final backend activation gates. Battery exemptions, Usage Access, Write Settings, Accessibility, and OEM Auto Start are **not blanket enrollment gates**. Each settings button opens Android's own screen; on return, recheck the actual grant. The photographed checklist's green/red icons are not proof of platform grant.
4. Borrower completes the existing OTP verification and accepts a versioned **running-app-specific** consent. Bind OTP session and consent evidence to the exact link code, borrower, tenant, and mode. Do not reuse consent wording that promises Device Owner enforcement.
5. Recheck required grants immediately before activation because the backend requires a fresh capability observation (within five minutes). The earlier permissions screen alone may have become stale during OTP/consent.
6. **Finish enrollment** becomes available only when the server-defined required capabilities are currently present. On OK, the app submits the exact token, borrower JWT from OTP/consent, manually entered IMEIs, a stable `activationRequestId` in the JSON body, FCM token, requirements version, and fresh capability snapshot. The backend atomically consumes the token, creates the `RUNNING_APP` device in existing state `ACTIVE`, and links `User.isDeviceLinked`/`linkedDeviceId`. The same request ID supports a lost-response retry; a different ID after linkage conflicts. No installation key proof is required.
7. Before that final transaction there is **no enrolled device**, even if OTP and consent succeeded. Dealer status comes from `User`/`EnrollmentToken` and safe derived progress. A closed app, denied required grant, or failed network request leaves enrollment resumable under the valid token; it does not expose device controls.
8. After activation, the app uses the existing borrower JWT, receives only supported commands by sync, and acknowledges what it actually performed. Recheck capability changes over time. A revoked grant reduces `allowedActions` and may make a command fail or remain unknown; it does not silently change the historical enrollment type.

### QR reissue and replacement

Reuse the existing borrower-scoped `POST /api/distributor/users/:userId/enrollment/qr` route. For an owner borrower, an empty body retains the present response and reuse/expiry behavior. For a running borrower, a compatible dealer app sends `{ "enrollmentMode": "RUNNING_APP" }` to show/reuse a valid QR; `{ "enrollmentMode": "RUNNING_APP", "rotate": true }` cancels the unused code and issues a new same-mode code atomically. The request mode is a guard; `User.enrollmentMode` and token mode are authoritative. A no-mode old-client call for a running borrower returns `409 DEALER_APP_UPGRADE_REQUIRED`; an explicit mismatch returns `409 ENROLLMENT_MODE_MISMATCH`. Keep the token-based `POST /api/distributor/enrollment/qr` owner-only. **No new QR regeneration endpoint is needed.**

Show current QR and Regenerate QR as separate dealer actions because rotation invalidates a code the borrower may already be using. A pre-activation enrollment-type change needs a separate audited cancel-and-switch flow. A linked phone needs a controlled replacement/rebind flow that clears the old FCM token, pending commands, and activation claim, and invalidates old borrower sessions where supported.

## Changes in APIs

### Database and migration

| Record | Additive change | Source and validation rule |
|---|---|---|
| `User` | `enrollmentMode` enum, default `DEVICE_OWNER_QR` | Set from validated Add Borrower request. Keep it even if QR expires so regeneration has a durable mode source. |
| `EnrollmentToken` | Same `enrollmentMode`; hash for running-token verification and encrypted QR secret for authorized re-display | Copy mode from `User`. Reuse current `userId`, `tenantId`, expiry, consumed/cancelled, and regeneration-chain fields. One usable claim per borrower/tenant. Encrypt the recoverable secret with a managed key because the dealer can reopen an active QR; never store it as plaintext or expose it in list/detail/audit data. |
| `Device` | Same `enrollmentMode`; activation retry ID; timestamped capability snapshot; identifier provenance | Copy mode from the consumed token after checking `User` agreement. Keep required `imei`, optional `imei2`, existing states, policy versions, location, and FCM fields. Running `deviceOwnerStatus` is never treated as confirmed. The retry ID is not an authenticator. |
| Consent/version records | Mode-scoped version and accepted evidence | Owner terms remain valid; publish/select current running terms separately and retain rendered hash, OTP relation, time, and accepted mode. |
| Command/audit records | Mode and observed outcome in existing payload/ack/audit fields | Distinguish requested state, queued/sent FCM, app acknowledgement, running lock-overlay presentation, optional system screen-lock call, reminder display/sound, location fix, and release cleanup. |

Deploy additive schema first, backfill existing `User`, `EnrollmentToken`, and `Device` rows to owner mode in bounded batches, then enable running enrollment by tenant feature flag. Include pending/expired tokens and unlinked borrowers in the backfill. Resolve duplicate unused tokens before adding a uniqueness guard and mode/list indexes. Do not change the meaning of legacy states, command statuses, or current credit ledger entries. Existing owner app/API responses remain valid during migration.

### Endpoint contract

Paths use the current `/api` prefix; `/api/tenant` aliases dealer/distributor behavior where already supported. New path names are proposals except the existing routes named below.

| Consumer/step | Endpoint work | Compatibility and safety |
|---|---|---|
| Dealer Add Borrower | **Existing** `POST /api/distributor/users/register`: optional `enrollmentMode`, default owner; persist on `User`/token with borrower, EMI schedule, and one credit debit. | Preserve old owner fields and response envelope. Running response adds safe enrollment ID/mode/expiry; do not leak its secret in later list/detail responses. |
| QR | **Existing** token-based `/api/distributor/enrollment/qr` remains owner-only. **Existing** borrower-scoped `/api/distributor/users/:userId/enrollment/qr` becomes mode-aware with explicit running-mode guard and optional `rotate: true`. | Owner QR keeps `qrPayload`, `qrCodeDataUrl`, `enrollmentToken`, `tokenExpiresAt`. Running QR returns app-link text, PNG, expiry, mode/type; no `PROVISIONING_*` extras or separate raw/old token field. Only this authorized QR response decrypts/reveals the active secret; preview/activation verifies its hash. |
| Running preview | **New** `POST /api/app/running-enrollment/preview` with secret in body. | Rate-limit; show only safe lender/borrower preview, expiry, required capabilities and requirements version. No token consumption or URL/log secret. |
| OTP and consent | Extend existing app consent initiate/resend/verify/terms/accept routes with exact running-token, session, tenant, mode, and consent-version binding. | Retain owner request/response shape and next-step values. Reject a token of the other mode and replayed or mismatched consent. |
| Authentication | Reuse the existing borrower OTP/consent JWT. There is no running-specific installation challenge or per-request signature. | Exact running QR, OTP/consent, JWT, IMEIs, and capability checks protect activation; a stolen valid JWT can call app APIs, which is part of this mode's lower assurance. |
| Final activation | **Existing** `POST /api/app/device/register` gains strict running branch with exact token, body `activationRequestId`, `imei`/`imei2`, FCM, requirements version, and capability snapshot. | Atomically consume token, create device, link user. Owner branch remains compatible; never let a running token use owner fallback. Do not create Device Owner emergency override tokens for running devices. |
| Dealer enrollment status | **New** `GET /api/distributor/enrollments/:enrollmentId/status`; retain old token-based owner status temporarily. | Return derived progress, saved mode, expiry, linked device ID, readiness, masked IMEIs; never echo a running secret. |
| Borrower/device lists and detail | Extend existing dealer `/users`, `/devices`, device/user details, and admin `/devices` with additive mode, identifier source, capability age, last contact/outcome, `allowedActions`, and optional `enrollmentMode` filter. | Default All includes both modes. Pending running borrowers appear before `Device` creation. Preserve search, tenant scope, pagination, and old fields. |
| App lifecycle | Extend existing app policy, ping, sync, command ack, login/refresh, and update/check flows. Add `POST /api/app/device/capabilities` for later grant/FCM/build changes. Keep Play Integrity endpoints owner-only. | Resolve `linkedDeviceId` from the borrower JWT; filter commands by mode at queue, delivery, and sync. Keep separate package/signing/update rules for both APKs. |
| Dealer/admin actions | Reuse dealer lock, unlock, user-scoped reminders, location; reuse admin lock, unlock, location, release. Add settled-only dealer release and a production admin EMI reminder route with explicit `OVERDUE` or `UPCOMING`. | A shared service checks actor scope, lender delegation, consent, settlement, release state, device mode, command allowlist, and current capability **before** state mutation. Unsupported running actions return `409 UNSUPPORTED_FOR_ENROLLMENT_MODE` with no command. |
| Admin cases, commands, risk lists | Add device mode, eligible action summary, and observed result to actionable list/detail responses. | Running escalation may use the existing full or temporary unlock resolution. Critical-risk auto-lock remains visibly separate from EMI mode. |

Authorization must distinguish permission to **register/distribute** from lender authority to **control** a financed phone. An outlet may act for a lender only through an explicit, scoped delegation. All supported running controls require the same tenant/lender checks in dealer and admin paths; UI hiding never replaces server rejection. Protect the existing unauthenticated testing-token route before running enrollment is enabled. See the [full API audit](dual_mode_enrollment_and_controls_plan.md#61-api-audit-against-the-exact-borrower-journey).

### Commands, reminders, states, and scheduled work

| Action/condition | New managed device | Running device |
|---|---|---|
| Lock | Existing owner policy/kiosk enforcement. | App-controlled lock overlay when available, with separate acknowledgement of overlay presentation and optional one-time Device Admin `lockNow()` call; borrower can still unlock Android or disable the app's access. |
| Unlock | Existing managed unlock and temporary unlock. | Full unlock clears the app restriction and overlay. Temporary unlock clears the overlay until the saved expiry, after which the overlay is requested again; neither action unlocks Android's credential screen. |
| Overdue reminder | Notification only. | Notification only. |
| Pending/upcoming reminder | Kiosk screen with sound. | Overlay with sound when possible, one notification fallback. Prevent duplicate companion notification. |
| Get location | Existing supported collection path. | Only when consent, distribution eligibility, grant, and current app capability allow it; report actual fix time/accuracy. |
| Release | Current settled-device owner release. | Settled-only `RELEASE_DEVICE` makes the running app clear local EMI state/binding and acknowledge; do not claim Device Owner removal. |

The shared EMI cron serves both enrollment types. `EMI_AUTOMATED` retains grace/final lock according to `lockOnGraceExpiry`; `MANUAL` still receives scheduled upcoming and overdue reminders but no scheduled EMI grace/final lock. Risk-triggered critical auto-lock is governed separately by `riskRules`. Keep UTC due-day math and the existing overdue reminder window. Do not start another running-only scheduler.

The backend now updates EMI financial overdue/DPD data even before a device is linked and scans schedules in ordered pages beyond 500. Before rollout, make reminder/lock creation idempotent and state+command transitions atomic across concurrent workers, atomically claim FCM deliveries, and report retry exhaustion or stale unacknowledged commands honestly. The shared temporary-unlock expiry includes running devices; manual-override-token renewal excludes them. Reject unknown/owner-only payloads at queue, FCM delivery, and app sync. Keep `Device.state=LOCKED` as a **requested policy state**, paired with command delivery and applied evidence; never render it alone as proof of a locked running phone. See the [cron review](dual_mode_enrollment_and_controls_plan.md#9-cron-system-review-for-running-devices).

## Changes in Dealer App

The dealer app source is outside this repository; this section is its implementation contract. Use saved `User.enrollmentMode` for pending enrollments and saved `Device.enrollmentMode` for linked devices. Use backend `allowedActions` and unavailable reasons for controls.

| Screen | Required behavior |
|---|---|
| Add Borrower | Add **Enrollment type**, New device preselected. Retain selection on validation/network failure; submit with existing borrower fields. Explain setup difference and keep one-credit pricing. |
| QR/status | On the existing borrower-list **Generate QR** action, display the QR returned for the borrower's saved mode. Owner: Android setup QR and provisioning instructions. Running: running-app QR and install → scan → IMEI → permissions → OTP/consent instructions. Show expiry, Show current QR, Regenerate QR (`rotate: true` warning), cancel, and derived progress. Do not alter saved mode from this action. |
| Borrower list/detail | Keep All as default, add New/Running filter and badge even before a device exists; show **Generate QR** only for unlinked borrowers. The action uses stored `User.enrollmentMode`: the owner request preserves its existing body/response; the running request uses `{ "enrollmentMode": "RUNNING_APP" }` on `POST /api/distributor/users/:userId/enrollment/qr`. Show activation status, safe expiry, linked device, EMI summary, and consent. Do not expose the running code in ordinary rows. |
| Device list/detail | Keep both in the same fleet. Add mode/assurance badge, masked borrower-entered IMEI marker, current contact, permission health, requested state, latest command result, and eligible actions. A red/grant-loss indicator is not automatically “tampering.” |
| Actions | Offer eligible running **Lock, Unlock, Send reminder, Get location, Release, Temporary unlock** and case resolution. Hide managed per-app lock/unlock controls for WhatsApp, caller/dialer, and YouTube, plus wipe/reprovision, manual override, and testing. In the admin device detail, show factory-reset, USB-debugging, and unknown-app-install controls as disabled with a Device Owner explanation; the backend rejects direct calls. Disabled supported actions show `allowedActions.reason`. Lock wording explains the lower-assurance overlay and any separate one-time screen-lock result. |
| Reminder choice | Keep **Overdue EMI** (notification) distinct from **Pending/upcoming EMI** (running overlay+sound with one fallback notification). Show delivery versus actual display/sound outcome. |
| Location/release | Location shows purpose/consent, grant availability, last fix age and accuracy. Release requires settled installments, explicit confirmation, and a pending/retry result if the app is offline. |

## Changes in Admin Panel

The checked-in [super-admin portal](../super-admin-portal/src) has **no Add Borrower form, borrower list page, or admin borrower-creation route**. Do not create a parallel admin registration flow solely for this rollout. If one is introduced later, it must use the same Enrollment type default, registration service, tenant/lender scope, and credit/consent rules.

1. Update [`devices/page.tsx`](<../super-admin-portal/src/app/(dashboard)/devices/page.tsx>) to keep an All default and add New managed/Running filter, type badge, masked IMEI provenance, last contact, and separate requested-state versus applied-result columns. Do not remove existing tenant/borrower/search/pagination fields.
2. Update [`devices/[deviceId]/page.tsx`](<../super-admin-portal/src/app/(dashboard)/devices/[deviceId]/page.tsx>) and action panels to show eligible running controls, including temporary unlock, with grant freshness and mode-specific copy. Managed per-app restrictions, owner-only testing, and manual override tokens must not be fetched or rendered for running devices. Render factory-reset, USB-debugging, and unknown-app-install controls as disabled with a Device Owner explanation. Release and location remain conditional.
3. Add the production admin EMI reminder control with separate Overdue and Pending/upcoming choices. The admin does not currently have the normal reminder action outside testing surfaces.
4. Update escalation cases: the existing **Temporary unlock** resolution remains available for a running device. Its command clears the overlay until expiry; the existing expiry job queues a relock. Include mode and allowed actions in case data and explain overlay versus kiosk enforcement.
5. Add mode and truthful outcome copy to command and risk tables. The current command table describes `LOCK` and `RELEASE_DEVICE` as managed-device operations; running rows need app-restriction/screen-lock and local-release descriptions. Keep critical-risk auto-lock separate from EMI manual/automatic mode.
6. Keep existing combined dashboard/tenant/partner totals for compatibility; add an optional mode breakdown when the backend provides one. There is no current admin borrower table that needs editing.

## Phased Implementation

| Phase | Build work | Exit gate |
|---|---|---|
| **0. Confirm product/security contract** | Finalize lender/dealer authority, running-lock and release wording, location/distribution eligibility, consent, package identity, and feature flag. Close public testing-token access. | Written action semantics, consent text, location decision, and no public test-token path. |
| **1. Additive backend foundation** | Add/backfill `enrollmentMode` on User/token/device; consent mode; indexes; identifier provenance; activation retry ID and capability fields. Keep old contracts and states. | Existing owner registration, QR, OTP, device sync, payment, and release tests pass with missing mode. |
| **2. QR and running enrollment APIs** | Extend Add Borrower; mode-aware borrower QR reuse/rotation; running preview; OTP/consent JWT; final idempotent device registration; safe status endpoint. | Wrong/replayed/expired/cross-mode token fails; one credit and one linked device; no device before final OK. |
| **3. Separate running borrower APK** | In-app running QR scanner and preview first, IMEI entry second, named permission checklist third, then OTP/consent, secure JWT storage, authenticated sync/ack, reminders, Pay Now and Temp Unlock overlay flows for automatic dealers, grant-health reporting, and release cleanup. | Physical phone completes enrollment; timed overlay clearing and relock work across app restart/offline periods. |
| **4. Shared control and cron hardening** | Central action authorization/allowlist, owner-only producer gates, running ack semantics, FCM/deduplication/idempotency, EMI pagination/accounting fixes, mode-aware updates, and owner-only Play Integrity. | Every prohibited running endpoint/job rejects without mutation; owner behavior still works; reminders and locks have auditable outcomes. |
| **5. Dealer and admin UI** | Dealer form/QR/lists/detail/actions; admin fleet/detail, reminders, case dialog, command/risk tables, and conditional panels. | Both types visible in default lists; only eligible controls displayed; direct API denial agrees with UI; no false “phone locked” claim. |
| **6. Pilot and rollout** | Enable per tenant, monitor activation completion, grant loss, FCM/ack delay, false-lock reports, location failure, and release retry across Android/OEM/install channels. Keep ongoing sync/release enabled if new running enrollment is switched off. | Pilot meets measured thresholds, old QR path has no regression, and already-enrolled borrowers are not stranded by rollback. |

## Test Cases

Use one owner device and one running device under both `EMI_AUTOMATED` and `MANUAL` tenants. Verify backend responses, dealer UI, admin UI, device behavior, command/FCM records, audit logs, and credit ledger where applicable.

For a running-device-only, step-by-step backend rehearsal of automatic and manual payment journeys, use [dry run.md](dry%20run.md).

| ID | Scenario | Expected result |
|---|---|---|
| E01 | Older dealer request omits `enrollmentMode`; Add Borrower form initial selection | Owner mode is stored; new-device QR and existing response remain valid. |
| E02 | Invalid or changed enrollment type in registration/QR request | Invalid enum returns `400`; QR request disagreeing with stored mode returns `409`, with no mutation. |
| E03 | Register running borrower, reopen QR after dealer reload, then rotate | Authorized re-display decrypts the same active QR; database/list/logs contain no running plaintext secret; one credit debit; rotation invalidates the old unused token atomically. |
| E04 | Old dealer build requests QR for running borrower without mode | Stable `409 DEALER_APP_UPGRADE_REQUIRED`; no owner provisioning QR is returned. |
| E05 | Owner token submitted to running app or running link code sent to owner app | Rejected before consent/device creation; no cross-mode fallback. |
| E06 | Expired, cancelled, consumed, wrong-tenant, wrong-user, or concurrently claimed running token | Exactly one valid activation can complete; replay and other claims fail. |
| E07 | Borrower abandons enrollment after OTP/consent or denies a required grant | No `Device` or `isDeviceLinked` before final OK; dealer sees safe pending status; valid session can resume and recheck grants. |
| E08 | Dual-IMEI and genuine single-IMEI phones | Existing fields used; two values required when present, distinct/validated and marked borrower-entered; absent second value is explicit for single-IMEI case. |
| E09 | Duplicate IMEI, typed IMEI copied to another phone, stolen borrower JWT | Duplicate flagged or rejected per policy; typed IMEI alone cannot authorize device sync/ack. A valid stolen JWT can call app APIs, so this risk is monitored and documented. |
| E10 | Final OK repeated, concurrent, or sent with a different retry ID | Identical `activationRequestId` returns original device; different ID conflicts; token consumed once; one linked device. |
| E11 | Grant loss after activation: Device Admin, overlay, notifications, location | Capability snapshot and `allowedActions` update; actions fail/fallback truthfully; enrollment history remains unchanged. |
| E12 | Legacy owner API fixtures and old database records | Old QR/registration/OTP/consent/commands still work; backfilled records display New managed. |
| C01 | Dealer/admin lock and unlock on running app, online/offline | Command and requested state appear; lock-overlay presentation and one-time screen-lock outcome are separate; ordinary Unlock dismisses the overlay; offline/sent is not shown as applied. |
| C02 | Call running owner-only routes directly: per-app restrictions, security controls, testing, manual override, wipe/reprovision | `409 UNSUPPORTED_FOR_ENROLLMENT_MODE`; no state/version/EMI/command/FCM mutation. Running temporary unlock succeeds when authorized and remains subject to expiry. |
| C03 | Borrower with `MANUAL` tenant mode | Automatic upcoming/overdue reminders occur; no EMI grace/final auto-lock; EMI details/history visible; borrower payment submission disabled. |
| C04 | Critical security risk under `MANUAL` with risk auto-lock enabled | Separate risk-policy lock may queue after the running capability gate; UI labels it as risk action, not EMI automation. |
| C05 | Pending/upcoming and overdue reminders for both modes | Owner pending/upcoming kiosk+sound; running overlay+sound or one fallback notification; overdue notification only; no duplicate running notification. |
| C06 | UTC due-day boundaries and configured DPD/grace window | Both modes select the same UTC dates; overdue reminders occur only every 12 hours within the existing window and skip locked or actively temp-unlocked devices. |
| C07 | Get location with denied/revoked grant, absent consent, offline app, or ineligible build | Action unavailable/rejected with reason; no invented fresh location; an accepted fix reports captured time and accuracy. |
| C08 | Settled and unsettled release, offline release, and final ack | Unsettled rejected; settled queues once; running app clears local state/binding; no fabricated Device Owner release status. |
| C09 | Dealer without lender authority, other tenant, or unauthorized admin actor | Normal authorization/not-found response before mode disclosure; no command or credit mutation. |
| C10 | Automatic running lock overlay: Pay Now and Temp Unlock buttons | Pay Now opens the existing payment QR/proof flow; Temp Unlock opens the existing borrower unlock-request screen. An authorized dealer/admin/partner decision queues `TEMP_UNLOCK`, clears the overlay after truthful ACK, and restores the overlay at expiry unless payment/full unlock/release supersedes it. |
| J01 | EMI schedule has no linked device during running enrollment | Overdue financial status/DPD still update; no device command is queued. |
| J02 | More than 500 eligible schedules and simultaneous cron runs | All partitions progress; one logical reminder/lock per due window despite races. |
| J03 | FCM unavailable, retry exhausted, duplicate push, sent without ack | Authenticated sync recovers pending work; terminal/stale results are visible; no push is treated as applied enforcement. |
| J04 | Temp-unlock expiry and manual-override renewal jobs scan mixed fleet | Expired owner and running temp unlocks each queue one relock; running devices never receive a manual-override token. |
| U01 | Dealer borrower/device lists and admin device table with pending, owner, running, released, and backfilled records | All is default; mode filters/pagination/search work; pending running borrower appears before device exists; no running QR secret leaks. |
| U02 | Admin case dialog, command/risk rows, device detail, and owner-only panels | Running temporary unlock and case resolution are available; managed per-app controls remain absent; factory-reset, USB-debugging, and unknown-app-install switches are disabled with an explanation; direct backend calls reject them. |
| U03 | Physical devices across supported Android/OEM versions, reboot, force-stop, reinstall, missing PIN, denied overlay, silent/DND, permission revocation | Product reports actual limitations and fallbacks; no running phone is described as durably or fully managed. |

**Launch acceptance:** A dealer can add either borrower type from the same form and show the correct QR. The running borrower can complete OTP, consent, IMEI, required access, and final activation on an already-running phone. Both dealer and admin can find the device and safely use only the eligible controls. Backend endpoints and scheduled jobs reject unsupported running actions. Existing new-device onboarding and owner controls remain compatible.
