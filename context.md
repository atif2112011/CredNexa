# EMI Shield — Project Context

> **For AI Agents:** Read this file first before working on any part of this project.
> It explains what the product is, why decisions were made, what has been built so far,
> and where everything lives. Cross-reference `architecture.md` for schemas and API routes.

---

## 1. What Is EMI Shield?

EMI Shield is a **device control and compliance SaaS platform** for financed mobile devices sold on EMI (Equated Monthly Installment) by NBFCs, retail chains, and standalone shops in India.

**The core problem it solves:**
When a customer buys a device on EMI and stops paying, the lender has no practical way to enforce repayment. EMI Shield installs an agent app on the device at time of purchase. If the customer defaults, the lender can remotely lock the device (restrict it to a lock screen), incentivizing repayment. Once payment is made, the device unlocks automatically.

**What makes it legally and ethically complex:**
- Device locking in India requires explicit, verifiable borrower consent (Aadhaar-OTP backed)
- Emergency calls (112) must always remain accessible — even on a locked device
- The platform itself is NOT a lender. It is a technology facilitator. All lock/unlock authority sits with the credit originator (tenant), not with EMI Shield
- Every action must be auditable for legal defensibility
- Personal data (photos, chats, messages) must never be accessed

---

## 2. The Business Model

```
EMI Shield (the platform)
    ↕ sells product to
Channel Partners  (e.g. an NBFC group, a large retail chain)
    ↕ who have as customers
Tenants  (individual NBFCs, shops, retail outlets)
    ↕ who sell devices to
Users  (the borrower — the person who buys the device on EMI)
```

- **EMI Shield** provides the platform, super admin dashboard, and enforcement infrastructure
- **Channel Partners** are the B2B customers of EMI Shield. They resell/distribute the product to their network of tenants. Think of them as franchise holders
- **Tenants** are the organisations that actually sell financed devices. They have dashboards for daily operations (lock/unlock, payment review, escalations). A tenant can be:
  - An NBFC — has `lend` capability only (credit originator, not direct seller)
  - A standalone shop — has both `lend` and `distribute` capabilities
  - A POS outlet under a retail chain — has `distribute` capability only (parent retail chain is the lender)
- **Users** are the device buyers. They only interact with the Android app

---

## 3. The Four Interfaces

### 3.1 Admin Dashboard (Super Admin)
- Web app used by EMI Shield's own operations team
- **Scope:** Platform-wide
- **Key functions:**
  - Manage channel partners and tenants
  - Handle escalated cases (when a tenant hasn't responded to a borrower's unlock request within the SLA)
  - Override lock/unlock in escalation scenarios (mandatory reason required, fully audited)
  - View risk flags (frequent overrides, repeated payment mismatches, SIM changes, rooted devices)
  - Manage consent document versions
  - View platform-wide audit logs

### 3.2 Partner Dashboard (Tenant Dashboard)
- Web app used by tenant staff (NBFC managers, shop owners, agents)
- **Scope:** Own tenant's data only (strict tenant isolation)
- **Key functions:**
  - View all devices and their current state (ACTIVE, LOCKED, GRACE_PERIOD, etc.)
  - Manually lock or unlock a specific device
  - Grant temporary unlock (e.g. 24 hours)
  - Review and action borrower unlock requests within SLA
  - Configure lock/unlock/escalation policy (days past due, grace period, SLA hours, etc.)
  - View payment history and manually validate mismatched payments
  - View audit logs for their own tenant

### 3.3 Distributor Dashboard
- Web app used by tenant staff who have the `distribute` capability
- Note: This may be the same staff on the same tenant — it's a capability flag, not a separate role
- **Key functions:**
  - Register a new user (borrower) with their loan details
  - Bind a device (by IMEI) to a registered user
  - View their device inventory and user list

### 3.4 Android App (Borrower App)
- Native Android app installed on the financed device at point of sale
- The borrower uses this app to pay EMIs, request unlocks, and track escalation status
- The app also runs as a background service — it receives FCM push commands for lock/unlock and syncs state on reconnect
- **CRITICAL:** The app must survive device restart (boot receiver), work offline (queue sync), and resist tampering/rooting

---

## 4. Identity and Auth Architecture

This is one of the most important decisions in the project — **two completely separate identity collections**:

### `accounts` — Dashboard users
- Super admins, channel partner staff, tenant admins, tenant staff
- Authenticate with **email + password** (or OTP for some flows)
- JWT contains `tokenType: "account"` and the account's `role` + `tenantId` / `channelPartnerId`
- Roles: `super_admin` | `channel_partner_admin` | `channel_partner_staff` | `tenant_admin` | `tenant_staff`

### `users` — Borrowers (app users)
- The device purchasers who use the Android app
- Authenticate with **mobile OTP only** (no password)
- JWT contains `tokenType: "user"`
- No dashboard access whatsoever

**Why separate collections?**
Dashboard users and borrowers are fundamentally different actors with different auth mechanisms, different data shapes, and different security models. Mixing them into one collection would create sparse documents and a confused auth system. The middleware resolves which collection to query based on `tokenType` in the JWT.

---

## 5. The Tenant Model (Critical to Understand)

The old design had separate `lenders` and `distributors` collections. This was replaced with a single **`tenants`** collection because both are just organisations with different capabilities:

```js
// A standalone shop:
{ type: 'standalone_outlet', capabilities: ['lend', 'distribute'] }

// An NBFC:
{ type: 'nbfc', capabilities: ['lend'] }

// A POS outlet under a retail chain:
{ type: 'pos_outlet', capabilities: ['distribute'], parentTenantId: <retail_chain_id> }

// A retail chain (the lender entity):
{ type: 'retail_chain', capabilities: ['lend', 'distribute'] }
```

- `parentTenantId` handles the outlet-under-chain hierarchy without a separate collection
- A tenant's `capabilities` array gates API access — lock/unlock routes check for `lend`, device registration routes check for `distribute`
- All tenants belong to a `channelPartner`

---

## 6. Core Domain Concepts

### Device States
A device moves through these states based on payment behavior and commands:

| State | Meaning |
|---|---|
| `ACTIVE` | Normal usage — EMI up to date |
| `GRACE_PERIOD` | EMI overdue but within grace window — warnings shown, device usable |
| `LOCKED` | Restricted mode — only emergency calls, Pay Now, Request Unlock allowed |
| `TEMP_UNLOCK` | Temporarily unlocked for a configured duration (e.g. 24h) |
| `UNLOCK_PENDING` | Payment validated, unlock command dispatched, waiting for device ack |
| `OFFLINE_PENDING` | Device offline when lock/unlock was triggered — command queued |
| `CONSENT_INVALID` | No valid consent record found — enforcement blocked |

### Case States (Unlock Requests)
When a borrower taps "Request Unlock" a case is created:

| State | Meaning |
|---|---|
| `PENDING_TENANT` | Waiting for the tenant to action |
| `ESCALATED` | Tenant didn't respond within SLA — auto-escalated to super admin |
| `UNDER_REVIEW` | Super admin is reviewing |
| `RESOLVED_TENANT` | Tenant approved/rejected |
| `RESOLVED_SUPER_ADMIN` | Super admin overrode |
| `REJECTED` | Request denied |
| `CLOSED` | Completed |

### Lock/Unlock Authority
- **Automatic lock:** Triggered by a background scheduler when DPD (Days Past Due) exceeds the tenant's configured threshold after the grace period
- **Manual lock:** Tenant staff triggers via the Partner Dashboard
- **Automatic unlock:** Triggered when a payment webhook is received, validated, matched to the EMI schedule, and the tenant's unlock policy says unlock
- **Manual unlock:** Tenant staff triggers via dashboard
- **Super admin unlock:** Only on escalated cases, always with a mandatory reason

### The Payment-to-Unlock Pipeline
```
Payment Gateway Webhook
  → Deduplication (unique txnRef)
  → Validation Engine (match to EMI schedule)
  → Policy Engine (evaluate tenant unlock rules)
  → Device Command Queue (UNLOCK command)
  → FCM Push to device
  → Device acks → state = ACTIVE
  → Audit log written
```

If any step fails, the payment record is retained and surfaced for manual review. The platform never loses a payment event.

---

## 7. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Backend | Node.js + Express | REST API. Modular structure by domain |
| Database | MongoDB | 17 collections — see architecture.md |
| Mobile App | Native Android (Java/Kotlin) | Boot receiver, FCM, background service, device admin API |
| Push Notifications | Firebase Cloud Messaging (FCM) | Lock/unlock commands + user notifications |
| Payments | UPI + Payment Gateway | Webhook-driven. Deep link UPI from app |
| OTP / SMS | SMS provider (e.g. MSG91) | Login OTP + Aadhaar-linked consent OTP |
| File Storage | S3-compatible | Payment proof document uploads |
| Dashboard | React (Web) | Three separate web apps or one with role-based views |

---

## 8. MongoDB Collections (Summary)

See `architecture.md` Section 5 for full schemas. Here is a quick reference:

| # | Collection | Purpose |
|---|---|---|
| 1 | `accounts` | Dashboard logins (super admin, CP staff, tenant staff) |
| 2 | `users` | Borrowers — device purchasers using the Android app |
| 3 | `channelPartners` | B2B entities reselling EMI Shield |
| 4 | `tenants` | Orgs using the product (NBFCs, shops, outlets) — replaces old `lenders` + `distributors` |
| 5 | `devices` | Device registrations + real-time state |
| 6 | `consentVersions` | Versioned legal consent documents (managed by super admin) |
| 7 | `consentRecords` | Immutable per-user consent artefacts (Aadhaar OTP backed) — never updated |
| 8 | `tenantPolicies` | Per-tenant lock/unlock/escalation config (only for `lend` tenants) |
| 9 | `emiSchedules` | EMI installment schedules per user/loan |
| 10 | `payments` | All payment transactions — unique index on `txnRef` for deduplication |
| 11 | `deviceCommands` | Lock/unlock command queue with FCM delivery tracking and retry logic |
| 12 | `unlockRequests` | Borrower-initiated cases with SLA tracking |
| 13 | `auditLogs` | Immutable tamper-evident event log — **never updated or deleted** |
| 14 | `notifications` | Push/SMS/email notification records |
| 15 | `otpRecords` | OTP lifecycle — TTL indexed (expires in 10 min) |
| 16 | `riskFlags` | Risk signals surfaced to super admin |
| 17 | `devicePolicies` | Per-tenant enforcement policies keyed by device state (`EMI_PAID`, `EMI_LOCKED`, etc.) |

### Critical Immutability Rules
- `consentRecords` — never modify after creation. Legal artefact
- `auditLogs` — never modify or delete. Tamper-evident via `logHash` (SHA-256)
- Both collections have no UPDATE/DELETE API routes

---

## 9. API Route Groups (Summary)

See `architecture.md` Section 6 for all routes with request/response examples.

| Prefix | Who Uses It | Auth |
|---|---|---|
| `/api/v1/auth` | Everyone | Public (OTP) / Credential |
| `/api/v1/app` | Borrowers (Android app) | `tokenType: user` JWT |
| `/api/v1/distributor` | Tenant staff with `distribute` capability | `tokenType: account` |
| `/api/v1/partner` | Tenant staff with `lend` capability | `tokenType: account` |
| `/api/v1/admin` | Super admin only | `tokenType: account` + `role: super_admin` |
| `/api/v1/webhooks/payment` | Payment gateways | HMAC-SHA256 signature |
| `/api/v1/device` | Android app (device sync) | `tokenType: user` JWT (device-bound) |

---

## 10. Key Business Rules (Non-Negotiable)

These rules must be enforced at the API/service layer, not just the UI:

1. **Consent gate** — No lock command is dispatched if there is no valid `consentRecord` for the device. If consent is missing/invalid, device state = `CONSENT_INVALID` and a compliance flag is raised.

2. **Emergency calls** — The Android app must never block emergency calling (112). This is a legal requirement.

3. **Payment not equal to unlock** — A successful payment callback does NOT immediately unlock the device app-side. The server must validate the payment, match it to the EMI schedule, evaluate policy, and then send an unlock command. The app waits for the server command.

4. **Payment deduplication** — `payments.txnRef` has a unique index. A duplicate webhook with the same `txnRef` is silently dropped — it must never trigger a second unlock.

5. **Override requires reason** — Super admin override endpoints reject requests with no `reason` field at the route level.

6. **Tenant isolation** — Every DB query for devices, users, payments, cases, and audit logs must be scoped to `tenantId` derived from the authenticated account's JWT. No cross-tenant data leakage.

7. **Audit everything** — Every state change, payment event, consent action, escalation, and override writes to `auditLogs`. There are no silent operations.

8. **SLA auto-escalation** — A background scheduler runs every 5 minutes querying `unlockRequests` where `status = PENDING_TENANT` and `slaDeadline < now`. These auto-escalate without any manual trigger.

9. **Offline command queuing** — If a device is offline when a lock/unlock command is issued, the command is stored in `deviceCommands` with `status: pending`. When the device reconnects and calls `/device/sync`, it receives pending commands and applies them locally, then acks.

10. **No personal data access** — The app must never request permissions to read contacts, photos, messages, or call logs beyond what is strictly required for device management (IMEI, SIM info for security events).

---

## 11. Scheduled Background Jobs

The backend needs these cron jobs running continuously:

| Job | Frequency | What It Does |
|---|---|---|
| SLA Escalation Checker | Every 5 min | Auto-escalates `PENDING_TENANT` unlock requests past their `slaDeadline` |
| Temp Unlock Expiry | Every 1 min | Re-locks `TEMP_UNLOCK` devices past their `tempUnlockExpiresAt` |
| Command Retry | Every 10 min | Retries `pending` device commands not yet delivered |
| EMI DPD Calculator | Daily midnight | Recalculates `dpd` on all schedules, triggers auto-lock policy evaluation |
| Risk Flag Generator | Every 30 min | Detects override spikes, repeated SLA breaches, generates `riskFlags` |
| Payment Validation Retry | Every 15 min | Retries `mismatch` / stuck `pending` payment validations |

---

## 12. Android App Key Behaviors

The Android app is more complex than a typical consumer app because it must:

1. **Survive device reboot** — Uses a `BroadcastReceiver` for `BOOT_COMPLETED` to restart the background service
2. **Enforce lock screen** — Uses Android Device Admin API or Accessibility Service to prevent launcher access when state = `LOCKED`
3. **Allow emergency calls during lock** — Lock screen must pass through 112/emergency dialer
4. **Work offline** — App calls `/device/sync` on reconnect to pick up queued commands
5. **Detect tampering** — Checks for root access, APK signature mismatch, emulator environment on every launch. Reports events to `/app/security/event`
6. **Detect SIM change** — Compares stored SIM serial against current on each launch
7. **Smart sync** — Combination of FCM push (for instant delivery) and polling `/device/sync` (for reliability)
8. **Consent flow** — Aadhaar OTP flow must be completed before device is activated. No shortcuts

### App States (maps to device states)
```
ACTIVE        → Full app access, show EMI summary
GRACE_PERIOD  → Full access + warning banner + countdown to lock
LOCKED        → Lock screen only. Allow: emergency calls, Pay Now, Request Unlock, escalation status
TEMP_UNLOCK   → Full access + expiry countdown banner
UNLOCK_PENDING → Show "Unlock processing..." state
OFFLINE_PENDING → Show "Syncing..." indicator
CONSENT_INVALID → Show error, contact support
```

---

## 13. Consent Architecture (Legal Critical)

The consent flow happens once — at the time of device purchase/activation:

1. Distributor staff registers the user (`POST /distributor/users/register`)
2. User launches the app for the first time
3. App displays consent terms (fetched from `consentVersions.current`)
4. User reads terms, ticks checkbox
5. App triggers Aadhaar OTP via `POST /app/consent/initiate`
6. User enters OTP
7. App calls `POST /app/consent/confirm` — server creates a `consentRecord` (immutable)
8. Device registration proceeds (`POST /app/device/register`)

The `consentRecord` stores: borrower ID, device ID, tenant ID, consent version, OTP reference, acceptance timestamp, IP address, device fingerprint, and a SHA-256 hash of the payload.

**If consent is missing:** No lock command will ever be dispatched. Device state = `CONSENT_INVALID`. This is a hard block enforced in the Command Queue module.

---

## 14. What Has Been Done So Far

| Artifact | Status | Location |
|---|---|---|
| Product Requirements Document (PRD) | ✅ Complete | `D:\prd_emi shield.docx` |
| Borrower App Use Cases (UC-1 to UC-32) | ✅ Complete | `D:\use case of emi shield app.docx` |
| System Architecture | ✅ Complete | `architecture.md` (this folder) |
| Database Schemas (MongoDB) | ✅ Complete | `architecture.md` Section 5 |
| API Routes | ✅ Complete | `architecture.md` Section 6 |
| Backend implementation | ❌ Not started | — |
| Frontend dashboards | ❌ Not started | — |
| Android app | ❌ Not started | — |

---

## 15. Folder Structure (Planned)

```
EMI Shield/
├── context.md              ← You are here
├── architecture.md         ← Full architecture, schemas, API routes
│
├── backend/                ← Node.js + Express API
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/       ← OTP, JWT, session
│   │   │   ├── consent/    ← Consent flow, versioning
│   │   │   ├── device/     ← Device management, state, commands
│   │   │   ├── payment/    ← Payment ingestion, validation, webhook
│   │   │   ├── policy/     ← Tenant policy engine
│   │   │   ├── cases/      ← Unlock requests, escalation
│   │   │   ├── audit/      ← Audit logger
│   │   │   ├── notifications/ ← FCM, SMS, email
│   │   │   └── admin/      ← Super admin operations
│   │   ├── middleware/
│   │   │   ├── verifyJWT.js
│   │   │   ├── requireRole.js
│   │   │   ├── tenantScope.js   ← Injects tenantId filter into all queries
│   │   │   └── requireConsent.js
│   │   ├── models/         ← Mongoose schemas (one file per collection)
│   │   ├── jobs/           ← Cron jobs (SLA checker, DPD calculator, etc.)
│   │   └── app.js
│   └── package.json
│
├── admin-dashboard/        ← React web app (Super Admin)
├── partner-dashboard/      ← React web app (Tenant staff)
├── distributor-dashboard/  ← React web app (Tenant distribute staff)
│                              Note: May be part of partner-dashboard with role-based views
│
└── android-app/            ← Native Android (Java/Kotlin)
```

---

## 16. Terminology Glossary

| Term | Meaning in This Project |
|---|---|
| **User** | The borrower — the person who bought the device on EMI. Uses only the Android app |
| **Account** | A dashboard login — tenant staff, channel partner staff, or super admin |
| **Tenant** | An organisation using EMI Shield (NBFC, shop, outlet). Has `capabilities: ['lend', 'distribute']` |
| **Channel Partner** | A B2B reseller of EMI Shield who manages multiple tenants |
| **Super Admin** | EMI Shield's own operations staff. Platform-wide access, exception-only authority |
| **DPD** | Days Past Due — how many days overdue the EMI is |
| **SLA** | The time window a tenant has to action a borrower's unlock request before auto-escalation |
| **Consent Record** | The immutable legal proof that the borrower agreed to device control. Aadhaar OTP backed |
| **Device Command** | A LOCK or UNLOCK instruction queued for delivery to the device via FCM |
| **Unlock Request / Case** | Created when a borrower taps "Request Unlock" on the lock screen |
| **Escalation** | An unlock request that the tenant didn't action within SLA — routed to super admin |
| **Override** | Super admin forcing an unlock on an escalated case. Always requires a reason |
| **Risk Flag** | An automated alert to super admin (e.g. tenant has high override volume, SIM changed on device) |
| **FCM** | Firebase Cloud Messaging — used to push lock/unlock commands and notifications to the Android app |
| **txnRef** | Unique payment transaction reference from the gateway — used for deduplication |
| **IMEI** | Device hardware identifier — the primary device binding key |
| **Lend capability** | A tenant that can lock/unlock devices and configure policy |
| **Distribute capability** | A tenant that can register devices and onboard users |

---

## 17. Important Design Decisions (and Why)

| Decision | Reason |
|---|---|
| `accounts` and `users` are separate collections | Different auth mechanisms (password vs OTP), different data shapes, different security models. Merging them would create confusion |
| `tenants` replaces `lenders` + `distributors` | An NBFC and a shop are the same entity type — just with different capabilities. One collection with a `capabilities` array is cleaner than two collections |
| `consentRecords` are immutable | Legal requirement. A consent record is a legal artefact. If you need to re-consent, you create a new record |
| `auditLogs` are never updated/deleted | Tamper-evident logs are a regulatory requirement for a financial enforcement platform |
| Payment does not instantly unlock (app-side) | Prevents race conditions and fraud. The server is the single source of truth for unlock decisions |
| Unique index on `payments.txnRef` | Payment gateways often send duplicate webhooks. This prevents double-unlock at the DB level |
| `tenantId` in JWT + middleware scope | Ensures no tenant can ever query another tenant's data, even with a crafted request |
| FCM + polling hybrid for device sync | FCM is fast but unreliable (device offline, app killed). Polling on reconnect ensures eventual delivery |
| `deviceCommands` queue with retry | Handles the offline device case — commands persist and are retried, never lost |
