# EMI Shield — Device States

> **Purpose:** Every possible state a managed device can be in, what triggers it, what the device enforces, what the borrower sees, and how the state changes.
>
> `devices.state` is the authoritative field. `devices.policyKey` controls which policy document is fetched and enforced.

---

## Table of Contents

1. [State Overview](#1-state-overview)
2. [State Details](#2-state-details)
   - [ACTIVE](#21-active)
   - [GRACE_PERIOD](#22-grace_period)
   - [LOCKED](#23-locked)
   - [TEMP_UNLOCK](#24-temp_unlock)
   - [UNLOCK_PENDING](#25-unlock_pending)
   - [OFFLINE_PENDING](#26-offline_pending)
   - [CONSENT_INVALID](#27-consent_invalid)
3. [State Transition Table](#3-state-transition-table)
4. [Scheduler-Triggered Transitions](#4-scheduler-triggered-transitions)
5. [Manual Transitions](#5-manual-transitions)
6. [Policy Enforcement Matrix](#6-policy-enforcement-matrix)
7. [FCM Messages Per Transition](#7-fcm-messages-per-transition)

---

## 1. State Overview

| State | `policyKey` | Enforcement Level | Triggering Source |
|---|---|---|---|
| `ACTIVE` | `EMI_PAID` | None — full access | Payment validated / registration complete |
| `GRACE_PERIOD` | `EMI_GRACE` | Warning only | Scheduler: EMI overdue within grace window |
| `LOCKED` | `EMI_LOCKED` | Full lock — restricted app set | Scheduler: Grace expired / SLA policy |
| `TEMP_UNLOCK` | `TEMP_UNLOCKED` | Temporary full access | Manual: Tenant admin grants temp unlock |
| `UNLOCK_PENDING` | *(unchanged)* | Same as LOCKED until delivered | Event: Tenant approves payment, unlock command queued |
| `OFFLINE_PENDING` | *(unchanged)* | Last applied policy enforced locally | Event: Any command when device offline |
| `CONSENT_INVALID` | `CONSENT_INVALID` | Lock **blocked** — enforcement error | System: No valid `consentRecord` on lock attempt |

---

## 2. State Details

### 2.1 ACTIVE

> The device is fully operational. All apps work normally.

| Field | Value |
|---|---|
| `devices.state` | `ACTIVE` |
| `devices.policyKey` | `EMI_PAID` |
| `policyVersion` | Incremented on every state entry |

**Triggered into ACTIVE from:**
- Device onboarding (first registration + consent complete) → initial state
- Payment fully validated and matched to outstanding EMI → LOCKED/GRACE exits to ACTIVE
- Admin override (Super Admin manual unlock) → LOCKED exits to ACTIVE
- TEMP_UNLOCK expires while no overdue EMI exists (scheduler re-evaluates → ACTIVE if paid)

**Triggered out of ACTIVE:**
- EMI DPD Calculator detects EMI is overdue → `GRACE_PERIOD`

**Device enforcement (`EMI_PAID` policy):**
- `lockMode: false`
- No app restrictions
- Factory reset: allowed (per tenant config — default disabled for enrolled devices)
- Status bar: enabled

**Borrower App UX:**
- Normal home screen
- EMI summary displayed (next due date, balance)
- No banners or warnings

---

### 2.2 GRACE_PERIOD

> EMI is overdue, but the tenant has configured a grace window before locking. The device remains usable — a prominent warning is shown.

| Field | Value |
|---|---|
| `devices.state` | `GRACE_PERIOD` |
| `devices.policyKey` | `EMI_GRACE` |

**Triggered into GRACE_PERIOD from:**
- `ACTIVE`: EMI DPD Calculator detects `dpd > 0` and device is within configured grace window

**Triggered out of GRACE_PERIOD:**
- Payment validated before grace window closes → `ACTIVE`
- Grace window closes (EMI still unpaid) → `LOCKED`

**Device enforcement (`EMI_GRACE` policy):**
- `lockMode: false`
- No app restrictions (all apps accessible)
- Warning banner visible at all times (injected by Borrower App)
- Emergency calls: always accessible

**Borrower App UX:**
- Orange warning banner: *"EMI overdue — device will lock in X days"*
- Countdown timer to lock date visible
- Pay Now button prominently shown
- All other app functions work normally

**FCM sent:** `NOTIFICATION` type — `notificationType: GRACE_PERIOD_START`

---

### 2.3 LOCKED

> EMI unpaid past grace window. Device is in restriction mode. The borrower can only make emergency calls, pay, or request an unlock.

| Field | Value |
|---|---|
| `devices.state` | `LOCKED` |
| `devices.policyKey` | `EMI_LOCKED` |

**Triggered into LOCKED from:**
- `GRACE_PERIOD`: Grace period expires, EMI still unpaid
- `TEMP_UNLOCK`: Temp unlock expiry timer fires (Temp Unlock Expiry scheduler)
- `UNLOCK_PENDING`: Payment validation fails or command delivery fails all retries

**Triggered out of LOCKED:**
- Payment validated → `UNLOCK_PENDING` → `ACTIVE`
- Tenant/admin grants temp unlock → `TEMP_UNLOCK`
- Tenant/admin grants full unlock manually → `UNLOCK_PENDING` → `ACTIVE`
- Super Admin override (with reason) → `ACTIVE` (skips UNLOCK_PENDING)

**Device enforcement (`EMI_LOCKED` policy):**
- `lockMode: true`
- Allowed apps only: Emergency dialler (112), Borrower App (Pay Now, Request Unlock screen)
- Factory reset: disabled
- Status bar: disabled
- ADB: disabled (per tenant config)
- All other apps blocked

**Borrower App UX:**
- Full-screen lock screen displayed
- Available actions: *Pay Now*, *Request Unlock*, *Call Emergency (112)*
- Escalation status shown if case is open

**FCM sent:** `NOTIFICATION` type — `notificationType: DEVICE_LOCKED`

---

### 2.4 TEMP_UNLOCK

> Tenant admin has granted a temporary unlock (e.g. while the borrower arranges payment). Full access restored until the timer expires.

| Field | Value |
|---|---|
| `devices.state` | `TEMP_UNLOCK` |
| `devices.policyKey` | `TEMP_UNLOCKED` |
| `devices.tempUnlockExpiresAt` | Expiry timestamp set at grant time |

**Triggered into TEMP_UNLOCK from:**
- `LOCKED`: Tenant admin approves temp unlock from Partner App
- `LOCKED` (case path): Case escalated to Super Admin and resolved as temp unlock

**Triggered out of TEMP_UNLOCK:**
- `tempUnlockExpiresAt` passes (Temp Unlock Expiry scheduler fires every 1 min) → `LOCKED`
- Payment validated during the window → `ACTIVE` (full unlock, timer cancelled)

**Device enforcement (`TEMP_UNLOCKED` policy):**
- `lockMode: false`
- All apps accessible
- Factory reset: follows tenant config (typically disabled)
- Warning banner shown with countdown

**Borrower App UX:**
- Orange countdown banner: *"Temporary unlock — X hours remaining"*
- All app functions work normally
- Pay Now button pinned (user encouraged to pay before expiry)

**FCM sent:** `NOTIFICATION` type — `notificationType: TEMP_UNLOCK_APPROVED`

---

### 2.5 UNLOCK_PENDING

> Payment has been validated and the unlock command has been created — the device has not yet acknowledged it. This is a transient state.

| Field | Value |
|---|---|
| `devices.state` | `UNLOCK_PENDING` |
| `devices.policyKey` | *(unchanged — still `EMI_LOCKED`)* |

**Triggered into UNLOCK_PENDING from:**
- `LOCKED`: Tenant admin approves payment via `POST /partner/payments/:paymentId/approve` → EMI matched → unlock command created and FCM `POLICY_UPDATE` sent

**Triggered out of UNLOCK_PENDING:**
- Device receives FCM, fetches policy, calls ack → `ACTIVE`
- All FCM retries exhausted (maxRetries reached) → reverted to `LOCKED`
- Device reconnects offline → applies command from sync → `ACTIVE`

**Device enforcement:**
- Same as LOCKED (policy not changed yet — the device enforces the last fetched policy)
- Once the app receives the `POLICY_UPDATE` FCM and acks, it fetches `EMI_PAID` and goes ACTIVE

**Borrower App UX:**
- Full-screen lock screen remains
- "Unlock processing…" spinner shown (app transitions this when it receives the FCM wake-up)
- Usually completes within seconds if device is online

---

### 2.6 OFFLINE_PENDING

> A command (lock or unlock) was issued while the device was offline or unreachable. The command is queued in `deviceCommands`. The device will apply it when it reconnects.

| Field | Value |
|---|---|
| `devices.state` | `OFFLINE_PENDING` |
| `devices.policyKey` | *(unchanged — last known policy)* |

**Triggered into OFFLINE_PENDING from:**
- Any state: Server issues a command but FCM delivery fails (device offline, stale token, etc.)

**Triggered out of OFFLINE_PENDING:**
- Device calls `POST /app/device/ping` → server sets `forceApplyPolicy: true` in response → device fetches policy and acks → state resolves to the target state (LOCKED or ACTIVE)
- Device calls `POST /app/device/sync` on reconnect → same resolution

**Device enforcement:**
- Last policy applied locally is enforced (device-side)
- Backend tracks command as `pending` in `deviceCommands`

**Borrower App UX:**
- "Syncing…" indicator shown
- If last applied policy was `EMI_LOCKED`: lock screen shown
- If last applied policy was `EMI_PAID`: full access continues until sync completes

**Note:** `OFFLINE_PENDING` is a server-side tracking state. The device itself doesn't know it's in this state — it enforces whatever its last locally-applied policy was.

---

### 2.7 CONSENT_INVALID

> No valid `consentRecord` exists for this device. Lock commands are **blocked** — the system cannot legally enforce restrictions without user consent. Compliance team is alerted.

| Field | Value |
|---|---|
| `devices.state` | `CONSENT_INVALID` |
| `devices.policyKey` | `CONSENT_INVALID` |

**Triggered into CONSENT_INVALID from:**
- Any state: Server attempts to issue a LOCK command but finds no valid `consentRecord` for the device

**Triggered out of CONSENT_INVALID:**
- Compliance team resolves the consent issue (manually, with legal documentation)
- Super Admin resets device state via admin override → `ACTIVE` or re-triggers consent flow

**Device enforcement (`CONSENT_INVALID` policy):**
- `lockMode: false` — lock is **not** applied (legal block)
- Warning shown to user: contact support
- All apps accessible (device cannot be legally restricted without consent)

**Borrower App UX:**
- Error banner: *"Account issue — please contact support"*
- Pay Now and Request Unlock hidden (not relevant without lock)
- Normal app access continues

**FCM sent:** `SECURITY_ALERT` type — `alertCode: CONSENT_MISSING` → sent to tenant admin via `NOTIFICATION`

---

## 3. State Transition Table

| From | To | Trigger | Actor |
|---|---|---|---|
| *(registration complete)* | `ACTIVE` | Device registered + consent complete | System |
| `ACTIVE` | `GRACE_PERIOD` | EMI DPD Calculator detects overdue EMI | Scheduler (daily midnight) |
| `GRACE_PERIOD` | `ACTIVE` | Tenant approves payment before grace closes | System (tenant approval) |
| `GRACE_PERIOD` | `LOCKED` | Grace window closes, EMI unpaid | Scheduler (daily midnight) |
| `LOCKED` | `UNLOCK_PENDING` | Tenant approves payment, instant unlock policy | System (tenant approval via Partner App) |
| `LOCKED` | `TEMP_UNLOCK` | Tenant admin grants temp unlock | Manual (Partner App) |
| `LOCKED` | `ACTIVE` | Super Admin override (with reason) | Manual (Admin Panel) |
| `UNLOCK_PENDING` | `ACTIVE` | App acks POLICY_UPDATE FCM | System (app ack) |
| `UNLOCK_PENDING` | `LOCKED` | All retries exhausted | Scheduler (Command Retry) |
| `TEMP_UNLOCK` | `LOCKED` | `tempUnlockExpiresAt` passed | Scheduler (every 1 min) |
| `TEMP_UNLOCK` | `ACTIVE` | Tenant approves payment during unlock window | System (tenant approval via Partner App) |
| *(any)* | `OFFLINE_PENDING` | Command issued, device unreachable | System (FCM delivery failure) |
| `OFFLINE_PENDING` | *(target)* | Device reconnects, calls ping or sync | System (device sync) |
| *(any)* | `CONSENT_INVALID` | LOCK command blocked — no consentRecord | System (consent gate) |
| `CONSENT_INVALID` | `ACTIVE` | Compliance resolved, admin override | Manual (Admin Panel) |

---

## 4. Scheduler-Triggered Transitions

### 4.1 EMI DPD Calculator — Daily at Midnight

**What it does:**
1. Queries all `emiSchedules` where `status: overdue` or `dpd > 0`
2. For each overdue device:
   - Recalculates `dpd` (days past due)
   - If `devices.state === 'ACTIVE'` and `dpd > 0` → transition to `GRACE_PERIOD`
   - If `devices.state === 'GRACE_PERIOD'` and grace window has closed → transition to `LOCKED`
3. For each newly LOCKED device:
   - Updates `devices.state`, `devices.policyKey`, increments `devices.policyVersion`
   - Creates `deviceCommands` record (`commandType: LOCK`, `triggeredBy: auto_policy`)
   - Sends FCM `POLICY_UPDATE` to `devices.fcmToken`
   - Creates `notifications` record (`type: DEVICE_LOCKED`)
   - Writes `auditLogs` entry

**Grace window:**
- Configured in `tenantPolicies.gracePeriodDays`
- Default: 3 days after EMI due date
- Configurable per tenant from Partner App

### 4.2 Temp Unlock Expiry — Every 1 Minute

**What it does:**
1. Queries all `devices` where `state === 'TEMP_UNLOCK'` and `tempUnlockExpiresAt < now`
2. For each expired device:
   - Updates `devices.state` → `LOCKED`, `devices.policyKey` → `EMI_LOCKED`, increments `policyVersion`
   - Creates `deviceCommands` record (`commandType: LOCK`, `triggeredBy: temp_unlock_expiry`)
   - Sends FCM `POLICY_UPDATE`
   - Creates `notifications` record (`type: TEMP_UNLOCK_EXPIRING` → sent 5 min before expiry; and `DEVICE_LOCKED` → sent on actual expiry)
   - Writes `auditLogs` entry

### 4.3 Command Retry — Every 10 Minutes

**What it does:**
1. Queries `deviceCommands` where `status: 'pending'` and `nextRetryAt < now` and `retryCount < maxRetries`
2. Re-sends FCM to `devices.fcmToken`
3. Increments `retryCount`, updates `nextRetryAt` (exponential backoff)
4. If `retryCount >= maxRetries` → marks `status: 'failed'`; for LOCK commands, device state stays `OFFLINE_PENDING`

---

## 5. Manual Transitions

### 5.1 Temp Unlock (Partner App — Tenant Admin)

**Route:** `POST /partner/devices/:deviceId/temp-unlock`

**Trigger flow:**
1. Tenant admin opens unlock request in Partner App
2. Tenant admin sets unlock duration (hours) — within tenant-configured max
3. Backend validates request:
   - Device is currently `LOCKED`
   - Duration ≤ `tenantPolicies.maxTempUnlockHours`
   - Valid `consentRecord` exists
4. Updates `devices.state` → `TEMP_UNLOCK`, `devices.policyKey` → `TEMP_UNLOCKED`
5. Sets `devices.tempUnlockExpiresAt`
6. Creates `deviceCommands` record (`commandType: TEMP_UNLOCK`, `triggeredBy: manual_tenant`)
7. Sends FCM `POLICY_UPDATE` to device
8. Sends FCM `NOTIFICATION` (`notificationType: TEMP_UNLOCK_APPROVED`) to borrower

### 5.2 Full Manual Unlock (Partner App — Tenant Admin)

**Route:** `POST /partner/devices/:deviceId/unlock`

**Trigger flow:**
1. Tenant admin provides reason
2. Backend validates:
   - Device is `LOCKED`
   - Requesting account has `tenant_admin` role
   - Valid `consentRecord` exists
3. Updates `devices.state` → `UNLOCK_PENDING`, `devices.policyKey` → `EMI_PAID`
4. Creates `deviceCommands` record (`commandType: UNLOCK`, `triggeredBy: manual_tenant`)
5. Sends FCM `POLICY_UPDATE` to device
6. On ack → state becomes `ACTIVE`

### 5.3 Super Admin Override

**Route:** `POST /admin/devices/:deviceId/override`

**Trigger flow:**
1. Super Admin provides reason (mandatory, logged in audit trail)
2. Backend bypasses all policy checks (Super Admin can override any state)
3. Directly transitions device to `ACTIVE`
4. Creates `deviceCommands` record (`commandType: UNLOCK`, `triggeredBy: super_admin`)
5. Sends FCM `POLICY_UPDATE` to device
6. Writes `auditLogs` with override reason and Super Admin account ID

---

## 6. Policy Enforcement Matrix

Each `policyKey` maps to a `devicePolicies` document in MongoDB, scoped per tenant. These records are copied from centralized platform defaults when a tenant is created. Below are the **default values**.

| `policyKey` | `lockMode` | `allowedApps` | `disableFactoryReset` | `disableStatusBar` | `disableAdb` |
|---|---|---|---|---|---|
| `EMI_PAID` | `false` | *(all apps)* | `true` | `false` | `false` |
| `EMI_GRACE` | `false` | *(all apps)* | `true` | `false` | `false` |
| `EMI_LOCKED` | `true` | Emergency dialler, Borrower App | `true` | `true` | `true` |
| `TEMP_UNLOCKED` | `false` | *(all apps)* | `true` | `false` | `false` |
| `CONSENT_INVALID` | `false` | *(all apps)* | `true` | `false` | `false` |

> Emergency calls to **112** are always accessible regardless of `lockMode`. This is enforced at the Borrower App level and Android DPC level.

---

## 7. FCM Messages Per Transition

Each state transition sends one or more FCM messages to the target device. The backend uses the Firebase Admin SDK with the device's `devices.fcmToken`.

| Transition | FCM `type` | `notificationType` / `commandType` | User-visible? |
|---|---|---|---|
| ACTIVE → GRACE_PERIOD | `POLICY_UPDATE` | commandType: `LOCK` (partial) | No (silent) |
| ACTIVE → GRACE_PERIOD | `NOTIFICATION` | `GRACE_PERIOD_START` | Yes — warning banner |
| GRACE_PERIOD → LOCKED | `POLICY_UPDATE` | commandType: `LOCK` | No (silent) |
| GRACE_PERIOD → LOCKED | `NOTIFICATION` | `DEVICE_LOCKED` | Yes — lock screen |
| LOCKED → TEMP_UNLOCK | `POLICY_UPDATE` | commandType: `TEMP_UNLOCK` | No (silent) |
| LOCKED → TEMP_UNLOCK | `NOTIFICATION` | `TEMP_UNLOCK_APPROVED` | Yes — unlock confirmation |
| LOCKED → UNLOCK_PENDING | `POLICY_UPDATE` | commandType: `UNLOCK` | No (silent) |
| UNLOCK_PENDING → ACTIVE | `NOTIFICATION` | `UNLOCK_SUCCESS` | Yes — success screen |
| TEMP_UNLOCK → LOCKED (5 min before) | `NOTIFICATION` | `TEMP_UNLOCK_EXPIRING` | Yes — expiry warning |
| TEMP_UNLOCK → LOCKED (on expiry) | `POLICY_UPDATE` | commandType: `LOCK` | No (silent) |
| TEMP_UNLOCK → LOCKED (on expiry) | `NOTIFICATION` | `DEVICE_LOCKED` | Yes — lock screen |
| *(any)* → CONSENT_INVALID | `SECURITY_ALERT` | alertCode: `CONSENT_MISSING` | Yes — error screen |
| Payment validated → ACTIVE | `NOTIFICATION` | `PAYMENT_CONFIRMED` | Yes — success toast |

---

*See `flows.md` — Flow 5 for the end-to-end FCM delivery pipeline including online and offline paths.*
*See `architecture.md` — Section 5.11 for the `deviceCommands` schema and Section 5.14 for the `notifications` schema.*
