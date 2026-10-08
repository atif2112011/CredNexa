# Dealer and Borrower App Developer Guide

Automatic EMI mode  |  Working guide  |  7 October 2026

This guide explains the jobs of the Dealer and Borrower apps, the complete borrower lifecycle, the meaning of the main screens, and the admin tools used to exercise reminders and device states. It is written for a developer joining the project. Follow the live API behavior described here when implementing or debugging an app screen.

## 1  Which app does what

| Surface | Primary user and purpose |
| --- | --- |
| Dealer app | Dealer administrator registers borrowers, creates enrollment QR codes, monitors loans and devices, reviews payments and unlock cases, buys key credits, and sends reminders. |
| Borrower app | Runs on the financed Android device. It completes consent and device registration, shows EMI and payment information, displays reminders and lock status, submits payment claims, and requests help or an unlock. |
| Super admin portal | Operates the platform: dealer settings, consent versions, devices, commands, audit logs, key purchase approvals, and the device Testing Panel. |

Terminology: a dealer is a tenant. A key is a tenant credit consumed when a new borrower is registered. A borrower is stored as a User; the dealer login is an Account. The app's device state and an EMI installment's payment status are separate records.

## 2  Test identities and starting point

| Item | Value |
| --- | --- |
| Dealer | Apex Rural -Tenant-1 |
| Dealer login | 9000030102 |
| Dealer password | Password@123 |
| Test borrower | Aastha_Sudan_Test |
| Borrower mobile | 9999900004 |
| Loan ID | BRW-2026-80EF8D9D |
| Borrower record | Active; six EMIs of INR 2,000 on a INR 12,000 loan. EMI 1 is paid in advance; EMIs 2 through 6 are pending. |
| Device | Onboarded using a simulated test device. Initial server state ACTIVE with EMI_PAID policy. |
| Admin website | [https://admin.crednexa.co.in/](https://admin.crednexa.co.in/) |
| Admin login | admin@gmail.in |
| Admin password | password |

The Aastha device and consent records were created for testing. They establish the backend activation status, but do not prove Android Device Owner provisioning or enforcement on a physical phone. Recheck live state before a demo because admin simulations and scheduled jobs change these records. Use the dealer credentials only in a controlled test environment.

## 3  The ordinary end to end journey

1. Dealer login.  Sign in with the dealer mobile and password. POST /api/auth/login returns an account access token; the refresh token is held in an HTTP-only cookie. The tenant scope comes from the account, not from a client-selected dealer ID.

2. Register borrower.  Open Register Borrower and enter name, mobile, Aadhaar-linked mobile, loan amount, EMI amount, tenure, and disbursement date. The backend validates the numbers, creates the borrower and six or more installment rows, consumes one dealer key, and issues an enrollment token.

3. Generate enrollment QR.  Open the new borrower and choose Generate or Regenerate QR. The backend combines the enrollment token with provisioning settings. Show the QR on the dealer's screen; the token expires and can be regenerated while activation is incomplete.

4. Provision the phone.  On a new or factory-reset Android phone, enter the setup QR flow, connect to Wi-Fi, and scan the dealer QR. Android downloads and verifies the managed app and provisions it as Device Owner. A simulated database device does not exercise this step.

5. Borrower consent and activation.  The Borrower app fetches current consent terms, starts and verifies an OTP, records the borrower's explicit acceptance, then registers the device with its identity and push token. The backend links the device and consumes the enrollment token. The dealer sees activation complete.

6. Operate the loan.  The Borrower app shows the EMI schedule and payment route. The Dealer app monitors due and overdue accounts, reviews payment claims, and handles unlock cases. Automatic jobs send due reminders, enter grace, and lock after the configured thresholds.

## 4  Dealer app screen map

These are the functional screens a dealer app should expose. Labels may differ in an Android build; use the API data and actions as the source of truth.

| Screen or section | What the dealer sees and does |
| --- | --- |
| Login | Authenticate the tenant_admin account; recover or refresh session as needed. |
| Dashboard | Borrower and activated-device counts, available keys, enrollment status, device-state totals, alerts for due or overdue EMIs, payments needing approval, and unlock requests. |
| Register Borrower | Capture identity and loan terms. Show the generated loan ID, installment schedule, key debit, and enrollment token after success. |
| Borrowers | Search borrowers; open a profile to see activation stage, loan data, installments, enrollment token, and linked device. Pending and Overdue EMI views filter the relevant borrowers. |
| Enrollment QR | Generate or regenerate a provisioning QR and inspect registration progress: USER_REGISTERED, QR_GENERATED, CONSENT_COMPLETED, or ACTIVATION_COMPLETE. |
| Devices | View state, policy, last contact, and command history. From a device detail, send an upcoming payment prompt or request lock, unlock, temporary unlock, restrictions, security controls, or location. |
| EMI detail | See each installment's due date, status, amount, paid amount, and overdue totals. A dealer can mark one installment paid with a reason and reference. |
| Payment approvals | Inspect borrower-submitted amount, reference, and optional proof. Approve only after verifying actual receipt, or reject with a reason. |
| Unlock requests | Review borrower reason, evidence, case status, and deadline; resolve with full unlock, a time-limited unlock, or rejection. |
| Payment QR settings | Upload a dealer UPI QR, select the active QR, and remove obsolete entries. The Borrower app displays the active one. |
| Keys or credits | View balance and current purchase pricing; submit a purchase request with proof; track approval. A new borrower registration consumes one key. |
| Settings | Review account and dealer configuration such as Aadhaar verification. Device policies and systemwide options are managed in the admin portal. |

## 5  Borrower app screen map

| Screen or state | Meaning and action |
| --- | --- |
| Provisioning and consent | Reads enrollment token, shows the current agreement, verifies mobile OTP, records consent, then registers the physical device. |
| Dashboard | Shows borrower/loan summary, current due EMI, recent paid installments, and the current device state/policy. |
| EMI schedule and detail | Lists due dates and payment status; installment detail shows amount, outstanding balance, and linked payment when available. |
| Pay Now | Shows the active dealer UPI QR. Payment is made in a separate UPI app; this screen does not itself move money. |
| I Have Paid | Submits the amount, optional UPI reference/note, and optional proof image for dealer review. One pending approval per device is allowed. |
| Payment history | Shows submitted, approved, or rejected payment records and their details. |
| Grace or locked | Shows why access is restricted, the EMI information, payment action, and Request Unlock when appropriate. |
| Request Unlock | Creates a case with mandatory reason and optional details/evidence; shows current case and its progress. |
| Notifications and sync | Displays due, overdue, payment, and unlock messages. The app fetches authoritative state/commands from the API and acknowledges execution. |

## 6  Payments, keys, and manual help

### Borrower payment and dealer approval

A. Dealer prepares QR.  Keep one dealer payment QR active in Payment QR settings. GET /api/app/payment/qr returns its image and label.

B. Borrower pays externally.  Show the active QR and amount. The borrower completes UPI payment outside EMI Shield, then submits the claim in the Borrower app with amount, reference, and optional proof.

C. Dealer verifies and decides.  The claim enters Payment Approvals. Approval applies the amount to the earliest unpaid installments, updates EMI statuses, and normally queues an UNLOCK command; a fully settled schedule queues permanent RELEASE instead. Rejection leaves the EMI unpaid.

Developer watchpoint: current approval code queues an EMI_PAID unlock whenever the schedule is not newly settled, even if another installment remains overdue. The next EMI policy run can relock it. Show the installment statuses and device policy independently; do not equate an EMI_PAID policy label with every EMI being paid.

### Borrower request for temporary access

1. Borrower.  On a locked device, open Request Unlock, enter a reason, optionally add details and an image, and submit. An existing open case blocks a duplicate.

2. Dealer.  Open Unlock Requests, inspect the case and its EMI context, and select Temporary Unlock. Enter a duration and note. The device moves to TEMP_UNLOCK with TEMP_UNLOCKED policy and an expiry time.

3. Expiry.  The scheduled expiry job reevaluates temporary unlocks every 10 minutes. A dealer can also trigger a device-level temporary unlock directly from Device Detail with a reason and duration, up to the dealer policy maximum.

### Request more keys

1. Open Keys.  Fetch purchase options to show balance, unit price, quantity limits, discount slabs, and the admin's current UPI or QR payment destination.

2. Price the request.  Select a valid integer quantity. Apply the matching inclusive discount slab to the base key price and show the final payable amount. Refresh options if pricing changes.

3. Submit and track.  Make the payment externally, upload proof, include the reference and pricing version, and submit. The super admin approves or rejects the request. Approved keys increase the dealer balance; a pending request does not.

## 7  Reminders and the automatic state machine

The automatic EMI policy job runs every 30 minutes; queued push delivery runs every minute. A device may be offline, and a queued command is not proof that the phone applied it. Compare desired policy version with last applied version and command acknowledgement when debugging.

| Trigger or action | Expected result |
| --- | --- |
| 10 or 5 days before due | Automatic upcoming EMI reminder is queued. The dealer can also send an upcoming reminder for a selected borrower or send a device-level upcoming payment prompt. |
| Due date has passed | An unpaid installment becomes overdue; the schedule's overdue count, amount, and days past due are recalculated. |
| Within configured grace window | Automatic policy changes to GRACE_PERIOD / EMI_GRACE, with an overdue reminder. Grace reminders are limited to roughly every 12 hours. |
| Beyond DPD plus grace | Automatic policy changes to LOCKED / EMI_LOCKED and a LOCK command is queued when locking is enabled. |
| Payment or approved resolution | The server may queue UNLOCK and use UNLOCK_PENDING / EMI_PAID until the phone acknowledges. The final paid EMI can queue RELEASE_PENDING and then RELEASED. |
| Dealer reminder | Pending/Overdue borrower lists let the dealer send individual or bulk overdue reminders. An upcoming reminder can be sent for a future unpaid EMI within its selected window. |

A reminder command is a message, not a payment or policy transition. The dealer's overdue reminder action skips a borrower with no overdue EMI or no linked device. Aastha currently has no overdue EMI, so use the admin Testing Panel to create that test condition first.

## 8  Device states and admin test controls

| State | Meaning |
| --- | --- |
| ACTIVE | Normal managed operation; usually EMI_PAID policy. |
| GRACE_PERIOD | Overdue within the configured grace window; EMI_GRACE policy. |
| LOCKED | Server requests lock under EMI_LOCKED policy; check command acknowledgement for physical enforcement. |
| TEMP_UNLOCK | Time-limited access under TEMP_UNLOCKED policy. |
| UNLOCK_PENDING | Unlock requested and command awaiting device acknowledgement. |
| OFFLINE_PENDING | Transition is waiting for device contact. |
| CONSENT_INVALID | Consent is invalid and the matching restrictive policy applies. |
| RELEASE_PENDING / RELEASED | Final settlement release is queued / permanently completed. |

The super admin portal has a Testing Panel on each device detail page. Its actions change live EMI/device records and may queue commands; use a dedicated test account. In the portal open Devices, select the test device, then use Testing Panel. Review the resulting EMI schedule, state, command list, and audit log after every action.

| Admin Testing Panel action | What it does |
| --- | --- |
| Send Upcoming Reminder | Queues a reminder for the next future unpaid EMI. |
| Send Overdue Reminder | Makes the next unpaid EMI overdue when needed, then queues an overdue reminder. |
| Simulate Upcoming EMI Cron | Moves the next unpaid due date to five days away and runs the EMI reminder policy job. |
| Simulate Device Grace Period | Moves the next unpaid EMI into the configured grace window, runs policy evaluation, and queues a grace reminder. |
| Simulate Auto-lock | Moves the next unpaid EMI beyond grace expiry and runs the policy job to lock. |
| Simulate Payment Unlock | Marks the most recent overdue EMI paid and queues the normal payment unlock. |
| Settle and Release Device | Marks all remaining installments paid and queues permanent device release. Use only when the test can be retired. |

For Aastha, a useful sequence is: inspect initial ACTIVE state and five pending EMIs; simulate grace; inspect GRACE_PERIOD and the policy command; simulate auto-lock; inspect LOCKED and command acknowledgement; simulate payment unlock; inspect the paid EMI count and return policy. A simulated device may not apply commands on actual Android hardware. Do not use Settle and Release if you plan to reuse the account for reminder and lock tests.

## 9  Developer checks and API map

- Use /api/tenant for Dealer app calls; /api/distributor is a compatibility alias. Borrower calls use /api/app, and super admin calls use /api/admin.
- Account login: POST /api/auth/login. Borrower onboarding: POST /api/app/consent/initiate, /consent/verify-otp, /consent/accept, then /device/register.
- Dealer registration and QR: POST /api/tenant/users/register and /enrollment/qr. Check /users/:id or /enrollments/:token/status for activation progress.
- EMI and payment: GET /api/app/dashboard, /installments, /payment/qr, /payment/history; POST /payment/submit. Dealer approval: GET /api/tenant/payments/approval-requests and POST /payments/:paymentId/approve or /reject.
- Unlock: POST /api/app/unlock-request; dealer GET /api/tenant/unlock-requests and POST /unlock-requests/:caseId/temp-unlock, /approve, or /reject.
- Keys and reminders: GET /api/tenant/credits/purchase/options; POST /credits/purchase/requests, /users/:userId/upcoming-emi-reminder, /users/:userId/overdue-emi-reminder. Admin simulation: POST /api/admin/devices/:deviceId/testing/:action.
When a screen looks wrong, inspect four layers in order: installment status and due date; server device state and current policy; queued/sent/acknowledged/failed command; applied policy version and last device sync. The server can say LOCKED while a physical device has not enforced a failed command.

## 10  Guided test using Aastha

Exercise setup: the tester is signed in to the Borrower app on a test phone as Aastha_Sudan_Test (9999900004), signed in to the Dealer app as dealer 9000030102, and signed in at [https://admin.crednexa.co.in/](https://admin.crednexa.co.in/) as admin@gmail.in. The same tester uses all three surfaces. The account starts with one paid EMI and five pending EMIs; the exercises below change those records. Refresh each screen after an action. A backend-simulated device supports server-side state checks; physical Android lock and push behavior requires a real enrolled phone.

### Exercise 1 — Establish the starting account and device state

1. Open the Dealer app → Borrowers. Search for Aastha_Sudan_Test or 9999900004, open the borrower, and read the EMI schedule and linked device. Confirm that six installments exist: one paid and five pending at the start of this exercise.

2. Open the Borrower app → Dashboard and EMIs on the test phone. Confirm the same borrower identity, next due EMI, paid installment, and device status. Use Sync or refresh if the screen is stale.

3. Open [https://admin.crednexa.co.in/](https://admin.crednexa.co.in/) → Devices. Search for Aastha or simulated IMEI 000000150997355, select View, and note the device state, active policy, desired and applied policy versions, command history, and Testing Panel. Device ID: 6ac62a676c9bab50e6e34012.

### Exercise 2 — Send an upcoming EMI reminder

1. In the admin website, open Devices → Aastha device → Testing Panel. Select Simulate Upcoming EMI Cron and confirm the prompt. This moves the next unpaid EMI to five days before its due date and runs the reminder job.

2. Refresh the admin device page. Check the next EMI date and Command History for the reminder. Open FCM Logs if the notification is queued or fails.

3. Open the Dealer app → Pending EMIs and find Aastha. Confirm the upcoming installment and its due date. Open the Borrower app → EMIs and Notifications, refresh or sync, and check the reminder on the test phone.

### Exercise 3 — Enter the grace period

1. In the admin website, return to Devices → Aastha device → Testing Panel. Select Simulate Device Grace Period and confirm. This changes the next unpaid due date, applies the grace policy, and queues a reminder.

2. Refresh the admin device detail. Check that the server state is GRACE_PERIOD, the policy is EMI_GRACE, and Command History shows the policy command. Compare desired and applied versions before treating the phone as updated.

3. Open the Dealer app → Devices and the Aastha device detail. Refresh and compare its state. Open the Borrower app → Dashboard, sync, and check the displayed due/overdue state and any grace reminder.

### Exercise 4 — Simulate the end of grace and a lock

1. In the admin website → Devices → Aastha device → Testing Panel, select Simulate Auto-lock and confirm. This places the next unpaid EMI beyond grace expiry and runs the automatic EMI policy job.

2. Refresh the admin page. Look for LOCKED with EMI_LOCKED policy, then check Command History and desired versus applied policy versions. A queued command proves intent; an acknowledged command is needed to confirm delivery.

3. Open the Dealer app → Devices → Aastha and refresh. Open the Borrower app on the test phone and sync. If it is truly enrolled, check the locked screen and available emergency/unlock controls; a simulated backend record alone cannot demonstrate Android enforcement.

### Exercise 5 — Send an overdue reminder from the Dealer app

1. Open the Dealer app → Overdue EMIs. Find Aastha, open the overdue installment, and choose Send Overdue Reminder. Confirm the action and note the result shown by the app.

2. Open the admin website → Devices → Aastha device → Command History, then FCM Logs. Check that a reminder was queued and whether delivery succeeded. A missing push should be investigated there before repeating the request.

3. Open the Borrower app → Notifications and refresh/sync. Check the overdue message and the EMI shown on Dashboard. The Dealer app also offers an upcoming reminder from Pending EMIs when the next unpaid installment is in the future.

### Exercise 6 — Request and grant a temporary unlock

1. On the test phone, open the Borrower app while the account is locked. Choose Request Unlock, enter a reason, submit, and note the request or case status in the app.

2. Open the Dealer app → Unlock Requests. Find Aastha’s new case, open it, review the reason and device, and choose Temporary Unlock. Select the offered duration, enter a note if requested, and confirm.

3. Open the admin website → Devices → Aastha device. Refresh and check TEMP_UNLOCK / TEMP_UNLOCKED and the unlock command. Open the Borrower app, sync, and confirm the temporary access and expiry shown. The normal EMI policy resumes after the timed unlock expires.

### Exercise 7 — Walk through payment and payment approval

1. Open the Borrower app → EMIs or Dashboard → Pay Now. Review the dealer UPI QR and amount. A real payment is completed in a UPI app, outside the Borrower app; use only an approved test payment method for this part of training.

2. After making an approved test transfer, return to the Borrower app → I Have Paid. Enter the amount and transaction reference and attach proof if offered. Submit the claim and check its pending status in Payment History.

3. Open the Dealer app → Payment Approvals. Open Aastha’s claim, verify the actual receipt and amount, then approve or reject it. Refresh the Borrower app → Payment History and EMIs, and the admin device page → Command History, to inspect the updated installment and unlock command.

4. For a no-money state test, use the admin website → Devices → Aastha device → Testing Panel → Simulate Payment Unlock instead. Confirm it, then check which overdue EMI became paid and whether any other overdue EMI remains. This testing action is separate from a real UPI transfer and dealer approval.

### Exercise 8 — Inspect other states and finish the session

1. Open the admin website → Devices → Aastha device. Compare the current server state, active policy, latest command, and applied version after each previous exercise. Use Commands and FCM Logs to explain any difference between the server and phone.

2. To exercise reminder paths independently, use Testing Panel → Send Upcoming Reminder or Send Overdue Reminder when their EMI conditions apply. Then inspect Command History and FCM Logs, plus the Borrower app → Notifications.

3. Only at the end of the test, if permanent release is the intended outcome, use Testing Panel → Settle & Release Device. It marks all remaining installments paid and requests a permanent release. Verify the released state in the admin website, Dealer app → Devices, and Borrower app after sync. This consumes the reusable pending-EMI test setup.

Troubleshooting rule: if the admin website shows a reminder or lock as queued but the phone does not react, inspect command acknowledgement, FCM Logs, app login, push token, network access, and whether the test phone was physically enrolled. The test data here includes a simulated device record, so server transitions can be tested even when no physical Android policy changes occur.

## Source of truth in this repository

Backend routes: backend/src/modules/distributor/distributor.routes.js; backend/src/modules/app/app.routes.js; backend/src/modules/admin/admin.routes.js. Core logic: backend/src/modules/distributor/distributor.controller.js; backend/src/modules/app/app.controller.js; backend/src/jobs/scheduledJobs.js; backend/src/services/adminDeviceTesting.service.js. State labels: backend/src/constants/deviceStates.js. App flow references: flows.md and slab_based_key_purchase_tenant.md.
