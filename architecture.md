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

| Interface | Users | Role |
|---|---|---|
| **Admin Dashboard** | Super Admin | Exception handling, escalation override, risk monitoring, platform governance |
| **Partner Dashboard** | Tenant staff (NBFCs, Retail Chains, Standalone Outlets) | Daily lock/unlock operations, payment review, unlock request handling, policy config |
| **Distributor Dashboard** | Tenant staff with distributor capability | Device sale registration, user onboarding, device-user binding |
| **Android App** | User (borrower — device purchaser) | Pay EMI, request unlock, view escalation status, consent acceptance |

### Identity Model

| Collection | Who it represents |
|---|---|
| `accounts` | All dashboard logins — super admin, channel partner staff, tenant staff |
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
│  │  Admin Dashboard │  │ Partner Dashboard│  │ Distributor Dashboard  │   │
│  │   (React/Web)    │  │   (React/Web)    │  │     (React/Web)        │   │
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
| **Payment Gateway / UPI** | Payment initiation and webhook callbacks |
| **Firebase Cloud Messaging (FCM)** | Push notifications to Android devices |
| **OTP / SMS Service** | OTP delivery for auth and consent |
| **File Storage (S3 / compatible)** | Payment proof document uploads |

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
- `accounts` → login credentials for all dashboard actors (super admin, channel partner staff, tenant staff)
- `users` → device purchasers only. No dashboard access. Authenticate via OTP on the Android app
- `tenants` → the organisation entity. A tenant's `capabilities` array determines whether it can lend (lock/unlock authority), distribute (register devices/users), or both
- A parent tenant (e.g. Retail Chain) can have child tenants (outlets) — `parentTenantId` field

**Isolation Rules:**
- Tenant staff can only view/manage resources where `tenantId` matches their own
- Channel partner accounts see aggregated data across all their tenants
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
- Payment initiation (UPI / Gateway)
- Webhook ingestion from payment gateways
- Payment deduplication by transaction reference
- EMI schedule matching and validation
- Post-payment action determination (full/partial/delayed unlock)

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
Dashboard login credentials for all non-borrower actors: super admins, channel partner staff, and tenant staff.

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
      'channel_partner_admin',
      'channel_partner_staff',
      'tenant_admin',
      'tenant_staff'
    ],
    required: true
  },

  // Scoping — only one of these is populated depending on role
  channelPartnerId: { type: ObjectId, ref: 'channelPartners' }, // for CP roles
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
  registeredBy: { type: ObjectId, ref: 'accounts' }, // tenant staff who onboarded them
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
  updatedAt: { type: Date, default: Date.now }
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
    disableStatusBar: { type: Boolean, default: false }
  },

  version: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: ObjectId, ref: 'accounts' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
// Compound unique index: { tenantId: 1, policyKey: 1 }
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
Per-tenant configurable policy for lock, unlock, and escalation behavior. Only tenants with the `lend` capability have a policy document.

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
    slaHours: { type: Number, default: 24 },            // hours before auto-escalate
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
        enum: ['pending', 'paid', 'overdue', 'partial'],
        default: 'pending'
      },
      paidAmount: { type: Number, default: 0 },
      paidAt: { type: Date },
      paymentId: { type: ObjectId, ref: 'payments' }
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
All payment transactions (deduplication by txnRef).

```js
{
  _id: ObjectId,
  userId: { type: ObjectId, ref: 'users', required: true },
  tenantId: { type: ObjectId, ref: 'tenants', required: true },
  deviceId: { type: ObjectId, ref: 'devices' },

  // Payment identifiers
  txnRef: { type: String, required: true, unique: true },   // gateway transaction reference
  orderId: { type: String },                                 // internal order ID
  gatewayTxnId: { type: String },

  // Amount
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },

  // Channel
  paymentMethod: {
    type: String,
    enum: ['upi', 'gateway', 'wallet', 'manual'],
    required: true
  },
  upiId: { type: String },

  // Status lifecycle
  status: {
    type: String,
    enum: ['initiated', 'pending', 'success', 'failed', 'refunded', 'duplicate'],
    default: 'initiated'
  },
  gatewayStatus: { type: String },   // raw status from gateway
  failureReason: { type: String },

  // Validation
  validationStatus: {
    type: String,
    enum: ['pending', 'matched', 'mismatch', 'manual_review'],
    default: 'pending'
  },
  matchedInstallments: [{ type: ObjectId }],   // installment IDs matched
  validatedAt: { type: Date },
  validatedBy: { type: String, default: 'system' },

  // Unlock outcome
  unlockTriggered: { type: Boolean, default: false },
  unlockCommandId: { type: ObjectId, ref: 'deviceCommands' },

  initiatedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  webhookReceivedAt: { type: Date }
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
User-initiated unlock request cases.

```js
{
  _id: ObjectId,
  caseId: { type: String, required: true, unique: true },   // e.g. "CASE-2024-00123"
  userId: { type: ObjectId, ref: 'users', required: true },
  deviceId: { type: ObjectId, ref: 'devices', required: true },
  tenantId: { type: ObjectId, ref: 'tenants', required: true },

  reason: { type: String, required: true },
  reasonCategory: {
    type: String,
    enum: ['payment_made', 'temporary_emergency', 'gateway_issue', 'payment_mismatch', 'other']
  },
  proofDocumentUrl: { type: String },

  // Case state
  status: {
    type: String,
    enum: [
      'PENDING_TENANT',
      'ESCALATED',
      'UNDER_REVIEW',
      'RESOLVED_TENANT',
      'RESOLVED_SUPER_ADMIN',
      'REJECTED',
      'CLOSED'
    ],
    default: 'PENDING_TENANT'
  },

  // SLA tracking
  slaHours: { type: Number },
  slaDeadline: { type: Date },
  slaBreached: { type: Boolean, default: false },
  escalatedAt: { type: Date },

  // Resolution
  resolvedBy: { type: ObjectId, ref: 'accounts' },
  resolvedAt: { type: Date },
  resolutionNote: { type: String },
  resolutionAction: {
    type: String,
    enum: ['unlocked', 'temp_unlocked', 'rejected', 'override']
  },

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
      'CASE_RESOLVED'
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
      'PAYMENT_CONFIRMED'
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
  expiresAt: { type: Date, required: true },   // TTL index — 10 min default
  createdAt: { type: Date, default: Date.now }
}
// TTL Index: db.otpRecords.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
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

#### EMI & Payment

| Method | Route | Description |
|---|---|---|
| GET | `/app/emi/schedule` | Full EMI schedule (UC-32) |
| GET | `/app/emi/summary` | Current EMI summary (amount due, DPD, due date) |
| POST | `/app/payment/initiate` | Initiate UPI / gateway payment (UC-12) |
| POST | `/app/payment/callback` | App-side payment callback after UPI return (UC-12) |
| GET | `/app/payment/history` | List all payments (UC-15) |
| GET | `/app/payment/:paymentId` | Single payment details |

**Request — POST `/app/payment/initiate`**
```json
{ "amount": 3500, "method": "upi", "upiId": "borrower@upi" }
```
**Response:**
```json
{
  "orderId": "ORD-20240109-001",
  "upiDeepLink": "upi://pay?...",
  "txnRef": "EMI-TXN-001"
}
```

#### Unlock Request & Escalation

| Method | Route | Description |
|---|---|---|
| POST | `/app/unlock-request` | Submit unlock request with reason (UC-16) |
| POST | `/app/unlock-request/:requestId/proof` | Upload payment proof document (UC-17) |
| GET | `/app/unlock-request/active` | Get active unlock request status (UC-18) |
| GET | `/app/unlock-request/history` | All past unlock requests |

**Request — POST `/app/unlock-request`**
```json
{
  "reason": "I have already paid the EMI. Transaction ID: UPI-123",
  "reasonCategory": "payment_made"
}
```
**Response:**
```json
{
  "caseId": "CASE-2024-00123",
  "status": "PENDING_TENANT",
  "slaDeadline": "2024-01-10T10:00:00Z"
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

> Requires `tokenType: account` + `role: tenant_admin | tenant_staff` + tenant has `distribute` capability

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

> Requires `tokenType: account` + `role: tenant_admin | tenant_staff`  
> Lock/unlock routes additionally require tenant has `lend` capability

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
| GET | `/partner/unlock-requests` | List requests (filter: status, SLA breached) |
| GET | `/partner/unlock-requests/:requestId` | Request detail with borrower info |
| POST | `/partner/unlock-requests/:requestId/approve` | Approve → triggers unlock |
| POST | `/partner/unlock-requests/:requestId/reject` | Reject request with reason |
| POST | `/partner/unlock-requests/:requestId/temp-unlock` | Grant temporary unlock as resolution |

**Request — POST `/partner/unlock-requests/:requestId/approve`**
```json
{ "note": "Verified payment via bank statement" }
```

#### Escalation Queue

| Method | Route | Description |
|---|---|---|
| GET | `/partner/escalations` | Escalated cases assigned to this lender |
| GET | `/partner/escalations/:caseId` | Escalation case detail |

#### Payments

| Method | Route | Description |
|---|---|---|
| GET | `/partner/payments` | Payment list (filter by status, date range) |
| GET | `/partner/payments/:paymentId` | Payment detail with validation status |
| POST | `/partner/payments/:paymentId/manual-validate` | Manually mark payment as validated |

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

### 6.5 Super Admin Dashboard Routes (`/admin`)

> Requires `tokenType: account` + `role: super_admin`

#### Escalation & Override

| Method | Route | Description |
|---|---|---|
| GET | `/admin/escalations` | All escalated cases platform-wide |
| GET | `/admin/escalations/:caseId` | Escalation detail — device, borrower, payment, history |
| POST | `/admin/escalations/:caseId/unlock` | Override unlock (mandatory reason) (FR-5) |
| POST | `/admin/escalations/:caseId/temp-unlock` | Override temporary unlock (FR-6) |
| POST | `/admin/escalations/:caseId/reject` | Reject escalation with reason |
| GET | `/admin/overrides` | History of all override actions |

**Request — POST `/admin/escalations/:caseId/unlock`**
```json
{ "reason": "Lender SLA breached 3x. Payment verified via bank records. Unlocking." }
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
| GET | `/admin/tenants` | List all tenants |
| POST | `/admin/tenants` | Create new tenant |
| GET | `/admin/tenants/:id` | Tenant detail |
| PATCH | `/admin/tenants/:id/status` | Activate / deactivate tenant |
| GET | `/admin/tenants/:id/accounts` | List staff accounts under a tenant |

#### Consent Versions

| Method | Route | Description |
|---|---|---|
| GET | `/admin/consent-versions` | List consent document versions |
| POST | `/admin/consent-versions` | Create new consent version |
| PATCH | `/admin/consent-versions/:id/activate` | Mark as current active version |

#### Audit & Compliance

| Method | Route | Description |
|---|---|---|
| GET | `/admin/audit-logs` | Platform-wide audit log (all events) |
| GET | `/admin/audit-logs/export` | Export audit log (CSV / JSON) |
| GET | `/admin/reports/dashboard` | Platform KPIs and metrics |
| GET | `/admin/reports/override-analysis` | Override volume and reason breakdown |

---

### 6.6 Payment Gateway Webhook Routes (`/webhooks`)

> Secured by webhook signature verification (not JWT)

| Method | Route | Description |
|---|---|---|
| POST | `/webhooks/payment/:gateway` | Receive payment callback (UPI, gateway) |

**Flow triggered by webhook:**
1. Verify gateway signature
2. Deduplicate by `txnRef`
3. Update `payments.status` → `success` or `failed`
4. If success → trigger Validation Engine → EMI schedule matching
5. If matched → invoke Policy Engine → determine unlock action
6. Update `devices.state` = `ACTIVE`, set `devices.currentPolicyKey` = `EMI_PAID`, increment `desiredPolicyVersion`
7. Send `POLICY_UPDATE` FCM to device: `{ "type": "POLICY_UPDATE", "policyVersion": <n> }`
8. Write `auditLogs` entry

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
Borrower pays via UPI
        │
        ▼
Payment Gateway Webhook → POST /webhooks/payment/:gateway
        │
        ▼
Deduplicate by txnRef (check payments collection)
        │
        ▼
Update payments.status = 'success'
        │
        ▼
Validation Engine: match txnRef → EMI schedule installments
        │
   ┌────┴────┐
   │matched? │
   └──┬──┬───┘
      │  │
    YES  NO → status = 'mismatch' → flag for manual review
      │         do NOT trigger unlock
      ▼
Policy Engine: evaluate lenderPolicy.unlockRules
      │
  ┌───┴────────────────────────┐
  │  unlockType?                │
  └──┬──────────┬──────────────┘
     │          │
  instant    delayed (T+X min)
     │          │
     ▼          ▼
Update devices.state = 'ACTIVE'
Set devices.currentPolicyKey = 'EMI_PAID'
Increment devices.desiredPolicyVersion
    │
    ▼
Send POLICY_UPDATE FCM: { "type": "POLICY_UPDATE", "policyVersion": N }
    │
    ▼
App fetches GET /app/device/policy → applies EMI_PAID policy (lockMode: false)
    │
    ▼
Write auditLogs (UNLOCK_TRIGGERED)
    │
    ▼
Send FCM notification: "Device Unlocked"
```

### 7.2 Unlock Request & Auto-Escalation Flow

```
Borrower taps "Request Unlock"
        │
        ▼
POST /app/unlock-request → create unlockRequests record
caseId generated, status = PENDING_TENANT
slaDeadline = now + policy.slaHours
        │
        ▼
Notify lender dashboard (FCM / in-app)
        │
        ▼
[Background Scheduler — runs every N minutes]
        │
        ▼
Query: unlockRequests WHERE status=PENDING_TENANT AND slaDeadline < now
        │
        ▼
Update status → ESCALATED
escalatedAt = now
Write auditLogs (ESCALATION_RAISED)
Create riskFlags if repeated SLA breach
Notify borrower: "Request escalated to admin"
Notify super admin dashboard
        │
        ▼
Super Admin reviews → POST /admin/escalations/:id/unlock
(mandatory reason required)
        │
        ▼
Create deviceCommands (UNLOCK, triggeredBy: 'super_admin')
Write auditLogs (OVERRIDE_EXECUTED)
Update case status → RESOLVED_SUPER_ADMIN
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
              ┌────────────┼────────────┐
              │            │            │
         SLA breach   Tenant acts  Tenant rejects
              │            │            │
              ▼            ▼            ▼
        [ESCALATED]  [RESOLVED_    [REJECTED]
              │        TENANT]          │
              │                         │
         Admin acts                  [CLOSED]
              │
       ┌──────┴──────┐
       │             │
   Unlocked     Temp Unlock
       │             │
       ▼             ▼
[RESOLVED_SUPER_ADMIN]
       │
       ▼
   [CLOSED]
```

---

## 10. Security Architecture

### Authentication Strategy

| Actor | Collection | Method |
|---|---|---|
| Borrower (Android app) | `users` | OTP → JWT (`tokenType: user`) |
| Tenant staff / admin | `accounts` | Email+Password or OTP → JWT (`tokenType: account`) |
| Channel partner staff | `accounts` | Email+Password → JWT (`tokenType: account`) |
| Super admin | `accounts` | Email+Password + 2FA → JWT (`tokenType: account`) |
| Payment Webhooks | — | Webhook HMAC-SHA256 signature |
| Device Sync | `users` | Device-bound JWT tied to IMEI + user session |

### RBAC Permission Matrix

| Permission | super_admin | tenant_admin (lend) | tenant_staff (lend) | tenant (distribute only) | user (borrower) |
|---|---|---|---|---|---|
| Lock device | Escalation only | ✅ | ✅ | ❌ | ❌ |
| Unlock device | Escalation only | ✅ | ✅ | ❌ | ❌ |
| Temp unlock | Escalation only | ✅ Within policy | ✅ Within policy | ❌ | ❌ |
| Override (with reason) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Configure policy | ❌ (platform-level only) | ✅ Own tenant | ❌ | ❌ | ❌ |
| View audit logs | ✅ All | ✅ Own tenant | ✅ Own tenant | ❌ | ❌ |
| Handle escalation | ✅ | ✅ Own cases | ✅ Own cases | ❌ | ❌ |
| Register users/devices | ❌ | ❌ | ❌ | ✅ | ❌ |
| Submit unlock request | ❌ | ❌ | ❌ | ❌ | ✅ |
| Make payment | ❌ | ❌ | ❌ | ❌ | ✅ |
| View own EMI/case status | ❌ | ❌ | ❌ | ❌ | ✅ |
| Manage tenants | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage channel partners | ✅ | ❌ | ❌ | ❌ | ❌ |

### Key Security Rules

1. **Consent Gate** — No lock command is dispatched unless `consentRecords` has a valid, verified record for the device
2. **Tenant Isolation** — All DB queries are scoped by `tenantId` / `channelPartnerId` via middleware
3. **Audit Immutability** — `auditLogs` and `consentRecords` collections have no UPDATE/DELETE routes
4. **Payment Deduplication** — Unique index on `payments.txnRef` prevents duplicate unlock triggers
5. **Override Mandatory Reason** — Super admin override API validates `reason` field at route level
6. **Device Integrity** — Root/tamper detection events generate risk flags and may block enforcement
7. **OTP Expiry** — MongoDB TTL index on `otpRecords.expiresAt` (10 min) with attempt throttling
8. **Offline Token Security** — Offline unlock tokens (Phase 2) require cryptographic signing

### MongoDB Indexes

```js
// accounts
db.accounts.createIndex({ email: 1 }, { unique: true })
db.accounts.createIndex({ tenantId: 1, role: 1 })
db.accounts.createIndex({ channelPartnerId: 1, role: 1 })

// users
db.users.createIndex({ mobile: 1 }, { unique: true })
db.users.createIndex({ loanId: 1 }, { unique: true })
db.users.createIndex({ tenantId: 1 })

// tenants
db.tenants.createIndex({ channelPartnerId: 1 })
db.tenants.createIndex({ parentTenantId: 1 })

// devices
db.devices.createIndex({ userId: 1, tenantId: 1 })
db.devices.createIndex({ imei: 1 }, { unique: true })
db.devices.createIndex({ state: 1, tenantId: 1 })

// payments
db.payments.createIndex({ txnRef: 1 }, { unique: true })
db.payments.createIndex({ userId: 1, status: 1 })

// unlockRequests
db.unlockRequests.createIndex({ tenantId: 1, status: 1 })
db.unlockRequests.createIndex({ slaDeadline: 1, status: 1 })  // for SLA scheduler

// auditLogs
db.auditLogs.createIndex({ deviceId: 1, timestamp: -1 })
db.auditLogs.createIndex({ tenantId: 1, eventType: 1, timestamp: -1 })

// notifications
db.notifications.createIndex({ recipientId: 1, createdAt: -1 })

// deviceCommands
db.deviceCommands.createIndex({ deviceId: 1, status: 1 })

// tenantPolicies
db.tenantPolicies.createIndex({ tenantId: 1 }, { unique: true })

// TTL index
db.otpRecords.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

---

## Appendix — Scheduled Jobs

| Job | Frequency | Purpose |
|---|---|---|
| **SLA Escalation Checker** | Every 5 minutes | Query `PENDING_TENANT` cases past `slaDeadline`, auto-escalate |
| **Temp Unlock Expiry** | Every 1 minute | Query `TEMP_UNLOCK` devices past `tempUnlockExpiresAt`, re-evaluate and relock |
| **Command Retry** | Every 10 minutes | Retry `pending` device commands that haven't been delivered |
| **EMI DPD Calculator** | Daily at midnight | Recalculate `dpd` on all active `emiSchedules`, trigger auto-lock policy evaluation |
| **Risk Flag Generator** | Every 30 minutes | Detect override volume spikes, repeated SLA breaches, create `riskFlags` |
| **Payment Validation Retry** | Every 15 minutes | Re-attempt validation for `mismatch` / `pending` payments |
