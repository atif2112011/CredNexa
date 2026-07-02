# Risk Auto-Lock App Developer Contract

This document is for the borrower Android app developer.

## Purpose

This change allows the app to recognize when the current device lock was triggered by a backend risk auto-lock instead of a normal EMI/payment-related lock.

The app only needs this distinction for one behavior:

- hide the temp unlock section when the device is locked due to `risk_auto_lock`

The app may also use this information to show a stronger warning style on the lock screen.

## Why We Are Doing This

Today the app can see that a device is locked, but a normal `LOCKED` + `EMI_LOCKED` state does not tell the app why the lock happened.

That is a problem because risk-triggered locks should behave differently from normal EMI locks:

- temp unlock should not be offered for a risk auto-lock case
- the warning message should tell the borrower to contact admin
- the UI can use a different warning color/treatment for security-related lock cases

We are not introducing a separate backend device state for this. The device will still use the normal locked policy/state pipeline. We only need an additional flag so the app can adjust UI.

## Required App Change

When the app infers a risk auto-lock case from the sync/device command payload, it must:

- hide the temp unlock section
- show risk-specific lock-screen messaging
- optionally use a stronger warning color theme than the standard locked screen

When the flag is `false`, the app should show the normal locked-screen behavior.

## Sync API Response Path

The backend will not return a dedicated `risk_flag_auto` field.

The app must infer the risk auto-lock case from the `pendingCommands` array in the sync API response.

Primary path:

```text
data.pendingCommands[]
```

The app should look for a pending or sent `LOCK` command whose payload source is:

```text
data.pendingCommands[i].commandType = "LOCK"
data.pendingCommands[i].payload.source = "risk_auto_lock"
```

Example:

```json
{
  "success": true,
  "message": "Device sync completed",
  "data": {
    "serverTime": "2026-06-29T12:00:00.000Z",
    "scheduledLockAt": null,
    "deviceState": "LOCKED",
    "currentPolicyKey": "EMI_LOCKED",
    "desiredPolicyVersion": 7,
    "policy": {},
    "pendingCommands": [
      {
        "_id": "commandId",
        "commandType": "LOCK",
        "status": "pending",
        "payload": {
          "source": "risk_auto_lock",
          "riskFlagId": "riskFlagId",
          "riskType": "ROOT_DETECTED",
          "severity": "critical",
          "policyKey": "EMI_LOCKED",
          "policyVersion": 7
        }
      }
    ]
  }
}
```

Inference rule:

- if a `LOCK` command exists with `payload.source = "risk_auto_lock"`, treat the current lock as a risk auto-lock case and cache the local flag as `true`
- otherwise do not set the local risk auto-lock flag from sync alone

## Local Cache Behavior

The app should keep a local cached boolean for this flag.

Recommended cache key meaning:

```text
risk_flag_auto = true | false
```

Rules:

- if sync contains a `LOCK` command with `payload.source = "risk_auto_lock"`, set the cached flag to `true`
- if the app receives a `LOCK` command with `payload.source = "risk_auto_lock"` outside sync handling, it may immediately set the cached flag to `true`
- clear it when an `UNLOCK` command is successfully processed
- clear it when a `TEMP_UNLOCK` command is successfully processed
- do not try to infer risk auto-lock from `deviceState = LOCKED` alone

The cache is only for UI continuity. Backend sync remains the source of truth.

## Lock Screen UI Guidance

Because the app knows when the lock is due to a risk flag, it may modify the lock-screen look and copy for this case.

Recommended message:

```text
Risk Flag Detected! Contact Admin
```

The same risk-lock screen may also show:

- admin phone number
- admin email

Example display:

```text
Risk Flag Detected! Contact Admin
Phone: <admin phone>
Email: <admin email>
```

UI expectation:

- use a more urgent warning color/treatment than the normal EMI locked screen
- keep the screen clear and action-oriented
- do not show temp unlock controls when the cached `isRiskAutoLock` flag is `true`

## Summary of App Logic

Normal lock case:

- no pending `LOCK` command with `payload.source = "risk_auto_lock"` has been observed, and local cache is not set
- show normal lock screen
- temp unlock section can remain visible if other existing rules allow it

Risk auto-lock case:

- a `LOCK` command with `payload.source = "risk_auto_lock"` was observed and cached locally
- hide temp unlock section
- show `Risk Flag Detected! Contact Admin`
- show admin phone/email
- optionally use stronger warning colors

## Notes

- No separate device state is being introduced for this app change.
- The existing lock state remains `LOCKED`.
- This flag is only used to control lock-screen UI and temp unlock visibility.
- The backend does not expose a dedicated `risk_flag_auto` sync field for this version.
