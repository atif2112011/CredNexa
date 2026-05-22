# EMI Shield — Tenant App Onboarding Flows

> **Purpose:** Flows for the Tenant App used by `tenant_admin` to onboard borrowers and track device activation.
> These flows focus only on onboarding new users and registering financed devices.
> **Base URL:** `https://api.emishield.in/api/v1`

---

## API Availability Summary

| Flow | Required API | Status |
|---|---|---|
| Tenant Admin Login | `POST /auth/login` | Available |
| Tenant App Dashboard | `GET /distributor/dashboard` | Available |
| Register New Borrower | `POST /distributor/users/register` | Available |
| Generate Enrollment QR | `POST /distributor/enrollment/qr` | Available |
| Track Enrollment Status | `GET /distributor/enrollments/:token/status` | Available |
| View Borrower Detail | `GET /distributor/users/:id` | Available |
| View Device Inventory | `GET /distributor/devices` | Available |
| View Device Detail | `GET /distributor/devices/:id` | Available |
| Regenerate Enrollment QR | `POST /distributor/enrollment/:token/regenerate` | Available |
| Tenant QR Code Management | `/distributor/qr-codes/*` | Available |
| Payment Approval Queue | `/distributor/payments/*` | Available |
| Manual Device Lock / Unlock | `/distributor/devices/:id/*` | Available |
| Borrower Unlock Request Queue | `/distributor/unlock-requests/*` | Available |

Current simulation can complete onboarding, QR payment approval, borrower unlock requests, manual tenant lock/unlock, and device command acknowledgement using Tenant App `/distributor/*` APIs plus borrower-side `/app/*` APIs.

---

## Flow TA-1 — Tenant Admin Login

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin receives an access token scoped to their tenant.

```
POST /auth/login

Body:
{
  "email": "tenantadmin@example.com",
  "password": "Welcome@123"
}
```

**Backend actions:**
1. Validates email and password against `accounts`
2. Confirms account is active and role is `tenant_admin`
3. Returns access token with `tokenType: account`, `role: tenant_admin`, and `tenantId`
4. Sets refresh token as HTTP-only cookie

**Response data to store:**
- `accessToken`
- `account.tenantId`

**API status:** Available.

---

## Flow TA-2 — Tenant App Dashboard

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin sees onboarding progress and activation health.

```
GET /distributor/dashboard
Authorization: Bearer <tenantAdminToken>
```

**Dashboard should show:**
- Borrowers registered today
- Total registered borrowers
- Enrollment tokens active, consumed, expired, and cancelled
- Devices pending activation
- Devices activated
- Devices grouped by state
- Recent enrollments with status

**Backend actions:**
1. Validates `tenant_admin`
2. Scopes all counts to `req.auth.tenantId`
3. Aggregates users, enrollment tokens, and devices

**API status:** Available.

---

## Flow TA-3 — Register New Borrower

> **Actor:** Tenant Admin  
> **Outcome:** Borrower, EMI schedule, and enrollment token are created.

```
POST /distributor/users/register
Authorization: Bearer <tenantAdminToken>

Body:
{
  "name": "Ramesh Kumar",
  "mobile": "9876543210",
  "email": "ramesh@example.com",
  "aadhaarLinkedMobile": "9876543210",
  "loanId": "LOAN-TEST-001",
  "loanAmount": 18000,
  "emiAmount": 3000,
  "tenureMonths": 6,
  "disbursementDate": "2026-05-21"
}
```

**Backend actions:**
1. Validates tenant admin and tenant `distribute` capability
2. Creates `users` with `tenantId` from JWT
3. Generates `emiSchedules.installments`
4. Generates short-lived `enrollmentToken`
5. Writes audit log

**Response data to store:**
- `userId`
- `tenantId`
- `emiScheduleId`
- `enrollmentToken`
- `tokenExpiresAt`

**API status:** Available.

---

## Flow TA-4 — Generate Enrollment QR

> **Actor:** Tenant Admin  
> **Outcome:** Tenant App displays an Android Device Owner provisioning QR code.

```
POST /distributor/enrollment/qr
Authorization: Bearer <tenantAdminToken>

Body:
{
  "enrollmentToken": "<enrollmentToken>"
}
```

**Backend actions:**
1. Validates tenant admin and tenant scope
2. Confirms enrollment token belongs to the same tenant
3. Confirms token is not expired, consumed, or cancelled
4. Builds Android provisioning JSON
5. Generates QR image from that JSON
6. Writes audit log

**Response includes:**
```json
{
  "qrPayload": {
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.emishield.app/.AdminReceiver",
    "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
      "enrollmentToken": "<enrollmentToken>"
    }
  },
  "qrCodeDataUrl": "data:image/png;base64,...",
  "qrCodeMimeType": "image/png",
  "enrollmentToken": "<enrollmentToken>",
  "tokenExpiresAt": "..."
}
```

**Tenant App action:** render `qrCodeDataUrl` as an image.

**API status:** Available.

---

## Flow TA-5 — Track Enrollment Status

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin can see where the borrower/device is in the onboarding journey.

```
GET /distributor/enrollments/:token/status
Authorization: Bearer <tenantAdminToken>
```

**Statuses to return:**
- `USER_REGISTERED`
- `QR_GENERATED`
- `CONSENT_COMPLETED`
- `ACTIVATION_COMPLETE`
- `TOKEN_EXPIRED`
- `TOKEN_CONSUMED`
- `TOKEN_CANCELLED`

**Backend actions:**
1. Finds enrollment token by token and tenant scope
2. Checks token expiry/consumption
3. Checks whether user has `consentRecordId`
4. Checks whether device exists for user
5. Returns combined onboarding status

**API status:** Available.

---

## Flow TA-6 — View Borrower Detail

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin can inspect borrower registration and activation state.

```
GET /distributor/users/:id
Authorization: Bearer <tenantAdminToken>
```

**Response should include:**
- Borrower profile
- Loan details
- EMI schedule
- Enrollment token status
- Consent status
- Linked device summary

**Backend actions:**
1. Validates tenant admin
2. Finds user by `_id` and `tenantId`
3. Loads EMI schedule
4. Loads current enrollment token
5. Loads consent record and linked device if present

**API status:** Available.

---

## Flow TA-7 — View Device Inventory

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin sees devices registered under their tenant.

```
GET /distributor/devices
Authorization: Bearer <tenantAdminToken>
```

**Backend actions:**
1. Validates tenant admin and tenant `distribute` capability
2. Lists devices where `tenantId` equals JWT tenant
3. Returns newest first

**Response should show:**
- IMEI
- Device model/manufacturer
- Linked borrower
- Device state
- Created date

**API status:** Available.

---

## Flow TA-8 — View Device Detail

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin can inspect one activated device.

```
GET /distributor/devices/:id
Authorization: Bearer <tenantAdminToken>
```

**Response should include:**
- IMEI and hardware details
- Linked borrower
- Current state
- Current policy key/version
- Last seen
- FCM token timestamp

**Backend actions:**
1. Validates tenant admin
2. Finds device by `_id` and `tenantId`
3. Loads linked borrower
4. Loads current active device policy

**API status:** Available.

---

## Flow TA-9 — Regenerate Enrollment QR

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin can recover from expired or failed QR provisioning.

```
POST /distributor/enrollment/:token/regenerate
Authorization: Bearer <tenantAdminToken>
```

**Backend actions:**
1. Finds old enrollment token by tenant scope
2. Rejects regeneration if a device is already registered
3. Rejects regeneration if the token is already consumed
4. Rejects regeneration if the token has already been regenerated
5. Marks old token cancelled
6. Creates a new enrollment token for the same user and tenant
7. Returns new Android provisioning QR payload and QR image
8. Writes audit log

**Response should include:**
- new `enrollmentToken`
- new `tokenExpiresAt`
- new `qrPayload`
- new `qrCodeDataUrl`

**API status:** Available.

---

## Flow TA-10 — Tenant Payment QR Management

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin manages the QR image borrowers use for external UPI/manual payment.

### List QR Codes

```http
GET /distributor/qr-codes
Authorization: Bearer <tenantAdminToken>
```

### Add QR Code

```http
POST /distributor/qr-codes
Authorization: Bearer <tenantAdminToken>

Body:
{
  "label": "PhonePe Business QR",
  "imageUrl": "https://storage.example.com/tenant/phonepe-qr.png",
  "activate": true
}
```

### Activate QR Code

```http
PATCH /distributor/qr-codes/:qrId/activate
Authorization: Bearer <tenantAdminToken>
```

### Delete Inactive QR Code

```http
DELETE /distributor/qr-codes/:qrId
Authorization: Bearer <tenantAdminToken>
```

**Rules:**
- The first QR is activated automatically.
- Activating one QR deactivates all others.
- The active QR cannot be deleted.

**API status:** Available.

---

## Flow TA-11 — Payment Approval And Unlock

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin approves borrower-submitted QR payments and queues device unlock.

### List Pending Payments

```http
GET /distributor/payments/pending-approval
Authorization: Bearer <tenantAdminToken>
```

### View Payment Detail

```http
GET /distributor/payments/:paymentId
Authorization: Bearer <tenantAdminToken>
```

### Approve Payment

```http
POST /distributor/payments/:paymentId/approve
Authorization: Bearer <tenantAdminToken>

Body:
{
  "note": "Verified UPI credit in bank statement"
}
```

**Backend actions:**
1. Confirms payment belongs to tenant.
2. Marks payment `success` / `approved`.
3. Applies amount to oldest unpaid EMI installments.
4. Updates device to `UNLOCK_PENDING` and `EMI_PAID`.
5. Creates a pending `UNLOCK` device command.
6. FCM worker sends the policy update.

### Reject Payment

```http
POST /distributor/payments/:paymentId/reject
Authorization: Bearer <tenantAdminToken>

Body:
{
  "reason": "No matching credit found in bank statement"
}
```

**API status:** Available.

---

## Flow TA-12 — Manual Device Lock / Unlock

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin can manually control a tenant device outside onboarding.

### Manual Lock

```http
POST /distributor/devices/:id/lock
Authorization: Bearer <tenantAdminToken>

Body:
{
  "reason": "EMI grace period expired"
}
```

### Manual Full Unlock

```http
POST /distributor/devices/:id/unlock
Authorization: Bearer <tenantAdminToken>

Body:
{
  "reason": "Manual payment verified"
}
```

### Manual Temporary Unlock

```http
POST /distributor/devices/:id/temp-unlock
Authorization: Bearer <tenantAdminToken>

Body:
{
  "durationHours": 24,
  "reason": "Emergency access approved"
}
```

**Backend actions:**
1. Validates device belongs to tenant.
2. Updates device state and current policy key.
3. Increments desired policy version.
4. Creates a pending `deviceCommands` record.
5. FCM worker delivers policy update.

**API status:** Available.

---

## Flow TA-13 — Borrower Unlock Request Queue

> **Actor:** Tenant Admin  
> **Outcome:** Tenant admin reviews borrower-created unlock requests.

### List Requests

```http
GET /distributor/unlock-requests?status=PENDING_TENANT
Authorization: Bearer <tenantAdminToken>
```

### View Request Detail

```http
GET /distributor/unlock-requests/:caseId
Authorization: Bearer <tenantAdminToken>
```

### Approve Full Unlock

```http
POST /distributor/unlock-requests/:caseId/approve
Authorization: Bearer <tenantAdminToken>

Body:
{
  "note": "Payment proof verified",
  "emiAction": "none"
}
```

Use `"emiAction": "waive"` only when the tenant intentionally waives the active overdue installment.

### Approve Temporary Unlock

```http
POST /distributor/unlock-requests/:caseId/temp-unlock
Authorization: Bearer <tenantAdminToken>

Body:
{
  "durationHours": 24,
  "note": "Emergency access approved"
}
```

### Reject Request

```http
POST /distributor/unlock-requests/:caseId/reject
Authorization: Bearer <tenantAdminToken>

Body:
{
  "note": "No matching payment found"
}
```

**API status:** Available.
