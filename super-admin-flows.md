# EMI Shield — Super Admin Flows

> **Purpose:** Operational flows for the Admin Dashboard used by EMI Shield super admins.
> Login is already covered by `POST /auth/login`; these flows start after a valid `super_admin` access token exists.
> **Base URL:** `https://api.emishield.in/api/v1`

---

## Flow SA-2 — Channel Partner Management

> **Actor:** Super Admin
> **Outcome:** Channel partners can be listed, created, reviewed, updated, activated, or deactivated.

### Step SA-2.1 — List Channel Partners

```
GET /admin/channel-partners?status=active&type=nbfc_group&search=bharat&page=1&limit=20
Authorization: Bearer <superAdminToken>
```

**Backend actions:**
1. Validates `tokenType: account` and `role: super_admin`
2. Applies optional filters: `status`, `type`, `search`
3. Returns paginated channel partners with tenant/account counts

### Step SA-2.2 — Create Channel Partner

```
POST /admin/channel-partners
Authorization: Bearer <superAdminToken>

Body:
{
  "name": "Bharat Finance Group",
  "type": "nbfc_group",
  "contactEmail": "ops@bharatfinance.in",
  "contactPhone": "9800000001"
}
```

**Backend actions:**
1. Validates required fields
2. Creates `channelPartners`
3. Writes `auditLogs`: `CHANNEL_PARTNER_CREATED`

### Step SA-2.3 — View Channel Partner Detail

```
GET /admin/channel-partners/:id
Authorization: Bearer <superAdminToken>
```

**Response includes:** partner profile, admin account, tenant summary, active device count, escalation counts, and recent audit events.

### Step SA-2.4 — Update Channel Partner

```
PATCH /admin/channel-partners/:id
Authorization: Bearer <superAdminToken>
```

### Step SA-2.5 — Activate / Deactivate Channel Partner

```
PATCH /admin/channel-partners/:id/status
Authorization: Bearer <superAdminToken>

Body:
{
  "isActive": false,
  "reason": "Contract ended"
}
```

**Rule:** Deactivation does not delete tenants, devices, users, audit logs, or consent records. It blocks new logins/actions for accounts under the partner unless explicitly exempted.

---

## Flow SA-3 — Tenant Management

> **Actor:** Super Admin
> **Outcome:** A tenant is created under a channel partner. Centralized default tenant and device policies are copied automatically for every tenant.

### Step SA-3.1 — List Tenants

```
GET /admin/tenants?channelPartnerId=<id>&capability=lend&status=active&search=pune&page=1&limit=20
Authorization: Bearer <superAdminToken>
```

**Response includes:** tenant profile summary, channel partner name, capabilities, active device count, locked device count, pending escalation count, and risk flag count.

### Step SA-3.2 — Create Tenant

The create tenant form contains tenant profile fields only. Policy JSON is not accepted in this request.

Default policies live centrally in the backend constants folder, for example `backend/src/constants/defaultPolicies.js`. On tenant creation, the backend copies those defaults into tenant-scoped `tenantPolicies` and `devicePolicies` records.

```
POST /admin/tenants
Authorization: Bearer <superAdminToken>

Body:
{
  "name": "Bharat Finance - Pune Branch",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "channelPartnerId": "<channelPartnerId>",
  "parentTenantId": null,
  "supportPhone": "9800000002",
  "supportEmail": "support@bharatpune.in",
  "supportWhatsapp": "9800000002",
  "address": {
    "street": "12, MG Road",
    "city": "Pune",
    "state": "Maharashtra",
    "pincode": "411001"
  }
}
```

**Backend actions:**
1. Validates channel partner exists and is active
2. Validates tenant `type`, `capabilities`, and `parentTenantId` rules
3. Starts a MongoDB transaction
4. Creates `tenants`
5. Copies centralized `DEFAULT_TENANT_POLICY` into one `tenantPolicies` document
6. Copies centralized `DEFAULT_DEVICE_POLICIES` into five `devicePolicies` documents
7. Uses the same default policy templates for every tenant, regardless of tenant capabilities
8. Writes `auditLogs`: `TENANT_CREATED`, `TENANT_POLICY_CREATED`, `DEVICE_POLICIES_CREATED`
9. Commits the transaction

**Validation rules:**
- Request body must not provide `tenantPolicy` or `devicePolicies`
- Every tenant receives one tenant policy and all five device policies: `EMI_PAID`, `EMI_GRACE`, `EMI_LOCKED`, `TEMP_UNLOCKED`, `CONSENT_INVALID`
- The centralized `EMI_LOCKED` default must always allow the borrower app and emergency dialer
- Tenant capability affects which APIs the tenant can use, not whether policy records are created

### Step SA-3.3 — View Tenant Detail

```
GET /admin/tenants/:id
Authorization: Bearer <superAdminToken>
```

**Response includes:** tenant profile, channel partner, parent tenant, accounts summary, policies, QR summary, devices by state, pending cases, and risk flags.

### Step SA-3.4 — Update Tenant Profile

```
PATCH /admin/tenants/:id
Authorization: Bearer <superAdminToken>
```

### Step SA-3.5 — Activate / Deactivate Tenant

```
PATCH /admin/tenants/:id/status
Authorization: Bearer <superAdminToken>

Body:
{
  "isActive": false,
  "reason": "Tenant offboarded"
}
```

**Rule:** Deactivation blocks new onboarding, tenant admin actions, and policy changes. It does not delete historical records.

---

## Flow SA-4 — Admin Account Management

> **Actor:** Super Admin
> **Outcome:** Super Admin can create, update, activate, and deactivate both supported operational account roles: `partner_admin` and `tenant_admin`.

### Step SA-4.1 — List Admin Accounts

```
GET /admin/accounts?role=tenant_admin&tenantId=<tenantId>&status=active&page=1&limit=20
Authorization: Bearer <superAdminToken>
```

**Backend actions:**
1. Validates `role: super_admin`
2. Applies optional filters: `role`, `tenantId`, `channelPartnerId`, `status`, `search`
3. Returns only account metadata; never returns password hashes or tokens

### Step SA-4.2 — Create Tenant Admin

```
POST /admin/accounts
Authorization: Bearer <superAdminToken>

Body:
{
  "name": "Priya Sharma",
  "email": "priya@bharatpune.in",
  "mobile": "9800000003",
  "role": "tenant_admin",
  "tenantId": "<tenantId>",
  "temporaryPassword": "Welcome@123"
}
```

**Backend actions:**
1. Validates tenant exists and is active
2. Validates email uniqueness
3. Hashes `temporaryPassword`
4. Creates `accounts`
5. Writes `auditLogs`: `ACCOUNT_CREATED`

### Step SA-4.3 — Create Partner Admin

```
POST /admin/accounts
Authorization: Bearer <superAdminToken>

Body:
{
  "name": "Anita Rao",
  "email": "anita@bharatfinance.in",
  "mobile": "9800000005",
  "role": "partner_admin",
  "channelPartnerId": "<channelPartnerId>",
  "temporaryPassword": "Welcome@123"
}
```

**Backend actions:**
1. Validates channel partner exists and is active
2. Validates email uniqueness
3. Hashes `temporaryPassword`
4. Creates `accounts`
5. Writes `auditLogs`: `ACCOUNT_CREATED`

### Step SA-4.4 — Update Admin Account

```
PATCH /admin/accounts/:accountId
Authorization: Bearer <superAdminToken>

Body:
{
  "name": "Priya S. Sharma",
  "mobile": "9800000099"
}
```

**Rule:** Role/scope changes are allowed only when the target scope is valid:
- `tenant_admin` must have `tenantId`
- `partner_admin` must have `channelPartnerId`
- No account can be changed into any role outside `partner_admin` or `tenant_admin`

### Step SA-4.5 — Activate / Deactivate Admin Account

```
PATCH /admin/accounts/:accountId/status
Authorization: Bearer <superAdminToken>

Body:
{
  "isActive": false,
  "reason": "Admin left organisation"
}
```

**Rule:** Deactivation blocks login and refresh-token use for that account. Historical audit logs remain unchanged.

---

## Flow SA-6 — Consent Version Management

> **Actor:** Super Admin
> **Outcome:** Consent documents are versioned, published, and preserved for legal auditability.

### Step SA-6.1 — List Consent Versions

```
GET /admin/consent-versions?status=current
Authorization: Bearer <superAdminToken>
```

### Step SA-6.2 — Create Consent Version

```
POST /admin/consent-versions
Authorization: Bearer <superAdminToken>

Body:
{
  "version": "1.2",
  "title": "EMI Shield Device Control Agreement",
  "borrowerAgreementText": "...",
  "deviceControlConsentText": "...",
  "privacyPolicyText": "...",
  "tripartiteAckText": "..."
}
```

**Backend actions:**
1. Validates version is unique
2. Creates `consentVersions` with `isCurrent: false`
3. Writes `auditLogs`: `CONSENT_VERSION_CREATED`

### Step SA-6.3 — Publish Consent Version

```
PATCH /admin/consent-versions/:id/publish
Authorization: Bearer <superAdminToken>

Body:
{
  "reason": "Updated legal language for emergency access and consent clarity"
}
```

**Backend actions:**
1. Validates consent version exists
2. In a transaction, sets all versions `isCurrent: false`
3. Sets the selected version `isCurrent: true`, `publishedAt`, `publishedBy`
4. Writes `auditLogs`: `CONSENT_VERSION_PUBLISHED`

**Rule:** Existing `consentRecords` keep pointing to the version accepted by the borrower. They are never modified.

---

## Flow SA-7 — Escalation Queue

> **Actor:** Super Admin
> **Outcome:** Super Admin can see cases that breached tenant and channel partner SLAs.

### Step SA-7.1 — List Admin Escalations

```
GET /admin/escalations?status=ESCALATED_ADMIN&tenantId=<id>&channelPartnerId=<id>&page=1&limit=20
Authorization: Bearer <superAdminToken>
```

**Backend actions:**
1. Queries `unlockRequests` where `status: ESCALATED_ADMIN`
2. Applies optional filters
3. Returns case summaries with borrower, device, tenant, channel partner, SLA breach timestamps, and evidence thumbnail

### Step SA-7.2 — View Escalation Detail

```
GET /admin/escalations/:caseId
Authorization: Bearer <superAdminToken>
```

**Response includes:** case reason, evidence URL, SLA history, borrower/device summary, EMI overdue summary, related payments, unlock request history, command history, and audit trail.

**Rule:** Passive viewing should not mutate the case. Set `UNDER_REVIEW` only through an explicit review action if that API is added later.

---

## Flow SA-8 — Super Admin Override

> **Actor:** Super Admin
> **Outcome:** Super Admin resolves a fully escalated case by override unlock, temporary unlock, or rejection.

### Step SA-8.1 — Override Full Unlock

```
POST /admin/escalations/:caseId/unlock
Authorization: Bearer <superAdminToken>

Body:
{
  "reason": "Tenant and channel partner both breached SLA. Borrower proof verified.",
  "emiAction": "none"
}
```

**Backend actions:**
1. Validates case exists and is `ESCALATED_ADMIN` or `UNDER_REVIEW`
2. Validates `reason` is present
3. Updates device to `UNLOCK_PENDING`, `currentPolicyKey: EMI_PAID`, increments desired policy version
4. Creates `deviceCommands`: `UNLOCK`, `triggeredBy: super_admin`
5. Updates `unlockRequests`: `RESOLVED_SUPER_ADMIN`
6. Sends FCM `POLICY_UPDATE` and borrower notification
7. Writes `auditLogs`: `OVERRIDE_EXECUTED`, `UNLOCK_TRIGGERED`

### Step SA-8.2 — Override Temporary Unlock

```
POST /admin/escalations/:caseId/temp-unlock
Authorization: Bearer <superAdminToken>

Body:
{
  "durationHours": 24,
  "reason": "Emergency access approved while payment dispute is reviewed"
}
```

### Step SA-8.3 — Reject Escalation

```
POST /admin/escalations/:caseId/reject
Authorization: Bearer <superAdminToken>

Body:
{
  "reason": "Bank record confirms no payment was received"
}
```

**Non-negotiable rules:**
- All override actions require `reason`
- Super Admin override is allowed only on escalated cases
- The platform never deletes the case, command, or audit history

---

## Flow SA-11 — Device Oversight

> **Actor:** Super Admin
> **Outcome:** Super Admin can inspect any device for support, compliance, or escalation review without becoming the default lock authority.

### Step SA-11.1 — Search Devices

```
GET /admin/devices?imei=123456789012345&tenantId=<id>&state=LOCKED&mobile=9876543210&page=1&limit=20
Authorization: Bearer <superAdminToken>
```

**Response includes:** IMEI, borrower, tenant, channel partner, state, current policy, last seen time, root/tamper flags, and pending command count.

### Step SA-11.2 — View Device Detail

```
GET /admin/devices/:deviceId
Authorization: Bearer <superAdminToken>
```

**Response includes:** device identifiers, borrower and tenant summary, current policy, consent status, EMI overdue summary, unlock requests, latest command status, and risk flags.

### Step SA-11.3 — View Device Command History

```
GET /admin/devices/:deviceId/commands
Authorization: Bearer <superAdminToken>
```

### Step SA-11.4 — View Device Audit Trail

```
GET /admin/devices/:deviceId/audit-logs
Authorization: Bearer <superAdminToken>
```

**Rule:** Device oversight is read-heavy. Super Admin does not use this flow for casual lock/unlock. Unlock actions go through Flow SA-8 when a case is escalated.
