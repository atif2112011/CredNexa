# Disallow Service

This document lists the Device Owner restrictions planned for the EMI security app.

## Baseline Restrictions

After the app is installed through QR provisioning and becomes the Device Owner, apply these restrictions:

- Factory reset
- Safe boot / safe mode
- Debugging features / ADB
- Add user
- Remove user
- Install unknown sources
- Date/time configuration

## Flutter Integration

Flutter cannot apply Device Owner restrictions directly from Dart. Create a platform channel and apply the restrictions in the Android native layer using `DevicePolicyManager`.

### Dart Call

```dart
import 'package:flutter/services.dart';

class DisallowService {
  static const MethodChannel _channel = MethodChannel('emi_shield/device_policy');

  static Future<void> applyBaselineRestrictions() async {
    await _channel.invokeMethod('applyBaselineRestrictions');
  }
}
```

### Android Native Mapping

```kotlin
private fun applyBaselineRestrictions() {
    val devicePolicyManager = getSystemService(DevicePolicyManager::class.java)
    val adminComponent = ComponentName(this, EmiDeviceAdminReceiver::class.java)

    val emiRestrictions = listOf(
        UserManager.DISALLOW_FACTORY_RESET,
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_DEBUGGING_FEATURES,
        UserManager.DISALLOW_ADD_USER,
        UserManager.DISALLOW_REMOVE_USER,
        UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
        UserManager.DISALLOW_CONFIG_DATE_TIME
    )

    emiRestrictions.forEach { restriction ->
        devicePolicyManager.addUserRestriction(adminComponent, restriction)
    }
}
```

## Notes

- Use server time for EMI/payment decisions instead of relying only on device time.
- Test these restrictions on target OEM devices because policy behavior can vary by Android version and manufacturer.
- Keep the baseline focused so normal users can still use Wi-Fi, mobile data, Bluetooth, camera, Play Store, Google accounts, calls, and messaging.
