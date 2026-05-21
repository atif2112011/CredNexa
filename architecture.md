# EMI Shield — System Architecture, Database Schemas & API Routes

> **Stack:** Node.js + Express (Backend) · MongoDB (Database) · Android (Mobile App)  
> **Version:** 1.0 · Status: Implementation Ready

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Component Architecture](#2-component-architecture)
3. [Multi-Tenant Hierarchy](#3-multi-tenant-hierarchy)
4. [Module Breakdown](#4-module-breakdown)
5. [Database Schemas](#5-database-schemas)
6. [API Routes](#6-api-routes)
7. [Workflow Diagrams](#7-workflow-diagrams)
8. [Device State Machine](#8-device-state-machine)
9. [Case State Machine](#9-case-state-machine)
10. [Security Architecture](#10-security-architecture)

---

## 1. System Overview

EMI Shield is a **lender-authorized, consent-backed device control and compliance platform** for financed devices. It enables lawful, auditable device restriction and restoration workflows tied to EMI repayment behavior.

**Core Principle:** Lock and unlock authority always resides with the credit originator (lender), never with the platform itself.

### Four Primary Interfaces

| Interface | Users | Platform | Role |
|---|---|---|---|
| **Admin Dashboard** | Super Admin | Web app | Exception handling, escalation override, risk monitoring, platform governance |
| **Partner App** | `tenant_admin` and `partner_admin` | Android app | Tenant operations, escalation handling, payment review, unlock request handling, policy config |
| **Distributor App** | `tenant_admin` with `distribute` capability | Android app | Device sale registration, user onboarding, QR code generation, device-user binding |
| **Borrower App** | User (borrower — device purchaser) | Android app | Pay EMI, request unlock, view escalation status, consent acceptance |

### Identity Model

| Collection | Who it represents |
|---|---|
| `accounts` | Admin/operator logins — `super_admin`, `partner_admin`, `tenant_admin` |
| `users` | Device purchasers (borrowers) only — people who install the app |
| `channelPartners` | B2B entities that resell the EMI Shield product |
| `tenants` | Organisations under a channel partner — NBFCs, shops, retail chains, outlets |

---

## 2. Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EMI SHIELD PLATFORM                                  │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────┐   │
│  │  Admin Dashboard │  │   Partner App    │  │   Distributor App      │   │
│  │   (React/Web)    │  │   (Android)      │  │     (Android)          │   │
│  └────────┬─────────┘  └────────┬─────────┘  └───────────┬────────────┘   │
│           │                     │                          │                │
│           └─────────────────────┼──────────────────────────┘                │
│                                 │                                           │
│                    ┌────────────▼────────────┐                              │
│                    │   REST API Gateway       │                              │
│                    │  (Node.js + Express)     │                              │
│                    │  JWT Auth Middleware      │                              │
│                    │  Role-based Guard        │                              │
│                    └────────────┬────────────┘                              │
│                                 │                                           │
│     ┌───────────────────────────┼───────────────────────────────┐          │
│     │                           │                               │          │
│  ┌──▼──────────────┐  ┌────────▼──────────┐  ┌───────────────▼──┐        │
│  │  Auth & Consent │  │  Device Manager   │  │  Payment Engine  │        │
│  │  Module         │  │  Module           │  │  Module          │        │
│  └──┬──────────────┘  └────────┬──────────┘  └───────────────┬──┘        │
│     │                           │                               │          │
│  ┌──▼──────────────┐  ┌────────▼──────────┐  ┌───────────────▼──┐        │
│  │  Policy Engine  │  │  Command Queue    │  │  Validation      │        │
│  │  Module         │  │  (Lock/Unlock)    │  │  Engine          │        │
│  └──┬──────────────┘  └────────┬──────────┘  └───────────────┬──┘        │
│     │                           │                               │          │
│  ┌──▼──────────────┐  ┌────────▼──────────┐  ┌───────────────▼──┐        │
│  │  Case Manager   │  │  Audit Logger     │  │  Notification    │        │
│  │  (Escalations) │  │  Module           │  │  Service         │        │
│  └─────────────────┘  └───────────────────┘  └──────────────────┘        │
│                                 │                                           │
│                    ┌────────────▼────────────┐                              │
│                    │        MongoDB           │                              │
│                    └─────────────────────────┘                              │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │              Android Borrower App                                    │  │
│  │  Boot Receiver · FCM Push · Background Sync · Lock Screen UI        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### External Integrations

| System | Purpose |
|---|---|
| **Firebase Cloud Messaging (FCM)** | Push notifications to Android devices |
| **OTP / SMS Service** | OTP delivery for auth and consent |
| **File Storage (S3 / compatible)** | QR code image uploads + payment proof document uploads |

---

## 3. Multi-Tenant Hierarchy

```
EMI Shield Super Admin (platform)
   │
   ├── Channel Partner (sells EMI Shield product to organisations)
   │       │
   │       ├── Tenant: NBFC  (type: nbfc, capabilities: [lend])
   │       │       └── Tenant: NBFC Outlet  (type: pos_outlet, capabilities: [distribute])
   │       │               └── User (borrower) ↔ Device
   │       │
   │       ├── Tenant: Retail Chain  (type: retail_chain, capabilities: [lend, distribute])
   │       │       └── Tenant: Chain Outlet  (type: pos_outlet, capabilities: [distribute])
   │       │               └── User (borrower) ↔ Device
   │
   └── Tenant: Standalone Outlet  (type: standalone, capabilities: [lend, distribute])
           └── User (borrower) ↔ Device
```

**Key distinctions:**
- `accounts` → login credentials for all admin/operator actors (`super_admin`, `partner_admin`, `tenant_admin`)
- `users` → device purchasers only. No dashboard access. Authenticate via OTP on the Android app
- `tenants` → the organisation entity. A tenant's `capabilities` array determines whether it can lend (lock/unlock authority), distribute (register devices/users), or both
- A parent tenant (e.g. Retail Chain) can have child tenants (outlets) — `parentTenantId` field

**Isolation Rules:**
- Tenant admins can only view/manage resources where `tenantId` matches their own
- Partner admins see aggregated data across all tenants under their channel partner
- Super admin has platform-wide read and exception-only write access
- Device and user records always carry `tenantId` for scoped queries

---

## 4. Module Breakdown

### 4.1 Auth & Identity Module
- OTP-based mobile verification
- Aadhaar-linked OTP consent flow
- JWT session management
- Role-based access control (RBAC)
- Device session binding

### 4.2 Consent Module
- Consent document versioning
- Borrower consent capture with OTP backing
- Consent artefact storage (immutable)
- Consent validation before any enforcement action

### 4.3 Device Management Module
- Device registration and fingerprinting
- Device state management (ACTIVE → GRACE → LOCKED → etc.)
- FCM token management
- SIM change and root detection event handling

### 4.4 Policy Engine Module
- Per-lender configurable lock rules (DPD, grace period)
- Unlock rules (payment thresholds, partial unlock)
- Escalation SLA configuration
- Temporary unlock duration rules
- Policy versioning

### 4.5 Payment Engine Module
- Tenant QR code management (upload, activate, delete via S3)
- Payment submission by borrower ("I paid" tap)
- Tenant approval workflow (Partner App review + approve)
- Post-approval EMI schedule matching and validation
- Post-approval action determination (unlock trigger)

### 4.6 Command Queue Module
- Lock/unlock command dispatch to device via FCM
- Offline command queuing (pending execution)
- Retry logic on reconnect
- Command status tracking

### 4.7 Case Manager Module
- Unlock request case creation
- SLA tracking per lender policy
- Automatic escalation on SLA breach
- Case state transitions
- Super admin override handling

### 4.8 Audit Logger Module
- Immutable event recording
- Tamper-evident log structure
- Events: consent, OTP, payment, lock, unlock, escalation, override
- Actor, timestamp, device ID, reason captured for every event

### 4.9 Notification Service
- FCM push notifications to borrower app
- Dashboard alerts to lenders / admins
- EMI reminders, overdue warnings, unlock confirmations

---

## 5. Database Schemas

### 5.1 `accounts` Collection
Dashboard login credentials for all non-borrower actors: super admins, partner admins, and tenant admins.

```js
{
  _id: ObjectId,
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String },
  passwordHash: { type: String, required: true },

  role: {
    type: String,
    enum: [
      'super_admin',
      'partner_admin',
      'tenant_admin'
    ],
    required: true
  },

  // Scoping — only one of these is populated depending on role
  channelPartnerId: { type: ObjectId, ref: 'channelPartners' }, // for partner_admin
  tenantId: { type: ObjectId, ref: 'tenants' },                 // for tenant roles

  isActive: { type: Boolean, default: true },
  lastLoginAt: { type: Date },
  createdBy: { type: ObjectId, ref: 'accounts' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
```

### 5.2 `users` Collection
Device purchasers (borrowers) only. These are the people who install the Android app and whose devices are subject to EMI-linked control. No dashboard access.

```js
{
  _id: ObjectId,
  name: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  email: { type: String },

  // Aadhaar consent identity
  aadhaarLinkedMobile: { type: String },
  aadhaarVerified: { type: Boolean, default: false },

  // Tenant relationship — which organisation sold them the device
  tenantId: { type: ObjectId, ref: 'tenants', required: true },

  // Loan details
  loanId: { type: String, required: true, unique: true },
  loanAmount: { type: Number },
  emiAmount: { type: Number },
  tenureMonths: { type: Number },
  disbursementDate: { type: Date },

  // Consent link (populated after consent flow completes)
  consentRecordId: { type: ObjectId, ref: 'consentRecords' },

  isActive: { type: Boolean, default: true },
  registeredBy: { type: ObjectId, ref: 'accounts' }, // tenant_admin who onboarded them
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
```

### 5.3 `channelPartners` Collection
B2B entities that resell the EMI Shield product. They manage one or more tenants.

```js
{
  _id: ObjectId,
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ['nbfc_group', 'retail_chain_group', 'independent'],
    required: true
  },
  contactEmail: { type: String },
  contactPhone: { type: String },
  adminAccountId: { type: ObjectId, ref: 'accounts' },
  isActive: { type: Boolean, default: true },
  createdBy: { type: ObjectId, ref: 'accounts' }, // super admin
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
```

### 5.4 `tenants` Collection
Organisations that use EMI Shield to sell devices and/or enforce EMI-linked device control. Replaces the old separate `lenders` and `distributors` collections.

A tenant's `capabilities` array determines its permissions:
- `lend` — can configure lock/unlock policy, has lock/unlock authority over devices
- `distribute` — can register devices and onboard users

```js
{
  _id: ObjectId,
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ['nbfc', 'retail_chain', 'standalone_outlet', 'pos_outlet'],
    required: true
  },
  capabilities: {
    type: [String],
    enum: ['lend', 'distribute'],
    required: true
    // e.g. standalone_outlet → ['lend', 'distribute']
    // e.g. nbfc             → ['lend']
    // e.g. pos_outlet       → ['distribute']
  },

  channelPartnerId: { type: ObjectId, ref: 'channelPartners', required: true },

  // For outlets that sit under a parent tenant (e.g. chain outlet under retail chain)
  parentTenantId: { type: ObjectId, ref: 'tenants', default: null },

  adminAccountId: { type: ObjectId, ref: 'accounts' },

  // Support contact shown to users on the lock screen
  supportPhone: { type: String },
  supportEmail: { type: String },
  supportWhatsapp: { type: String },

  address: {
    street: String,
    city: String,
    state: String,
    pincode: String
  },

  isActive: { type: Boolean, default: true },
  createdBy: { type: ObjectId, ref: 'accounts' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  // UPI QR codes — shown to borrowers when they tap "Pay Now"
  // Only one entry can have isActive: true at any time (enforced at API layer)
  qrCodes: [{
    _id: { type: ObjectId, auto: true },
    label: { type: String, required: true },     // e.g. "HDFC UPI", "PhonePe"
    imageUrl: { type: String, required: true },  // S3/storage URL
    isActive: { type: Boolean, default: false },
    uploadedBy: { type: ObjectId, ref: 'accounts' },
    createdAt: { type: Date, default: Date.now }
  }]
}
```

### 5.5 `devices` Collection
Financed device registrations and real-time state.

```js
{
  _id: ObjectId,
  userId: { type: ObjectId, ref: 'users', required: true },     // the borrower
  tenantId: { type: ObjectId, ref: 'tenants', required: true }, // tenant that sold/manages this device

  // Device identifiers
  imei: { type: String, required: true, unique: true },
  imei2: { type: String },
  deviceModel: { type: String },
  manufacturer: { type: String },
  androidVersion: { type: String },
  appVersion: { type: String },
  simInfo: {
    simOperator: String,
    simSerial: String,
    phoneNumber: String
  },

  // FCM
  fcmToken: { type: String },
  fcmTokenUpdatedAt: { type: Date },

  // Device state
  state: {
    type: String,
    enum: [
      'ACTIVE',
      'GRACE_PERIOD',
      'LOCKED',
      'TEMP_UNLOCK',
      'UNLOCK_PENDING',
      'OFFLINE_PENDING',
      'CONSENT_INVALID'
    ],
    default: 'ACTIVE'
  },
  stateUpdatedAt: { type: Date, default: Date.now },
  stateUpdatedBy: { type: ObjectId, ref: 'accounts' },  // account (dashboard actor) who changed state

  // Temporary unlock details
  tempUnlockExpiresAt: { type: Date },

  // Policy tracking
  currentPolicyKey: { type: String },              // e.g. "EMI_LOCKED" — set by backend on every state change
  currentPolicyId: { type: ObjectId, ref: 'devicePolicies' },
  desiredPolicyVersion: { type: Number, default: 0 },     // last version dispatched by backend
  lastAppliedPolicyVersion: { type: Number, default: 0 }, // last version reported by device (via ping)
  lastPolicyAppliedAt: { type: Date },

  // Offline/state tracking
  lastSeenAt: { type: Date },
  isOnline: { type: Boolean, default: false },

  // Security flags
  isRooted: { type: Boolean, default: false },
  isTampered: { type: Boolean, default: false },
  simChangedAt: { type: Date },

  registeredAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
```

### 5.6 `consentVersions` Collection
Versioned legal consent documents managed by super admin.

```js
{
  _id: ObjectId,
  version: { type: String, required: true, unique: true },   // e.g. "1.0", "1.1"
  title: { type: String, required: true },
  borrowerAgreementText: { type: String, required: true },
  deviceControlConsentText: { type: String, required: true },
  privacyPolicyText: { type: String, required: true },
  tripartiteAckText: { type: String },
  isCurrent: { type: Boolean, default: false },
  publishedAt: { type: Date },
  publishedBy: { type: ObjectId, ref: 'accounts' },
  createdAt: { type: Date, default: Date.now }
}
```

### 5.7 `consentRecords` Collection
Immutable consent artefacts per user. Legally critical — never updated, only created.

```js
{
  _id: ObjectId,
  userId: { type: ObjectId, ref: 'users', required: true },
  deviceId: { type: ObjectId, ref: 'devices', required: true },
  tenantId: { type: ObjectId, ref: 'tenants', required: true },

  consentVersionId: { type: ObjectId, ref: 'consentVersions', required: true },
  consentVersion: { type: String, required: true },   // snapshot of version string

  // Aadhaar verification — backend-proxied via third-party service (e.g. Digio, Karza)
  aadhaarLinkedMobile: { type: String, required: true },
  aadhaarProvider: { type: String },               // name of the Aadhaar OTP provider used
  aadhaarVerificationRef: { type: String },         // provider's session / transaction reference ID
  aadhaarVerifiedAt: { type: Date },

  // Verified identity snapshot returned by the Aadhaar provider (stored for legal defensibility)
  verifiedProfile: {
    name: String,
    dob: String,      // masked — e.g. "**/**/1990"
    address: String
  },

  // Consent acceptance
  consentCheckboxAccepted: { type: Boolean, required: true },
  acceptedAt: { type: Date, required: true },
  ipAddress: { type: String },
  deviceFingerprint: { type: String },

  // Integrity
  consentHash: { type: String },    // SHA-256 hash of consent payload for tamper detection

  createdAt: { type: Date, default: Date.now }
  // NOTE: This document must never be modified after creation
}
```

### 5.17 `devicePolicies` Collection
Per-tenant enforcement policies defining Android restrictions for each device/EMI state. Tenants configure these via the Partner Dashboard. The app fetches the active policy and enforces it using `DevicePolicyManager`.

```js
{
  _id: ObjectId,
  tenantId: { type: ObjectId, ref: 'tenants', required: true },

  policyKey: {
    type: String,
    enum: ['EMI_PAID', 'EMI_GRACE', 'EMI_LOCKED', 'TEMP_UNLOCKED', 'CONSENT_INVALID'],
    required: true
  },

  restrictions: {
    lockMode: { type: Boolean, default: false },          // true = restrict device to allowed apps only
    allowedApps: [{ type: String }],   // Android package names permitted (empty = all allowed)
    blockedApps:  [{ type: String }],  // Android package names to block
    disableFactoryReset: { type: Boolean, default: true },
    disableStatusBar: { type: Boolean, default: false },
    disableAdb: { type: Boolean, default: false }
  },

  version: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: ObjectId, ref: 'accounts' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
// Atlas manages the uniqueness/indexing strategy for { tenantId, policyKey }
```

**`policyKey` → Device State Mapping:**

| `policyKey` | Device `state` | Enforcement Behavior |
|---|---|---|
| `EMI_PAID` | `ACTIVE` | No lock — full device access |
| `EMI_GRACE` | `GRACE_PERIOD` | No lock — warning UI shown |
| `EMI_LOCKED` | `LOCKED` | Lock mode on — restricted app set only |
| `TEMP_UNLOCKED` | `TEMP_UNLOCK` | No lock — expiry countdown shown |
| `CONSENT_INVALID` | `CONSENT_INVALID` | Minimal UI — show contact support |
```

### 5.8 `tenantPolicies` Collection
Per-tenant configurable policy for lock, unlock, and escalation behavior. Every tenant receives a tenant policy copied from centralized platform defaults during `POST /admin/tenants`, regardless of tenant capabilities.

```js
{
  _id: ObjectId,
  tenantId: { type: ObjectId, ref: 'tenants', required: true, unique: true },
  version: { type: Number, default: 1 },

  // Lock rules
  lockRules: {
    dpd: { type: Number, default: 30 },               // days past due before auto-lock
    gracePeriodDays: { type: Number, default: 7 },     // grace days after DPD
    lockOnGraceExpiry: { type: Boolean, default: true }
  },

  // Unlock rules
  unlockRules: {
    unlockType: {
      type: String,
      enum: ['instant', 'delayed', 'partial'],
      default: 'instant'
    },
    delayMinutes: { type: Number, default: 0 },         // for delayed unlock
    requireFullPayment: { type: Boolean, default: true },
    partialUnlockOnPartialPayment: { type: Boolean, default: false },
    requireReasonOnManualUnlock: { type: Boolean, default: false }
  },

  // Temporary unlock
  tempUnlockRules: {
    defaultDurationHours: { type: Number, default: 24 },
    maxDurationHours: { type: Number, default: 72 }
  },

  // Escalation SLA
  escalationRules: {
    slaHours: { type: Number, default: 24 },                        // hours tenant has to action before escalating to channel partner
    partnerEscalationSlaHours: { type: Number, default: 48 },       // hours channel partner has before further escalation to super admin
    autoEscalateOnSLABreach: { type: Boolean, default: true }
  },

  updatedBy: { type: ObjectId, ref: 'accounts' },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}
```

### 5.9 `emiSchedules` Collection
EMI repayment schedule per user/loan.

```js
{
  _id: ObjectId,
  userId: { type: ObjectId, ref: 'users', required: true },
  tenantId: { type: ObjectId, ref: 'tenants', required: true },
  loanId: { type: String, required: true },

  installments: [
    {
      installmentNumber: { type: Number, required: true },
      dueDate: { type: Date, required: true },
      principalAmount: { type: Number },
      interestAmount: { type: Number },
      emiAmount: { type: Number, required: true },
      penaltyAmount: { type: Number, default: 0 },
      status: {
        type: String,
        enum: ['pending', 'paid', 'overdue', 'partial', 'waived'],
        default: 'pending'
      },
      paidAmount: { type: Number, default: 0 },
      paidAt: { type: Date },
      paymentId: { type: ObjectId, ref: 'payments' },
      waivedBy: { type: ObjectId, ref: 'accounts' },   // account that granted waive (case resolution)
      waivedAt: { type: Date },
      waiveReason: { type: String }                    // caseId or note
    }
  ],

  overdueAmount: { type: Number, default: 0 },
  overdueInstallments: { type: Number, default: 0 },
  dpd: { type: Number, default: 0 },   // days past due (computed)

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
```

### 5.10 `payments` Collection
All payment records for QR-based EMI payments pending or completed.

```js
{
  _id: ObjectId,
  userId: { type: ObjectId, ref: 'users', required: true },
  tenantId: { type: ObjectId, ref: 'tenants', required: true },
  deviceId: { type: ObjectId, ref: 'devices' },

  // Amount
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },

  // Channel — QR-based payment (borrower scans tenant's UPI QR externally)
  paymentMethod: {
    type: String,
    enum: ['qr', 'manual'],
    required: true
  },
  qrCodeId: { type: ObjectId },   // references the tenants.qrCodes subdocument shown to borrower

  // Status lifecycle: initiated → approval_pending → success
  status: {
    type: String,
    enum: ['initiated', 'approval_pending', 'success', 'cancelled'],
    default: 'initiated'
  },

  // Tenant approval
  approvalStatus: {
    type: String,
    enum: ['pending_approval', 'approved'],
    default: 'pending_approval'
  },
  approvedBy: { type: ObjectId, ref: 'accounts' },   // tenant_admin who approved
  approvedAt: { type: Date },

  // EMI matching (done at approval time)
  matchedInstallments: [{ type: ObjectId }],   // installment IDs matched
  validatedAt: { type: Date },
  validatedBy: { type: ObjectId, ref: 'accounts' },

  // Unlock outcome
  unlockTriggered: { type: Boolean, default: false },
  unlockCommandId: { type: ObjectId, ref: 'deviceCommands' },

  submittedAt: { type: Date, default: Date.now },   // when borrower tapped "Payment Sent"
  completedAt: { type: Date }                        // when approval + unlock completed
}
```

### 5.11 `deviceCommands` Collection
Lock/unlock command queue with delivery tracking.

```js
{
  _id: ObjectId,
  deviceId: { type: ObjectId, ref: 'devices', required: true },
  userId: { type: ObjectId, ref: 'users' },
  tenantId: { type: ObjectId, ref: 'tenants' },

  commandType: {
    type: String,
    enum: ['LOCK', 'UNLOCK', 'TEMP_UNLOCK', 'RECHECK_STATE'],
    required: true
  },

  // Source of command
  triggeredBy: {
    type: String,
    enum: ['manual_tenant', 'auto_policy', 'payment_unlock', 'super_admin', 'temp_unlock_expiry'],
    required: true
  },
  triggeredByAccountId: { type: ObjectId, ref: 'accounts' }, // null for automated triggers

  // Payload
  payload: {
    unlockDurationHours: Number,    // for TEMP_UNLOCK
    reason: String,
    policyVersion: String
  },

  // Delivery status
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed', 'expired'],
    default: 'pending'
  },
  fcmMessageId: { type: String },
  sentAt: { type: Date },
  deliveredAt: { type: Date },
  acknowledgedAt: { type: Date },   // app sends ack

  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 5 },
  nextRetryAt: { type: Date },

  // For offline queuing
  executedLocally: { type: Boolean, default: false },  // device applied on reconnect

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
```

### 5.12 `unlockRequests` Collection
User-initiated unlock request cases with two-tier escalation (Tenant → Channel Partner → Super Admin).

```js
{
  _id: ObjectId,
  caseId: { type: String, required: true, unique: true },   // e.g. "CASE-2024-00123"
  userId: { type: ObjectId, ref: 'users', required: true },
  deviceId: { type: ObjectId, ref: 'devices', required: true },
  tenantId: { type: ObjectId, ref: 'tenants', required: true },
  channelPartnerId: { type: ObjectId, ref: 'channelPartners' },  // populated on escalation to partner

  // Borrower submission
  reason: { type: String, required: true },                 // short required reason
  details: { type: String },                                // optional longer description
  reasonCategory: {
    type: String,
    enum: ['payment_made', 'temporary_emergency', 'payment_mismatch', 'other']
  },
  imageUrl: { type: String },                               // optional JPEG evidence image (S3)

  // Case state
  status: {
    type: String,
    enum: [
      'PENDING_TENANT',          // Waiting for tenant to action
      'ESCALATED_PARTNER',       // Tenant SLA breached → escalated to channel partner
      'ESCALATED_ADMIN',         // Channel partner SLA breached → escalated to super admin
      'UNDER_REVIEW',            // Super admin is actively reviewing
      'RESOLVED_TENANT',         // Tenant resolved (unlocked, temp-unlocked, or rejected)
      'RESOLVED_PARTNER',        // Channel partner resolved
      'RESOLVED_SUPER_ADMIN',    // Super admin resolved (override)
      'REJECTED',                // Denied (by tenant, partner, or super admin)
      'CLOSED'                   // Final state after resolution acknowledged
    ],
    default: 'PENDING_TENANT'
  },

  // Tenant-level SLA
  slaHours: { type: Number },                              // from tenantPolicies.escalationRules.slaHours
  slaDeadline: { type: Date },                             // createdAt + slaHours
  slaBreached: { type: Boolean, default: false },
  escalatedToPartnerAt: { type: Date },

  // Channel partner-level SLA (populated on ESCALATED_PARTNER)
  partnerSlaHours: { type: Number },                       // from tenantPolicies.escalationRules.partnerEscalationSlaHours
  partnerSlaDeadline: { type: Date },                      // escalatedToPartnerAt + partnerSlaHours
  partnerSlaBreached: { type: Boolean, default: false },
  escalatedToAdminAt: { type: Date },

  // Resolution
  resolvedBy: { type: ObjectId, ref: 'accounts' },         // account that resolved
  resolvedAt: { type: Date },
  resolutionNote: { type: String },
  resolutionAction: {
    type: String,
    enum: [
      'unlocked',                 // full unlock (device set to ACTIVE/EMI_PAID)
      'waived',                   // full unlock + current overdue installment marked waived
      'temp_unlocked',            // temporary unlock for N hours
      'rejected',                 // request denied
      'override'                  // super admin forced unlock on escalated case
    ]
  },
  tempUnlockDurationHours: { type: Number },               // set when resolutionAction = 'temp_unlocked'

  deviceCommandId: { type: ObjectId, ref: 'deviceCommands' },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
```

### 5.13 `auditLogs` Collection
Immutable tamper-evident log of all critical platform events.

```js
{
  _id: ObjectId,

  // Event classification
  eventType: {
    type: String,
    enum: [
      'CONSENT_GIVEN',
      'OTP_VERIFIED',
      'DEVICE_REGISTERED',
      'PAYMENT_RECEIVED',
      'PAYMENT_VALIDATED',
      'PAYMENT_FAILED',
      'LOCK_TRIGGERED',
      'UNLOCK_TRIGGERED',
      'TEMP_UNLOCK_TRIGGERED',
      'TEMP_UNLOCK_EXPIRED',
      'UNLOCK_REQUEST_CREATED',
      'ESCALATION_RAISED',
      'OVERRIDE_EXECUTED',
      'POLICY_UPDATED',
      'CONSENT_VERSION_CREATED',
      'SIM_CHANGE_DETECTED',
      'ROOT_DETECTED',
      'APP_TAMPER_DETECTED',
      'SLA_BREACHED',
      'CASE_RESOLVED',
      'CASE_WAIVED',
      'PAYMENT_SUBMITTED',
      'PAYMENT_APPROVED'
    ],
    required: true
  },

  // Actor — actorId references `accounts` for dashboard actions, `users` for app actions
  // actorCollection tells you which to look up
  actorId: { type: ObjectId },
  actorCollection: { type: String, enum: ['accounts', 'users', 'system'] },
  actorRole: { type: String },
  actorLabel: { type: String },   // "System" for automated events

  // Subject
  deviceId: { type: ObjectId, ref: 'devices' },
  userId: { type: ObjectId, ref: 'users' },
  tenantId: { type: ObjectId, ref: 'tenants' },
  caseId: { type: String },
  paymentId: { type: ObjectId, ref: 'payments' },
  commandId: { type: ObjectId, ref: 'deviceCommands' },

  // Reason (mandatory for overrides)
  reason: { type: String },

  // Policy / consent version at time of action
  policyVersion: { type: Number },
  consentVersion: { type: String },

  // Full event payload snapshot for legal defensibility
  payload: { type: Object },

  // Integrity
  logHash: { type: String },      // SHA-256 of event fields for tamper detection

  timestamp: { type: Date, default: Date.now, immutable: true }
  // NOTE: Documents in this collection must never be updated or deleted
}
```

### 5.14 `notifications` Collection
Notification records sent to borrowers and lender dashboard users.

```js
{
  _id: ObjectId,
  // recipientId references `users` for borrower notifications, `accounts` for dashboard alerts
  recipientId: { type: ObjectId, required: true },
  recipientCollection: { type: String, enum: ['users', 'accounts'], required: true },
  channel: {
    type: String,
    enum: ['fcm', 'sms', 'email', 'in_app'],
    required: true
  },

  type: {
    type: String,
    enum: [
      'EMI_REMINDER',
      'OVERDUE_WARNING',
      'GRACE_PERIOD_START',
      'DEVICE_LOCKED',
      'UNLOCK_SUCCESS',
      'UNLOCK_REQUEST_RECEIVED',
      'ESCALATION_UPDATE',
      'TEMP_UNLOCK_APPROVED',
      'TEMP_UNLOCK_EXPIRING',
      'CASE_RESOLVED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_APPROVAL_REQUIRED',    // sent to tenant admins when borrower taps "Payment Sent"
      'CASE_ESCALATED_TO_PARTNER',    // sent to partner admins when tenant SLA breaches
      'CASE_ESCALATED_TO_ADMIN'       // sent to super admin when channel partner SLA breaches
    ],
    required: true
  },

  title: { type: String },
  body: { type: String },
  data: { type: Object },         // extra payload for app deep linking

  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed'],
    default: 'pending'
  },
  sentAt: { type: Date },
  failureReason: { type: String },

  // References
  deviceId: { type: ObjectId, ref: 'devices' },
  caseId: { type: String },
  paymentId: { type: ObjectId, ref: 'payments' },

  createdAt: { type: Date, default: Date.now }
}
```

### 5.15 `otpRecords` Collection
OTP lifecycle tracking (auto-expire old records).

```js
{
  _id: ObjectId,
  mobile: { type: String, required: true },
  otp: { type: String, required: true },       // hashed in storage
  purpose: {
    type: String,
    enum: ['login', 'consent', 'aadhaar_consent'],
    required: true
  },
  verified: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  expiresAt: { type: Date, required: true },   // expires after 10 min by Atlas-managed TTL configuration
  createdAt: { type: Date, default: Date.now }
}
```

### 5.16 `riskFlags` Collection
Risk monitoring signals surfaced to super admin.

```js
{
  _id: ObjectId,
  flagType: {
    type: String,
    enum: [
      'HIGH_OVERRIDE_VOLUME',
      'FREQUENT_UNLOCK_FAILURES',
      'REPEATED_PAYMENT_MISMATCH',
      'HIGH_COMPLAINT_RATE',
      'SIM_CHANGE',
      'ROOT_DETECTED',
      'APP_TAMPER'
    ],
    required: true
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },

  // Subject
  tenantId: { type: ObjectId, ref: 'tenants' },
  deviceId: { type: ObjectId, ref: 'devices' },
  userId: { type: ObjectId, ref: 'users' },

  description: { type: String },
  isAcknowledged: { type: Boolean, default: false },
  acknowledgedBy: { type: ObjectId, ref: 'accounts' },
  acknowledgedAt: { type: Date },

  createdAt: { type: Date, default: Date.now }
}
```

---

## 6. API Routes

### Base URL: `/api/v1`

### Auth Middleware Applied To All Protected Routes:
- `verifyJWT` — validates Bearer token; resolves to either `accounts` or `users` collection depending on token type
- `requireRole([...roles])` — RBAC guard (roles from `accounts.role` or `'user'` for app tokens)
- `requireConsentValid` — device routes only

---

### 6.1 Authentication Routes (`/auth`)

| Method | Route | Description | Access |
|---|---|---|---|
| POST | `/auth/send-otp` | Send OTP to mobile number | Public |
| POST | `/auth/verify-otp` | Verify OTP, return session token | Public |
| POST | `/auth/login` | Password login for dashboard users | Public |
| POST | `/auth/refresh-token` | Refresh JWT access token | Authenticated |
| POST | `/auth/logout` | Invalidate session | Authenticated |

**Request — POST `/auth/send-otp`**
```json
{ "mobile": "9876543210", "purpose": "login" }
```

**Request — POST `/auth/verify-otp`**
```json
{ "mobile": "9876543210", "otp": "123456", "purpose": "login" }
```
**Response (app user):**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "tokenType": "user",
  "user": { "id": "...", "name": "Ramesh Kumar", "mobile": "..." }
}
```
**Response (dashboard account):**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "tokenType": "account",
  "account": { "id": "...", "role": "tenant_admin", "tenantId": "...", "name": "..." }
}
```

---

### 6.2 Borrower App Routes (`/app`)

> All routes require `verifyJWT` + `tokenType: user`

#### Onboarding

| Method | Route | Description |
|---|---|---|
| POST | `/app/check-device` | Check if device IMEI is already registered (UC-1) |
| GET | `/app/consent/terms` | Fetch current consent document version |
| POST | `/app/consent/initiate` | Backend initiates Aadhaar OTP via third-party provider; returns `verificationSessionId` |
| POST | `/app/consent/confirm` | Verify OTP server-side, store verified profile + consent record, issue JWT |
| POST | `/app/device/register` | Register device IMEI + FCM token (UC-4) |

**Request — POST `/app/consent/initiate`** *(no auth required — uses `enrollmentToken`)*
```json
{
  "enrollmentToken": "TEMP_TOKEN_ABC123",
  "aadhaarLinkedMobile": "9876543210"
}
```
**Response:**
```json
{
  "verificationSessionId": "VS_XYZ789",
  "otpSent": true,
  "maskedMobile": "98****3210",
  "expiresInSeconds": 600
}
```

**Request — POST `/app/consent/confirm`** *(no auth required — uses `enrollmentToken`)*
```json
{
  "enrollmentToken": "TEMP_TOKEN_ABC123",
  "verificationSessionId": "VS_XYZ789",
  "otp": "482910",
  "consentCheckboxAccepted": true,
  "consentVersion": "1.1"
}
```
**Response:**
```json
{
  "consentRecordId": "...",
  "consentAccepted": true,
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "user",
  "user": { "id": "...", "name": "Ramesh Kumar", "tenantId": "..." }
}
```

**Request — POST `/app/device/register`**
```json
{
  "imei": "123456789012345",
  "imei2": "123456789012346",
  "deviceModel": "Samsung Galaxy M14",
  "manufacturer": "Samsung",
  "androidVersion": "14",
  "appVersion": "1.0.0",
  "fcmToken": "..."
}
```
> `userId` and `tenantId` are resolved from the JWT — do not include in the request body.

#### Session & Dashboard

| Method | Route | Description |
|---|---|---|
| GET | `/app/session/validate` | Validate stored token + device integrity (UC-5, UC-6) |
| GET | `/app/dashboard` | Get borrower dashboard summary |
| GET | `/app/device/state` | Get current device state (UC-7 to UC-11) |
| GET | `/app/device/policy` | Fetch active enforcement policy for this device |
| POST | `/app/device/ping` | Update FCM token, report health stats, heartbeat |
| POST | `/app/device/command/ack` | Acknowledge that a policy command was applied on-device |

**Response — GET `/app/device/state`**
```json
{
  "state": "LOCKED",
  "currentPolicyKey": "EMI_LOCKED",
  "policyVersion": 2,
  "tempUnlockExpiresAt": null,
  "pendingCase": { "caseId": "CASE-2024-001", "status": "ESCALATED" }
}
```

**Response — GET `/app/device/policy`**
```json
{
  "policyKey": "EMI_LOCKED",
  "policyVersion": 2,
  "deviceState": "LOCKED",
  "restrictions": {
    "lockMode": true,
    "allowedApps": ["com.emishield.app", "com.android.dialer"],
    "blockedApps": [],
    "disableFactoryReset": true,
    "disableStatusBar": true
  },
  "tempUnlockExpiresAt": null
}
```

**Request — POST `/app/device/ping`**
```json
{
  "fcmToken": "<current or rotated FCM token>",
  "battery": 71,
  "network": "wifi",
  "rootDetected": false,
  "developerMode": false,
  "lastAppliedPolicyVersion": 2
}
```

**Request — POST `/app/device/command/ack`**
```json
{
  "commandId": "<deviceCommands._id>",
  "appliedPolicyVersion": 5,
  "appliedAt": "2024-01-15T00:03:47.000Z"
}
```

**Backend actions — POST `/app/device/command/ack`:**
1. Validates `commandId` belongs to the authenticated device (tenantId + deviceId match)
2. Updates `deviceCommands`: `{ status: 'acknowledged', acknowledgedAt: appliedAt }`
3. Confirms device state based on command type:
   - `LOCK` or `TEMP_UNLOCK` → `devices.state` stays as set by scheduler/server
   - `UNLOCK` or `TEMP_UNLOCK` expiry → `devices.state` transitions to `ACTIVE`
4. Writes `auditLogs` entry: `{ event: 'POLICY_ACKNOWLEDGED', ... }`

**Response:**
```json
{ "success": true }
```

#### EMI & Payment

| Method | Route | Description |
|---|---|---|
| GET | `/app/emi/schedule` | Full EMI schedule (UC-32) |
| GET | `/app/emi/summary` | Current EMI summary (amount due, DPD, due date) |
| GET | `/app/payment/qr` | Fetch the tenant's active QR code image for payment |
| POST | `/app/payment/submit` | Borrower taps "Payment Sent" — creates payment record |
| GET | `/app/payment/history` | List all payments (UC-15) |
| GET | `/app/payment/:paymentId` | Single payment details |

**Response — GET `/app/payment/qr`**
```json
{
  "qrCodeId": "<ObjectId>",
  "label": "HDFC UPI",
  "imageUrl": "https://storage.emishield.in/qr/tenant123_hdfc.png"
}
```

> If no active QR code is configured for the tenant, returns `404` with message `"Payment not available — contact your lender"`.

**Request — POST `/app/payment/submit`**
```json
{
  "qrCodeId": "<ObjectId>",
  "amount": 3500
}
```

**Backend actions — POST `/app/payment/submit`:**
1. Validates JWT — device belongs to this tenant
2. Checks no `approval_pending` payment already exists for this device (prevents duplicates)
3. Creates `payments` document: `{ status: 'approval_pending', paymentMethod: 'qr', qrCodeId, amount, submittedAt }`
4. Sends FCM `NOTIFICATION` to tenant admins (`notificationType: PAYMENT_APPROVAL_REQUIRED`) — alerts them in Partner App
5. Writes `auditLogs` entry

**Response:**
```json
{
  "paymentId": "<ObjectId>",
  "status": "approval_pending",
  "message": "Payment submitted — awaiting lender confirmation"
}
```

#### Unlock Request & Escalation

| Method | Route | Description |
|---|---|---|
| POST | `/app/unlock-request` | Submit unlock request with reason + optional image (UC-16) |
| POST | `/app/unlock-request/:requestId/image` | Upload or replace evidence JPEG after submission (UC-17) |
| GET | `/app/unlock-request/active` | Get active unlock request status (UC-18) |
| GET | `/app/unlock-request/history` | All past unlock requests |

**Request — POST `/app/unlock-request`**

`Content-Type: multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | String | ✅ | Short required reason |
| `reasonCategory` | String | ✗ | `payment_made` \| `temporary_emergency` \| `payment_mismatch` \| `other` |
| `details` | String | ✗ | Optional longer description (up to 1000 chars) |
| `image` | File | ✗ | Optional JPEG evidence image (max 5MB) |

**Backend actions:**
1. Validate JWT, extract `userId`, `deviceId`, `tenantId`
2. Check no active (`PENDING_TENANT` or `ESCALATED_*`) case already exists for this device — return `409` if one is open
3. Upload image to S3 if provided → get `imageUrl`
4. Resolve `channelPartnerId` from `tenants` document
5. Create `unlockRequests` document:
   ```
   { caseId: 'CASE-YYYY-NNNNN', status: 'PENDING_TENANT',
     slaHours: policy.escalationRules.slaHours,
     slaDeadline: now + slaHours,
     details, imageUrl, reasonCategory }
   ```
6. Send FCM `NOTIFICATION` to tenant admins: `UNLOCK_REQUEST_RECEIVED`, deepLink to case
7. Write `auditLogs`: `UNLOCK_REQUEST_CREATED`

**Response:**
```json
{
  "caseId": "CASE-2024-00123",
  "status": "PENDING_TENANT",
  "slaDeadline": "2024-01-10T10:00:00Z",
  "message": "Your request has been submitted. The lender has been notified."
}
```

#### Notifications & Support

| Method | Route | Description |
|---|---|---|
| GET | `/app/notifications` | Get notifications list (UC-20 to UC-23) |
| PATCH | `/app/notifications/:id/read` | Mark notification as read |
| GET | `/app/support/contact` | Get lender support contact details (UC-31) |

#### Security Events

| Method | Route | Description |
|---|---|---|
| POST | `/app/security/event` | Report root/SIM-change/tamper event (UC-28, UC-29, UC-30) |
| POST | `/app/sync` | Full state sync on reconnect (UC-24, UC-25, UC-26, UC-27) |

**Request — POST `/app/security/event`**
```json
{
  "eventType": "ROOT_DETECTED",
  "details": { "method": "supersu_binary" }
}
```

---

### 6.3 Distributor Dashboard Routes (`/distributor`)

> Requires `tokenType: account` + `role: tenant_admin` + tenant has `distribute` capability

| Method | Route | Description |
|---|---|---|
| GET | `/distributor/dashboard` | Stats: devices sold, active, locked |
| POST | `/distributor/users/register` | Register new user (borrower) + loan details |
| POST | `/distributor/enrollment/qr` | Generate Android Device Owner QR provisioning payload from `enrollmentToken` |
| GET | `/distributor/users` | List all users under this tenant |
| GET | `/distributor/users/:id` | Single user details |
| POST | `/distributor/device/bind` | Bind device (IMEI) to user |
| GET | `/distributor/devices` | List all devices registered by this tenant |
| GET | `/distributor/devices/:id` | Single device details and state |

**Request — POST `/distributor/users/register`**
```json
{
  "name": "Ramesh Kumar",
  "mobile": "9988776655",
  "email": "ramesh@email.com",
  "aadhaarLinkedMobile": "9988776655",
  "loanId": "LOAN-2024-001",
  "loanAmount": 18000,
  "emiAmount": 3500,
  "tenureMonths": 6,
  "disbursementDate": "2024-01-01"
}
```

**Request — POST `/distributor/device/bind`**
```json
{
  "userId": "...",
  "imei": "123456789012345",
  "deviceModel": "Redmi 12",
  "manufacturer": "Xiaomi"
}
```

---

### 6.4 Partner (Tenant) Dashboard Routes (`/partner`)

> Requires `tokenType: account` + `role: tenant_admin`  
> Lock/unlock routes additionally require tenant has `lend` capability

> Tenant admins do not create subordinate accounts. Additional `tenant_admin` accounts are created, updated, activated, or deactivated by Super Admin through `/admin/accounts`.

#### Device Management

#### Device Management

| Method | Route | Description |
|---|---|---|
| GET | `/partner/devices` | Paginated device list with state filter |
| GET | `/partner/devices/:deviceId` | Device detail — state, EMI, case history |
| POST | `/partner/devices/:deviceId/lock` | Manually lock device (FR-1) |
| POST | `/partner/devices/:deviceId/unlock` | Manually unlock device (FR-1) |
| POST | `/partner/devices/:deviceId/temp-unlock` | Grant temporary unlock (FR-6) |

**Request — POST `/partner/devices/:deviceId/lock`**
```json
{ "reason": "3 consecutive EMI defaults" }
```

**Request — POST `/partner/devices/:deviceId/temp-unlock`**
```json
{ "durationHours": 24, "reason": "Borrower traveling, will pay tomorrow" }
```

#### Unlock Requests

| Method | Route | Description |
|---|---|---|
| GET | `/partner/unlock-requests` | List requests (filter: status, SLA breached, date range) |
| GET | `/partner/unlock-requests/:requestId` | Request detail with borrower info, image, history |
| POST | `/partner/unlock-requests/:requestId/approve` | Full unlock — optionally waive overdue installment |
| POST | `/partner/unlock-requests/:requestId/temp-unlock` | Grant temporary unlock for N hours |
| POST | `/partner/unlock-requests/:requestId/reject` | Reject request with mandatory reason |

**Request — POST `/partner/unlock-requests/:requestId/approve`**
```json
{
  "note": "Verified borrower's payment receipt via call",
  "emiAction": "waive"
}
```

`emiAction` options:
- `"waive"` — marks the current overdue installment as `waived` in `emiSchedules`; device gets `EMI_PAID` policy and won't be auto-relocked by the DPD scheduler
- `"none"` (default) — unlocks device to `ACTIVE`/`EMI_PAID` policy for the current cycle only; EMI installment remains `overdue` (use with caution — DPD scheduler may re-lock)

**Backend actions — POST `/partner/unlock-requests/:requestId/approve`:**
1. Validate case belongs to this tenant, is `PENDING_TENANT` status
2. If `emiAction === 'waive'`:
   - Find current overdue installment in `emiSchedules`
   - Update: `{ status: 'waived', waivedBy: <accountId>, waivedAt: now, waiveReason: caseId }`
   - Update `emiSchedules.overdueAmount`, `overdueInstallments`
3. Update `devices.state → UNLOCK_PENDING`, `policyKey → EMI_PAID`, `policyVersion: N+1`
4. Create `deviceCommands`: `{ commandType: 'UNLOCK', triggeredBy: 'manual_tenant' }`
5. Send FCM `POLICY_UPDATE` to device
6. Update `unlockRequests`: `{ status: 'RESOLVED_TENANT', resolutionAction: 'waived' | 'unlocked', resolvedBy, resolvedAt, resolutionNote }`
7. Send FCM `NOTIFICATION` to borrower: `UNLOCK_SUCCESS`
8. Write `auditLogs`: `CASE_RESOLVED` (+ `CASE_WAIVED` if emiAction = waive), `UNLOCK_TRIGGERED`

**Request — POST `/partner/unlock-requests/:requestId/temp-unlock`**
```json
{
  "durationHours": 24,
  "note": "Borrower is travelling, will pay on return"
}
```

**Backend actions:**
1. Validate case is `PENDING_TENANT`
2. Update `devices`: `{ state: 'TEMP_UNLOCK', policyKey: 'TEMP_UNLOCKED', tempUnlockExpiresAt: now + durationHours }`
3. Create `deviceCommands`: `{ commandType: 'TEMP_UNLOCK', payload: { durationHours } }`
4. Send FCM `POLICY_UPDATE` to device
5. Update `unlockRequests`: `{ status: 'RESOLVED_TENANT', resolutionAction: 'temp_unlocked', tempUnlockDurationHours: durationHours, resolvedBy, resolvedAt, resolutionNote }`
6. Send FCM `NOTIFICATION` to borrower: `TEMP_UNLOCK_APPROVED` (includes expiry time)
7. Write `auditLogs`: `TEMP_UNLOCK_TRIGGERED`, `CASE_RESOLVED`

**Request — POST `/partner/unlock-requests/:requestId/reject`**
```json
{ "note": "Payment not received per bank records. Please use the Pay Now option." }
```

**Backend actions:**
1. Update `unlockRequests`: `{ status: 'REJECTED', resolutionAction: 'rejected', resolvedBy, resolvedAt, resolutionNote }`
2. Send FCM `NOTIFICATION` to borrower: `ESCALATION_UPDATE` with rejection reason
3. Write `auditLogs`: `CASE_RESOLVED`

#### Escalation Queue

| Method | Route | Description |
|---|---|---|
| GET | `/partner/escalations` | Escalated cases assigned to this lender |
| GET | `/partner/escalations/:caseId` | Escalation case detail |

#### Payments

| Method | Route | Description |
|---|---|---|
| GET | `/partner/payments` | Payment list (filter by approvalStatus, date range) |
| GET | `/partner/payments/:paymentId` | Payment detail |
| GET | `/partner/payments/pending-approval` | List payments awaiting tenant approval |
| POST | `/partner/payments/:paymentId/approve` | Approve payment → triggers EMI match + unlock |

**Backend actions — POST `/partner/payments/:paymentId/approve`:**
1. Validates payment belongs to this tenant and is in `approvalStatus: 'pending_approval'`
2. Updates `payments`: `{ approvalStatus: 'approved', approvedBy: <accountId>, approvedAt: now, status: 'success' }`
3. Matches payment amount against `emiSchedules` — marks installment(s) as `paid`
4. Evaluates `tenantPolicies.unlockRules` — determines unlock type (instant / delayed)
5. Updates `devices.state` → `UNLOCK_PENDING`, `policyKey` → `EMI_PAID`, increments `policyVersion`
6. Creates `deviceCommands` record (`commandType: UNLOCK`, `triggeredBy: payment_unlock`)
7. Sends FCM `POLICY_UPDATE` to device
8. Sends FCM `NOTIFICATION` (`notificationType: UNLOCK_SUCCESS`) to borrower
9. Writes `auditLogs` entry

**Response:**
```json
{
  "success": true,
  "paymentId": "<ObjectId>",
  "unlockCommandId": "<ObjectId>",
  "matchedInstallments": ["<ObjectId>"]
}
```

#### QR Code Management

| Method | Route | Description |
|---|---|---|
| GET | `/partner/qr-codes` | List all QR codes for this tenant |
| POST | `/partner/qr-codes` | Upload a new QR code image (multipart/form-data) |
| PUT | `/partner/qr-codes/:qrId/activate` | Set this QR as active (deactivates all others) |
| DELETE | `/partner/qr-codes/:qrId` | Delete a QR code (blocked if `isActive: true`) |

**Request — POST `/partner/qr-codes`** (`multipart/form-data`):

| Field | Type | Description |
|---|---|---|
| `image` | File | QR code image (PNG/JPG, max 2MB) |
| `label` | String | Human-readable label, e.g. "HDFC UPI" |

**Backend actions — POST `/partner/qr-codes`:**
1. Validates image type and size
2. Uploads image to S3, gets `imageUrl`
3. Appends to `tenants.qrCodes` array: `{ label, imageUrl, isActive: false, uploadedBy }`
4. If this is the first QR code, sets `isActive: true` automatically

**Backend actions — PUT `/partner/qr-codes/:qrId/activate`:**
1. Sets all `tenants.qrCodes[].isActive` → `false`
2. Sets the target entry's `isActive` → `true`
3. Atomic update to prevent race conditions

**Response — GET `/partner/qr-codes`:**
```json
{
  "qrCodes": [
    {
      "_id": "<ObjectId>",
      "label": "HDFC UPI",
      "imageUrl": "https://storage.emishield.in/qr/tenant123_hdfc.png",
      "isActive": true,
      "uploadedBy": "<accountId>",
      "createdAt": "2024-01-10T10:00:00.000Z"
    }
  ]
}
```

#### Policy Configuration

| Method | Route | Description |
|---|---|---|
| GET | `/partner/policy` | Get current tenant EMI/escalation policy |
| PUT | `/partner/policy` | Update policy (FR-7) — requires `lend` capability |

#### Device Policy Configuration

| Method | Route | Description |
|---|---|---|
| GET | `/partner/device-policies` | List all enforcement policies for this tenant |
| POST | `/partner/device-policies` | Create an enforcement policy for a `policyKey` |
| PUT | `/partner/device-policies/:policyKey` | Update enforcement restrictions for a `policyKey` |

**Request — PUT `/partner/device-policies/:policyKey`**
```json
{
  "restrictions": {
    "lockMode": true,
    "allowedApps": ["com.emishield.app", "com.android.dialer", "com.paytm.android"],
    "blockedApps": [],
    "disableFactoryReset": true,
    "disableStatusBar": true
  }
}
```

**Request — PUT `/partner/policy`**
```json
{
  "lockRules": { "dpd": 30, "gracePeriodDays": 5 },
  "unlockRules": { "unlockType": "instant", "requireFullPayment": true },
  "tempUnlockRules": { "defaultDurationHours": 24 },
  "escalationRules": { "slaHours": 12 }
}
```

#### Audit & Reporting

| Method | Route | Description |
|---|---|---|
| GET | `/partner/audit-logs` | Filtered audit log (by device, event type, date) |
| GET | `/partner/reports/dashboard` | KPIs: lock rate, unlock rate, SLA compliance |
| GET | `/partner/reports/sla` | SLA tracker — pending requests and breach status |

---

### 6.5 Channel Partner Routes (`/cp`)

> Requires `tokenType: account` + `role: partner_admin`  
> `channelPartnerId` is resolved from the requesting account's JWT. All cases shown are scoped to tenants under this channel partner.

#### Escalation Queue

| Method | Route | Description |
|---|---|---|
| GET | `/cp/escalations` | All `ESCALATED_PARTNER` cases from this CP's tenants |
| GET | `/cp/escalations/:caseId` | Escalation detail — device, borrower, tenant, history, evidence image |
| POST | `/cp/escalations/:caseId/approve` | Full unlock — optionally waive overdue installment |
| POST | `/cp/escalations/:caseId/temp-unlock` | Grant temporary unlock for N hours |
| POST | `/cp/escalations/:caseId/reject` | Reject with mandatory reason |

**Request — POST `/cp/escalations/:caseId/approve`**
```json
{
  "reason": "Borrower confirmed payment. Tenant failed to respond.",
  "emiAction": "waive"
}
```

**Backend actions — POST `/cp/escalations/:caseId/approve`:**
1. Validate case is `ESCALATED_PARTNER` and belongs to a tenant under this `channelPartnerId`
2. If `emiAction === 'waive'`: mark overdue installment as `waived` in `emiSchedules`
3. Update `devices.state → UNLOCK_PENDING`, `policyKey → EMI_PAID`
4. Create `deviceCommands`: `{ commandType: 'UNLOCK', triggeredBy: 'manual_tenant' }`
5. Send FCM `POLICY_UPDATE` to device
6. Update `unlockRequests`: `{ status: 'RESOLVED_PARTNER', resolutionAction: 'waived' | 'unlocked', resolvedBy, resolvedAt }`
7. Send FCM `NOTIFICATION` to borrower: `UNLOCK_SUCCESS`
8. Write `auditLogs`: `CASE_RESOLVED`, `UNLOCK_TRIGGERED` (+ `CASE_WAIVED` if waive)

**Request — POST `/cp/escalations/:caseId/temp-unlock`**
```json
{ "durationHours": 48, "reason": "Case under investigation, granting interim access" }
```

**Request — POST `/cp/escalations/:caseId/reject`**
```json
{ "reason": "No evidence provided. Escalating back to tenant." }
```

---

### 6.6 Super Admin Dashboard Routes (`/admin`)

> Requires `tokenType: account` + `role: super_admin`

#### Escalation & Override

| Method | Route | Description |
|---|---|---|
| GET | `/admin/escalations` | All `ESCALATED_ADMIN` cases — channel partner SLA also breached |
| GET | `/admin/escalations/:caseId` | Escalation detail — full history including tenant + CP inaction |
| POST | `/admin/escalations/:caseId/unlock` | Override unlock (mandatory reason) (FR-5) |
| POST | `/admin/escalations/:caseId/temp-unlock` | Override temporary unlock (FR-6) |
| POST | `/admin/escalations/:caseId/reject` | Reject escalation with reason |
| GET | `/admin/overrides` | History of all override actions |

**Request — POST `/admin/escalations/:caseId/unlock`**
```json
{ "reason": "Tenant + CP both SLA breached 3x. Payment verified via bank records. Unlocking." }
```

#### Risk Monitoring

| Method | Route | Description |
|---|---|---|
| GET | `/admin/risk-flags` | Active risk flags (filter by severity, type) |
| PATCH | `/admin/risk-flags/:flagId/acknowledge` | Acknowledge risk flag |

#### Channel Partner & Tenant Management

| Method | Route | Description |
|---|---|---|
| GET | `/admin/channel-partners` | List all channel partners |
| POST | `/admin/channel-partners` | Create new channel partner |
| GET | `/admin/channel-partners/:id` | Channel partner details |
| PATCH | `/admin/channel-partners/:id` | Update channel partner |
| PATCH | `/admin/channel-partners/:id/status` | Activate / deactivate channel partner |
| GET | `/admin/tenants` | List all tenants |
| POST | `/admin/tenants` | Create new tenant and copy centralized default policies |
| GET | `/admin/tenants/:id` | Tenant detail |
| PATCH | `/admin/tenants/:id` | Update tenant profile/support details |
| PATCH | `/admin/tenants/:id/status` | Activate / deactivate tenant |
| GET | `/admin/accounts` | List `partner_admin` and `tenant_admin` accounts |
| POST | `/admin/accounts` | Create `partner_admin` or `tenant_admin` account |
| GET | `/admin/accounts/:accountId` | Account detail |
| PATCH | `/admin/accounts/:accountId` | Update account profile/scope |
| PATCH | `/admin/accounts/:accountId/status` | Activate / deactivate account |

**Policy creation on `POST /admin/tenants`:**  
The Super Admin create-tenant form does not include policy JSON. Default policies live centrally in the backend constants folder, for example `backend/src/constants/defaultPolicies.js`. The backend creates all related records in one MongoDB transaction:
1. One `tenants` document
2. One `tenantPolicies` document copied from `DEFAULT_TENANT_POLICY`
3. Five `devicePolicies` documents copied from `DEFAULT_DEVICE_POLICIES`, one per `policyKey`: `EMI_PAID`, `EMI_GRACE`, `EMI_LOCKED`, `TEMP_UNLOCKED`, `CONSENT_INVALID`
4. `auditLogs` entries for tenant and policy creation

Required validation:
- Request body must not include `tenantPolicy` or `devicePolicies`
- Every tenant receives one tenant policy and all five device policies
- The centralized `EMI_LOCKED` default must keep emergency dialer and borrower app accessible
- Tenant capability controls available APIs only; it does not control policy record creation

**Request — POST `/admin/tenants`**
```json
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

**Request — POST `/admin/accounts`**
```json
{
  "name": "Priya Sharma",
  "email": "priya@bharatpune.in",
  "mobile": "9800000003",
  "role": "tenant_admin",
  "tenantId": "<tenantId>",
  "temporaryPassword": "Welcome@123"
}
```
> Valid roles for this route: `partner_admin` and `tenant_admin`. Use `channelPartnerId` for `partner_admin` and `tenantId` for `tenant_admin`. No other operational account roles exist.

**Request — POST `/admin/accounts` for partner admin**
```json
{
  "name": "Anita Rao",
  "email": "anita@bharatfinance.in",
  "mobile": "9800000005",
  "role": "partner_admin",
  "channelPartnerId": "<channelPartnerId>",
  "temporaryPassword": "Welcome@123"
}
```

#### Consent Versions

| Method | Route | Description |
|---|---|---|
| GET | `/admin/consent-versions` | List consent document versions |
| POST | `/admin/consent-versions` | Create new consent version |
| GET | `/admin/consent-versions/:id` | Consent version detail |
| PATCH | `/admin/consent-versions/:id/publish` | Mark as current active version |

**Publish rule:** publishing a version sets every other `consentVersions.isCurrent` to `false` and sets the selected version to `isCurrent: true`. Existing `consentRecords` are never updated.

#### Device Oversight

| Method | Route | Description |
|---|---|---|
| GET | `/admin/devices` | Search devices by IMEI, borrower mobile, tenant, channel partner, or state |
| GET | `/admin/devices/:deviceId` | Device detail with borrower, tenant, consent, policy, risk, and EMI summary |
| GET | `/admin/devices/:deviceId/commands` | Device command history |
| GET | `/admin/devices/:deviceId/audit-logs` | Device-specific audit trail |

> Super Admin device oversight is read-heavy. Lock/unlock actions must happen through escalation override routes, not casual device detail actions.

#### Audit & Compliance

| Method | Route | Description |
|---|---|---|
| GET | `/admin/audit-logs` | Platform-wide audit log (all events) |
| GET | `/admin/audit-logs/export` | Export audit log (CSV / JSON) |
| GET | `/admin/reports/dashboard` | Platform KPIs and metrics |
| GET | `/admin/reports/override-analysis` | Override volume and reason breakdown |

---

### 6.7 Device Sync Routes (`/device`)

> Called by Android app on reconnect / background sync. Requires `tokenType: user` JWT.

| Method | Route | Description |
|---|---|---|
| POST | `/device/sync` | App syncs device state and pending policy on reconnect (UC-24 to UC-27) |

**Response — POST `/device/sync`**
```json
{
  "deviceState": "LOCKED",
  "currentPolicyKey": "EMI_LOCKED",
  "policyVersion": 2,
  "forceApplyPolicy": true
}
```

> If `forceApplyPolicy: true`, the app must immediately call `GET /app/device/policy` and re-apply restrictions, regardless of the locally cached policy version.

---

## 7. Workflow Diagrams

### 7.1 Payment-to-Unlock Flow

```
Borrower taps "Pay Now" on lock screen
        │
        ▼
GET /app/payment/qr → returns active QR image URL from tenants.qrCodes
        │
        ▼
App displays QR code image
Borrower scans with their UPI app and pays externally
        │
        ▼
Borrower taps "Payment Sent" in app
        │
        ▼
POST /app/payment/submit → creates payments record
{ status: 'approval_pending', paymentMethod: 'qr', submittedAt }
        │
        ▼
FCM NOTIFICATION → Tenant Admin Partner App
{ notificationType: 'PAYMENT_APPROVAL_REQUIRED' }
        │
        ▼
[Tenant admin opens Partner App]
GET /partner/payments/pending-approval → sees pending payment
        │
        ▼
Tenant verifies receipt in their bank / UPI app
        │
        ▼
POST /partner/payments/:paymentId/approve
        │
        ▼
Update payments: { status: 'success', approvalStatus: 'approved' }
        │
        ▼
Match payment amount → EMI schedule installments
Mark installment(s) as paid
        │
        ▼
Policy Engine: evaluate tenantPolicies.unlockRules
        │
        ▼
Update devices.state → 'UNLOCK_PENDING'
Set devices.policyKey → 'EMI_PAID'
Increment devices.policyVersion
        │
        ▼
Create deviceCommands: { commandType: 'UNLOCK', triggeredBy: 'payment_unlock' }
        │
        ▼
Send FCM POLICY_UPDATE → device
        │
        ▼
App fetches GET /app/device/policy → applies EMI_PAID policy (lockMode: false)
App calls POST /app/device/command/ack → devices.state → 'ACTIVE'
        │
        ▼
Write auditLogs (UNLOCK_TRIGGERED, POLICY_ACKNOWLEDGED)
        │
        ▼
Send FCM NOTIFICATION: { notificationType: 'UNLOCK_SUCCESS' } → borrower
```

### 7.2 Unlock Request & Two-Tier Escalation Flow

```
[Borrower App — LOCKED state]
Borrower taps "Request Unlock" → fills form (reason, details, optional JPEG)
        │
        ▼
POST /app/unlock-request (multipart/form-data)
  → image uploaded to S3 → imageUrl stored
  → unlockRequests created: { status: 'PENDING_TENANT', caseId, slaDeadline }
  → FCM NOTIFICATION (UNLOCK_REQUEST_RECEIVED) → tenant admin devices
        │
        ▼
[Partner App — Tenant Admin]
  GET /partner/unlock-requests → see case + image
  Tenant chooses one of three actions:
    ┌─────────────────────────────────────────────────────────┐
    │ OPTION A — Full Unlock                                  │
    │   POST /partner/unlock-requests/:id/approve             │
    │   emiAction: 'waive' → installment.status = 'waived'   │
    │   OR emiAction: 'none' → installment stays 'overdue'   │
    │   → devices.state → UNLOCK_PENDING → FCM POLICY_UPDATE │
    │   → case status → RESOLVED_TENANT                       │
    ├─────────────────────────────────────────────────────────┤
    │ OPTION B — Temp Unlock                                  │
    │   POST /partner/unlock-requests/:id/temp-unlock         │
    │   durationHours: N                                      │
    │   → devices.state → TEMP_UNLOCK                        │
    │   → case status → RESOLVED_TENANT                       │
    ├─────────────────────────────────────────────────────────┤
    │ OPTION C — Reject                                       │
    │   POST /partner/unlock-requests/:id/reject              │
    │   note: reason                                          │
    │   → case status → REJECTED                              │
    └─────────────────────────────────────────────────────────┘
        │ (if tenant does NOT act before slaDeadline)
        ▼
[Background Scheduler — SLA Escalation Checker, runs every 5 min]
Query: unlockRequests WHERE status='PENDING_TENANT' AND slaDeadline < now
        │
        ▼
Update status → ESCALATED_PARTNER
escalatedToPartnerAt = now
partnerSlaDeadline = now + policy.escalationRules.partnerEscalationSlaHours
Write auditLogs (ESCALATION_RAISED, SLA_BREACHED)
Create riskFlag if tenant has repeated SLA breaches
FCM NOTIFICATION (CASE_ESCALATED_TO_PARTNER) → partner admins
FCM NOTIFICATION (ESCALATION_UPDATE) → borrower
        │
        ▼
[Partner App — Partner Admin]
  GET /cp/escalations → see cases from all their tenants
  Channel partner chooses one of three actions (same as tenant):
    - POST /cp/escalations/:id/approve (full unlock, optional waive)
    - POST /cp/escalations/:id/temp-unlock
    - POST /cp/escalations/:id/reject
  → case status → RESOLVED_PARTNER
        │ (if channel partner does NOT act before partnerSlaDeadline)
        ▼
[Background Scheduler — SLA Escalation Checker]
Query: unlockRequests WHERE status='ESCALATED_PARTNER' AND partnerSlaDeadline < now
        │
        ▼
Update status → ESCALATED_ADMIN
escalatedToAdminAt = now
Write auditLogs (ESCALATION_RAISED, SLA_BREACHED)
FCM NOTIFICATION (CASE_ESCALATED_TO_ADMIN) → super admin
FCM NOTIFICATION (ESCALATION_UPDATE) → borrower: "Escalated to platform admin"
        │
        ▼
[Admin Dashboard — Super Admin]
  GET /admin/escalations → see ESCALATED_ADMIN cases
  Super admin takes action (mandatory reason on all):
    - POST /admin/escalations/:id/unlock (override full unlock)
    - POST /admin/escalations/:id/temp-unlock
    - POST /admin/escalations/:id/reject
  → deviceCommands (UNLOCK, triggeredBy: 'super_admin')
  → auditLogs (OVERRIDE_EXECUTED)
  → case status → RESOLVED_SUPER_ADMIN → CLOSED
```

### 7.3 Offline Lock / Unlock Flow

```
Lender triggers lock → POST /partner/devices/:id/lock
        │
        ▼
Update devices.state = 'OFFLINE_PENDING'
Set devices.currentPolicyKey = 'EMI_LOCKED'
Increment devices.desiredPolicyVersion
        │
Send POLICY_UPDATE FCM → device offline → FCM delivery deferred
        │
        ▼
[Device comes online]
        │
        ▼
App calls POST /device/sync
Server returns forceApplyPolicy: true, currentPolicyKey: 'EMI_LOCKED'
        │
        ▼
App fetches GET /app/device/policy → applies EMI_LOCKED policy
        │
        ▼
Update devices.state = 'LOCKED'
Write auditLogs (LOCK_TRIGGERED)
```

---

## 8. Device State Machine

```
                    ┌──────────────────┐
                    │     ACTIVE       │◄──────────────────────────┐
                    └────────┬─────────┘                           │
                             │ EMI overdue detected                 │
                             ▼                                      │
                    ┌──────────────────┐                           │
                    │  GRACE_PERIOD    │                           │
                    └────────┬─────────┘                           │
                             │ Grace period expires                 │
                             │ + valid policy + consent            │
                             ▼                                      │
                    ┌──────────────────┐    Full payment validated ─┘
                    │     LOCKED       │◄──────────────────────────────┐
                    └──┬───┬──────┬───┘                               │
                       │   │      │                                    │
     Borrower requests │   │      │ Payment validated                 │
     unlock            │   │      │ (instant unlock policy)           │
                       │   │      ▼                                    │
                       │   │  ┌─────────────────┐                     │
                       │   │  │ UNLOCK_PENDING   │ → command sent      │
                       │   │  └─────────────────┘      │              │
                       │   │                       delivered           │
                       │   │                            │              │
                       │   │                       [ACTIVE] ───────────┘
                       │   │
                       │   │ Temp unlock approved
                       │   ▼
                       │  ┌─────────────────┐
                       │  │  TEMP_UNLOCK    │ ──── expires ──► [LOCKED]
                       │  └─────────────────┘
                       │
                       ▼
              ┌──────────────────────┐
              │  Case: PENDING_TENANT│
              └──────┬───────────────┘
                     │ SLA breach
                     ▼
              ┌──────────────────────┐
              │      ESCALATED       │
              └──────────────────────┘

  [OFFLINE_PENDING] — Device offline, lock/unlock command queued, applied on reconnect
  [CONSENT_INVALID] — Enforcement blocked, compliance team alerted
```

---

## 9. Case State Machine

```
  Borrower submits → [PENDING_TENANT]
                           │
              ┌────────────┼────────────────┐
              │            │                │
         SLA breach   Tenant acts      Tenant rejects
              │            │                │
              ▼            ▼                ▼
   [ESCALATED_PARTNER] [RESOLVED_TENANT]  [REJECTED]
              │                              │
    ┌─────────┼──────────┐               [CLOSED]
    │         │          │
 CP SLA    CP acts   CP rejects
 breach       │          │
    │         ▼          ▼
    ▼  [RESOLVED_PARTNER] [REJECTED]
[ESCALATED_ADMIN]           │
    │                    [CLOSED]
    │
  Admin acts (mandatory reason)
    │
    ▼
[RESOLVED_SUPER_ADMIN]
    │
    ▼
[CLOSED]
```

**Terminal states:** `RESOLVED_TENANT`, `RESOLVED_PARTNER`, `RESOLVED_SUPER_ADMIN`, `REJECTED`, `CLOSED`

| Status | Who sets it | Trigger |
|---|---|---|
| `PENDING_TENANT` | System (on submit) | Borrower submits unlock request |
| `ESCALATED_PARTNER` | Scheduler | Tenant `slaDeadline` exceeded |
| `ESCALATED_ADMIN` | Scheduler | Channel partner `partnerSlaDeadline` exceeded |
| `UNDER_REVIEW` | Super admin | Super admin opens case for investigation |
| `RESOLVED_TENANT` | Tenant admin | Any of: approve, temp-unlock, reject |
| `RESOLVED_PARTNER` | Partner admin | Any of: approve, temp-unlock, reject |
| `RESOLVED_SUPER_ADMIN` | Super admin | Override unlock / temp-unlock / reject |
| `REJECTED` | Tenant / CP / Admin | Request denied |
| `CLOSED` | System | Case acknowledged as complete |

---

## 10. Security Architecture

### Authentication Strategy

| Actor | Collection | Method |
|---|---|---|
| Borrower (Android app) | `users` | OTP → JWT (`tokenType: user`) |
| Tenant admin | `accounts` | Email+Password or OTP → JWT (`tokenType: account`) |
| Partner admin | `accounts` | Email+Password → JWT (`tokenType: account`) |
| Super admin | `accounts` | Email+Password + 2FA → JWT (`tokenType: account`) |
| Payment Webhooks | — | Webhook HMAC-SHA256 signature |
| Device Sync | `users` | Device-bound JWT tied to IMEI + user session |

### RBAC Permission Matrix

| Permission | super_admin | partner_admin | tenant_admin (lend) | tenant_admin (distribute) | user (borrower) |
|---|---|---|---|---|---|
| Lock device | Escalation only | Escalated cases only | Yes | No | No |
| Unlock device | Escalation only | Escalated cases only | Yes | No | No |
| Temp unlock | Escalation only | Escalated cases only | Within policy | No | No |
| Override (with reason) | Yes | No | No | No | No |
| Configure policy | Platform setup only | No | Own tenant | No | No |
| View audit logs | All | Channel partner scope | Own tenant | Own tenant | No |
| Handle escalation | Admin escalation queue | Partner escalation queue | Own cases | No | No |
| Register users/devices | No | No | No | Yes | No |
| Submit unlock request | No | No | No | No | Yes |
| Make payment | No | No | No | No | Yes |
| View own EMI/case status | No | No | No | No | Yes |
| Manage tenants | Yes | No | No | No | No |
| Manage channel partners | Yes | No | No | No | No |

### Key Security Rules

1. **Consent Gate** — No lock command is dispatched unless `consentRecords` has a valid, verified record for the device
2. **Tenant Isolation** — All DB queries are scoped by `tenantId` / `channelPartnerId` via middleware
3. **Audit Immutability** — `auditLogs` and `consentRecords` collections have no UPDATE/DELETE routes
4. **Payment Deduplication** — Approval workflow prevents duplicate unlock triggers for the same pending payment
5. **Override Mandatory Reason** — Super admin override API validates `reason` field at route level
6. **Device Integrity** — Root/tamper detection events generate risk flags and may block enforcement
7. **OTP Expiry** — OTP records expire after 10 minutes through Atlas-managed TTL configuration, with attempt throttling
8. **Offline Token Security** — Offline unlock tokens (Phase 2) require cryptographic signing

### MongoDB Atlas Indexing

MongoDB Atlas manages indexes and TTL configuration for this project. The backend does not issue manual `createIndex` commands, and Mongoose models should avoid explicit `schema.index(...)` declarations.

---

## Appendix — FCM Message Types

All FCM messages are sent via **Firebase Admin SDK** using the device's `devices.fcmToken`. Three distinct message types are used:

### POLICY_UPDATE — Silent Data Message

Tells the app its policy has changed. The app **must not trust the payload alone** — it must fetch the current policy from `GET /app/device/policy` and apply it via DevicePolicyManager, then acknowledge via `POST /app/device/command/ack`.

**FCM payload:**
```json
{
  "token": "<devices.fcmToken>",
  "data": {
    "type": "POLICY_UPDATE",
    "commandId": "<deviceCommands._id>",
    "policyVersion": "5"
  },
  "android": { "priority": "HIGH" }
}
```

**Stored in:** `deviceCommands` (tracked with `fcmMessageId`, `sentAt`, `acknowledgedAt`)

**App handling:**
1. Receive → call `GET /app/device/policy`
2. Apply policy via DevicePolicyManager
3. Call `POST /app/device/command/ack` with `commandId`

---

### NOTIFICATION — User-Visible Push Notification

Sends an in-app notification to the borrower (EMI reminder, device locked alert, unlock success, etc.). Contains a `deepLink` for tap-to-navigate behaviour.

**FCM payload:**
```json
{
  "token": "<devices.fcmToken>",
  "notification": {
    "title": "Device Restricted",
    "body": "Your EMI payment is overdue. Your device has been restricted."
  },
  "data": {
    "type": "NOTIFICATION",
    "notificationType": "DEVICE_LOCKED",
    "notificationId": "<notifications._id>",
    "deepLink": "emishield://pay"
  },
  "android": { "priority": "HIGH" }
}
```

**`notificationType` values (from `notifications.type` enum):**
`EMI_REMINDER`, `OVERDUE_WARNING`, `GRACE_PERIOD_START`, `DEVICE_LOCKED`, `UNLOCK_SUCCESS`, `UNLOCK_REQUEST_RECEIVED`, `ESCALATION_UPDATE`, `TEMP_UNLOCK_APPROVED`, `TEMP_UNLOCK_EXPIRING`, `CASE_RESOLVED`, `PAYMENT_CONFIRMED`, `PAYMENT_APPROVAL_REQUIRED`, `CASE_ESCALATED_TO_PARTNER`, `CASE_ESCALATED_TO_ADMIN`

**Stored in:** `notifications` (`channel: 'fcm'`)

**App handling:** Show Android notification. On tap → open Borrower App at `deepLink` destination.

---

### SECURITY_ALERT — High-Priority Silent Data Message

Sent for tamper events, consent violations, or fraud signals. The app logs the event, shows an alert to the user, and notifies the backend.

**FCM payload:**
```json
{
  "token": "<devices.fcmToken>",
  "data": {
    "type": "SECURITY_ALERT",
    "alertCode": "CONSENT_MISSING",
    "notificationId": "<notifications._id>"
  },
  "android": { "priority": "HIGH" }
}
```

**`alertCode` values:** `CONSENT_MISSING`, `FACTORY_RESET_ATTEMPTED`, `SIM_SWAP_DETECTED`, `ROOT_DETECTED`, `DPC_REMOVED`

**Stored in:** `notifications` (`channel: 'fcm'`, `type` mapped from alertCode)

**App handling:** Log event locally, show alert UI, call security events API.

---

## Appendix — Scheduled Jobs

| Job | Frequency | Purpose |
|---|---|---|
| **SLA Escalation Checker** | Every 5 minutes | Two-tier check: (1) `PENDING_TENANT` cases past `slaDeadline` → `ESCALATED_PARTNER` + notify CP; (2) `ESCALATED_PARTNER` cases past `partnerSlaDeadline` → `ESCALATED_ADMIN` + notify super admin |
| **Temp Unlock Expiry** | Every 1 minute | Query `TEMP_UNLOCK` devices past `tempUnlockExpiresAt`, re-evaluate and relock |
| **Command Retry** | Every 10 minutes | Retry `pending` device commands that haven't been delivered |
| **EMI DPD Calculator** | Daily at midnight | Recalculate `dpd` on all active `emiSchedules`, trigger auto-lock policy evaluation |
| **Risk Flag Generator** | Every 30 minutes | Detect override volume spikes, repeated SLA breaches, create `riskFlags` |
