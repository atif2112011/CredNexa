# Kiosk Mode Locking

## Purpose

EMI Shield should use Android kiosk mode for hard device locking.

When the backend device state becomes `LOCKED`, the Flutter app must enter kiosk mode and show a full-screen lock/payment screen. Kiosk mode should prevent the user from leaving EMI Shield and using the phone normally until the device state changes.

## When To Enable Kiosk Mode

Enable kiosk mode when:

- `devices.state` is `LOCKED`.
- The app receives a backend state update showing `LOCKED`.
- The background state listener fetches `LOCKED`.
- The app starts/restarts and the last known or freshly fetched state is `LOCKED`.

Disable kiosk mode when:

- `devices.state` changes from `LOCKED` to `ACTIVE`.
- `devices.state` changes from `LOCKED` to `TEMP_UNLOCK`.
- Backend sends an approved unlock/temp-unlock state.
- A testing/debug-only disable button is pressed in non-production builds.

## Lock Screen UI

When kiosk mode is active, show a full-screen lock screen with this message:

```text
Your device has been locked.
Pay EMI dues to unlock.
```

The screen must show:

- Current due amount.
- `Pay EMI` button.
- `Request Temp Unlock` button.
- Testing/debug-only `Disable Kiosk` button.

Suggested UI data:

```json
{
  "deviceState": "LOCKED",
  "dueAmount": 2500,
  "currency": "INR",
  "nextAction": "PAY_EMI"
}
```

## User Actions

### Pay EMI

The `Pay EMI` button should:

- Open the EMI payment flow inside the EMI Shield app.
- Keep the user inside kiosk mode during payment unless the approved payment flow requires a trusted external app.
- Sync payment status after payment completion.
- Disable kiosk mode only after backend confirms the device state is no longer `LOCKED`.

### Request Temp Unlock

The `Request Temp Unlock` button should:

- Call the backend temp-unlock request API.
- Show request status on the lock screen.
- Keep kiosk mode active until backend approves the request.
- Disable kiosk mode only after backend returns `TEMP_UNLOCK`.

### Disable Kiosk

The `Disable Kiosk` button is only for testing/debugging.

Requirements:

- Show only in debug/internal builds.
- Hide completely in production builds.
- Add a confirmation dialog before disabling.
- Log the action locally and on the backend if possible.
- Call the native Android method to stop kiosk mode.

## State Listener

The app must have a background state listener that keeps the local device state synced with the backend.

Responsibilities:

- Fetch current device state in the background.
- Immediately enable kiosk mode if fetched state is `LOCKED`.
- Immediately disable kiosk mode if fetched state is `ACTIVE` or `TEMP_UNLOCK`.
- Persist the last known device state locally.
- Restore kiosk mode after app restart or device reboot if the last known state is `LOCKED`.

Recommended triggers:

- App launch.
- App resume.
- Periodic background sync.
- FCM/data push received.
- Device reboot.
- Network reconnect.
- Payment completion.
- Temp unlock request status change.

## Background Sync Behavior

Suggested behavior:

```text
If state == LOCKED:
  open LockScreen
  start kiosk mode

If state == ACTIVE:
  stop kiosk mode
  allow normal app/device use

If state == TEMP_UNLOCK:
  stop kiosk mode
  show temp unlock countdown/status
```

The app should prefer push updates for fast locking, but still poll periodically as a fallback.

## Android Native Requirements

Flutter cannot fully manage kiosk mode directly. Use a platform channel and implement kiosk mode in the Android native layer.

Native Android must support:

- Configure lock task packages.
- Start lock task mode.
- Stop lock task mode.
- Restore kiosk after reboot if needed.

Example native responsibilities:

```kotlin
devicePolicyManager.setLockTaskPackages(
    adminComponent,
    arrayOf("com.yourcompany.emishield")
)
```

Start kiosk mode from the lock activity:

```kotlin
startLockTask()
```

Stop kiosk mode:

```kotlin
stopLockTask()
```

## Flutter Platform Channel Shape

Suggested Dart service:

```dart
import 'package:flutter/services.dart';

class KioskService {
  static const MethodChannel _channel = MethodChannel('emi_shield/kiosk');

  static Future<void> configureKioskMode() async {
    await _channel.invokeMethod('configureKioskMode');
  }

  static Future<void> startKioskMode() async {
    await _channel.invokeMethod('startKioskMode');
  }

  static Future<void> stopKioskMode() async {
    await _channel.invokeMethod('stopKioskMode');
  }
}
```

## Reboot Handling

Kiosk mode does not automatically resume by itself after reboot. Device Owner status and lock task package configuration persist, but the app must start again and call `startLockTask()`.

Implementation requirements:

- Register for boot completed events on Android.
- On reboot, start/schedule the app state restore flow.
- Fetch backend state if network is available.
- Fall back to last known local state if network is unavailable.
- If state is `LOCKED`, open the lock screen and start kiosk mode.

## Safety Notes

- Do not trust local state alone for unlocking.
- Only backend-confirmed state changes should disable kiosk in production.
- Keep debug disable hidden in release builds.
- Ensure emergency calling/support access is available according to product/legal requirements.
- Pair kiosk mode with `DISALLOW_SAFE_BOOT` and `DISALLOW_DEBUGGING_FEATURES` from `disallow_service.md`.
