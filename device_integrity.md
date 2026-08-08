# Device Integrity Layer Security

## Purpose

This document defines the device integrity security layer for EMI Shield after QR provisioning installs the Flutter app and makes it the Android Device Owner.

The app-layer restrictions are handled separately in `disallow_service.md`. This layer focuses on proving that the device, OS, boot state, and running environment are trustworthy before EMI registration continues and throughout the device lifecycle.

## Assumption

The device is freshly out of the box before provisioning:

- The app is installed silently through QR provisioning.
- The app becomes Device Owner.
- The device has not yet completed EMI registration.
- Restrictions are not applied immediately after QR provisioning.
- Restrictions are applied later after device registration.

## Security Areas Still Left

### 1. Provisioning Trust

**Risk:** A tampered APK, wrong package, reused QR code, or manipulated enrollment flow could register an unsafe device.

**Mitigation:**

- Use HTTPS for APK download in the QR provisioning payload.
- Include APK checksum/signature checksum in the QR provisioning payload.
- Use one-time enrollment tokens.
- Expire provisioning tokens quickly.
- Bind provisioning token to tenant/dealer/session.
- Reject duplicate registration attempts for the same provisioning token.
- Store provisioning audit data on the backend.

### 2. Device Integrity

**Risk:** The device may be rooted, bootloader-unlocked, running a custom ROM, using a tampered system image, or using a non-certified Android build.

**Mitigation:**

- Use Play Integrity API before continuing EMI registration.
- Prefer devices that return strong hardware-backed integrity.
- Reject or flag devices that fail required integrity checks.
- Store integrity verdict history on the backend.
- Re-check integrity periodically after registration.
- Create backend risk flags when integrity anomalies are detected.

### 3. Bootloader And OS Trust

**Risk:** An unlocked bootloader allows flashing custom images, patched boot images, rooted firmware, or modified recovery.

**Mitigation:**

- During provisioning, require Play Integrity verdicts that indicate device integrity.
- Prefer `MEETS_STRONG_INTEGRITY` where supported.
- Treat missing/failed integrity as a risk signal.
- Do not complete registration on suspicious devices unless manually approved.
- Include bootloader/custom OS risk in the backend risk score.

### 4. Root And Hooking Frameworks

**Risk:** Magisk, Zygisk, LSPosed, Frida, Substrate, debugger tools, or runtime hooks can tamper with app behavior.

**Mitigation:**

- Use Play Integrity API as the primary signal.
- Add local root/hooking indicators as secondary signals.
- Detect known suspicious packages, binaries, paths, and runtime instrumentation.
- Never rely only on local root checks because they can be bypassed.
- Send suspicious local signals to the backend risk flag API.
- Let the backend decide whether to warn, restrict, lock, or require manual review.

### 5. Backend Authority

**Risk:** If lock/unlock/payment status is decided only on-device, clearing data, patching storage, or tampering with local state could bypass enforcement.

**Mitigation:**

- Keep payment, registration, consent, lock state, and risk state server-authoritative.
- Use server time for EMI and grace-period calculations.
- Require authenticated device sessions for sync calls.
- Sign or version policy payloads sent to the device.
- Treat missing heartbeat or stale integrity as a risk signal.

### 6. Offline And Tamper Handling

**Risk:** The user may keep the device offline to avoid receiving lock/risk updates.

**Mitigation:**

- Require periodic heartbeat.
- Store the last successful integrity verification timestamp.
- Define a maximum offline grace window.
- Move device to restricted mode when offline beyond policy.
- Send risk flags when the device comes back online after suspicious offline duration.

### 7. OEM Flashing Paths

**Risk:** Fastboot, Odin, EDL, recovery flashing, and board-level tools may bypass app-level controls.

**Mitigation:**

- Procure devices with locked bootloader.
- Avoid devices/OEMs with weak bootloader controls for EMI deployments.
- Check integrity before registration and periodically after registration.
- Treat integrity regression as a high-severity backend risk flag.
- Use operational controls: device model allowlist, dealer SOP, and inventory audit.

## Play Integrity API

Play Integrity API helps verify whether a request comes from the genuine app running on a trustworthy Android device.

The app requests an integrity token from Google Play services. The token is sent to the backend. The backend verifies the token with Google and reads the verdict.

### Important Verdict Areas

- `appIntegrity`: Confirms package name/signature recognition.
- `deviceIntegrity`: Indicates whether the device appears genuine and trustworthy.
- `requestDetails`: Includes request data such as package name, request hash, and timestamp.
- `accountDetails`: Provides Play account/licensing signals where available.

### Recommended Device Verdict Handling

- `MEETS_STRONG_INTEGRITY`: Best signal. Prefer this for high-confidence devices where supported.
- `MEETS_DEVICE_INTEGRITY`: Acceptable baseline for most normal devices.
- Missing device integrity verdict: Treat as suspicious or require manual review.
- Failed integrity request: Retry carefully, then create a risk flag if still failing.

### Flutter Integration Shape

Flutter should call Android native code through a platform channel.

```dart
import 'package:flutter/services.dart';

class DeviceIntegrityService {
  static const MethodChannel _channel = MethodChannel('emi_shield/play_integrity');

  static Future<String> requestIntegrityToken({
    required String requestHash,
  }) async {
    return await _channel.invokeMethod<String>(
      'requestIntegrityToken',
      {'requestHash': requestHash},
    ) ?? '';
  }
}
```

The Android native layer should:

- Add the Play Integrity dependency.
- Create an integrity token request.
- Pass the backend-provided request hash/challenge.
- Return the token to Flutter.

The backend should:

- Generate a fresh challenge/request hash.
- Receive the integrity token from the app.
- Verify/decrypt the token using Google Play Integrity API.
- Evaluate the verdict.
- Store verdict metadata and risk results.

## Provisioning Integrity Flow

QR provisioning cannot run Play Integrity before the app is installed because the app does not exist yet. Integrity verification should happen immediately after provisioning, before EMI registration and consent collection proceed.

### Flow

1. Dealer scans QR provisioning code.
2. Android installs the app silently and sets it as Device Owner.
3. App launches and requests a backend challenge/auth context.
4. App generates the Play Integrity token, verifies it with auth/backend, shows a **Device Integrity Verified** screen, and then proceeds to consent collection.
5. User completes consent collection.
6. Device registration is completed on the backend.
7. Device Owner restrictions from `disallow_service.md` are applied after device registration.

### Failure Handling

If Play Integrity fails during provisioning:

- Do not proceed to consent collection.
- Do not complete device registration.
- Show a clear dealer-facing failure screen.
- Send a backend risk flag with the failed integrity reason.
- Allow retry only for temporary/network/API errors.
- Require admin review for rooted/custom-ROM/untrusted-device verdicts.

## Periodic Integrity Verification

Integrity should be verified after onboarding and throughout the loan lifecycle.

### When To Run Checks

- After first launch post-provisioning.
- After device registration.
- On app startup.
- After reboot.
- During daily heartbeat.
- Before sensitive actions such as unlock, temp unlock, policy refresh, or payment-state sync.
- After suspicious signals such as SIM change, long offline period, failed policy check, or root/hooking indicator.

### App Cron Guidance

Use a scheduled background job in the Flutter Android app to run integrity checks periodically.

Recommended implementation:

- Use Android `WorkManager` through Flutter.
- Schedule a periodic job with jitter.
- Run no more than needed to avoid quota and battery issues.
- Prefer one daily integrity check plus checks before sensitive actions.
- Use server-issued challenge/request hash for each check.
- Send the integrity token to backend for verification.
- Do not make final trust decisions only inside the app.

### Suggested Cron Behavior

```text
Job: device_integrity_check
Frequency: every 24 hours
Jitter: random delay of 0-3 hours
Network: required
Battery: not low, if possible
Retry: exponential backoff for temporary failures
```

### Cron Flow

1. Background job starts.
2. App authenticates using the device session.
3. App requests a fresh integrity challenge from backend.
4. App requests a Play Integrity token from Android native layer.
5. App sends token to backend verification endpoint.
6. Backend verifies token with Google.
7. Backend records an `IntegrityCheck`.
8. Backend creates or updates `RiskFlag` records when the verified verdict or local evidence indicates risk.
9. Backend returns integrity status, risk IDs, and any queued enforcement metadata to the app.

### Security Event API Usage

The server still supports a borrower/device-side API for recording compatibility security events. The app should use the Play Integrity verify endpoint for integrity-token based risks, and reserve the security event API for local observations that are not already represented by the verified token flow:

- Play Integrity verdict missing.
- Play Integrity verdict failed.
- Device integrity downgraded from previous known-good state.
- Repeated integrity API failures.
- Root/hooking signal detected locally.
- Device clock manipulation signal.
- Long offline period followed by suspicious state.
- Device Owner policy no longer active.
- Required restrictions missing after registration.

Endpoint:

```http
POST /app/security/event
Authorization: Bearer <user accessToken>
Content-Type: application/json
```

Request body to send to the backend:

```json
{
  "type": "DEVICE_INTEGRITY_COMPROMISED",
  "severity": "critical",
  "message": "Play Integrity verdict did not meet the required device integrity level",
  "metadata": {
    "source": "APP_CRON",
    "check": "play_integrity",
    "verdict": "missing_or_failed",
    "previousVerdict": "MEETS_DEVICE_INTEGRITY",
    "checkedAt": "2026-06-06T10:30:00Z"
  }
}
```

Required fields:

- `type`: Stable event/risk identifier, such as `ROOT_DETECTED`, `TAMPER_DETECTED`, `DEVICE_INTEGRITY_COMPROMISED`, or `APP_INTEGRITY_COMPROMISED`.
- `message`: Human-readable summary for support/admin review.

Optional fields:

- `severity`: One of `low`, `medium`, `high`, or `critical`. If omitted, backend defaults it to `medium`.
- `metadata`: Extra structured evidence from the app, Play Integrity response, or local checks.

Backend behavior:

- Finds the registered device from the authenticated user token.
- Creates a `DeviceEvent` with `eventType: "security"`.
- Creates a `RiskFlag` using `type`, `severity`, `message`, and `metadata`.
- If `severity` is `critical` and `type` is configured in `tenantPolicies.riskRules.autoLockTypes`, backend queues a `LOCK` command and the existing FCM command worker delivers the policy update.
- Marks `device.isRooted = true` when `type` is `ROOT_DETECTED`.
- Marks `device.isTampered = true` when `type` is `TAMPER_DETECTED`.
- Writes a device security audit log.

Response:

```json
{
  "success": true,
  "message": "Security event recorded",
  "data": {
    "riskFlagId": "665f6f0b6f0f6f0b6f0f6f0b",
    "status": "open"
  }
}
```

### Good Security Event Examples

#### 1. Root detected from local indicators

```json
{
  "type": "ROOT_DETECTED",
  "severity": "high",
  "message": "Root indicators detected on the device",
  "metadata": {
    "source": "APP_STARTUP",
    "signals": ["su_binary", "magisk_package"],
    "paths": ["/system/xbin/su"],
    "packageNames": ["com.topjohnwu.magisk"],
    "checkedAt": "2026-06-06T10:30:00Z"
  }
}
```

#### 2. Play Integrity verdict failed

```json
{
  "type": "DEVICE_INTEGRITY_COMPROMISED",
  "severity": "critical",
  "message": "Play Integrity verdict failed during periodic device check",
  "metadata": {
    "source": "APP_CRON",
    "check": "play_integrity",
    "deviceIntegrity": [],
    "appIntegrity": "PLAY_RECOGNIZED",
    "previousDeviceIntegrity": ["MEETS_DEVICE_INTEGRITY"],
    "requestPackageName": "com.emishield.app",
    "checkedAt": "2026-06-06T10:30:00Z"
  }
}
```

#### 3. Device Owner policy missing after registration

```json
{
  "type": "DEVICE_OWNER_POLICY_MISSING",
  "severity": "critical",
  "message": "Device Owner policy is no longer active after registration",
  "metadata": {
    "source": "POLICY_SYNC",
    "isDeviceOwnerApp": false,
    "expectedAdminComponent": "com.emishield.app/.AdminReceiver",
    "lastKnownPolicyVersion": 4,
    "checkedAt": "2026-06-06T10:30:00Z"
  }
}
```

### Risk Response Policy

Backend response should decide the next action:

- `LOW`: Log only.
- `MEDIUM`: Warn dealer/admin and increase monitoring.
- `HIGH`: Mark device as tampered and require admin review.
- `CRITICAL`: Move device to restricted/locked state according to tenant policy.

## Implementation Notes

- Use backend server time for all risk timestamps and EMI calculations.
- Store the last successful integrity check timestamp.
- Store last known integrity verdict.
- Compare every new verdict against the previous verdict.
- Avoid frequent integrity requests; use event-driven checks for sensitive actions.
- Keep local root checks as supporting evidence, not final proof.
- Make risk flags idempotent to avoid spamming duplicate alerts.
- Include enough metadata for admins to understand what changed.
