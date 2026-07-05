# Risk Management Service App Developer Contract

This document describes the MVP risk-management contract after the server-owned Play Integrity implementation.

## Integrity Check Flow

1. App calls `POST /api/app/integrity/challenge` with an action such as `APP_STARTUP`, `DAILY_HEARTBEAT`, `ADMIN_RECHECK`, `APP_FOREGROUND`, `BOOT_COMPLETED`, `BEFORE_UNLOCK`, or `REMEDIATION_RECHECK`.
2. Backend returns `challengeId`, `requestHash`, and `expiresAt`.
3. App requests the Play Integrity token using the backend `requestHash`.
4. App calls `POST /api/app/integrity/verify` with `challengeId`, `integrityToken`, `action`, and optional `localSignals`.
5. Backend verifies the token, stores an `IntegrityCheck`, creates or updates `RiskFlag` records, and returns the decision.

## Verify Response Additions

Existing fields remain. The backend may now also return:

```json
{
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

In observe mode, risk records can be created but Play Integrity auto-lock is not queued. In enforcement mode, critical configured risks can queue `LOCK` with `payload.source = "risk_auto_lock"`.

## Supported Security Commands

The app should support these `DeviceCommand.commandType` values in sync and FCM command handling:

| Command | Purpose |
| --- | --- |
| `RUN_INTEGRITY_CHECK` | Immediately run a fresh challenge/token/verify cycle. |
| `SHOW_REMEDIATION` | Show a non-technical remediation screen. |
| `INSTALL_UPDATE` | Download/install trusted production app repair metadata. |
| `WIPE_DEVICE` | Admin-only destructive reset command; execute only when Device Owner capability exists. |
| `REPROVISION_REQUIRED` | Show shop-owner reprovision requirement. |

Existing `LOCK`, `UNLOCK`, `TEMP_UNLOCK`, `POLICY_UPDATE`, `UPCOMING_PAYMENT`, and `NOTIFICATION` commands remain unchanged.

## Risk Lock UI Contract

Do not expect a separate `risk_flag_auto` field in sync.

The app must continue to infer risk auto-lock from:

```text
pendingCommands[i].commandType = "LOCK"
pendingCommands[i].payload.source = "risk_auto_lock"
```

When detected, cache a local UI flag and show:

```text
Risk Flag Detected! Contact Admin
```

The screen may show admin phone/email. Hide temp unlock controls while the cached risk-lock flag is active. Clear the cached flag after successful `UNLOCK` or `TEMP_UNLOCK` command processing.

## Local Signals

Send local signals as evidence in `/api/app/integrity/verify`:

```json
{
  "localSignals": {
    "usbDebuggingEnabled": true,
    "developerOptionsEnabled": false,
    "unknownSourcesEnabled": false,
    "isRooted": false,
    "isTampered": false,
    "rootIndicators": [],
    "hookingIndicators": []
  }
}
```

The app should not decide final risk status. The backend maps evidence to risk type, severity, status, remediation method, and command actions.
