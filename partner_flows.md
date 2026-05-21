# EMI Shield - Partner App Flows

> **Purpose:** Flows for the Partner App used by `partner_admin` accounts.
> A partner can onboard tenants under their own channel partner and resolve escalated cases from those tenants.
> **Base URL:** `https://api.emishield.in/api/v1`

---

## API Availability Summary

| Flow | Required API | Status |
|---|---|---|
| Partner Admin Login | `POST /auth/login` | Available |
| Partner Dashboard | `GET /partner/dashboard` | Available |
| Tenant List | `GET /partner/tenants` | Available |
| Create Tenant | `POST /partner/tenants` | Available |
| Tenant Admin Account Management | `/partner/accounts/*` | Available |
| Partner Escalation Queue | `GET /partner/escalations` | Available |
| Partner Escalation Detail | `GET /partner/escalations/:caseId` | Available |
| Resolve Partner Escalation | `/partner/escalations/:caseId/*` | Available |

---

## Scope Rules

1. Partner APIs require `tokenType: account` and `role: partner_admin`.
2. `channelPartnerId` is always resolved from the partner admin JWT.
3. Partner requests must not send `channelPartnerId` to choose scope.
4. Partner-created tenants automatically belong to the authenticated partner.
5. Partner-created tenants receive centralized default `tenantPolicies` and all default `devicePolicies`.
6. Partner account APIs can create and manage only `tenant_admin` accounts for tenants under that partner.
7. Partner escalation APIs can act only on cases with `status: ESCALATED_PARTNER`.

---

## Flow PA-1 - Partner Admin Login

> **Actor:** Partner Admin  
> **Outcome:** Partner admin receives an account access token scoped to their channel partner.

```http
POST /auth/login

Body:
{
  "email": "partneradmin@example.com",
  "password": "Welcome@123"
}
```

**Backend actions:**
1. Validates email and password.
2. Confirms account is active and role is `partner_admin`.
3. Returns access token with `channelPartnerId`.
4. Sets refresh token as HTTP-only cookie.

**Response data to store:**
- `accessToken`
- `account.channelPartnerId`

**API status:** Available.

---

## Flow PA-2 - Partner Dashboard

> **Actor:** Partner Admin  
> **Outcome:** Partner admin sees the operational health of all tenants under the partner.

```http
GET /partner/dashboard
Authorization: Bearer <partnerAdminToken>
```

**Dashboard shows:**
- Total tenants
- Active/inactive tenants
- Tenant admin account count
- Total borrowers
- Total devices
- Devices grouped by state
- Open cases
- Cases escalated to partner
- Recent escalations

**Backend actions:**
1. Validates partner admin.
2. Loads partner scope from JWT.
3. Aggregates tenants, users, devices, accounts, and cases under that partner only.

**API status:** Available.

---

## Flow PA-3 - Tenant List

> **Actor:** Partner Admin  
> **Outcome:** Partner admin can browse tenants under their channel partner.

```http
GET /partner/tenants?status=active&capability=lend&search=pune&page=1&limit=20
Authorization: Bearer <partnerAdminToken>
```

**Backend actions:**
1. Validates partner admin.
2. Filters tenants by authenticated partner `channelPartnerId`.
3. Applies optional filters: `status`, `capability`, `search`.
4. Returns paginated tenants.

**API status:** Available.

---

## Flow PA-4 - Create Tenant

> **Actor:** Partner Admin  
> **Outcome:** Partner creates a tenant under their own channel partner.

```http
POST /partner/tenants
Authorization: Bearer <partnerAdminToken>

Body:
{
  "name": "Bharat Finance - Jaipur Branch",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "parentTenantId": null,
  "supportPhone": "9800000010",
  "supportEmail": "support@bharatjaipur.in",
  "supportWhatsapp": "9800000010",
  "address": {
    "street": "20 MI Road",
    "city": "Jaipur",
    "state": "Rajasthan",
    "pincode": "302001"
  }
}
```

**Important request rules:**
- Do not send `channelPartnerId`.
- Do not send `tenantPolicy`.
- Do not send `devicePolicies`.

**Backend actions:**
1. Validates partner admin.
2. Reads `channelPartnerId` from JWT.
3. Validates tenant `type` and `capabilities`.
4. Creates `tenants`.
5. Copies centralized `DEFAULT_TENANT_POLICY` into `tenantPolicies`.
6. Copies centralized `DEFAULT_DEVICE_POLICIES` into `devicePolicies`.
7. Writes audit logs.

**API status:** Available.

---

## Flow PA-5 - Tenant Admin Account Management

> **Actor:** Partner Admin  
> **Outcome:** Partner can create, list, update, activate, and deactivate `tenant_admin` accounts for partner-owned tenants.

### List Tenant Admin Accounts

```http
GET /partner/accounts?tenantId=<tenantId>&status=active&page=1&limit=20
Authorization: Bearer <partnerAdminToken>
```

### Create Tenant Admin

```http
POST /partner/accounts
Authorization: Bearer <partnerAdminToken>

Body:
{
  "name": "Priya Sharma",
  "email": "priya@bharatjaipur.in",
  "mobile": "9800000011",
  "tenantId": "<tenantId>",
  "temporaryPassword": "Welcome@123"
}
```

### Update Tenant Admin

```http
PATCH /partner/accounts/:accountId
Authorization: Bearer <partnerAdminToken>

Body:
{
  "name": "Priya S. Sharma",
  "mobile": "9800000099"
}
```

### Activate / Deactivate Tenant Admin

```http
PATCH /partner/accounts/:accountId/status
Authorization: Bearer <partnerAdminToken>

Body:
{
  "isActive": false,
  "reason": "Admin left organisation"
}
```

**Backend actions:**
1. Validates partner admin.
2. Resolves all tenant IDs under partner.
3. Ensures target tenant/account belongs to one of those tenants.
4. Allows only `tenant_admin` account management.
5. Writes audit logs.

**API status:** Available.

---

## Flow PA-6 - Partner Escalation Queue

> **Actor:** Partner Admin  
> **Outcome:** Partner sees cases escalated from tenants under their channel partner.

```http
GET /partner/escalations?status=ESCALATED_PARTNER&tenantId=<tenantId>&page=1&limit=20
Authorization: Bearer <partnerAdminToken>
```

**Backend actions:**
1. Validates partner admin.
2. Filters `unlockRequests` by partner scope.
3. Defaults status to `ESCALATED_PARTNER`.
4. Optionally filters by partner-owned `tenantId`.
5. Returns borrower, device, and tenant summaries.

**API status:** Available.

---

## Flow PA-7 - Partner Escalation Detail

> **Actor:** Partner Admin  
> **Outcome:** Partner reviews evidence and history before resolving a case.

```http
GET /partner/escalations/:caseId
Authorization: Bearer <partnerAdminToken>
```

**Response includes:**
- Unlock request details
- Borrower summary
- Device summary
- Tenant summary
- Device command history
- Audit trail

**Backend actions:**
1. Validates partner admin.
2. Finds case by `caseId` and partner scope.
3. Loads linked tenant, borrower, device, commands, and audit logs.

**API status:** Available.

---

## Flow PA-8 - Resolve Partner Escalation

> **Actor:** Partner Admin  
> **Outcome:** Partner resolves a case with full unlock, temporary unlock, or rejection.

### Full Unlock

```http
POST /partner/escalations/:caseId/unlock
Authorization: Bearer <partnerAdminToken>

Body:
{
  "note": "Borrower proof verified by partner operations."
}
```

**Backend actions:**
1. Validates case belongs to partner.
2. Allows action only when `status: ESCALATED_PARTNER`.
3. Updates device to `UNLOCK_PENDING`.
4. Sets `currentPolicyKey: EMI_PAID`.
5. Creates `deviceCommands` with `triggeredBy: partner_admin`.
6. Updates case to `RESOLVED_PARTNER`.
7. Writes audit log.

### Temporary Unlock

```http
POST /partner/escalations/:caseId/temp-unlock
Authorization: Bearer <partnerAdminToken>

Body:
{
  "durationHours": 24,
  "note": "Emergency access approved while payment proof is reviewed."
}
```

**Rule:** `durationHours` cannot exceed the tenant policy `tempUnlockRules.maxDurationHours`.

**Backend actions:**
1. Validates case belongs to partner.
2. Allows action only when `status: ESCALATED_PARTNER`.
3. Updates device to `TEMP_UNLOCK`.
4. Sets `currentPolicyKey: TEMP_UNLOCKED`.
5. Sets `tempUnlockExpiresAt`.
6. Creates `deviceCommands` with `triggeredBy: partner_admin`.
7. Updates case to `RESOLVED_PARTNER`.
8. Writes audit log.

### Reject Case

```http
POST /partner/escalations/:caseId/reject
Authorization: Bearer <partnerAdminToken>

Body:
{
  "note": "No valid payment proof found."
}
```

**Backend actions:**
1. Validates case belongs to partner.
2. Allows action only when `status: ESCALATED_PARTNER`.
3. Updates case to `REJECTED`.
4. Stores resolution note and resolver.
5. Writes audit log.

**API status:** Available.

---

## Final Partner App Checklist

1. Login as `partner_admin`.
2. Open dashboard.
3. List existing tenants.
4. Create a tenant.
5. Create a `tenant_admin` for that tenant.
6. List partner escalations.
7. Open escalation detail.
8. Resolve the escalation by unlock, temp unlock, or reject.
