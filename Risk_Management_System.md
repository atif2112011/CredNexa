# EMI Shield Risk Management System

This document explains the new server-owned Risk Management System for EMI Shield after the Play Integrity MVP implementation.

It is intended for backend, admin portal, QA, deployment, and product discussions. The app-facing handoff remains in `Risk_Management_Service_App_Developer_Contract.md`.

## Summary

The Risk Management System moves enforcement-grade security decisions from app-reported events into backend-verified integrity checks.

The backend now:

- verifies Google Play Integrity tokens through `/api/app/integrity/verify`
- stores each verification attempt as an `IntegrityCheck`
- maps failed verdicts and local evidence into `RiskFlag` records
- deduplicates and escalates active risk flags
- can queue `LOCK` commands with `payload.source = "risk_auto_lock"`
- supports admin mitigation actions from the super-admin portal
- keeps destructive actions, such as wipe, admin-only

The borrower app still detects risk auto-lock from `pendingCommands`. There is no separate `risk_flag_auto` sync field in this MVP.

## MVP Scope

Included:

- server-verified Play Integrity risk creation
- `IntegrityCheck` history
- expanded `RiskFlag` lifecycle and evidence fields
- active risk filtering across admin workflows
- admin risk detail page
- acknowledge, recheck, clear, false-positive, app-update, and wipe actions
- unlock warning when active critical risk exists
- security command support through `DeviceCommand`
- app-developer contract for new command handling

Not included:

- automatic wipe
- new `RISK_LOCKED` device state
- borrower-visible remediation orchestration beyond queued commands
- tenant-facing policy UI for all risk rules
- historical migration for old risk rows unless added separately

## Important Runtime Mode

`DEVICE_INTEGRITY_MODE` controls whether the backend only observes failed integrity checks or actively enforces them.

### Observe Mode

```env
DEVICE_INTEGRITY_MODE=observe
```

Observe mode is the safe/default mode.

Behavior:

- failed Play Integrity results are stored
- `IntegrityCheck` records are created
- `RiskFlag` records can be created
- admin can review risks
- the app is allowed to continue
- Play Integrity auto-lock is not queued

Use this mode when validating false positives, app token behavior, package name setup, device verdicts, and admin visibility.

### Enforce Mode

```env
DEVICE_INTEGRITY_MODE=enforce
```

`enforcement` is also accepted by the backend.

Behavior:

- failed Play Integrity results are stored
- `RiskFlag` records are created or escalated
- `/api/app/integrity/verify` returns the real backend decision
- critical configured risks can queue a `LOCK` command
- auto-lock uses the existing device lock pipeline
- wipe is still admin-only

Use this mode only after observe-mode data looks clean enough.

## What "Flip To Enforce" Means

"Flip `DEVICE_INTEGRITY_MODE` from observe to enforce" means changing the backend environment variable so failed integrity checks can affect the borrower device instead of only being recorded.

In simple terms:

| Mode | Backend records risk | App allowed to continue | Can auto-lock |
| --- | --- | --- | --- |
| `observe` | Yes | Yes | No |
| `enforce` | Yes | Depends on decision | Yes, when tenant policy allows |

This is why the rollout question matters. Enforce mode can lock real borrower devices if a critical risk is verified and policy allows auto-lock.

## Recommended Rollout

Start with staging only.

Recommended sequence:

1. Keep production on `DEVICE_INTEGRITY_MODE=observe`.
2. Set staging to `DEVICE_INTEGRITY_MODE=enforce`.
3. Test clean devices, rooted/tampered devices, wrong package, stale token, request hash mismatch, and app update repair.
4. Confirm admin risk list/detail, recheck, clear, false-positive, unlock warning, and wipe queue behavior.
5. After staging is clean, move to limited production canary.

Limited production canary means:

- set production backend to `DEVICE_INTEGRITY_MODE=enforce`
- enable auto-lock only for one or a few selected tenants through tenant risk policy
- keep `riskRules.autoLockOnCriticalSecurityRisk` disabled for everyone else if needed
- monitor risk volume, false positives, lock volume, and admin actions
- keep wipe admin-only and do not enable destructive automation

Because `DEVICE_INTEGRITY_MODE` is an environment-level backend setting, tenant-level rollout should be controlled with tenant policy. The global env decides whether enforcement is possible; tenant policy decides whether a tenant can actually auto-lock on critical risk.

## Core Backend Flow

### 1. Challenge

```http
POST /api/app/integrity/challenge
```

The backend creates a challenge and returns:

- `challengeId`
- `requestHash`
- `expiresAt`

The app requests the Google Play Integrity token using the backend-provided `requestHash`.

### 2. Verify

```http
POST /api/app/integrity/verify
```

The backend:

1. loads the challenge
2. verifies the Play Integrity token
3. checks request hash
4. checks token timestamp
5. checks package name
6. checks app integrity verdict
7. checks device integrity verdict
8. combines optional local signals
9. stores `IntegrityCheck`
10. creates or updates `RiskFlag`
11. optionally queues auto-lock in enforce mode

### 3. Risk Creation

Risk creation is now server-owned.

The app may send local evidence, but the backend decides:

- risk type
- severity
- status
- remediation method
- whether auto-lock is allowed
- which admin actions are available

### 4. Auto-Lock

Auto-lock only happens when all of these are true:

- mode is `enforce` or `enforcement`
- risk severity is `critical`
- tenant policy allows `autoLockOnCriticalSecurityRisk`
- risk type is included in tenant `riskRules.autoLockTypes`
- the device is not already locked
- a usable `EMI_LOCKED` device policy exists

The queued lock command keeps the existing app contract:

```json
{
  "commandType": "LOCK",
  "payload": {
    "source": "risk_auto_lock",
    "riskFlagId": "riskFlagId",
    "riskType": "DEVICE_INTEGRITY_COMPROMISED",
    "severity": "critical"
  }
}
```

## Risk Data Model

### IntegrityCheck

Stores verification history:

- tenant
- user
- device
- challenge
- action
- mode
- decision
- reason code
- package name
- app integrity verdict
- device integrity verdict
- local signals
- risk flag ids
- raw provider metadata

Use this to debug why a risk was created.

### RiskFlag

Represents the admin-facing risk lifecycle.

Key fields:

- `type`
- `riskType`
- `riskBucket`
- `severity`
- `status`
- `message`
- `source`
- `evidence`
- `metadata`
- `integrityCheckId`
- `firstDetectedAt`
- `lastDetectedAt`
- acknowledgement fields
- clearance fields
- override fields

Active statuses include open, acknowledged, warning pending, remediation required, locked, compromised permanent, temp overridden, and wiped pending reprovision.

Inactive statuses include resolved, cleared, and false positive.

## Risk Type Mapping

| Signal | Risk Type | Default Severity | Notes |
| --- | --- | --- | --- |
| Request hash mismatch | `PLAY_INTEGRITY_REQUEST_HASH_MISMATCH` | high | Possible replay/tampering; starts as remediation required. |
| Package mismatch | `PLAY_INTEGRITY_PACKAGE_MISMATCH` | critical | Wrong package returned by Play Integrity. |
| Stale token or expired challenge | `PLAY_INTEGRITY_TOKEN_EXPIRED` | medium | Usually retry or clock/network issue. |
| Device integrity failed | `DEVICE_INTEGRITY_COMPROMISED` | critical | Root/tamper/untrusted environment path. |
| App not recognized | `APP_INTEGRITY_COMPROMISED` | critical | App signing/version issue or tamper. |
| Root/tamper local signal | `ROOT_DETECTED`, `TAMPER_DETECTED`, `APP_TAMPER_DETECTED` | critical | Evidence from app; backend decides final status. |
| Remediable local setting | `USB_DEBUGGING_ENABLED`, `DEVELOPER_OPTIONS_ENABLED`, `UNKNOWN_SOURCES_ENABLED` | medium | Warning pending until fixed and rechecked. |
| App security event | event `type` | provided/default severity | Compatibility path only. |

## Risk Handling Matrix

Risk flags are not handled only by `type`. The backend combines:

- `riskType`
- `riskBucket`
- `severity`
- `status`
- `remediationMethod`
- tenant `riskRules`
- current `DEVICE_INTEGRITY_MODE`

This lets the system treat a stale token differently from a rooted device, even though both are visible as risk flags in the admin panel.

| Risk Category | Example Risk Types | Default Handling | Auto-Lock Eligibility | Admin Action |
| --- | --- | --- | --- | --- |
| Device compromise | `DEVICE_INTEGRITY_COMPROMISED`, `ROOT_DETECTED`, `TAMPER_DETECTED`, `BOOTLOADER_UNLOCKED`, `CUSTOM_ROM_DETECTED` | Mark as critical, move device security state toward compromised/remediation, require physical recovery or reprovision review. | Yes, when mode is `enforce`, severity is critical, and tenant policy includes the risk type. | Recheck, acknowledge, clear false positive, unlock with warning, admin-only wipe if needed. |
| App compromise | `APP_INTEGRITY_COMPROMISED`, `APP_TAMPER_DETECTED`, `APP_SIGNATURE_MISMATCH`, `DEBUGGABLE_BUILD_DETECTED` | Require reinstall, app update, or trusted app repair. | Critical app compromise can auto-lock when included in tenant policy; high-only findings do not auto-lock by default. | Push app update, recheck, clear false positive, unlock with warning for active critical risk. |
| Protocol mismatch | `PLAY_INTEGRITY_REQUEST_HASH_MISMATCH`, `PLAY_INTEGRITY_PACKAGE_MISMATCH` | Treat as suspicious verification mismatch; usually require fresh challenge or reinstall review. | Only if the exact risk type is critical and included in tenant `autoLockTypes`. | Recheck first; investigate package/signing setup before broad enforcement. |
| Stale or temporary integrity | `PLAY_INTEGRITY_TOKEN_EXPIRED`, `PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE` | Warning/retry path; do not treat as confirmed compromise. | No by default. | Request recheck; monitor repeated failures. |
| Remediable settings | `USB_DEBUGGING_ENABLED`, `DEVELOPER_OPTIONS_ENABLED`, `UNKNOWN_SOURCES_ENABLED` | Warning pending; ask user/admin to fix setting. | No by default. | Show warning, request recheck after setting is fixed. |
| Compatibility app event | `ROOT_DETECTED`, `TAMPER_DETECTED`, `DEVICE_INTEGRITY_COMPROMISED`, or custom event type from `/security/event` | Kept for local app-reported evidence and backward compatibility. | Yes only if severity is critical and tenant policy allows the event type. | Same admin workflow, but server-verified Play Integrity is preferred for enforcement decisions. |

Important implementation detail: auto-lock checks the exact `riskType`/event type against tenant `riskRules.autoLockTypes`. If a critical risk type is not listed there, it will be recorded and shown to admin but will not auto-lock.

## Admin Workflows

### Risk List

The admin risk list shows active risks by default and links into detail pages.

Operators can filter by status, severity, tenant, device, type, and search text.

### Risk Detail

The risk detail page shows:

- risk summary
- affected tenant/device/user
- evidence and metadata
- recent integrity checks
- related device commands
- audit history
- available mitigation actions

### Acknowledge

Acknowledgement means an operator has seen the risk.

It does not clear the risk, remove active-risk warnings, or unlock the device.

### Request Recheck

Queues:

```text
RUN_INTEGRITY_CHECK
```

The app should run a fresh challenge/token/verify cycle.

### Push App Update

Queues:

```text
INSTALL_UPDATE
```

Used when the risk appears repairable by trusted app update metadata.

### Clear / False Positive

Requires a reason.

Clearing changes the risk to an inactive status and removes it from the device active-risk list. If there are no other active risks, the device security state returns to healthy.

### Auto-Resolve After Clean Recheck

Some risk flags do not need manual admin closure.

When a fresh integrity check is clean, the backend automatically resolves active risks that are safe to close from a clean recheck:

- `PLAY_INTEGRITY_TOKEN_EXPIRED`
- `PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE`
- `USB_DEBUGGING_ENABLED`
- `DEVELOPER_OPTIONS_ENABLED`
- `UNKNOWN_SOURCES_ENABLED`
- other low/medium `stale_integrity` or `remediable_setting` risks

Backend behavior:

- sets risk status to `resolved`
- sets `lastCleanCheckAt`
- sets `clearedAt`
- writes `clearanceReason = "Auto-resolved after clean integrity recheck"`
- stores `resolvedByIntegrityCheckId` in risk metadata
- stores resolved ids in `IntegrityCheck.resolvedRiskIds`
- removes resolved ids from `Device.currentRiskIds`
- writes `RISK_FLAG_AUTO_RESOLVED` audit logs
- sets device security state to `HEALTHY` only if no other active risk remains

Risks that stay admin-reviewed:

- critical device compromise
- root/tamper/custom ROM/bootloader risks
- permanent compromise statuses
- critical app compromise
- wipe/reprovision states
- high/critical suspicious protocol mismatch

For these, admin must use recheck, clear, false positive, app update, wipe, or reprovision workflow as appropriate.

### Wipe

Queues:

```text
WIPE_DEVICE
```

Rules:

- admin-only
- reason required
- critical permanent device-compromise risk only
- never auto-queued in MVP
- app must only execute when Device Owner capability exists

Eligible examples:

- `DEVICE_INTEGRITY_COMPROMISED`
- `ROOT_DETECTED`
- `TAMPER_DETECTED`
- `SYSTEM_TAMPER_DETECTED`
- `CUSTOM_ROM_DETECTED`
- `BOOTLOADER_UNLOCKED`

Not eligible examples:

- app package/signature repair risks
- Play Integrity request hash mismatch
- stale/expired token
- USB debugging
- developer options
- unknown sources

## Unlock Behavior

Admin unlock is allowed in the MVP, but the backend and admin portal surface active critical risk warnings.

The warning is attached to unlock-related command payloads and shown in the device override panel.

This keeps emergency operations possible while making the risk visible to the operator.

## App Contract

The app must continue reading `pendingCommands`.

Risk auto-lock is detected from:

```text
pendingCommands[i].commandType = "LOCK"
pendingCommands[i].payload.source = "risk_auto_lock"
```

The borrower copy remains:

```text
Risk Flag Detected! Contact Admin
```

New commands the app should safely handle:

- `RUN_INTEGRITY_CHECK`
- `SHOW_REMEDIATION`
- `INSTALL_UPDATE`
- `WIPE_DEVICE`
- `REPROVISION_REQUIRED`

## Policy Controls

Tenant policy controls the practical blast radius of enforcement.

Important fields:

```json
{
  "riskRules": {
    "autoLockOnCriticalSecurityRisk": true,
    "autoLockTypes": [
      "ROOT_DETECTED",
      "TAMPER_DETECTED",
      "SYSTEM_TAMPER_DETECTED",
      "CUSTOM_ROM_DETECTED",
      "BOOTLOADER_UNLOCKED",
      "DEVICE_INTEGRITY_COMPROMISED",
      "APP_INTEGRITY_COMPROMISED",
      "APP_TAMPER_DETECTED"
    ],
    "destructiveEnforcementEnabled": false,
    "wipeRequiresAdminAction": true
  }
}
```

MVP defaults:

- auto-lock can be enabled for critical configured risks
- default auto-lock is limited to confirmed device compromise and critical app compromise
- protocol mismatch, stale integrity, USB debugging, developer options, unknown sources, debug builds, and legacy `APP_SIGNATURE_MISMATCH` are not default auto-lock types
- destructive enforcement is disabled
- wipe requires admin action

## QA Checklist

Backend:

- clean integrity pass
- request hash mismatch
- package mismatch
- stale token
- failed device verdict
- failed app integrity verdict
- high-risk local signal
- repeated risk dedupe/escalation
- observe mode creates risk without auto-lock
- enforce mode can queue risk auto-lock

Admin portal:

- risk list active filter
- risk detail page
- acknowledge
- request recheck
- push app update
- clear
- false positive
- wipe queue
- unlock warning with active critical risk

App contract:

- pending command sync remains compatible
- old lock/unlock/temp-unlock still work
- new security commands are acknowledged safely
- risk auto-lock UI is inferred from command payload source

## Operational Recommendation

Use this order:

1. staging enforce
2. production observe
3. production limited tenant canary
4. broader tenant rollout

Do not start with broad production enforce. The first production enforce run should be limited by tenant policy so a bad package name, signing issue, or Play Integrity configuration mismatch does not lock too many real devices.
