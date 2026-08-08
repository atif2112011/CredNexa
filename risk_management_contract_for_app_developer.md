# Risk Management Contract For App Developer

This document is the app-developer work contract for the EMI Shield Risk Management System.

It explains what the borrower Android app must implement, what screens are required, what backend APIs are used, what commands must be handled, and how each risk flow should behave.

Backend owns final risk decisions. The app collects signals, requests Play Integrity tokens, sends evidence, receives onboarding decisions, and performs risk actions only from backend commands.

## Golden Rules

1. The app must not decide final risk status by itself.
2. The app must send Play Integrity tokens to backend for verification.
3. The app must send local security signals as evidence.
4. The app must process risk commands from `pendingCommands`.
5. The app must infer risk auto-lock only from a `LOCK` command with `payload.source = "risk_auto_lock"`.
6. The app must not expect a `risk_flag_auto` field in sync.
7. Wipe must be executed only when `WIPE_DEVICE` is received and Device Owner capability exists.
8. Unlock/temp-unlock can clear the local risk-lock UI flag, but it does not clear server risk.

## Required Backend APIs

### 1. Create Onboarding Integrity Challenge

```http
POST /api/app/integrity/challenge
Authorization: Bearer <userAccessToken>
```

Request:

```json
{
  "action": "APP_STARTUP",
  "deviceContext": {
    "imei": "device-imei",
    "appVersion": "1.0.0",
    "versionCode": 100
  }
}
```

Response:

```json
{
  "challengeId": "challengeId",
  "requestHash": "requestHash",
  "expiresAt": "2026-07-05T10:00:00.000Z",
  "action": "APP_STARTUP"
}
```

App work:

- use this endpoint only for onboarding/consent/pre-registration style checks
- pass backend `requestHash` into Google Play Integrity SDK
- do not generate your own request hash
- do not reuse old challenges

### 2. Verify Onboarding Integrity Token

```http
POST /api/app/integrity/verify
Authorization: Bearer <userAccessToken>
```

Request:

```json
{
  "challengeId": "challengeId",
  "integrityToken": "googlePlayIntegrityToken",
  "action": "APP_STARTUP",
  "localSignals": {
    "usbDebuggingEnabled": false,
    "developerOptionsEnabled": false,
    "unknownSourcesEnabled": false,
    "installFromUnknownSourcesEnabled": false,
    "adbEnabled": false,
    "isRooted": false,
    "isTampered": false,
    "debuggable": false,
    "rootIndicators": [],
    "hookingIndicators": []
  }
}
```

Response may include:

```json
{
  "decision": "allow",
  "integrityStatus": "passed",
  "reasonCode": null,
  "integrityCheckId": "integrityCheckId",
  "riskFlagIds": [],
  "autoLocks": []
}
```

For observed failure:

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

For enforce-mode failure:

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

App work:

- if `decision = allow`, continue normal flow
- if `decision = retry`, show retry flow and request a new challenge
- if `decision = manual_review`, show support/contact-admin flow
- if `decision = block`, stop sensitive flow and wait for command/sync state
- always continue to process `/device/sync`
- do not decide lock state only from `riskFlagIds`

Only this onboarding endpoint is decision-driven.

### 3. Create Risk Integrity Challenge

```http
POST /api/app/integrity/risk/challenge
Authorization: Bearer <userAccessToken>
```

Use this endpoint for ongoing risk management checks:

- app startup
- app foreground
- boot completed
- local app-side periodic/background scheduler
- after settings remediation
- after app update
- after `RUN_INTEGRITY_CHECK`

Request:

```json
{
  "action": "APP_STARTUP",
  "deviceContext": {
    "imei": "device-imei",
    "appVersion": "1.0.0",
    "versionCode": 100
  }
}
```

Response:

```json
{
  "status": "challenge_created",
  "challengeId": "challengeId",
  "requestHash": "requestHash",
  "expiresAt": "2026-07-05T10:00:00.000Z",
  "action": "APP_STARTUP"
}
```

App work:

- call this before risk Play Integrity token requests
- pass backend `requestHash` into Google Play Integrity SDK
- do not use onboarding challenge for scheduled/background checks
- do not use `ONBOARDING_PRE_REGISTRATION` action here

### 4. Verify Risk Integrity Token

```http
POST /api/app/integrity/risk/verify
Authorization: Bearer <userAccessToken>
```

Request:

```json
{
  "challengeId": "challengeId",
  "integrityToken": "googlePlayIntegrityToken",
  "action": "APP_STARTUP",
  "localSignals": {
    "usbDebuggingEnabled": false,
    "developerOptionsEnabled": false,
    "unknownSourcesEnabled": false,
    "installFromUnknownSourcesEnabled": false,
    "adbEnabled": false,
    "isRooted": false,
    "isTampered": false,
    "debuggable": false,
    "rootIndicators": [],
    "hookingIndicators": []
  }
}
```

Response:

```json
{
  "status": "recorded",
  "integrityCheckId": "integrityCheckId",
  "riskFlagIds": ["riskFlagId"],
  "resolvedRiskIds": [],
  "commandsQueued": [
    {
      "commandType": "LOCK",
      "commandId": "commandId",
      "riskFlagId": "riskFlagId",
      "source": "risk_auto_lock",
      "policyKey": "EMI_LOCKED",
      "policyVersion": 7
    }
  ],
  "syncRecommended": true
}
```

Expired challenge response:

```json
{
  "status": "retry_required",
  "reasonCode": "CHALLENGE_EXPIRED",
  "syncRecommended": false,
  "commandsQueued": []
}
```

App work:

- do not lock/unlock/wipe from this response
- do not show onboarding decision UI from this response
- if `syncRecommended = true`, call `/api/app/device/sync`
- perform actions only from commands returned by sync/FCM

### 5. Device Sync

```http
POST /api/app/device/sync
Authorization: Bearer <userAccessToken>
```

App work:

- call during app startup
- call after successful integrity verification
- call after FCM command notification
- call after network reconnect
- call periodically as already implemented

Risk auto-lock detection:

```text
pendingCommands[i].commandType = "LOCK"
pendingCommands[i].payload.source = "risk_auto_lock"
```

Example:

```json
{
  "pendingCommands": [
    {
      "id": "commandId",
      "commandType": "LOCK",
      "payload": {
        "source": "risk_auto_lock",
        "policyKey": "EMI_LOCKED",
        "riskFlagId": "riskFlagId",
        "riskType": "DEVICE_INTEGRITY_COMPROMISED",
        "severity": "critical"
      }
    }
  ]
}
```

App work:

- apply the lock command normally
- cache a local risk-lock flag
- show risk lock screen
- acknowledge the command after processing

### 4. Command Acknowledgement

```http
POST /api/app/device/command/ack
Authorization: Bearer <userAccessToken>
```

Use the existing command ack contract.

For `INSTALL_UPDATE`, include installed version details when available:

```json
{
  "commandId": "commandId",
  "status": "completed",
  "appVersion": "1.2.0",
  "versionCode": 120
}
```

For failed wipe or command failure, acknowledge safely with failure/error details according to existing app command ack behavior.

## Required Screens

### 1. Risk Auto-Lock Screen

Show when app detects:

```text
LOCK + payload.source = risk_auto_lock
```

Required primary text:

```text
Risk Flag Detected! Contact Admin
```

Screen details:

- show device is locked due to security risk
- show tenant/admin support phone or email if available from existing tenant utility/profile data
- hide borrower temp-unlock controls while cached risk-lock flag is active
- do not show normal EMI overdue-only messaging as the primary reason
- keep normal allowed locked-device emergency/support actions if already part of lock mode

State behavior:

- cache local risk-lock flag after processing risk auto-lock
- keep showing this screen while device remains locked and local flag is active
- clear cached local risk-lock flag only after successful `UNLOCK` or `TEMP_UNLOCK` command processing
- do not clear the server risk flag locally

### 2. Onboarding Integrity Retry Screen

Show during onboarding when `/integrity/verify` returns:

```text
decision = retry
```

Common reason codes:

- `CHALLENGE_EXPIRED`
- `TOKEN_TIMESTAMP_INVALID`
- `PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE`

Screen behavior:

- tell user security verification could not complete
- provide retry button
- app must request a fresh challenge
- do not show compromised-device language
- do not cache risk-lock flag

### 3. Onboarding Manual Review / Contact Admin Screen

Show during onboarding when `/integrity/verify` returns:

```text
decision = manual_review
```

Typical reason:

- `APP_INTEGRITY_UNRECOGNIZED`

Screen behavior:

- explain that app security verification requires admin review
- show contact admin/support details
- provide retry/recheck only if product allows
- do not execute destructive actions

### 4. Remediable Setting Screen

Show when backend or command asks app to show remediation for settings such as:

- USB debugging enabled
- developer options enabled
- install from unknown sources enabled

Screen behavior:

- explain the setting to turn off
- provide simple steps
- offer "I fixed it" action
- on "I fixed it", run fresh challenge and verify flow
- do not lock the device solely because of these warning settings

### 5. App Update / Repair Screen

Show when app receives:

```text
INSTALL_UPDATE
```

Screen behavior:

- show trusted update required
- download/install from backend-provided metadata only
- do not install arbitrary APK links
- after update, acknowledge command with app version/version code
- run a fresh integrity check after update or on next startup

### 6. Wipe / Reprovision Screen

Show when app receives:

```text
WIPE_DEVICE
```

Required conditions:

- execute only if app has Device Owner capability
- command payload must include `destructiveAction = true`
- command payload must include `requireDeviceOwner = true`

Screen behavior:

- show final security recovery state if UI is visible before wipe
- do not offer borrower bypass
- if wipe cannot run because Device Owner capability is missing, acknowledge failure safely
- after wipe/recovery, app/device must go through reprovision path

### 7. Reprovision Required Screen

Show when app receives:

```text
REPROVISION_REQUIRED
```

Screen behavior:

- tell user/admin that device needs shop/admin reprovision
- show support details
- block normal borrower flow until reprovision is completed

## Required Command Handling

The app must support these command types from `pendingCommands` and FCM-triggered sync:

| Command | App Action |
| --- | --- |
| `LOCK` with `payload.source = risk_auto_lock` | Apply lock, cache risk-lock UI flag, show risk screen, ack command. |
| `RUN_INTEGRITY_CHECK` | Run challenge -> Play Integrity token -> verify, then ack command. |
| `SHOW_REMEDIATION` | Show remediation screen using payload risk/remediation details, then ack when shown or completed. |
| `INSTALL_UPDATE` | Start trusted update flow, ack with installed version details after success. |
| `WIPE_DEVICE` | Execute only with Device Owner capability; otherwise ack failure safely. |
| `REPROVISION_REQUIRED` | Show reprovision-required screen and block normal flow. |
| `UNLOCK` | Process existing unlock flow; clear local risk-lock UI flag after success. |
| `TEMP_UNLOCK` | Process existing temp unlock flow; clear local risk-lock UI flag after success. |
| `POLICY_UPDATE` | Existing behavior. |
| `UPCOMING_PAYMENT` | Existing behavior. |
| `NOTIFICATION` | Existing behavior. |

## Required Integrity Check Triggers

App should run integrity flow during:

- app startup
- device sync after app launch
- app foreground resume
- boot completed, if app receives boot event
- before sensitive policy/unlock-related flow
- after app update
- after user fixes remediable setting
- after receiving `RUN_INTEGRITY_CHECK`
- after admin or support asks for recheck

Supported actions:

```text
APP_STARTUP
DAILY_HEARTBEAT
ADMIN_RECHECK
APP_FOREGROUND
BOOT_COMPLETED
BEFORE_UNLOCK
REMEDIATION_RECHECK
```

Use the action sent by the backend command when present.

## Required Local Signals

Send best-effort local signals in every onboarding `/integrity/verify` and risk `/integrity/risk/verify` call:

```json
{
  "localSignals": {
    "usbDebuggingEnabled": false,
    "developerOptionsEnabled": false,
    "unknownSourcesEnabled": false,
    "installFromUnknownSourcesEnabled": false,
    "adbEnabled": false,
    "isRooted": false,
    "isTampered": false,
    "debuggable": false,
    "rootIndicators": [],
    "hookingIndicators": []
  }
}
```

Rules:

- send booleans as booleans
- send arrays even when empty
- do not send secrets
- do not send full Play Integrity raw result outside `integrityToken`
- do not invent final risk status locally

## Risk Types The App May See

The app generally does not need to interpret every risk type. For onboarding it follows backend decisions. For risk management it follows backend commands from sync/FCM.

For UI text and support logging, the app may display simplified categories:

| Risk Type | App Category |
| --- | --- |
| `DEVICE_INTEGRITY_COMPROMISED` | Device security issue |
| `ROOT_DETECTED` | Device security issue |
| `TAMPER_DETECTED` | Device security issue |
| `APP_INTEGRITY_COMPROMISED` | App security issue |
| `APP_TAMPER_DETECTED` | App security issue |
| `PLAY_INTEGRITY_REQUEST_HASH_MISMATCH` | Verification retry required |
| `PLAY_INTEGRITY_PACKAGE_MISMATCH` | App verification issue |
| `PLAY_INTEGRITY_TOKEN_EXPIRED` | Verification retry required |
| `PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE` | Temporary verification issue |
| `USB_DEBUGGING_ENABLED` | Setting needs to be turned off |
| `DEVELOPER_OPTIONS_ENABLED` | Setting needs to be turned off |
| `UNKNOWN_SOURCES_ENABLED` | Setting needs to be turned off |

Do not use this table to decide lock/wipe locally. Backend commands decide enforcement.

## Default Auto-Lock Risk Types

By default, the backend can auto-lock only for confirmed device compromise and critical app compromise risks.

Current default tenant `riskRules.autoLockTypes`:

```json
[
  "ROOT_DETECTED",
  "TAMPER_DETECTED",
  "SYSTEM_TAMPER_DETECTED",
  "CUSTOM_ROM_DETECTED",
  "BOOTLOADER_UNLOCKED",
  "DEVICE_INTEGRITY_COMPROMISED",
  "APP_INTEGRITY_COMPROMISED",
  "APP_TAMPER_DETECTED"
]
```

These are not default auto-lock risks:

- `PLAY_INTEGRITY_REQUEST_HASH_MISMATCH`
- `PLAY_INTEGRITY_PACKAGE_MISMATCH`
- `PLAY_INTEGRITY_TOKEN_EXPIRED`
- `PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE`
- `DEBUGGABLE_BUILD_DETECTED`
- `USB_DEBUGGING_ENABLED`
- `DEVELOPER_OPTIONS_ENABLED`
- `UNKNOWN_SOURCES_ENABLED`
- legacy `APP_SIGNATURE_MISMATCH`

App rule: do not hard-code this list for enforcement. The app should only enforce when backend sends a command such as `LOCK`, `INSTALL_UPDATE`, `RUN_INTEGRITY_CHECK`, or `WIPE_DEVICE`.

## Flow 1: Normal Clean Device

1. App starts.
2. App calls `/integrity/risk/challenge`.
3. App requests Play Integrity token.
4. App calls `/integrity/risk/verify`.
5. Backend returns `status = recorded` and `syncRecommended = true`.
6. App calls `/device/sync`.
7. No risk lock command is present.
8. App continues normal borrower flow.

Expected app UI:

- no risk screen
- normal dashboard/payment flow

## Flow 2: Observe-Mode Risk Found

1. App calls risk challenge/verify.
2. Backend records `IntegrityCheck` and `RiskFlag`.
3. Backend returns `status = recorded`, `riskFlagIds`, and `syncRecommended = true`.
4. App calls `/device/sync`.
5. No risk lock command is present.
6. App continues normal flow.
7. App may log telemetry for support, but should not show risk-lock screen.

Expected app UI:

- normal flow unless product wants non-blocking warning

## Flow 3: Enforce-Mode Risk Auto-Lock

1. App calls risk challenge/verify.
2. Backend records risk.
3. Backend queues `LOCK` with `payload.source = risk_auto_lock`.
4. Risk verify returns `syncRecommended = true`, not a lock decision.
5. App calls `/device/sync`.
6. App sees pending `LOCK` risk command.
7. App applies lock.
8. App caches risk-lock UI flag.
9. App shows:

```text
Risk Flag Detected! Contact Admin
```

Expected app UI:

- risk lock screen
- admin/support contact details
- no borrower temp-unlock controls

Closure:

- admin may recheck, clear, false-positive, app-update, or wipe depending on risk type
- app clears local risk-lock UI flag after successful `UNLOCK` or `TEMP_UNLOCK`

## Flow 4: Admin Recheck

1. Admin presses `Recheck` in risk detail.
2. Backend queues `RUN_INTEGRITY_CHECK`.
3. App receives command in sync.
4. App calls `/integrity/risk/challenge` with action from payload, usually `ADMIN_RECHECK`.
5. App calls Play Integrity SDK.
6. App calls `/integrity/risk/verify`.
7. App acknowledges command.

Expected app UI:

- show "Checking device security" progress if user-visible
- if clean, return to normal eligible state
- if failed, sync and follow backend commands

Backend auto-resolution:

- if the clean recheck fixes a temporary/warning risk, backend can auto-resolve the risk
- examples: stale token, provider unavailable, USB debugging, developer options, unknown sources
- app does not need a special risk-clear command for this
- app must not mark server risk resolved locally
- app should continue normal sync behavior after recheck

## Flow 5: Admin App Update

1. Admin presses `App Update`.
2. Backend queues `INSTALL_UPDATE`.
3. App receives command.
4. App shows app update/repair screen.
5. App downloads/installs trusted update metadata from command payload.
6. App acknowledges command with version details.
7. App runs integrity check again.

Expected app UI:

- update required screen
- install progress
- retry/support on failure

## Flow 6: Admin Wipe

1. Admin presses `Wipe` for eligible critical device-compromise risk.
2. Backend queues `WIPE_DEVICE`.
3. App receives command.
4. App checks Device Owner capability.
5. If capability exists, app executes wipe/recovery flow.
6. If capability does not exist, app acknowledges failure safely.

Expected app UI:

- no borrower bypass
- reprovision/support state after wipe or failed wipe

Important:

- app must not wipe for app update risks, protocol mismatch, stale token, USB debugging, developer options, or unknown sources unless backend explicitly sends `WIPE_DEVICE`
- app must not create its own wipe decision

## Flow 7: Admin Unlock With Active Risk

1. Admin unlocks or temp-unlocks a risk-locked device.
2. Backend may include active risk warning in command payload.
3. App processes `UNLOCK` or `TEMP_UNLOCK`.
4. App clears local risk-lock UI flag only after successful command processing.
5. Server risk remains active until admin clears it.

Expected app UI:

- unlocked/temp-unlocked app state after command success
- no local risk-lock screen after unlock success

Important:

- unlock is not risk closure
- app should not mark risk resolved

## Screen Copy Requirements

Use exact primary risk-lock copy:

```text
Risk Flag Detected! Contact Admin
```

Suggested supporting copy:

```text
This device has been locked because a security risk was detected. Please contact your administrator for help.
```

Retry verification copy:

```text
Security verification could not be completed. Please try again.
```

Manual review copy:

```text
Security verification requires admin review. Please contact your administrator.
```

Remediable settings copy:

```text
Please turn off the highlighted security setting and run verification again.
```

## App Developer Acceptance Checklist

- challenge API is called before Play Integrity SDK token request
- backend `requestHash` is passed to Play Integrity SDK
- onboarding verify API includes `challengeId`, `integrityToken`, `action`, and `localSignals`
- onboarding flow handles `allow`, `retry`, `manual_review`, and `block`
- risk verify API uses `/integrity/risk/verify`
- risk verify response is not used to lock, unlock, wipe, or block UI
- app calls `/device/sync` after risk verify when `syncRecommended = true`
- app supports all new security command types
- risk auto-lock is inferred only from `LOCK` plus `payload.source = risk_auto_lock`
- risk-lock screen uses exact approved primary copy
- temp unlock controls are hidden during cached risk-lock state
- cached risk-lock state clears after successful `UNLOCK` or `TEMP_UNLOCK`
- app does not clear server risk locally
- app update command uses only trusted backend metadata
- wipe executes only from `WIPE_DEVICE` command and only with Device Owner capability
- command acknowledgements are sent after success/failure
- recheck flow runs fresh challenge/token/verify
- local signals are sent as evidence on every verify call
