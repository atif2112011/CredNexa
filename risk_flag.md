# Risk Flag / Security Event API Contract

This document is for the borrower Android app developer.

The app does not create `RiskFlag` documents directly. It reports a security event to the backend, and the backend creates:

- `DeviceEvent`
- `RiskFlag`
- optional device lock command when tenant risk rules match

## Endpoint

```http
POST /api/app/security/event
Authorization: Bearer <userAccessToken>
```

The user must already have a registered device.

## Request Body

```json
{
  "type": "ROOT_DETECTED",
  "severity": "critical",
  "message": "Root indicators detected on device",
  "metadata": {
    "source": "APP_STARTUP",
    "rootIndicators": ["/system/xbin/su"],
    "checkedAt": "2026-06-14T10:30:00.000Z"
  }
}
```

## Required Fields

| Field | Required | Notes |
| --- | --- | --- |
| `type` | Yes | Security event type. |
| `message` | Yes | Safe backend/admin-facing summary. |
| `severity` | No | Defaults to `medium` if omitted. |
| `metadata` | No | Extra diagnostic context. Do not send secrets or full Play Integrity token. |

## Severity Values

```text
low
medium
high
critical
```

Recommended usage:

| Severity | Use When |
| --- | --- |
| `low` | Informational or weak suspicious signal. |
| `medium` | Suspicious but not enough to block or lock. |
| `high` | Strong suspicious signal requiring admin review. |
| `critical` | Confirmed device/app compromise; eligible for backend auto-lock if tenant risk rules allow it. |

## Supported / Recommended Types

### Root / Tamper

```text
ROOT_DETECTED
TAMPER_DETECTED
RESTRICTIONS_MISSING
DEVICE_OWNER_POLICY_MISSING
```

Use examples:

```json
{
  "type": "ROOT_DETECTED",
  "severity": "critical",
  "message": "Root indicators detected",
  "metadata": {
    "source": "APP_STARTUP",
    "rootIndicators": ["/system/xbin/su", "magisk"],
    "checkedAt": "2026-06-14T10:30:00.000Z"
  }
}
```

```json
{
  "type": "RESTRICTIONS_MISSING",
  "severity": "critical",
  "message": "Required Device Owner restrictions are missing",
  "metadata": {
    "source": "POLICY_SYNC",
    "missingRestrictions": ["disableFactoryReset", "disableStatusBar"],
    "policyKey": "EMI_LOCKED",
    "policyVersion": 5
  }
}
```

### Google Play Integrity

Use these when backend/app Play Integrity result indicates compromise after registration.

```text
DEVICE_INTEGRITY_COMPROMISED
APP_INTEGRITY_COMPROMISED
```

Use `DEVICE_INTEGRITY_COMPROMISED` when Google device verdict does not meet the required level.

```json
{
  "type": "DEVICE_INTEGRITY_COMPROMISED",
  "severity": "critical",
  "message": "Play Integrity device verdict failed",
  "metadata": {
    "source": "APP_STARTUP",
    "action": "APP_STARTUP",
    "challengeId": "challengeId",
    "decision": "block",
    "deviceIntegrity": [],
    "requiredLevel": "MEETS_DEVICE_INTEGRITY",
    "checkedAt": "2026-06-14T10:30:00.000Z"
  }
}
```

Use `APP_INTEGRITY_COMPROMISED` when Google app verdict indicates the app is not trusted or expected.

```json
{
  "type": "APP_INTEGRITY_COMPROMISED",
  "severity": "critical",
  "message": "Play Integrity app verdict failed",
  "metadata": {
    "source": "APP_STARTUP",
    "action": "APP_STARTUP",
    "challengeId": "challengeId",
    "decision": "block",
    "appIntegrity": "UNRECOGNIZED_VERSION",
    "packageName": "com.crednexa.app",
    "checkedAt": "2026-06-14T10:30:00.000Z"
  }
}
```

### Repeated / Offline Signals

```text
INTEGRITY_CHECK_REPEATED_FAILURE
LONG_OFFLINE_SUSPICIOUS
```

Use `high` for repeated temporary failures. Use `critical` only if the app has strong evidence of compromise.

## Auto-Lock Rule

The backend has tenant policy defaults:

```json
{
  "riskRules": {
    "autoLockOnCriticalSecurityRisk": true,
    "autoLockTypes": [
      "ROOT_DETECTED",
      "TAMPER_DETECTED",
      "DEVICE_INTEGRITY_COMPROMISED",
      "APP_INTEGRITY_COMPROMISED"
    ]
  }
}
```

If all are true:

- `severity` is `critical`
- `type` is in tenant policy `riskRules.autoLockTypes`
- device is not already `LOCKED`

then backend:

- creates the risk flag
- sets device state to `LOCKED`
- applies `EMI_LOCKED` policy
- queues a `LOCK` command
- FCM worker sends the policy update through the existing command pipeline

## Success Response

```json
{
  "success": true,
  "message": "Security event recorded",
  "data": {
    "riskFlagId": "riskFlagId",
    "status": "open",
    "autoLock": {
      "queued": true,
      "commandId": "commandId",
      "deviceState": "LOCKED",
      "policyKey": "EMI_LOCKED",
      "policyVersion": 6
    }
  }
}
```

If auto-lock is not triggered:

```json
{
  "success": true,
  "message": "Security event recorded",
  "data": {
    "riskFlagId": "riskFlagId",
    "status": "open",
    "autoLock": {
      "queued": false,
      "reason": "RISK_RULE_NOT_MATCHED"
    }
  }
}
```

Other possible `autoLock.reason` values:

```text
DEVICE_ALREADY_LOCKED
EMI_LOCKED_POLICY_NOT_FOUND
LOCK_COMMAND_ALREADY_EXISTS
DEVICE_LOCK_CONDITION_FAILED
```

## Error Responses

Missing required fields:

```json
{
  "success": false,
  "error": "Security event type and message are required"
}
```

No registered device:

```json
{
  "success": false,
  "error": "Registered device not found"
}
```

## App Rules

- Do not send raw Play Integrity token in `metadata`.
- Do not send Google service credentials.
- Use `critical` only for confirmed compromise.
- Use `DEVICE_INTEGRITY_COMPROMISED` and `APP_INTEGRITY_COMPROMISED` only for Google integrity verdict failures after backend/app integrity flow.
- App should continue to obey backend sync/command state. The app should not locally lock itself only because it sent this event.
