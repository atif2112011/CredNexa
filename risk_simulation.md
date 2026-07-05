# Risk Simulation Checklist

This document simulates the risk scenarios that the backend and borrower app must handle correctly.

Purpose:

- verify what the backend receives
- verify what `IntegrityCheck`, `RiskFlag`, `DeviceCommand`, and audit data are created
- verify what the app receives from `/integrity/verify` and `/device/sync`
- verify what the app should do
- verify how the admin closes the risk

Use this as a QA checklist for staging before enabling `DEVICE_INTEGRITY_MODE=enforce` in production.

## Shared Test Setup

Backend environment:

```env
DEVICE_INTEGRITY_MODE=observe
```

Start in observe mode first. In observe mode the backend records risks but does not auto-lock.

Then repeat selected critical scenarios with:

```env
DEVICE_INTEGRITY_MODE=enforce
```

In enforce mode, critical eligible risks can queue `LOCK` with:

```json
{
  "source": "risk_auto_lock"
}
```

Required borrower app flow:

1. Call `POST /api/app/integrity/challenge`.
2. Use returned `requestHash` with Google Play Integrity SDK.
3. Call `POST /api/app/integrity/verify`.
4. Process verify response.
5. Continue normal `POST /api/app/device/sync`.
6. Process `pendingCommands`.

App must infer risk auto-lock only from:

```text
pendingCommands[i].commandType = "LOCK"
pendingCommands[i].payload.source = "risk_auto_lock"
```

There is no separate `risk_flag_auto` sync field.

## Common Backend Records

For every `/api/app/integrity/verify` call that reaches provider verification or local-signal evaluation, the backend should create an `IntegrityCheck`.

Exception: if the backend challenge itself is already expired before verification starts, the backend updates the challenge and returns retry without creating an `IntegrityCheck`.

Important fields to inspect:

- `deviceId`
- `userId`
- `tenantId`
- `challengeId`
- `checkType`
- `triggerReason`
- `packageName`
- `appIntegrityVerdict`
- `deviceRecognitionVerdict`
- `localSignals`
- `decision`
- `observedDecision`
- `integrityStatus`
- `reasonCode`
- `result`
- `createdRiskIds`
- `providerError`

For risk scenarios, the backend should also create or update an active `RiskFlag`.

Important fields to inspect:

- `type`
- `riskType`
- `severity`
- `status`
- `riskBucket`
- `remediationMethod`
- `source`
- `deviceId`
- `userId`
- `tenantId`
- `message`
- `evidence`
- `relatedIntegrityCheckId`
- `firstDetectedAt`
- `lastDetectedAt`
- `metadata`

If the same active risk repeats for the same device/user, backend should update the existing active risk flag rather than creating duplicate active rows.

## Verify Response Shape

Successful observe-mode verification with a detected risk can still return:

```json
{
  "decision": "allow",
  "integrityStatus": "observed_failure",
  "reasonCode": "DEVICE_INTEGRITY_FAILED",
  "observedDecision": "block",
  "integrityCheckId": "integrityCheckId",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": []
}
```

Enforce-mode critical failure can return a failed/block response and may include:

```json
{
  "decision": "block",
  "integrityStatus": "failed",
  "reasonCode": "DEVICE_INTEGRITY_FAILED",
  "integrityCheckId": "integrityCheckId",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": [
    {
      "riskFlagId": "riskFlagId",
      "queued": true,
      "commandId": "commandId",
      "deviceState": "LOCKED",
      "policyKey": "EMI_LOCKED"
    }
  ]
}
```

## Scenario 1: Clean Integrity Pass

### Backend Receives

`/integrity/verify` receives a valid token where:

- request hash matches challenge
- token timestamp is valid
- package name matches trusted package
- app integrity is trusted
- device integrity includes required verdict
- no high-risk local signals

Example app body:

```json
{
  "challengeId": "challengeId",
  "integrityToken": "validPlayIntegrityToken",
  "action": "APP_STARTUP",
  "localSignals": {
    "usbDebuggingEnabled": false,
    "developerOptionsEnabled": false,
    "unknownSourcesEnabled": false,
    "isRooted": false,
    "isTampered": false,
    "rootIndicators": [],
    "hookingIndicators": []
  }
}
```

### Backend Creates

`IntegrityCheck`:

- `decision = allow`
- `integrityStatus = passed`
- `result = clean`
- `createdRiskIds = []`

No new `RiskFlag`.

No `DeviceCommand`.

If the device has no active risks, backend may set:

- `device.lastCleanIntegrityAt`
- `device.integrityStaleAfter`
- `device.deviceSecurityState = HEALTHY`

### App Receives

```json
{
  "decision": "allow",
  "integrityStatus": "passed",
  "riskFlagIds": [],
  "autoLocks": []
}
```

### App Does

- continue normal flow
- do not show risk UI
- do not cache risk-lock state

### Closure

No admin action needed.

## Scenario 2: Request Hash Mismatch

This means the Play Integrity token request hash does not match the backend challenge.

### Backend Receives

Valid-looking token, but:

```text
summary.requestHash != challenge.requestHash
```

### Backend Creates

`IntegrityCheck`:

- `reasonCode = REQUEST_HASH_MISMATCH`
- `result = risk_found`

`RiskFlag`:

- `riskType = PLAY_INTEGRITY_REQUEST_HASH_MISMATCH`
- `severity = high`
- `riskBucket = protocol_mismatch`
- `status = remediation_required`
- `remediationMethod = retry_fresh_challenge`
- `source = server_verified_play_integrity`

### App Receives

Observe mode:

```json
{
  "decision": "allow",
  "integrityStatus": "observed_failure",
  "reasonCode": "REQUEST_HASH_MISMATCH",
  "observedDecision": "block",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": []
}
```

Enforce mode:

```json
{
  "decision": "block",
  "integrityStatus": "failed",
  "reasonCode": "REQUEST_HASH_MISMATCH",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": [
    {
      "queued": false,
      "reason": "RISK_RULE_NOT_MATCHED"
    }
  ]
}
```

### App Does

- in observe mode: continue but log telemetry
- in enforce mode: stop sensitive flow and ask user to retry
- request a fresh challenge before retrying

### Closure

Admin should:

1. use `Recheck`
2. verify app is using the latest backend `requestHash`
3. clear as `cleared` if the retry passes
4. mark `false_positive` if caused by staging/config/test setup

Wipe is not allowed.

## Scenario 3: Package Name Mismatch

This means Google returns a package name different from the backend trusted package.

### Backend Receives

Token summary where:

```text
summary.packageName != PLAY_INTEGRITY_PACKAGE_NAME
```

### Backend Creates

`IntegrityCheck`:

- `reasonCode = PACKAGE_NAME_MISMATCH`
- `result = risk_found`

`RiskFlag`:

- `riskType = PLAY_INTEGRITY_PACKAGE_MISMATCH`
- `severity = critical`
- `riskBucket = protocol_mismatch`
- `status = remediation_required`
- `remediationMethod = reinstall`
- `source = server_verified_play_integrity`

### App Receives

Observe mode allows but records:

```json
{
  "decision": "allow",
  "integrityStatus": "observed_failure",
  "reasonCode": "PACKAGE_NAME_MISMATCH",
  "observedDecision": "block",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": []
}
```

Enforce mode blocks:

```json
{
  "decision": "block",
  "integrityStatus": "failed",
  "reasonCode": "PACKAGE_NAME_MISMATCH",
  "riskFlagIds": ["riskFlagId"]
}
```

Auto-lock should normally not queue unless this exact type is added to tenant `riskRules.autoLockTypes`.

### App Does

- stop sensitive flow in enforce mode
- show support/update/reinstall path
- do not execute wipe

### Closure

Admin should:

1. check if this is wrong environment/package config
2. use `App Update` if a trusted build should repair it
3. use `Recheck`
4. clear or mark false positive after successful recheck

Wipe is not allowed.

## Scenario 4: Token Timestamp Invalid Or Challenge Expired

This is usually a retry problem, not confirmed compromise.

### Backend Receives

Either:

- token timestamp is too old/future
- challenge has expired before verify

### Backend Creates

If the Play Integrity token timestamp is invalid after provider verification, backend creates `IntegrityCheck`:

- `reasonCode = TOKEN_TIMESTAMP_INVALID`
- `result = stale`

`RiskFlag`:

- `riskType = PLAY_INTEGRITY_TOKEN_EXPIRED`
- `severity = medium`
- `riskBucket = stale_integrity`
- `status = warning_pending`
- `remediationMethod = retry_fresh_challenge`
- `source = server_verified_play_integrity`

If the backend challenge is already expired before provider verification, backend does not create `IntegrityCheck` or `RiskFlag`; it updates the challenge status and returns retry.

### App Receives

Expired challenge returns retry:

```json
{
  "decision": "retry",
  "integrityStatus": "temporary_failure",
  "reasonCode": "CHALLENGE_EXPIRED",
  "retryAfterSeconds": 0
}
```

Invalid token timestamp in observe mode can be recorded but allowed:

```json
{
  "decision": "allow",
  "integrityStatus": "observed_failure",
  "reasonCode": "TOKEN_TIMESTAMP_INVALID",
  "observedDecision": "retry"
}
```

### App Does

- request a new challenge
- retry Play Integrity
- do not show compromised-device UI
- do not cache risk-lock state

### Closure

Admin should:

1. use `Recheck`
2. monitor repeated failures
3. confirm the clean recheck auto-resolves the active stale-token risk

Wipe and auto-lock are not expected.

## Scenario 5: Play Integrity Provider Unavailable

This is when backend cannot verify token with Google due to provider/network/API error.

### Backend Receives

`decodePlayIntegrityToken()` throws a provider error.

### Backend Creates

`IntegrityCheck`:

- `reasonCode = PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE`
- `result = error`
- `providerError` populated

`RiskFlag`:

- `riskType = PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE`
- `severity = medium`
- `riskBucket = stale_integrity`
- `status = warning_pending`
- `remediationMethod = retry_fresh_challenge`
- `source = server_verified_play_integrity`

### App Receives

Observe mode:

```json
{
  "decision": "allow",
  "integrityStatus": "observed_failure",
  "reasonCode": "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE"
}
```

Enforce mode:

```json
{
  "decision": "retry",
  "integrityStatus": "temporary_failure",
  "reasonCode": "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE",
  "retryAfterSeconds": 30
}
```

### App Does

- retry after delay
- show temporary security verification failure if needed
- do not show compromised-device UI
- do not cache risk-lock state

### Closure

Admin should:

1. use `Recheck`
2. inspect provider error
3. confirm the clean recheck auto-resolves the active provider-unavailable risk

No wipe. No auto-lock by default.

## Scenario 6: App Integrity Unrecognized

This means Google app verdict does not match trusted Play-recognized app expectations.

### Backend Receives

`summary.appIntegrity` is not trusted when app recognition is required.

### Backend Creates

`IntegrityCheck`:

- `reasonCode = APP_INTEGRITY_UNRECOGNIZED`
- `result = risk_found`

`RiskFlag`:

- `riskType = APP_INTEGRITY_COMPROMISED`
- `severity = critical`
- `riskBucket = app_compromise`
- `status = remediation_required`
- `remediationMethod = reinstall`
- `source = server_verified_play_integrity`
- `evidence.appIntegrity` populated

### App Receives

Observe mode:

```json
{
  "decision": "allow",
  "integrityStatus": "observed_failure",
  "reasonCode": "APP_INTEGRITY_UNRECOGNIZED",
  "observedDecision": "manual_review",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": []
}
```

Enforce mode:

```json
{
  "decision": "manual_review",
  "integrityStatus": "failed",
  "reasonCode": "APP_INTEGRITY_UNRECOGNIZED",
  "riskFlagIds": ["riskFlagId"]
}
```

Auto-lock can happen only if tenant policy includes `APP_INTEGRITY_COMPROMISED`.

### App Does

- stop sensitive flow in enforce mode
- show update/reinstall/support path
- process `INSTALL_UPDATE` if admin queues it

### Closure

Admin should:

1. use `App Update` if trusted repair build exists
2. use `Recheck`
3. clear after clean pass
4. mark false positive for staging/signing config mistake

Wipe is not allowed.

## Scenario 7: Device Integrity Failed

This is the strongest server-verified device compromise scenario.

### Backend Receives

Play Integrity device verdict does not include required verdict:

```text
MEETS_DEVICE_INTEGRITY
```

or whatever `PLAY_INTEGRITY_REQUIRED_DEVICE_VERDICT` is configured to require.

### Backend Creates

`IntegrityCheck`:

- `reasonCode = DEVICE_INTEGRITY_FAILED`
- `result = risk_found`

`RiskFlag`:

- `riskType = DEVICE_INTEGRITY_COMPROMISED`
- `severity = critical`
- `riskBucket = device_compromise`
- `status = compromised_permanent`
- `remediationMethod = physical_recovery`
- `source = server_verified_play_integrity`
- `evidence.deviceIntegrity` populated

Device:

- `lastRiskAt` updated
- `deviceSecurityState` moves toward `COMPROMISED_PERMANENT` or `REMEDIATION`
- `currentRiskIds` updated

### App Receives

Observe mode:

```json
{
  "decision": "allow",
  "integrityStatus": "observed_failure",
  "reasonCode": "DEVICE_INTEGRITY_FAILED",
  "observedDecision": "block",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": []
}
```

Enforce mode:

```json
{
  "decision": "block",
  "integrityStatus": "failed",
  "reasonCode": "DEVICE_INTEGRITY_FAILED",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": [
    {
      "queued": true,
      "commandId": "commandId",
      "deviceState": "LOCKED",
      "policyKey": "EMI_LOCKED"
    }
  ]
}
```

Auto-lock queues only when tenant policy allows `DEVICE_INTEGRITY_COMPROMISED`.

### App Does

If `/device/sync` contains:

```json
{
  "commandType": "LOCK",
  "payload": {
    "source": "risk_auto_lock",
    "riskType": "DEVICE_INTEGRITY_COMPROMISED"
  }
}
```

then app must:

- apply lock policy
- cache risk-lock UI flag
- show `Risk Flag Detected! Contact Admin`
- hide borrower temp-unlock controls while risk-lock flag is active
- acknowledge command after processing

### Closure

Admin options:

- `Acknowledge`: records that admin saw it
- `Recheck`: queues fresh integrity check
- `Clear`: only after verified recovery
- `False Positive`: only for proven test/config issue
- `Wipe`: allowed because this is critical device compromise
- admin unlock is allowed but must show warning and does not clear the risk

## Scenario 8: Root Detected From Local Signals

### Backend Receives

`/integrity/verify` body includes:

```json
{
  "localSignals": {
    "isRooted": true,
    "rootIndicators": ["/system/xbin/su", "magisk"]
  }
}
```

### Backend Creates

`IntegrityCheck`:

- `result = risk_found`
- local signals stored

`RiskFlag`:

- `riskType = ROOT_DETECTED`
- `severity = critical`
- `riskBucket = device_compromise`
- `status = compromised_permanent`
- `remediationMethod = physical_recovery`
- `source = server_evaluated_local_signal`
- `evidence.rootIndicators` populated

Device:

- `isRooted = true`
- `deviceSecurityState` moves toward compromised/remediation

### App Receives

If Play Integrity result itself was otherwise clean, current final decision may be:

```json
{
  "decision": "block",
  "integrityStatus": "failed",
  "reasonCode": "HIGH_RISK_LOCAL_SIGNAL",
  "riskFlagIds": ["riskFlagId"]
}
```

Observe mode can convert this to allow with observed failure.

In enforce mode, auto-lock can queue if tenant policy includes `ROOT_DETECTED`.

### App Does

- in enforce mode: stop sensitive flow
- if sync has risk auto-lock command: apply lock and show risk contact-admin screen
- do not offer borrower temp unlock during cached risk lock

### Closure

Admin:

- `Recheck` after device recovery
- `Clear` after clean result
- `False Positive` for test device or bad detector
- `Wipe` allowed

## Scenario 9: Tamper Detected From Local Signals

### Backend Receives

```json
{
  "localSignals": {
    "isTampered": true
  }
}
```

### Backend Creates

`RiskFlag`:

- `riskType = TAMPER_DETECTED`
- `severity = critical`
- `riskBucket = device_compromise`
- `status = compromised_permanent`
- `remediationMethod = physical_recovery`
- `source = server_evaluated_local_signal`

Device:

- `isTampered = true`

### App Receives

Same handling as root:

- observe mode: allow with observed failure
- enforce mode: block and possibly auto-lock if tenant policy includes `TAMPER_DETECTED`

### App Does

- stop sensitive flow in enforce mode
- process risk auto-lock from `pendingCommands`

### Closure

Same as root:

- recheck
- clear after verified recovery
- false positive if detector/config issue
- wipe allowed

## Scenario 10: App Hooking Or Runtime App Tamper

### Backend Receives

```json
{
  "localSignals": {
    "hookingIndicators": ["frida", "xposed"]
  }
}
```

### Backend Creates

`RiskFlag`:

- `riskType = APP_TAMPER_DETECTED`
- `severity = critical`
- `riskBucket = app_compromise`
- `status = remediation_required`
- `remediationMethod = reinstall`
- `source = server_evaluated_local_signal`
- `evidence.hookingIndicators` populated

### App Receives

In enforce mode:

- `decision = block`
- `reasonCode = HIGH_RISK_LOCAL_SIGNAL`
- `riskFlagIds` includes app tamper risk

Auto-lock only if tenant policy includes `APP_TAMPER_DETECTED`.

### App Does

- stop sensitive flow
- show support/reinstall/update path
- process `INSTALL_UPDATE` if admin queues it

### Closure

Admin:

- `App Update` or reinstall instruction
- `Recheck`
- `Clear` after clean result
- `False Positive` for detector issue

Wipe is not allowed because this is app compromise, not permanent device compromise.

## Scenario 11: Debuggable Build Detected

### Backend Receives

```json
{
  "localSignals": {
    "debuggable": true
  }
}
```

### Backend Creates

`RiskFlag`:

- `riskType = DEBUGGABLE_BUILD_DETECTED`
- `severity = high`
- `riskBucket = app_compromise`
- `status = remediation_required`
- `remediationMethod = app_update`
- `source = server_evaluated_local_signal`

### App Receives

Usually no auto-lock:

```json
{
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": [
    {
      "queued": false,
      "reason": "RISK_RULE_NOT_MATCHED"
    }
  ]
}
```

### App Does

- continue in observe mode
- in enforce mode, stop sensitive flow if backend returns block
- wait for `INSTALL_UPDATE` if admin queues it

### Closure

Admin:

- `App Update`
- `Recheck`
- `Clear` after release build is verified
- `False Positive` for staging/test builds

No wipe.

## Scenario 12: USB Debugging Enabled

### Backend Receives

```json
{
  "localSignals": {
    "usbDebuggingEnabled": true
  }
}
```

or:

```json
{
  "localSignals": {
    "adbEnabled": true
  }
}
```

### Backend Creates

`RiskFlag`:

- `riskType = USB_DEBUGGING_ENABLED`
- `severity = medium`
- `riskBucket = remediable_setting`
- `status = warning_pending`
- `remediationMethod = user_fix`
- `source = server_evaluated_local_signal`

Device:

- `deviceSecurityState` moves to `WARNING` if more severe active risk is not already present

### App Receives

Usually:

```json
{
  "decision": "allow",
  "riskFlagIds": ["riskFlagId"],
  "autoLocks": []
}
```

### App Does

- show non-blocking warning or remediation screen if product wants it
- ask user/admin to disable USB debugging
- do not lock
- do not cache risk-lock state

### Closure

Admin:

1. ask user to disable USB debugging
2. press `Recheck`
3. confirm the clean recheck auto-resolves the warning risk

No wipe. No auto-lock.

## Scenario 13: Developer Options Enabled

### Backend Receives

```json
{
  "localSignals": {
    "developerOptionsEnabled": true
  }
}
```

### Backend Creates

`RiskFlag`:

- `riskType = DEVELOPER_OPTIONS_ENABLED`
- `severity = medium`
- `riskBucket = remediable_setting`
- `status = warning_pending`
- `remediationMethod = user_fix`
- `source = server_evaluated_local_signal`

### App Receives

Allow/warning style response. No auto-lock expected.

### App Does

- show remediation guidance if implemented
- do not lock

### Closure

Admin:

- user fixes setting
- `Recheck`
- clean recheck auto-resolves the warning risk

No wipe.

## Scenario 14: Unknown Sources Enabled

### Backend Receives

```json
{
  "localSignals": {
    "unknownSourcesEnabled": true
  }
}
```

or:

```json
{
  "localSignals": {
    "installFromUnknownSourcesEnabled": true
  }
}
```

### Backend Creates

`RiskFlag`:

- `riskType = UNKNOWN_SOURCES_ENABLED`
- `severity = medium`
- `riskBucket = remediable_setting`
- `status = warning_pending`
- `remediationMethod = user_fix`
- `source = server_evaluated_local_signal`

### App Receives

Allow/warning style response. No auto-lock expected.

### App Does

- show remediation guidance if implemented
- do not lock

### Closure

Admin:

- user disables unknown sources
- `Recheck`
- clean recheck auto-resolves the warning risk

No wipe.

## Scenario 15: Multiple Risks In One Verify

Example: Play Integrity device verdict fails and app also sends USB debugging enabled.

### Backend Receives

```json
{
  "challengeId": "challengeId",
  "integrityToken": "tokenWithFailedDeviceVerdict",
  "action": "APP_STARTUP",
  "localSignals": {
    "usbDebuggingEnabled": true
  }
}
```

### Backend Creates

`IntegrityCheck`:

- `result = risk_found`
- `createdRiskIds` contains multiple ids

`RiskFlag` records:

1. `DEVICE_INTEGRITY_COMPROMISED`
   - critical
   - device compromise
   - compromised permanent
2. `USB_DEBUGGING_ENABLED`
   - medium
   - remediable setting
   - warning pending

Device:

- security state follows the most severe active risk
- `currentRiskIds` includes the latest risk ids

### App Receives

```json
{
  "riskFlagIds": ["deviceRiskId", "usbRiskId"],
  "autoLocks": [
    {
      "riskFlagId": "deviceRiskId",
      "queued": true
    },
    {
      "riskFlagId": "usbRiskId",
      "queued": false,
      "reason": "RISK_RULE_NOT_MATCHED"
    }
  ]
}
```

### App Does

- if sync has risk auto-lock, apply lock and show risk contact-admin screen
- app should not try to interpret all risk ids itself
- app should process backend commands

### Closure

Admin should close each risk separately:

- device compromise: recheck, clear/false-positive, or wipe if needed
- USB debugging: user fix, recheck, auto-resolve after clean check

Unlocking does not close either risk.

## Scenario 16: Compatibility Security Event

This is the older app-reported event path. It still exists but should not be used for final Play Integrity decisions.

### Backend Receives

```http
POST /api/app/security/event
```

Example:

```json
{
  "type": "ROOT_DETECTED",
  "severity": "critical",
  "message": "Root indicators detected",
  "metadata": {
    "source": "APP_STARTUP",
    "rootIndicators": ["/system/xbin/su"]
  }
}
```

### Backend Creates

- `DeviceEvent`
- `RiskFlag`

`RiskFlag`:

- `type = ROOT_DETECTED`
- `riskType = ROOT_DETECTED`
- `severity = critical`
- `source = app_reported_security_event`
- `metadata` contains app event metadata

If tenant policy allows and criteria match, backend can queue risk auto-lock.

### App Receives

From the event endpoint:

```json
{
  "riskFlagId": "riskFlagId",
  "autoLock": {
    "queued": true,
    "commandId": "commandId"
  }
}
```

From `/device/sync`:

```json
{
  "pendingCommands": [
    {
      "commandType": "LOCK",
      "payload": {
        "source": "risk_auto_lock",
        "riskType": "ROOT_DETECTED"
      }
    }
  ]
}
```

### App Does

- process the `LOCK`
- cache risk-lock flag
- show `Risk Flag Detected! Contact Admin`

### Closure

Same as matching risk type. For `ROOT_DETECTED`, wipe is allowed only if critical and device-compromise/permanent criteria match.

## Scenario 17: Admin Recheck Command

This scenario starts from admin console, not Play Integrity failure.

### Backend Receives

```http
POST /api/admin/risk-flags/:flagId/recheck
```

Body:

```json
{
  "reason": "User says the issue is fixed"
}
```

### Backend Creates

`DeviceCommand`:

- `commandType = RUN_INTEGRITY_CHECK`
- `triggeredBy = risk_management`
- `payload.source = risk_admin_recheck`
- `payload.riskFlagId = flagId`
- `payload.action = ADMIN_RECHECK`

Audit log:

- risk recheck requested

### App Receives

From `/device/sync`:

```json
{
  "commandType": "RUN_INTEGRITY_CHECK",
  "payload": {
    "source": "risk_admin_recheck",
    "action": "ADMIN_RECHECK",
    "riskFlagId": "riskFlagId"
  }
}
```

### App Does

1. immediately call `/integrity/challenge` with `action = ADMIN_RECHECK`
2. request Play Integrity token
3. call `/integrity/verify`
4. acknowledge the command after processing

### Closure

If the recheck is clean:

- admin presses `Clear`

If the risk repeats:

- backend updates existing active risk
- admin keeps remediation flow open

## Scenario 18: Admin App Update Command

### Backend Receives

```http
POST /api/admin/risk-flags/:flagId/app-update
```

Body:

```json
{
  "reason": "Push trusted app repair build"
}
```

### Backend Creates

`DeviceCommand`:

- `commandType = INSTALL_UPDATE`
- `payload.source = risk_admin_app_update`
- `payload.riskFlagId = flagId`
- app build metadata from latest published borrower Android production build

Audit log:

- app update queued

### App Receives

From `/device/sync`:

```json
{
  "commandType": "INSTALL_UPDATE",
  "payload": {
    "source": "risk_admin_app_update",
    "riskFlagId": "riskFlagId",
    "apkUrl": "https://...",
    "versionCode": 123
  }
}
```

### App Does

- validate update metadata
- download/install trusted update through approved app update mechanism
- acknowledge command after processing
- run integrity recheck after update if commanded or on next startup

### Closure

Admin:

- press `Recheck`
- press `Clear` after clean verification
- use `False Positive` if this was a staging/signing/config issue

## Scenario 19: Admin Wipe Command

Wipe is destructive and heavily restricted.

### Backend Receives

```http
POST /api/admin/risk-flags/:flagId/wipe
```

Body:

```json
{
  "reason": "Device confirmed rooted and unrecoverable"
}
```

### Backend Eligibility

Allowed only when risk is:

- critical
- permanent/device-compromise style

Eligible examples:

- `DEVICE_INTEGRITY_COMPROMISED`
- `ROOT_DETECTED`
- `TAMPER_DETECTED`
- `SYSTEM_TAMPER_DETECTED`
- `CUSTOM_ROM_DETECTED`
- `BOOTLOADER_UNLOCKED`

Not eligible:

- `APP_INTEGRITY_COMPROMISED`
- `PLAY_INTEGRITY_PACKAGE_MISMATCH`
- `PLAY_INTEGRITY_REQUEST_HASH_MISMATCH`
- `PLAY_INTEGRITY_TOKEN_EXPIRED`
- `USB_DEBUGGING_ENABLED`
- `DEVELOPER_OPTIONS_ENABLED`
- `UNKNOWN_SOURCES_ENABLED`

### Backend Creates

`DeviceCommand`:

- `commandType = WIPE_DEVICE`
- `triggeredBy = super_admin`
- `payload.source = risk_admin_wipe`
- `payload.destructiveAction = true`
- `payload.requireDeviceOwner = true`
- `expiresAt` set

`RiskFlag`:

- `status = wiped_pending_reprovision`
- `metadata.wipeCommandId = commandId`
- `metadata.wipeQueuedAt = date`

Device:

- `deviceSecurityState = WIPED_PENDING_REPROVISION`

Audit log:

- wipe queued

### App Receives

From `/device/sync`:

```json
{
  "commandType": "WIPE_DEVICE",
  "payload": {
    "source": "risk_admin_wipe",
    "destructiveAction": true,
    "requireDeviceOwner": true,
    "riskFlagId": "riskFlagId"
  }
}
```

### App Does

- execute only if Device Owner capability exists
- reject/ack failure safely if Device Owner capability is missing
- after wipe/reprovision path, device should require shop/admin reprovision

### Closure

Admin closes only after:

- wipe command outcome is known
- device is recovered or reprovisioned
- risk is cleared with reason, or kept as `wiped_pending_reprovision` until reprovision is complete

## Scenario 20: Admin Unlock While Active Critical Risk Exists

This is allowed but warned.

### Backend Receives

Admin triggers unlock/temp unlock/full unlock for a device with active critical risk.

### Backend Creates

Normal unlock command, plus warning payload:

```json
{
  "riskWarning": {
    "hasActiveCriticalRisk": true,
    "riskFlagIds": ["riskFlagId"],
    "message": "Active critical risk exists on this device"
  }
}
```

### App Receives

Normal unlock command.

If it was previously risk locked, app may clear its local risk-lock UI flag after successful `UNLOCK` or `TEMP_UNLOCK` command processing.

### App Does

- process unlock command normally
- clear cached risk-lock UI flag only after successful unlock/temp unlock processing
- do not clear server risk

### Closure

Admin still must:

- `Recheck`
- `Clear`
- `False Positive`
- or continue remediation/wipe if needed

Unlock is not a risk closure action.

## Scenario 21: False Positive Closure

### Backend Receives

```http
POST /api/admin/risk-flags/:flagId/clear
```

Body:

```json
{
  "resolution": "false_positive",
  "reason": "Staging package name was configured incorrectly"
}
```

### Backend Updates

`RiskFlag`:

- `status = false_positive`
- `clearedBy = adminAccountId`
- `clearedAt = date`
- `clearanceReason = reason`

Device:

- removes risk id from `currentRiskIds`
- if no other active risk remains, `deviceSecurityState = HEALTHY`

Audit log:

- risk flag cleared

### App Receives

No direct risk-clear command is required.

On future sync/checks:

- no new risk auto-lock should appear for this cleared flag
- future repeated detection can create/update an active risk again

### App Does

- continue normal operation
- clear local risk-lock UI only when unlock/temp-unlock command succeeds, not merely because admin marked false positive

## Scenario 22: Auto-Resolve After Clean Recheck

This is the expected closure path for temporary and warning risks.

### Previous Active Risk

One of these active risks exists:

- `PLAY_INTEGRITY_TOKEN_EXPIRED`
- `PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE`
- `USB_DEBUGGING_ENABLED`
- `DEVELOPER_OPTIONS_ENABLED`
- `UNKNOWN_SOURCES_ENABLED`

Risk has:

- `severity = low` or `medium`
- `riskBucket = stale_integrity` or `remediable_setting`
- active status such as `warning_pending`

### Backend Receives

App runs a fresh challenge/token/verify cycle and backend evaluates it as clean.

### Backend Updates

`IntegrityCheck`:

- `result = clean`
- `resolvedRiskIds` contains auto-resolved risk ids

`RiskFlag`:

- `status = resolved`
- `lastCleanCheckAt = now`
- `clearedAt = now`
- `clearanceReason = Auto-resolved after clean integrity recheck`
- `metadata.autoResolved = true`
- `metadata.resolvedByIntegrityCheckId = integrityCheckId`

Device:

- pulls resolved ids from `currentRiskIds`
- sets `deviceSecurityState = HEALTHY` only if no other active risk remains

Audit:

- `RISK_FLAG_AUTO_RESOLVED`

### App Receives

Normal clean verify response.

No special risk-clear command is required.

### App Does

- continue normal flow
- continue normal sync
- do not locally mark server risk resolved
- do not show risk-lock UI unless a risk auto-lock command exists

### Closure

No manual admin clear is required for these auto-resolvable risks.

Admin can still review audit history and integrity check detail.

## Scenario 23: Clear After Remediation

### Backend Receives

```http
POST /api/admin/risk-flags/:flagId/clear
```

Body:

```json
{
  "resolution": "cleared",
  "reason": "Admin recheck passed after user disabled USB debugging"
}
```

### Backend Updates

Same as false positive, but:

- `status = cleared`

### App Receives

No direct risk-clear command.

### App Does

- continue normal operation

### Closure Rule

Only clear after one of these is true:

- clean integrity recheck exists
- admin verified app update/reinstall fixed the issue
- admin verified device recovery/reprovision
- product/support explicitly accepts manual closure reason

## End-To-End Acceptance Checklist

For each simulated scenario, verify:

- backend received expected request fields
- `IntegrityCheck` was created
- `RiskFlag` type/severity/status/bucket/remediation match expectation
- duplicate active risk was not created for repeated same risk
- `Device.currentRiskIds` updated for active risk
- observe mode did not auto-lock
- enforce mode auto-locked only eligible critical policy-allowed risks
- `/device/sync` contains expected `pendingCommands`
- app handles command and acknowledges safely
- admin action creates audit log
- closure path changes risk status correctly
- app does not infer risk lock from device state alone
- app infers risk lock only from `LOCK` plus `payload.source = risk_auto_lock`
