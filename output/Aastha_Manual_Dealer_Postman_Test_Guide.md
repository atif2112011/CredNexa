# Aastha manual dealer: running-device Postman test guide

**Prepared:** 12 October 2026  
**Purpose:** Exercise the dealer workflow while the Dealer app does not yet support running-device enrollment. The requests below call the existing backend APIs. The running borrower APK performs the Android-side scan, consent, activation, and command application.

## Test account and starting records

| Item | Value |
| --- | --- |
| Dealer | `Aastha_Dealer_Manual` |
| Dealer/tenant ID | `6acd12f1ec3d0ff275866ccc` |
| Dealer login ID (mobile) | `9000030200` |
| Dealer temporary password | `CNX-qx0TL9LDAa1!` |
| Dealer mode | `MANUAL` |
| Channel partner | Apex Rural Finance |
| Running enrollment | Enabled |
| Running location requests | Enabled; each borrower must also consent and grant location |
| Keys | 12 test keys granted, two used by borrower creation, **10 remaining** |
| Backend origin for Postman `BASE_URL` | `https://asia-south1-cred-nexa.cloudfunctions.net` |

| Borrower | Mobile and Aadhaar-linked mobile | Borrower ID | EMI schedule | Initial state |
| --- | --- | --- | --- | --- |
| `Aastha_Manual_Running_1` | `9999900097` | `6acd12f2ec3d0ff275866cf7` | INR 4,000 loan; two EMIs of INR 2,000 | Registered, no linked device; use for reminder, lock/unlock, location, non-final mark-paid |
| `Aastha_Manual_Running_2` | `9999900098` | `6acd12f2ec3d0ff275866d0f` | INR 2,000 loan; one EMI of INR 2,000 | Registered, no linked device; use for final payment and release |

The borrower mobile numbers match the test OTP prefix configured in this backend checkout. The mock OTP is `123456` **only if the deployed backend has the same test-prefix setting**; otherwise use the OTP delivered by the deployed provider. Both QR claims were checked and return `RUNNING_APP_LINK`. They currently expire on **19 October 2026 around 17:03 UTC**; the Generate QR request below creates a fresh claim when the prior one expires. Do not rotate a valid QR after OTP or consent has started.

The temporary password is included because this is a handoff for a test dealer. Keep the password, access token, and QR private. The QR carries an enrollment claim that anyone holding it can present until it expires or is consumed.

## What MANUAL changes

| Behavior | Automatic dealer (`EMI_AUTOMATED`) | This MANUAL dealer |
| --- | --- | --- |
| Upcoming/overdue EMI schedule and reminders | Scheduled | Scheduled on the same existing cadence |
| Scheduled EMI grace transitions and final EMI lock | Can occur under policy | Disabled; dealer decides when to lock/unlock |
| Critical security-risk auto-lock | Separate risk policy | Still a separate risk policy |
| Borrower EMI details and payment history | Visible | Visible |
| Borrower Pay Now/payment submission | Available | Hidden/disabled; the payment APIs reject it |
| Borrower Request Unlock | Available | Available; dealer can review the request |
| Borrower self-service temporary-unlock flow | App-dependent automatic flow | Do not present this flow in the MANUAL borrower UI |
| Dealer lock/unlock | Available | Primary device-control workflow; use the Postman calls below |
| Dealer mark EMI paid | Available | Records an offline/external payment. A non-final payment unlocks a locked device; the final payment queues permanent release. |

The backend still permits an operator-issued `TEMP_UNLOCK` and unlock-request review for a MANUAL dealer. These are separate from a borrower self-service temporary-unlock button. This guide tests **permanent manual unlock**, as requested.

For a running device, a successful `LOCK` asks the borrower APK to show an overlay. It is not Android Device Owner kiosk mode. An upcoming reminder is intended to show an overlay plus sound; an overdue reminder is a notification. A `queued` API response shows server intent, not proof that Android displayed it.

## Postman setup

Create a **local/private** Postman environment with these variables:

| Variable | Initial value |
| --- | --- |
| `BASE_URL` | `https://asia-south1-cred-nexa.cloudfunctions.net` (no trailing `/api`) |
| `DEALER_MOBILE` | `9000030200` |
| `DEALER_PASSWORD` | The temporary password in the account table above |
| `ACCESS_TOKEN` | Empty; set by login |
| `BORROWER_ID` | Start with `6acd12f2ec3d0ff275866cf7` |
| `DEVICE_ID` | Empty; set after phone onboarding |
| `INSTALLMENT_ID` | Empty; set from the EMI-list response |

For every dealer request after login, select **Bearer Token** authorization with `{{ACCESS_TOKEN}}` and `Content-Type: application/json`. The dealer account is the source of tenant scope; do not send or substitute a `tenantId` in the control bodies. If a token expires, log in again.

### 1. Log in

```http
POST {{BASE_URL}}/api/auth/login
Content-Type: application/json

{"identifier":"{{DEALER_MOBILE}}","password":"{{DEALER_PASSWORD}}","targetApp":"tenant_app"}
```

Expect HTTP `200`, `data.account.role: "tenant_admin"`, `data.account.tenantId: "6acd12f1ec3d0ff275866ccc"`, and `data.accessToken`. In Postman's **Post-response/Tests** tab:

```javascript
const data = pm.response.json().data;
pm.environment.set("ACCESS_TOKEN", data.accessToken);
```

### 2. Find a borrower and display the running QR

The two borrowers in the table are **already registered**. Do not register them again. If Aastha needs an additional test borrower later, use a new unused mobile and this request first; it consumes one of the dealer's available keys:

```http
POST {{BASE_URL}}/api/distributor/users/register
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "name":"Aastha_Additional_Running_Test",
  "mobile":"{{NEW_BORROWER_MOBILE}}",
  "aadhaarLinkedMobile":"{{NEW_BORROWER_MOBILE}}",
  "loanAmount":4000,
  "emiAmount":2000,
  "tenureMonths":2,
  "disbursementDate":"{{DISBURSEMENT_DATE}}",
  "enrollmentMode":"RUNNING_APP"
}
```

Set `DISBURSEMENT_DATE` in **Pre-request** to `new Date(Date.now() - 86400000).toISOString()`. Expect HTTP `201`, `data.userId`, `data.enrollmentMode: "RUNNING_APP"`, and `data.credits.remaining`. Set `BORROWER_ID` from `data.userId`; then use the borrower-scoped Generate QR request below. The registration response does not expose the running QR secret.

```http
GET {{BASE_URL}}/api/distributor/users?enrollmentMode=RUNNING_APP&search=Aastha_Manual_Running
Authorization: Bearer {{ACCESS_TOKEN}}
```

Expect both borrowers with `enrollmentMode: "RUNNING_APP"` and no linked device initially. Set `BORROWER_ID` to the first borrower ID, then:

```http
POST {{BASE_URL}}/api/distributor/users/{{BORROWER_ID}}/enrollment/qr
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{"enrollmentMode":"RUNNING_APP"}
```

Expect `data.qrType: "RUNNING_APP_LINK"`, `data.qrText`, `data.qrCodeDataUrl`, and `data.tokenExpiresAt`. A currently valid claim returns `reusedExistingToken: true`; an expired claim is replaced. To show the image in Postman, add this **Post-response/Tests** script and open **Visualize**:

```javascript
const data = pm.response.json().data;
pm.visualizer.set('<img alt="Running enrollment QR" style="width:360px" src="{{qr}}" />', {
  qr: data.qrCodeDataUrl
});
```

The old `/api/distributor/enrollment/qr` endpoint generates Device Owner setup QR codes and must not be used for these borrowers. If the request returns `409 DEALER_APP_UPGRADE_REQUIRED`, include the exact `RUNNING_APP` mode in the body. `409 ENROLLMENT_MODE_MISMATCH` means the body differs from the saved borrower mode.

### 3. Onboard the first real phone

Install the running borrower APK on the test phone and open its QR scanner. Scan the first borrower's QR, review the preview, enter the phone's IMEI 1 and IMEI 2 where applicable, grant notification and overlay access, complete OTP and running-app consent, and finish registration. Give **explicit location consent** and the Android location grant if Get Location will be tested. The APK needs a valid Firebase configuration and FCM token for its actual Android package; otherwise final activation or push delivery can fail.

Postman handles the **dealer side** of this step. A QR response alone does not create a `Device` record. After the APK completes activation, use:

```http
GET {{BASE_URL}}/api/distributor/devices?enrollmentMode=RUNNING_APP&search=Aastha_Manual_Running_1
Authorization: Bearer {{ACCESS_TOKEN}}
```

Find the row for borrower `6acd12f2ec3d0ff275866cf7`, confirm `state: "ACTIVE"`, and save its `_id` as `DEVICE_ID`. Its `allowedActions` should show lock, reminder, and location enabled if the APK reported the required current grants. Then inspect:

```http
GET {{BASE_URL}}/api/distributor/devices/{{DEVICE_ID}}
Authorization: Bearer {{ACCESS_TOKEN}}
```

`data.device.allowedActions` gives the reason when an action is unavailable. Running capabilities must be fresh, and location also needs consent, tenant enablement, and a current location grant. Ask the APK to refresh `/api/app/device/capabilities` if grants changed.

### 4. Send the pending/upcoming EMI reminder

```http
POST {{BASE_URL}}/api/distributor/users/{{BORROWER_ID}}/upcoming-emi-reminder
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{"windowDays":30,"note":"Aastha test: upcoming EMI reminder"}
```

Expect HTTP `201`, `data.queued: true`, `commandType: "EMI_REMINDER"`, a command ID, and the due installment. Confirm overlay plus sound on the phone. The test borrowers were given a disbursement date one day before setup so their first due EMI falls within the API's maximum 30-day lookahead. If `queued: false` with `NO_UPCOMING_EMI`, inspect the actual due date with the EMI-list request below; if `DEVICE_NOT_REACHABLE`, complete activation first. Repeating an active reminder can reuse its existing command.

For the separate **overdue notification** flow, use `POST /api/distributor/users/{{BORROWER_ID}}/overdue-emi-reminder` with `{"note":"Aastha overdue test"}` only once an EMI is actually overdue. A new borrower is not overdue, so this request will correctly return `queued: false` and `NO_OVERDUE_EMI` until then. MANUAL mode still receives automatic scheduled reminders; it does not auto-lock for EMI lateness.

### 5. Manually lock and unlock

```http
POST {{BASE_URL}}/api/distributor/devices/{{DEVICE_ID}}/lock
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{"reason":"Aastha manual lock test"}
```

Expect HTTP `200`, a `LOCK` command, and a locked server state. Confirm the running APK shows its lock overlay. Then:

```http
POST {{BASE_URL}}/api/distributor/devices/{{DEVICE_ID}}/unlock
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{"reason":"Aastha manual unlock test"}
```

Expect HTTP `200`, an `UNLOCK` command, and the overlay to clear after delivery/acknowledgement. Repeating a control when the device already has that state may return `200` with `noChange` rather than creating a second command. Refresh device detail after each action.

### 6. Get location

```http
POST {{BASE_URL}}/api/distributor/devices/{{DEVICE_ID}}/location-request
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{}
```

Expect HTTP `201`, a `GET_LOCATION` command, and an `immediateDelivery` result. The command does not itself contain coordinates. Repeat `GET /api/distributor/devices/{{DEVICE_ID}}` after the APK reports a position and inspect `data.device.lastLocation` and `data.latestLocationCommand`. If the backend reports `CAPABILITY_UNAVAILABLE`, check that the borrower accepted location consent, Android location is granted, the dealer's running location setting is enabled, and the last capability report is recent.

### 7. Record an external EMI payment

First get the actual installment IDs:

```http
GET {{BASE_URL}}/api/distributor/users/{{BORROWER_ID}}/emi-installments
Authorization: Bearer {{ACCESS_TOKEN}}
```

Use installment number **1** for the two-installment first borrower. In Postman's **Post-response/Tests** tab:

```javascript
const installments = pm.response.json().data.installments;
const first = installments.find((item) => item.installmentNumber === 1);
pm.environment.set("INSTALLMENT_ID", first._id);
```

To demonstrate the payment-triggered unlock, lock the first device again before marking this **non-final** installment paid. Then:

```http
POST {{BASE_URL}}/api/distributor/users/{{BORROWER_ID}}/emi-installments/{{INSTALLMENT_ID}}/mark-paid
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{"reason":"Offline payment verified by Aastha","reference":"AASTHA-MANUAL-EMI-1"}
```

Expect HTTP `200`, `data.installment.status: "paid"`, `data.unlockQueued: true` because the device was locked, and `data.releaseCommand: null` because one EMI remains. Refresh the phone and device detail to check that the overlay clears. If the device was already unlocked, the payment is still recorded but `unlockQueued` is false. This action marks the **full outstanding installment** paid; use it only for a test payment Aastha intends to record.

### 8. Onboard the second borrower and test release

Set `BORROWER_ID` to `6acd12f2ec3d0ff275866d0f`. Generate/display its QR using step 2, activate another test phone with the running APK using step 3, and save its device ID. Fetch its single `INSTALLMENT_ID` using step 7. Once ready to end its test lifecycle, call:

```http
POST {{BASE_URL}}/api/distributor/users/{{BORROWER_ID}}/emi-installments/{{INSTALLMENT_ID}}/mark-paid
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{"reason":"Final offline payment verified by Aastha","reference":"AASTHA-MANUAL-FINAL"}
```

Expect HTTP `200`, `data.scheduleStatus: "settled"`, `data.commandScheduled: true`, and `data.releaseCommand.commandType: "RELEASE_DEVICE"`. The device moves to `RELEASE_PENDING`; after the APK receives and acknowledges the command, confirm `RELEASED` and removal of its overlay/management behavior. **Release is permanent for this test device.**

There is also `POST /api/distributor/devices/{{DEVICE_ID}}/release` with `{"reason":"Manual release"}` for a device whose schedule was already settled but has no active release command. Before settlement it rejects with `400`; after the final mark-paid call above, the release command is already queued, so repeating it is not the normal test path.

## Troubleshooting and completion checklist

- `401`: dealer access token missing or expired; log in again.
- `402` on borrower registration: insufficient keys; these two borrowers were already created and the dealer currently has 10 keys available.
- `409 RUNNING_ENROLLMENT_DISABLED` or `RUNNING_ENROLLMENT_NOT_CONFIGURED`: check dealer policy and server running-enrollment settings.
- Reminder returns `queued: false`: inspect the due date and linked-device status before retrying.
- Location or lock returns `409 CAPABILITY_UNAVAILABLE`: refresh the APK's reported grants and inspect `allowedActions` in device detail.
- The API may queue a command while FCM delivery or Android permission enforcement fails. Record both the backend command and what the phone actually displayed.
- Keep borrower 1 for repeatable control tests. Use borrower 2 for the final payment and release at the end.

Setup was verified against the live backend on 12 October 2026: the new dealer login worked, both borrower records were visible under the dealer, both borrower QR requests returned `RUNNING_APP_LINK`, running enrollment and location were enabled, and the balance was **10**. Neither phone had been physically onboarded at document creation; the lock, reminder, location, payment, and release steps above are Aastha's test procedure, not completed-device results.
