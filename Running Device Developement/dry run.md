# Running-device backend dry run

**Scope:** Running-app QR enrollment only, under both `EMI_AUTOMATED` and `MANUAL` dealers. No Device Owner QR is enrolled in these scenarios.  
**Status:** Backend enrollment and command branches are implemented in this workspace; this remains an unexecuted end-to-end test plan pending a separate running APK and isolated database/device run.  
**Execution:** This document creates no database records and does not run against production. Use an isolated test database for the full time-based suite. The final section defines cleanup if a controlled production smoke run is later performed.

This plan uses the [master plan](master%20plan.md) as its target contract. It checks actual backend behavior described in [`scheduledJobs.js`](../backend/src/jobs/scheduledJobs.js), [`distributor.controller.js`](../backend/src/modules/distributor/distributor.controller.js), [`app.routes.js`](../backend/src/modules/app/app.routes.js), and [`emiInstallment.service.js`](../backend/src/services/emiInstallment.service.js). “Expected” below is acceptance behavior; backend unit tests do not substitute for a full database and physical APK run.

## Interpret the two requested journeys

1. **Pending EMI → reminder → payment → unlock:** an upcoming/pending reminder does **not** lock the phone. Under an automatic dealer, payment approval currently queues an `UNLOCK` for a non-final installment even if the device was already `ACTIVE`; the running app must handle that as an idempotent clear/no-op, and the UI must not claim that a locked phone was unlocked. To verify a real overlay removal, add an authorized manual `LOCK` before payment (scenario A02 or M03).
2. **Pending EMI → overdue → lock → payment → unlock:** overdue status alone does **not** auto-lock. For an automatic dealer with `lockOnGraceExpiry=true`, the cron locks only after the configured DPD **and** grace threshold has passed. For a manual dealer, the cron sends reminders but never queues an EMI grace/final lock; an authorized dealer must explicitly lock it (scenario M02).
3. **Final payment:** when the last installment settles the schedule, the current payment paths queue `RELEASE_DEVICE`, not an ordinary `UNLOCK`. Use a loan with at least two installments when the test specifically expects unlock rather than release.
4. **Payment meaning:** `EMI_AUTOMATED` can use borrower payment QR/submission followed by dealer approval. `MANUAL` hides/rejects borrower payment submission; the dealer records an external payment with `mark-paid`. Marking a non-final installment paid queues `UNLOCK` only if the device is `LOCKED`; otherwise it creates no unlock command.

## Test harness and evidence

### Fixtures

| Fixture | Configuration | Purpose |
|---|---|---|
| `AUTO-RUN` | Test tenant/dealer with `deviceControlRules.mode=EMI_AUTOMATED`, `lockOnGraceExpiry=true`, test DPD/grace values | Automatic reminders, grace, final lock, borrower payment approval, unlock. |
| `AUTO-NOLOCK-RUN` | Separate automatic test tenant or isolated policy variant with `lockOnGraceExpiry=false` | Reminders without final EMI lock. |
| `MANUAL-RUN` | Test tenant/dealer with `deviceControlRules.mode=MANUAL` | Automatic reminders, external payment recording, explicit lock, no EMI auto-lock. |
| Borrowers | Fresh test borrowers with unique mobiles, two or more EMI installments for unlock tests; one separate borrower for final-settlement tests | Avoid a final installment unexpectedly causing release. |
| Running installations | Test phones or a test-only client with a borrower JWT, stable activation request ID, FCM token, and manually entered IMEI 1/2 | Exercise running QR claim, linked-device sync, command acknowledgement, and capability reports. A simulated ack proves only the backend contract, not a visible Android overlay. |

Use a fresh run ID such as `RD-DRYRUN-YYYYMMDD-01` in supported test names/references and maintain a private manifest of tenant, account, borrower, schedule, installment, token, consent, installation, device, command, payment, notification, audit, and ledger IDs. Do not put enrollment secrets, OTPs, tokens, or real IMEIs in screenshots or logs. Record the one-credit registration debit and its ledger ID.

### Time and run rules

- Anchor all due-date assertions to **UTC calendar days**, as the current EMI job does. The cron currently sends upcoming reminders at **10 and 5 days before due**, scans on its scheduled run, and sends automatic overdue reminders every **12 hours only within the configured DPD/grace window**. Do not expect an automatic overdue reminder on the first overdue day unless the configured DPD makes that day the window start.
- For a deterministic full dry run, freeze the worker clock in an isolated test process or use a disposable database and controlled fixture dates. The checked-in job uses `new Date()` and does not accept a `now` argument. Do not change a production server clock or backdate real borrower records.
- When invoking `runEmiPolicyJob` directly in a test harness, pass the test `scheduleId` and do **not** use `forceReminders` except in a dedicated duplicate test. The job now scans in ordered pages; concurrent-worker idempotency still needs an isolated database test before rollout.
- Let the app fetch commands through JWT-authenticated sync and send an authenticated ack. FCM `sent`, a queued command, and `Device.state=LOCKED` are not proof that the lock overlay appeared. Inspect command ID, status, `ackPayload`, policy version, linked device ID, and observed time.
- Run each scenario with a new borrower unless the scenario explicitly continues a prior one. Resetting an installment or reusing a consumed QR can conceal defects.

### Baseline enrollment procedure `ENROLL-RUN`

Use this procedure at the start of every primary scenario; only vary the tenant and dates.

1. Dealer calls **existing** `POST /api/distributor/users/register` with borrower/loan fields and `enrollmentMode: "RUNNING_APP"`. Assert one `User`, one `EmiSchedule`, one mode-bound `EnrollmentToken`, one borrower-creation credit debit, and no `Device` yet.
2. Dealer calls **existing borrower-scoped** `POST /api/distributor/users/:userId/enrollment/qr` with `{"enrollmentMode":"RUNNING_APP"}`. Assert `qrType=RUNNING_APP_LINK`, QR image/text and expiry; no Android `PROVISIONING_*` keys. A second call while valid returns the same active QR. The QR secret is absent from ordinary list/detail/audit responses.
3. Running borrower app scans that QR, calls the preview API, completes OTP and running-specific consent, and enters IMEI 1 and IMEI 2 (or the explicit single-IMEI exception). Assert token, OTP session, tenant, borrower, consent version, and mode are bound together.
4. App obtains required notification/overlay grants and conditional location grant, requests Device Admin for normal-uninstall friction, then calls `POST /api/app/device/register` with the exact QR secret, borrower JWT, manually entered IMEIs, fresh capabilities, and body `activationRequestId` only after **Finish enrollment**. Device Admin may be declined without blocking activation; report its actual state. Assert one linked `Device` with `enrollmentMode=RUNNING_APP`, `state=ACTIVE`, `identifierSource=borrower_entered`, and a fresh capability snapshot. Token is consumed once. The dealer and admin lists include the device, and `allowedActions` contains only eligible running actions.
5. Call sync/ack with the borrower's JWT. It must resolve the exact `linkedDeviceId`; a different borrower JWT or old QR must not select this device. Repeat registration with the same `activationRequestId` and assert the original device is returned; use a different ID and assert conflict. Save baseline IDs and credit balance in the run manifest.

`ENROLL-RUN` is a backend test procedure for the implemented running-mode QR, preview, OTP/consent, registration, and acknowledgement branches. It still requires physical-device validation for overlay, sound, permissions, and background behavior; no production database dry run has been performed.

## Primary automatic-dealer scenarios

### A01 — New running borrower, pending reminder, payment approval, no prior lock

**Setup:** `AUTO-RUN`; use installment 1 of a two-installment schedule. Run `ENROLL-RUN`. Set the test clock to 10 or 5 UTC days before the installment due date.

1. Run the EMI policy job for this schedule, or send the existing dealer upcoming reminder through `POST /api/distributor/users/:userId/upcoming-emi-reminder` while the installment is in its allowed window.
2. Assert one `EMI_REMINDER` with `reminderType=UPCOMING`; running presentation is overlay + sound if available, otherwise one notification fallback. The installment remains `pending`; `Device.state` stays `ACTIVE`; no `LOCK` or `TEMP_UNLOCK` is created.
3. Borrower obtains the payment QR (`GET /api/app/payment/qr`), submits proof (`POST /api/app/payment/submit`), and dealer approves (`POST /api/distributor/payments/:paymentId/approve`). Payment is not counted paid merely because it was submitted.
4. Assert approval allocates payment to the installment, updates schedule totals, and queues one `UNLOCK` for the non-final payment under the **current** approval path. Running app acknowledges clearing any restriction; if no overlay was present, this is an idempotent no-op. Final state is `ACTIVE` after the valid ack. No `RELEASE_DEVICE`, owner-only `RESTRICTIONS_UPDATE`, or new reminder/lock for the paid installment.

**Pass evidence:** payment/ledger and installment status, one reminder ID, one approval ID, one unlock command and ack, unchanged absence of lock-overlay evidence. The operator copy must say the installment was paid and unlock processed, not that an active phone had previously been locked.

### A02 — New running borrower, overdue, DPD/grace lock, payment, overlay unlock

**Setup:** `AUTO-RUN`; first of at least two installments; `lockOnGraceExpiry=true`. Run `ENROLL-RUN`.

1. At UTC due minus 10 or 5 days, run the EMI job; assert `UPCOMING` reminder and no lock.
2. Advance the isolated clock past the due date and run the job; assert installment becomes `overdue`, DPD/overdue totals update, and **no final `LOCK` yet**. Advance to the configured DPD/grace window; assert `OVERDUE` is notification-only, at most once per 12-hour window, while the device is eligible.
3. During grace, assert owner-only restrictions are **not** sent to the running app. After `due + DPD + grace` has passed, run the job; assert one running-compatible `LOCK`, requested state `LOCKED`, and no second lock on a repeat run.
4. Deliver/sync the `LOCK`. The running app enters its restricted state and attempts its **lock overlay**. Ack `appRestrictionApplied` and `lockOverlayShown` separately. The app does not call `lockNow()`; Device Admin status is unrelated to `LOCK`. If overlay cannot appear, show limited/failed enforcement rather than claiming the phone is secured.
5. Borrower submits payment; dealer approves. Assert the first installment becomes paid and, because the schedule is not settled, one `UNLOCK` is queued with no owner-only restriction-clear command. App syncs/acks, clears the restriction and dismisses the lock overlay. Assert final requested/applied state returns to `ACTIVE`, and no further overdue reminders or lock are generated for that paid installment.

**Pass evidence:** due-date/DPD snapshots, command and ack timeline, no duplicate overdue notifications, payment allocation, and absence of owner-only policy payloads.

### A03 — Payment before due date suppresses later work

**Setup:** `AUTO-RUN`; non-final installment; `ENROLL-RUN`.

Send the upcoming reminder, approve payment before due, and then run the isolated clock through due date, DPD, and grace. Expect paid status, no overdue reminder, no grace action, no automatic `LOCK` for that installment, and no reappearing overlay. A delayed FCM reminder for the now-paid installment must be ignored or marked superseded by the running app; a sent push cannot revive old policy.

### A04 — Automatic dealer with final lock disabled

**Setup:** `AUTO-NOLOCK-RUN`; unpaid non-final installment; `ENROLL-RUN`.

Advance through upcoming, overdue, and beyond DPD/grace. Expect upcoming overlay+sound and overdue notification on the existing schedule, accurate financial overdue/DPD values, and **no final EMI `LOCK`**. A dealer may still issue a separately authorized manual lock; the `lockOnGraceExpiry` switch controls only scheduled EMI final lock.

### A05 — Last installment payment releases instead of unlocking

**Setup:** `AUTO-RUN`; all earlier installments already paid; final installment outstanding; `ENROLL-RUN` or continue a dedicated fixture.

Submit and approve the final borrower payment. Expect schedule `settled`, one `RELEASE_DEVICE`, state `RELEASE_PENDING` until app cleanup ack, then `RELEASED`. Do not expect ordinary `UNLOCK` for the final payment. Running release ack clears local financing state and FCM targeting; the APK clears stored borrower tokens. It must not claim Device Owner removal or set a managed-device owner status.

### A06 — Lock overlay buttons, approved temporary unlock, expiry, and payment

**Setup:** `AUTO-RUN`; non-final unpaid installment; `ENROLL-RUN`; issue and acknowledge a `LOCK` so the app overlay is visible.

1. Confirm the overlay shows **Pay Now** and **Temp Unlock**, with access to their existing screens. Pay Now fetches `/api/app/payment/qr` and can submit payment proof. Submission alone does not clear the overlay; dealer approval queues the normal `UNLOCK`.
2. On a separate unpaid fixture, tap Temp Unlock, submit `POST /api/app/unlock-request` with `reasonCategory=temporary_emergency`, and confirm a `PENDING_TENANT` case. The borrower remains locked until the dealer resolves it with `POST /api/distributor/unlock-requests/:caseId/temp-unlock` and a permitted `durationHours`.
3. Assert the device enters `TEMP_UNLOCK`, `tempUnlockExpiresAt` appears in sync/policy, FCM says `TEMP_UNLOCK`, and the app clears its overlay. A successful running ACK must have `appRestrictionCleared=true` and `lockOverlayCleared=true`. A repeated ACK is idempotent.
4. Keep the app offline across the deadline. Its local timer should restore the overlay; the backend expiry job should conditionally move the device to `LOCKED`, expire outstanding temp commands, and queue one `LOCK`. Reconnect and ACK the relock. A late temp command must not clear the overlay.
5. Repeat on a fresh fixture, but approve payment before the deadline. The resulting full `UNLOCK` or final `RELEASE_DEVICE` supersedes the timer; expiry must not relock a paid/released device. Verify there is no pending stale temp command applied after payment.

**Pass evidence:** case, command, expiry, payment, app overlay, and ACK timeline. The UI must distinguish an approved time-limited clear from full payment unlock and must not claim kiosk or Device Owner control.

## Primary manual-dealer scenarios

### M01 — New running borrower, pending reminder, externally paid while active

**Setup:** `MANUAL-RUN`; non-final installment; `ENROLL-RUN`.

Run the 10-day/5-day cron reminder or dealer upcoming reminder. Expect `UPCOMING` overlay+sound or one notification fallback, while installment stays `pending` and device stays `ACTIVE`. The borrower cannot obtain payment QR or submit payment through the app. After external payment is verified, dealer calls `POST /api/distributor/users/:userId/emi-installments/:installmentId/mark-paid` with a reason and reference. Expect installment `paid`, revised totals, and **no `UNLOCK` command** because the device was not locked. Do not describe this as a phone unlocking.

### M02 — Manual overdue: reminders continue; dealer decides to lock

**Setup:** `MANUAL-RUN`; non-final installment; `ENROLL-RUN`.

Advance the isolated clock through due date, DPD, grace, and beyond. Expect financial overdue/DPD and automatic `UPCOMING` and in-window `OVERDUE` reminders as applicable. Expect **no scheduled EMI grace policy and no scheduled EMI `LOCK`**, even when `lockOnGraceExpiry=true`. Dealer then calls `POST /api/distributor/devices/:id/lock` with a reason. Expect one `LOCK`; running app reports restriction/lock-overlay outcome. Once payment is verified, dealer marks that installment paid. Because device is `LOCKED` and the schedule is not settled, expect one `UNLOCK`, then overlay dismissal and `ACTIVE` after ack. If the dealer records the payment outside this API, an explicit authorized unlock is still required.

### M03 — Pending reminder, separate manual lock, payment, unlock

**Setup:** `MANUAL-RUN`; non-final installment; `ENROLL-RUN`.

Send a pending/upcoming reminder and verify that it alone does not lock. Dealer then manually locks for a documented business reason before the due date; app displays the running lock overlay. Dealer records the external payment using `mark-paid`. Expect the non-final payment to queue `UNLOCK` and clear the overlay after ack. This is the manual-dealer version of the requested “pending → reminder → pays → phone unlocks” journey with an explicit lock step.

### M04 — Manual payment API denial and final settlement

**Setup:** `MANUAL-RUN`; separate non-final and final-installment fixtures; `ENROLL-RUN` for each.

1. Borrower calls `GET /api/app/payment/qr` and `POST /api/app/payment/submit`; both are rejected without a `Payment`, schedule, command, or credit mutation. Dealer payment approval route rejects this tenant's borrower-payment flow.
2. Dealer records the final external installment with `mark-paid`. Expect `RELEASE_DEVICE`, not ordinary `UNLOCK`, and running-app cleanup on ack. If the device was manually locked, release clears the restriction as part of cleanup. No Device Owner release status is asserted.

### M05 — Critical risk lock stays separate from MANUAL EMI policy

**Setup:** `MANUAL-RUN` with a deliberately enabled critical-risk auto-lock rule, plus a matching test security event.

The EMI cron still cannot auto-lock for nonpayment. The risk service may queue a separate `LOCK` only after its own rule, consent, mode, and running capability checks. Assert the command and audit identify **risk** as source, the running lock overlay outcome is recorded, and the UI never labels this as automatic EMI locking. Repeat with risk auto-lock off: no risk lock.

## Cross-cutting running-only backend scenarios

| ID | Steps | Required result |
|---|---|---|
| R01 — QR re-display and rotation | Reopen the borrower's QR while valid; then call the same borrower-scoped route with `{"enrollmentMode":"RUNNING_APP","rotate":true}` and try the old QR. | Re-display returns the active running QR; rotation invalidates the old unused claim atomically; one usable QR; no extra registration credit. Old dealer request without mode fails safely for a running borrower. |
| R02 — Enrollment interrupted | Stop after preview, OTP, consent, or denied required overlay; resume with the same valid QR; press Finish twice concurrently. | No `Device` before Finish; actual grants are rechecked; one token consumption and one linked device; the same `activationRequestId` is idempotent, a different ID conflicts. |
| R03 — Wrong identity/mode | Use another tenant's token, owner provisioning token, expired/consumed token, copied IMEI, or another borrower's JWT. | Claim/sync/ack rejected at the appropriate boundary; typed IMEI alone never authenticates the app; no cross-tenant record or credit mutation. A copied valid JWT for the same borrower is a known lower-assurance risk and should not be represented as blocked by installation proof. |
| R04 — Offline command and recovery | Queue `LOCK`, `UNLOCK`, and a reminder while running app is offline; then reconnect with duplicate/out-of-order FCM. | Requested state and delivery status remain distinct from applied result. JWT-authenticated sync returns current unsuperseded work for the linked device; app uses policy version/command ID, applies once, and acknowledges actual overlay/reminder outcome. |
| R05 — Permission loss | Revoke overlay, notification, Device Admin, then conditional location one at a time after enrollment. | Capability snapshot ages/changes. A fresh known overlay loss makes Lock unavailable at the API; if grant is revoked after queue, the app reports failed/limited overlay outcome. Pending reminder uses one notification fallback if available; Device Admin deactivation removes normal-uninstall friction but does not alter the overlay `LOCK` behavior; location is disabled when grant/consent absent. No fabricated success. |
| R06 — Timed overlay unlock | Lock a running device; resolve a borrower case with dealer/admin/partner temporary unlock; repeat through the direct dealer/admin device route. Run expiry on a disposable clock, including duplicate runs, offline app, and payment/full unlock before expiry. | `TEMP_UNLOCK` is queued with a saved deadline; ACK requires overlay and restriction cleared. Local timer restores overlay while offline; expiry queues `LOCK` once and rejects stale temp ACK. Payment/full unlock/release supersedes expiry without a later relock. Owner-only restriction/security/testing/manual-override routes still return `409 UNSUPPORTED_FOR_ENROLLMENT_MODE` with no mutation. |
| R07 — Location and release authorization | Ask for location without consent/grant, with valid consent/grant, and after release; try release before and after all installments settle. | Reject unavailable location or unsettled release without mutation; accepted fix records actual capture time/accuracy; settled release queues once and prevents later control commands. |
| R08 — Tenant and actor scope | Dealer from another tenant, dealer without lender delegation, borrower attempting operator control, and authorized admin call the same running device. | Unauthorized paths deny before mode/borrower details leak; only scoped operator actions queue. Rejected action has no command, state, ledger, or success audit mutation. |
| R09 — Cron duplicate and UTC boundaries | Invoke due-window job twice, cross UTC midnight, overlap two workers, and include more than 500 test schedules in an isolated DB. | One logical reminder/lock per installment/window, correct UTC day, all eligible schedules eventually scanned, no running owner-only policy payload. This is a **rollout gate** because concurrent idempotency still needs hardening. |
| R10 — Pending versus overdue reminder | Queue `UPCOMING`/`PENDING` and `OVERDUE` for a running device and inspect command/notification records. | Pending/upcoming uses reminder overlay+sound or one fallback notification; overdue posts notification only; no duplicate companion notification, and neither reminder changes `Device.state`. |
| R11 — Pending enrollment during cron | Register a running borrower and run the EMI job before final Finish, including after due date. | Financial overdue/DPD is recalculated even though no device exists; no device command is queued, and no incomplete installation appears in device lists. This is a rollout gate because the current job skips schedules with no linked device before recalculation. |
| R12 — Fleet/status visibility | Query dealer borrower/device lists, admin device list/detail, and running enrollment status before and after Finish. | Pending borrower appears without a device; linked running device appears in default All and running filters, with mode, masked borrower-entered IMEI provenance, capability age, allowed actions, requested state, and actual command result. No QR secret in ordinary responses. |

## Evidence to capture for every run

Record a row per transition: UTC time, run/scenario ID, tenant mode, borrower/device IDs, installment status and DPD, `Device.state`, requested and applied policy versions, command type/status/source/ID, FCM attempt, authenticated ack fields, current capability age, and relevant audit ID. For payment steps also record `Payment` approval or `mark-paid` reference, schedule totals, settlement/release decision, and credit ledger balance. For running `LOCK`, capture `appRestrictionApplied` and `lockOverlayShown` independently; for Device Admin, capture activation/deactivation and its effect on ordinary uninstall separately. For reminders capture `presentationResult` and `soundResult`. Do not treat a synthetic ack as visual proof; physical-device QA should separately confirm the overlay.

Mark each scenario **Pass**, **Fail**, or **Blocked: feature not implemented**. A failed prerequisite does not count as a downstream pass. Preserve request/response shapes with secrets and personal data removed.

## Production-data cleanup if a smoke run is later used

The full time-shifted suite belongs in an isolated database. A controlled production smoke run may create only dedicated test-tenant/test-borrower records and use a test phone and payment channel; it must not use live borrowers, real loan claims, real financial payments, or global clock changes. Before the run, save tenant credit balance, policy, fixture manifest, and job/FCM scope. Test requests must be tagged with the unique run ID through supported name/reference/reason fields.

Cleanup is part of the run, not an optional follow-up:

1. Stop new test requests and prevent any further test commands or FCM/notifications from being delivered. Cancel unused running enrollment tokens and pending test commands, invalidate test borrower sessions where supported, and clear test FCM tokens.
2. Resolve any test phone lock overlay with an authorized `UNLOCK` or settled `RELEASE_DEVICE`; verify app acknowledgement and local cleanup before removing server records. Do not delete a record while a real phone can still receive an old lock.
3. Reconcile all test `User`, `EnrollmentToken`, `EmiSchedule`, `Device`, `DeviceCommand`, payment/proof, consent/OTP, notification, location, risk/case, audit, and credit-ledger IDs from the manifest. Delete disposable test records only through a reviewed cleanup procedure scoped by the exact IDs and test tenant. Retain or redact immutable audit/financial evidence according to the application's retention rules; do not silently erase it.
4. Reverse the borrower-creation credit effect with an auditable compensating credit-ledger entry if a credit was consumed; never merely increment `Tenant.creditBalance` or delete the debit. Restore only policy/configuration changes made for this run and refresh tenant metrics.
5. Assert zero active test enrollment claims, pending/sent commands, scheduled work, FCM targets, and borrower/device list entries; verify the tenant credit balance and aggregate metrics match the pre-run snapshot after the compensating entry. Save a cleanup report listing the IDs and residual audit records.

**No production database was accessed or changed to create this document, so there is nothing to clean up for this writing task.**
