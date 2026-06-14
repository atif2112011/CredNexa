# Play Integrity API Contract

This document is for the borrower Android app developer. These APIs run after OTP verification and before consent/device registration.

Base path:

```text
/api/app
```

Auth:

```http
Authorization: Bearer <accessToken returned by /api/app/consent/verify-otp>
```

## Flow

```text
1. User verifies OTP
2. Backend returns user accessToken
3. App calls POST /api/app/integrity/challenge
4. App sends requestHash to native Play Integrity bridge
5. Native Android returns integrityToken
6. App calls POST /api/app/integrity/verify
7. If decision is allow, continue to consent screen
```

The app must not verify the Play Integrity token locally. The backend verifies it with Google.

## Endpoint 1: Create Challenge

```http
POST /api/app/integrity/challenge
```

Creates a short-lived, single-use challenge. The returned `requestHash` must be passed to the Android Play Integrity token request.

### Request Body

```json
{
  "action": "ONBOARDING_PRE_REGISTRATION",
  "mobile": "9876543210",
  "enrollmentToken": "optional-enrollment-token",
  "deviceContext": {
    "isDeviceOwner": true,
    "packageName": "com.crednexa.app",
    "appVersion": "1.0.1",
    "androidVersion": "14",
    "deviceModel": "Pixel 7"
  }
}
```

### Field Notes

| Field | Required | Notes |
| --- | --- | --- |
| `action` | No | Defaults to `ONBOARDING_PRE_REGISTRATION`. |
| `mobile` | No | If sent, backend verifies it matches the authenticated user. |
| `enrollmentToken` | No | Send during onboarding if available from QR provisioning. |
| `deviceContext` | No | Diagnostic context stored with the challenge. |

Allowed `action` values:

```text
ONBOARDING_PRE_REGISTRATION
APP_STARTUP
DAILY_HEARTBEAT
BEFORE_POLICY_SYNC
BEFORE_UNLOCK
SUSPICIOUS_SIGNAL
```

For initial onboarding, use:

```text
ONBOARDING_PRE_REGISTRATION
```

### Success Response

```json
{
  "success": true,
  "message": "Integrity challenge created successfully",
  "data": {
    "challengeId": "665f6f0b6f0f6f0b6f0f6f0b",
    "requestHash": "base64url-request-hash",
    "expiresAt": "2026-06-14T10:30:00.000Z",
    "action": "ONBOARDING_PRE_REGISTRATION"
  }
}
```

### Error Responses

Invalid action:

```json
{
  "success": false,
  "error": "Valid integrity action is required"
}
```

Invalid user:

```json
{
  "success": false,
  "error": "Active user not found"
}
```

Mobile mismatch:

```json
{
  "success": false,
  "error": "Mobile does not match registered borrower"
}
```

Invalid enrollment token:

```json
{
  "success": false,
  "error": "Valid enrollment token not found"
}
```

## Native Play Integrity Call

After receiving `requestHash`, call the Android native bridge:

```json
{
  "requestHash": "base64url-request-hash"
}
```

Expected native output:

```json
{
  "success": true,
  "integrityToken": "token-from-google-play-integrity"
}
```

Do not log or permanently store the `integrityToken`.

## Endpoint 2: Verify Integrity

```http
POST /api/app/integrity/verify
```

Verifies the Play Integrity token with Google and returns the backend decision.

### Request Body

```json
{
  "challengeId": "665f6f0b6f0f6f0b6f0f6f0b",
  "integrityToken": "token-from-google-play-integrity",
  "action": "ONBOARDING_PRE_REGISTRATION",
  "localSignals": {
    "isDeviceOwner": true,
    "debuggable": false,
    "isRooted": false,
    "isTampered": false,
    "rootIndicators": [],
    "hookingIndicators": []
  }
}
```

### Field Notes

| Field | Required | Notes |
| --- | --- | --- |
| `challengeId` | Yes | Returned by `/integrity/challenge`. |
| `integrityToken` | Yes | Returned by Google Play Integrity on the device. |
| `action` | Yes | Must match the challenge action. |
| `localSignals` | No | Local root/tamper hints. Backend treats them as secondary signals. |

## Verify Responses

### Allow

Continue to consent screen.

```json
{
  "success": true,
  "message": "Device integrity verified successfully",
  "data": {
    "decision": "allow",
    "integrityStatus": "passed",
    "requiredLevel": "MEETS_DEVICE_INTEGRITY",
    "deviceIntegrity": ["MEETS_DEVICE_INTEGRITY"],
    "appIntegrity": "PLAY_RECOGNIZED",
    "verifiedAt": "2026-06-14T10:25:00.000Z",
    "nextStep": "SHOW_CONSENT"
  }
}
```

In observe mode, backend may still return `allow` while recording an observed failure:

```json
{
  "success": true,
  "message": "Device integrity observed successfully",
  "data": {
    "decision": "allow",
    "integrityStatus": "observed_failure",
    "reasonCode": "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE",
    "nextStep": "SHOW_CONSENT"
  }
}
```

The app should treat `decision: "allow"` as permission to continue to consent.

### Retry

Show retry UI and request a fresh challenge before retrying.

```json
{
  "success": false,
  "message": "Unable to verify device security. Please try again.",
  "data": {
    "decision": "retry",
    "integrityStatus": "temporary_failure",
    "reasonCode": "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE",
    "retryAfterSeconds": 30
  }
}
```

Expired challenge:

```json
{
  "success": false,
  "message": "Integrity challenge expired. Please retry.",
  "data": {
    "decision": "retry",
    "integrityStatus": "temporary_failure",
    "reasonCode": "CHALLENGE_EXPIRED",
    "retryAfterSeconds": 0
  }
}
```

### Block Or Manual Review

Do not continue to consent or device registration.

```json
{
  "success": false,
  "message": "Device security verification failed. Please contact support.",
  "data": {
    "decision": "block",
    "integrityStatus": "failed",
    "reasonCode": "DEVICE_INTEGRITY_FAILED",
    "nextStep": "DEVICE_INTEGRITY_FAILED"
  }
}
```

`decision` may be:

```text
block
manual_review
```

The app should show a safe failure/support screen for both.

## Generic Validation Errors

Missing required fields:

```json
{
  "success": false,
  "error": "Challenge ID, integrity token, and action are required"
}
```

Invalid challenge id:

```json
{
  "success": false,
  "error": "Valid challenge ID is required"
}
```

Challenge already used:

```json
{
  "success": false,
  "error": "Integrity challenge has already been used"
}
```

Challenge not found:

```json
{
  "success": false,
  "error": "Valid integrity challenge not found"
}
```

## App Handling Rules

- Request a new challenge for every integrity check.
- Never reuse `challengeId` or `requestHash`.
- Never log the full `integrityToken`.
- Never store the `integrityToken` permanently.
- Continue only when `data.decision === "allow"`.
- For `retry`, request a fresh challenge and run Play Integrity again.
- For `block` or `manual_review`, do not open consent or call device registration.
- In initial onboarding, integrity must run after OTP verify and before consent.

## Current Backend Mode

The backend supports two modes:

```text
observe
enforce / enforcement
```

In `observe` mode, failures are stored on the challenge but the API returns `allow` so onboarding can continue while verdicts are validated on real QR-provisioned devices.

In `enforce` mode, failed verdicts can return `retry`, `manual_review`, or `block`.
