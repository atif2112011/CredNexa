# Auto Risk Lock Mechanism

This document explains the complete `risk_auto_lock` mechanism in EMI Shield across backend behavior, command delivery, sync behavior, app inference, cached UI state, and unlock behavior.

It is intended as a forwardable technical handoff for backend, app, and product discussions.

## Purpose

The `risk_auto_lock` mechanism exists to automatically lock a borrower device when the backend receives a confirmed high-risk security event from the app and tenant policy allows security-triggered auto-lock.

Examples of risk events:

- root detected
- tamper detected
- device integrity compromised
- app integrity compromised

This mechanism is separate from normal EMI/payment locking in terms of business meaning, but it still uses the existing device lock state and lock policy pipeline.

## Why This Exists

Normal EMI locks and security-risk locks both result in the device being locked, but they are not the same from a product perspective.

A risk auto-lock is meant to represent:

- a possible compromised device
- a higher-severity security issue
- a case where tenant/partner temp unlock should not be shown
- a case where the borrower should be told to contact admin

We do not introduce a separate backend device state for this mechanism. Instead:

- the backend still uses `LOCKED`
- the backend still applies `EMI_LOCKED`
- the app distinguishes a risk lock by inspecting the `LOCK` command payload source

## Trigger Flow

The flow starts when the borrower app sends a security event to:

```http
POST /api/app/security/event
```

Reference:

- [risk_flag.md](D:/Practise%20Projects/EMI%20Shield/risk_flag.md)
- [backend/src/modules/app/app.controller.js](D:/Practise%20Projects/EMI%20Shield/backend/src/modules/app/app.controller.js)

Backend behavior:

1. Validates the incoming event.
2. Creates a `DeviceEvent` with `eventType: "security"`.
3. Creates a `RiskFlag`.
4. Checks whether this event qualifies for auto-lock.
5. If it qualifies, immediately updates the device record to locked state.
6. Queues a `LOCK` device command with `payload.source = "risk_auto_lock"`.

## Auto-Lock Conditions

Auto-lock only happens when all of these are true:

- event `severity` is `critical`
- event `type` is allowed in tenant policy `riskRules.autoLockTypes`
- tenant policy has not disabled `autoLockOnCriticalSecurityRisk`
- device is not already locked
- an active `EMI_LOCKED` policy exists

Default allowed auto-lock types:

```text
ROOT_DETECTED
TAMPER_DETECTED
DEVICE_INTEGRITY_COMPROMISED
APP_INTEGRITY_COMPROMISED
```

Reference:

- [backend/src/constants/defaultPolicies.js](D:/Practise%20Projects/EMI%20Shield/backend/src/constants/defaultPolicies.js)
- [backend/src/models/TenantPolicy.js](D:/Practise%20Projects/EMI%20Shield/backend/src/models/TenantPolicy.js)

## Backend Device State Change

When auto-lock succeeds, the backend changes the device state immediately before the handset acknowledges the command.

The device record is updated to:

- `state = LOCKED`
- `currentPolicyKey = EMI_LOCKED`
- `currentPolicyId = <EMI_LOCKED policy id>`
- `stateUpdatedAt = now`
- `desiredPolicyVersion = desiredPolicyVersion + 1`
- `tempUnlockExpiresAt` cleared

Important:

- the server already considers the device locked at this point
- this is not waiting for the device command ack to mark the device locked

## Queued Device Command

After the device record is updated, the backend creates a `LOCK` command.

Important payload fields:

```json
{
  "commandType": "LOCK",
  "payload": {
    "source": "risk_auto_lock",
    "policyKey": "EMI_LOCKED",
    "policyVersion": 7,
    "reason": "Critical security risk: ROOT_DETECTED",
    "riskFlagId": "riskFlagId",
    "riskType": "ROOT_DETECTED",
    "severity": "critical"
  }
}
```

This `payload.source = "risk_auto_lock"` marker is the key signal the app uses to distinguish a risk-triggered lock from a normal EMI lock.

## Device Sync Behavior

The backend does not return a dedicated field such as `data.risk_flag_auto`.

Instead, the app must infer the risk lock from the sync response’s pending commands array:

```text
data.pendingCommands[]
```

The app should inspect:

```text
data.pendingCommands[i].commandType === "LOCK"
data.pendingCommands[i].payload.source === "risk_auto_lock"
```

That is the correct current response path for this version.

Reference:

- [backend/src/modules/app/app.controller.js](D:/Practise%20Projects/EMI%20Shield/backend/src/modules/app/app.controller.js)

## App Inference Rule

The app should treat the device as a risk auto-lock case when it sees a command matching:

```text
commandType = "LOCK"
payload.source = "risk_auto_lock"
```

The app should not infer risk auto-lock from these values alone:

- `deviceState = LOCKED`
- `currentPolicyKey = EMI_LOCKED`

Those values only say that the device is locked, not why it was locked.

## App Cache Behavior

The app only needs a lightweight cached flag for this mechanism.

Recommended cached boolean:

```text
isRiskAutoLock = true | false
```

Set it to `true` when:

- sync contains a pending/sent `LOCK` command with `payload.source = "risk_auto_lock"`
- or the app receives/processes such a `LOCK` command directly before the next sync

Clear it when:

- an `UNLOCK` command is successfully processed
- a `TEMP_UNLOCK` command is successfully processed

This cache is only used for UI continuity. It is not an authorization system and not a backend source of truth.

## Lock Screen Behavior

When `isRiskAutoLock = true`, the app should:

- hide the temp unlock section
- show a risk-specific warning state
- optionally use a stronger warning color than the standard locked screen

Recommended message:

```text
Risk Flag Detected! Contact Admin
```

The screen may also show:

- admin phone number
- admin email

Example:

```text
Risk Flag Detected! Contact Admin
Phone: <admin phone>
Email: <admin email>
```

## Why Temp Unlock Is Hidden

The current intended product behavior is:

- if the device is locked because of `risk_auto_lock`, the borrower app should not show temp unlock controls
- the borrower should be directed to admin contact instead

This is a UI-level behavior controlled by the cached `isRiskAutoLock` flag.

## Device Command Acknowledgement Behavior

When the device acknowledges commands through:

```http
POST /api/app/device/command/ack
```

the backend updates the device state based on command type.

Relevant outcomes:

- `LOCK` acknowledged -> `device.state = LOCKED`
- `UNLOCK` acknowledged -> `device.state = ACTIVE`
- `TEMP_UNLOCK` acknowledged -> `device.state = TEMP_UNLOCK`

## Unlock Behavior After Risk Auto-Lock

A risk auto-lock does not clear itself automatically just because the risk flag exists, is reviewed, or is acknowledged.

The lock only changes when a later device command changes it.

Normal unlock path:

1. backend/admin flow queues an `UNLOCK` command
2. backend updates device state to `UNLOCK_PENDING`
3. device applies the unlock policy
4. device acknowledges the command
5. backend moves device state to `ACTIVE`
6. app clears cached `isRiskAutoLock`

Temp unlock path:

1. backend/admin flow queues a `TEMP_UNLOCK` command
2. backend updates device state to `TEMP_UNLOCK`
3. device applies temp unlock policy
4. device acknowledges the command
5. app clears cached `isRiskAutoLock`

For the current app requirement, both `UNLOCK` and `TEMP_UNLOCK` should clear the local cached risk flag.

## Important Product Constraint

For this version:

- do not add a separate backend sync field for `risk_flag_auto`
- do not add a separate device state such as `RISK_LOCKED`
- use the existing `LOCKED` state and `EMI_LOCKED` policy
- let the app infer the reason from the `LOCK` command payload and cache it locally

## End-to-End Summary

1. App detects a confirmed security anomaly.
2. App calls `POST /api/app/security/event`.
3. Backend creates `DeviceEvent` and `RiskFlag`.
4. If tenant risk rules allow it, backend auto-locks the device.
5. Backend sets device state to `LOCKED`.
6. Backend queues a `LOCK` command with `payload.source = "risk_auto_lock"`.
7. Sync returns `pendingCommands`.
8. App finds `commandType = "LOCK"` and `payload.source = "risk_auto_lock"`.
9. App sets local `isRiskAutoLock = true`.
10. App hides temp unlock and shows a stronger warning message.
11. Later `UNLOCK` or `TEMP_UNLOCK` clears the local cached risk-lock flag.

## Source References

- [risk_flag.md](D:/Practise%20Projects/EMI%20Shield/risk_flag.md)
- [Risk_Auto_Lock_App_Developer_Contract.md](D:/Practise%20Projects/EMI%20Shield/Risk_Auto_Lock_App_Developer_Contract.md)
- [backend/src/modules/app/app.controller.js](D:/Practise%20Projects/EMI%20Shield/backend/src/modules/app/app.controller.js)
- [backend/src/constants/defaultPolicies.js](D:/Practise%20Projects/EMI%20Shield/backend/src/constants/defaultPolicies.js)
- [backend/src/models/TenantPolicy.js](D:/Practise%20Projects/EMI%20Shield/backend/src/models/TenantPolicy.js)
