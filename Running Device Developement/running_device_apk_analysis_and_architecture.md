# Running-device enrollment: APK analysis and suggested implementation options

**Prepared:** 5 October 2026  
**Photo addendum:** 8 October 2026  
**Audience:** EMI Shield backend, Android, tenant-app, QA, and product developers  
**Sample:** `C:\Users\HP\Downloads\king_locker_running_app.apk`  
**SHA-256:** `59DFC34CB73D3E59FE8AEBD6F97616F1C653A439E35817A1AB43E0D745471D6C`

> **Status — research and suggestions, not the final implementation plan.** The static APK findings describe the inspected sample; the EMI Shield architecture, Android flow, API shapes, test ideas, and implementation order in this document were exploratory recommendations prepared before the running-device backend was implemented. They are not approval to copy the sample or a contract for developers. For current product decisions use the [master plan](master%20plan.md); for implemented borrower endpoints, request bodies, responses, JWT authentication, and command acknowledgements use the [running APK backend API contract](running%20apk%20backend%20api%20contract.md). An early installation-key/challenge design was considered and **not implemented**. The current backend follows the existing borrower JWT convention for both device types.

> **Current app handoff:** The [Running Device APK development plan](Running%20Device%20APK%20development%20plan.md) uses an in-app scanner for the running QR displayed from the dealer's borrower-list **Generate QR** action. Scan and preview come first, then manual IMEI entry, the permissions screen, OTP/consent, and final activation. The running QR carries an enrollment code; it is not the Android setup QR and does not grant Device Owner. The running APK skips Play Integrity during onboarding and regular operation; the server reserves its four Integrity endpoints for owner-provisioned devices. Any different order, link-sharing, or running Play Integrity proposal below was an earlier suggestion, not the current app handoff.

## 1. Initial interpretation in one page

This analysis suggested a **separate, clearly identified running-device borrower app** that reuses EMI Shield's borrower, consent, payment, case, command, and audit services. The subsequent product/backend contract chose `RUNNING_APP` enrollment and app-controlled lock/reminder overlays. The running lock overlay can contain **Pay Now** and **Temp Unlock** buttons that open the existing borrower payment and unlock-request screens; an approved temporary unlock clears the overlay until the existing server deadline and expiry relock. The final CredNexa decision is to request Device Admin solely to make normal uninstall require prior user deactivation; declining it does not block enrollment. The new APK does **not** call `lockNow()`. A normal installed app cannot deliver the same whole-device kiosk, permanent uninstall block, factory-reset control, package suspension, or persistent policy enforcement as a fully managed Device Owner app.

The supplied APK demonstrates how a competing/other app assembles permissions: a user-facing permission screen opens Android settings for Device Admin, Accessibility, Usage Access, overlay, write settings, and battery optimization; FCM and SMS handlers trigger a foreground lock service; the service repeatedly displays a lock activity and adds screen overlays. It also bundles a large amount of Device Owner/TestDPC-like code. **The Device Owner methods in the APK do not become available just because the APK requests permissions or is installed on a running phone.** Android's fully managed provisioning is a separate ownership flow, normally on a new or factory-reset device. [Android Enterprise provisioning](https://developer.android.com/work/dpc/dedicated-devices), [Device Admin activation](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#ACTION_ADD_DEVICE_ADMIN).

The current running-device design retains the useful parts of that proposal: enrollment on an already set-up phone, borrower OTP/consent, JWT-authenticated app calls, FCM-triggered reconciliation, payments/support, and permission health. It asks the borrower to enter IMEI 1 and IMEI 2 manually (or declare a true single-IMEI phone) to reuse inventory fields. Those entries are not verified by Android and must not authenticate the app. Treat missing permissions, force-stop, uninstall, offline state, and factory reset as **loss of assurance**, not as a proven locked state.

## 2. Scope and evidence standard

This was a **static, read-only inspection** of the APK ZIP, binary Android manifest and XML resources, DEX class/method metadata, method invocation references, Retrofit annotations, and APK signing-block certificate metadata. The APK was not installed or executed, and its server was not contacted. No physical-device behavior, successful permission grant, network response, or security property was verified dynamically. DEX observations below mean a call or string occurs in bytecode; they do not prove that the path succeeds on any Android version or OEM build.

Text inside `assets/terms_condition.html` and app strings was treated as **sample content**, not as instructions or as EMI Shield's consent contract. The file says “EMI SAFE” and contains claims about uninstallability; neither claim establishes Android capability or a requirement for our app. Our governing project rules are in [`context.md`](../context.md), [`architecture.md`](../architecture.md), and the current backend code.

Confidence labels used below:

- **Observed:** manifest, resource, method reference, or annotation directly extracted from this exact APK.
- **Platform fact:** Android/Google documentation linked near the statement.
- **Inference:** plausible behavior from the observed call graph, unverified at runtime.
- **Recommendation:** proposed EMI Shield design, not something found in the APK.

## 3. APK identity and build posture

| Property | Static result |
|---|---|
| Manifest package | `com.solutions.runningapp` |
| Label resource | `King Locker` (`@string/app_name`) |
| Version | `versionCode=5`, `versionName=1.4` |
| SDK | `minSdkVersion=26`, `targetSdkVersion=34`, compile SDK 34 |
| Layout | 17 DEX files, 1,224 ZIP entries, no `lib/` native libraries |
| UI/runtime framework evidence | Android `activity`/`services`/`receiver` classes are present; no `libflutter.so` or `flutter_assets` entries were found in the APK ZIP. This sample appears to be a native Android app, not a Flutter build. |
| Declared permissions | 76 `<uses-permission>` entries, 67 unique; several repeated |
| Components | 27 activities, 23 services, 17 receivers, 4 providers, 1 activity alias |
| Build flags | `android:debuggable=true`, `android:allowBackup=true`, `android:usesCleartextTraffic=true` |
| Signing metadata | APK Signing Block v2 contains a certificate with subject `C=US,O=Android,CN=Android Debug`; certificate SHA-256 `5FEABA4F8922442B4211FC2619D98CB891EE37E6C2BDE383788ABF840B595671` |

The signing block was parsed for certificate metadata; its cryptographic signature was **not independently verified**. The debug build/certificate and cleartext flag make this sample unsuitable as a production foundation. The APK also includes a Retrofit `HttpLoggingInterceptor`; the static method reference alone does not establish its configured logging level. Review the source/build pipeline before using any of its implementation patterns.

The package includes many `com.solutions.runningapp.policy`, `DevicePolicyManagerGateway`, COSU, provisioning, and `TestDPC` strings. This is strong evidence of TestDPC-derived or sample enterprise-management code being bundled. It is **not** evidence that this installation becomes Device Owner. The APK's custom running-device flow is concentrated in `activity`, `services`, `receiver`, `network`, and `util` classes. The absent Flutter runtime/assets and these Android classes support a native-Android implementation finding; static ZIP inspection does not identify every UI library used inside the app.

## 4. How this APK asks for access

The actionable permission journey is in `com.solutions.runningapp.activity.PermissionActivity` and its click listeners:

| Access | Observed request/check | What a normal installed app receives |
|---|---|---|
| Device Admin | Opens `android.app.action.ADD_DEVICE_ADMIN` with `android.app.extra.DEVICE_ADMIN`; checks `DevicePolicyManager.isAdminActive()` | User may activate a legacy Device Admin. This **does not** grant Device Owner. `force-lock` and declared Device Admin policies become available within their documented scope. |
| Accessibility | Opens `android.settings.ACCESSIBILITY_SETTINGS`; checks `enabled_accessibility_services` | User must enable the declared service. A sideloaded app may additionally require **App info → ⋮ → Allow restricted settings** before Android permits service activation; see the manual steps in §5.2. The service can observe/interact with permitted UI but is not a dependable system-policy authority. |
| Usage Access | Opens `android.settings.USAGE_ACCESS_SETTINGS`; checks AppOps `android:get_usage_stats` | User grants special access to usage data. The app can infer foreground usage; it cannot intrinsically block another app. |
| Draw over other apps | Opens `android.settings.action.MANAGE_OVERLAY_PERMISSION`; checks `Settings.canDrawOverlays()` | User grants `SYSTEM_ALERT_WINDOW`. The app can display allowed overlays, subject to Android's UI and background restrictions. |
| Write system settings | Opens `android.settings.action.MANAGE_WRITE_SETTINGS`; checks `Settings.System.canWrite()` | User grants only the supported `Settings.System` changes. This is not `WRITE_SECURE_SETTINGS` or Device Owner. |
| Ignore battery optimization | Opens `android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; checks `PowerManager.isIgnoringBatteryOptimizations()` | User may grant an exception, subject to platform and distribution rules; it does not make an app immortal. |
| Runtime permissions | Requests phone/call-related runtime access; registration code also contains location, SMS, contacts, storage and camera names | Each request remains subject to the actual manifest, Android version, role, and user decision. A string in bytecode does not grant the permission. |
| Notifications | `SplashActivity` references `POST_NOTIFICATIONS` | On Android 13+, notification display requires the runtime grant for non-exempt notifications. |

<a id="photographed-checklist-and-emi-shield-enrollment-decision"></a>

### Photographed checklist and suggested grant triage

The user-provided [upper photo](reference/permission_checklist_top.jpeg) and [lower photo](reference/permission_checklist_bottom.jpeg) show a running-phone app's **App Permissions** screen. Together they show ten rows. **Write Setting** has a green tick; the other nine have red crosses. These icons are the app's own UI and do not independently verify Android grants. The photos do not reveal which Android screen each row opens, what **Runtime Permission** contains, whether **Battery Optimization** differs from **Battery Power Usage**, or whether **Continue** actually blocks completion. They also do not establish the package identity of the pictured app. The APK bytecode observations in the preceding table are separate evidence.

| Pictured row | Interpretation and EMI Shield running-app decision |
|---|---|
| Battery Optimization | Likely an Android Doze/battery-exemption journey; the photo alone does not identify the request or grant. **Optional**, never a blanket enrollment gate. Use FCM and scheduled recovery first. A power exemption is user-controlled and does not guarantee delivery. |
| Runtime Permission | Too broad to implement as one checkbox. Split into named requests: `CAMERA` only if the app itself scans the QR, `POST_NOTIFICATIONS` on Android 13+ for reminders, and location only for an eligible Get location feature. Manually entered IMEIs do **not** justify phone-state access. Do not carry over the sample APK's SMS, contacts, call, or storage requests without a separate approved feature. |
| Overlay Permission | Maps to **Draw over other apps** / `SYSTEM_ALERT_WINDOW` if the app uses the agreed pending/upcoming EMI overlay with sound. **Required for that first-release presentation**, checked with `Settings.canDrawOverlays()` after returning from system settings and again at delivery. Android may still block a particular presentation, so use one notification fallback and report the actual result. |
| Usage Access Permission | Gives access to usage statistics; it is **not needed** for the agreed lock, unlock, reminders, location, or release. Do not request or block enrollment on it. It does not grant Device Owner control. |
| Device Admin Permission | Request during onboarding to add a deactivation step before ordinary uninstall. Check `isAdminActive()` on return, but allow enrollment if declined. Do not declare `force-lock` or call `lockNow()`. Borrowers can later deactivate admin access and uninstall; this is not Device Owner uninstall blocking. |
| Battery Power Usage | Label is ambiguous from the photo and may refer to an OEM power-management screen rather than a distinct Android permission. **Optional guidance only** unless its click target and benefit are established for a supported OEM; never mark it granted from a tap alone. |
| Write Setting | The photo shows a green tick. `WRITE_SETTINGS` / `Settings.System.canWrite()` allows supported system-settings changes; it is **not required** to play a reminder sound or implement the five agreed controls. Do not request it for EMI Shield merely because the sample app did. |
| Accessibility Permission | The inspected APK uses Accessibility to watch and obstruct parts of the system UI. EMI Shield's agreed controls do **not** require it. Do not request it or use it to interfere with security settings, permission revocation, or uninstall. |
| Auto Start | Typically an OEM-specific power/startup setting, not one standard Android runtime grant. **Optional help text**, not an enrollment gate. The app cannot truthfully promise background execution from a green tick here. |
| Location Permission | **Conditional**: require the supported foreground location grant only when the specific build/tenant offers Get location and its consent/distribution policy is settled. Keep the action unavailable when the grant is absent or revoked. Do not silently request background location as part of a generic checklist. |

The screenshot has no separate **Notifications** row. The current backend's activation check requires a fresh report with `notificationsAllowed: true` and `overlayAllowed: true`; it does not require Device Admin, Accessibility, Usage Access, Write Settings, battery exemptions, OEM Auto Start, or location. The CredNexa APK nevertheless requests Device Admin for normal-uninstall friction and records its true state; a refusal does not block enrollment. Location is optional and separately consented/gated for Get location. QR camera access is needed only if the app uses its own camera scanner. Recheck grants at final OK and after enrollment. A revoked grant changes capability/allowed actions and delivery outcomes; it does not retroactively turn the device into a Device Owner or erase enrollment. See the [live API contract](running%20apk%20backend%20api%20contract.md#38-post-apiappdevicecapabilities) for the exact fields.

### Flutter versus native Android permission ownership for the new EMI Shield app

**The inspected King Locker APK is native Android.** Its `PermissionActivity` launches Android intents and reads Android grant state directly; there is no evidence that it requests access from Flutter/Dart. For a **new Flutter-built EMI Shield running app**, Flutter can render the checklist, explanation, buttons, loan screens, and enrollment flow, but permissions are granted by **Android to the installed app package**, not “at Flutter level.” A Flutter plugin calls Android APIs underneath; where a plugin does not cover the exact behavior, a Flutter [platform channel](https://docs.flutter.dev/platform-integration/platform-channels) should call Kotlin/Java in the app's `android/` module. Android manifest entries, service/receiver declarations, settings screens, grant checks, and OS restrictions still apply. Do not mark a row granted because a Dart button was tapped or a settings Activity returned.

| Access or capability | Needed for agreed first release? | Flutter/Dart responsibility | Android-native responsibility and authoritative check |
|---|---|---|---|
| Notification display | **Yes** where Android requires it; backend currently requires `notificationsAllowed: true` at activation | Explain and request through a notification/FCM plugin; show the returned status and handle a denial | Declare `POST_NOTIFICATIONS` for Android 13+; Android presents the runtime grant. Verify the current notification permission/app notification state. FlutterFire's `requestPermission()` invokes this platform flow; FCM receipt alone does not prove that a notification appeared. [FlutterFire permission guide](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages#request_permission_to_receive_messages) |
| Draw over other apps and the lock/reminder overlay | **Yes** for the chosen running lock and pending/upcoming reminder presentation; backend requires `overlayAllowed: true` at activation | Show why access is needed, open the special-access flow through a plugin/platform channel, and display current status. A normal in-app details/payment screen may be Flutter. | Declare `SYSTEM_ALERT_WINDOW`; open `ACTION_MANAGE_OVERLAY_PERMISSION`, then call `Settings.canDrawOverlays()` after return and before each presentation. A Kotlin/Java service plus `WindowManager`/`TYPE_APPLICATION_OVERLAY` is the recommended implementation for an overlay that must appear while the Flutter UI is backgrounded. A plugin can wrap this native code; the grant and window remain Android features. [Android overlay grant](https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context)), [overlay window type](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY) |
| QR camera | **Only if** the borrower scans inside the app | A Flutter camera/QR plugin can display the scanner and request/check camera access | Declare `CAMERA` and let Android issue the runtime grant. A verified app link avoids the camera request entirely. |
| On-demand location | **Conditional**, only when tenant/product policy and separate borrower consent allow it | A Flutter location plugin can request foreground access and display the result/denial | Declare the chosen coarse/fine location permissions; Android owns the grant and may limit precision/background use. The native plugin checks current grant and obtains a fix. Report actual fix time and accuracy; never infer access from consent alone. [Android location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions) |
| Device Admin for normal-uninstall friction | **Request, but do not require for activation** | Explain that active admin access adds a deactivation step before normal uninstall; show its real status and allow refusal | Implement `DeviceAdminReceiver` and policy metadata in Android; launch `ACTION_ADD_DEVICE_ADMIN`, verify `isAdminActive()` on return, and remove the app's admin on authorized release. No `force-lock` policy or `lockNow()` call. This is not a Flutter runtime permission or Device Owner. [Android Device Admin](https://developer.android.com/work/device-admin) |
| Accessibility and Usage Access | **No** | Do not add them to the required checklist | If a future approved feature truly needs them, Android requires a declared `AccessibilityService` and user-enabled settings, or `UsageStatsManager`/AppOps and the Usage Access settings screen. Dart cannot grant either. Do not copy the sample's anti-disable behavior. |
| Write Settings | **No** | Do not request it for reminder sound or the agreed controls | `WRITE_SETTINGS` is Android special access, checked through `Settings.System.canWrite()`; it does not provide `WRITE_SECURE_SETTINGS`. |
| Battery exemption, Battery Power Usage, OEM Auto Start | **No**, optional troubleshooting only | Explain OEM-specific guidance if evidence shows it helps | Android `PowerManager`/Settings or OEM screens determine the result. Auto Start has no one standard Android permission or reliable cross-OEM grant check. None guarantees uninterrupted operation. [Doze and standby guidance](https://developer.android.com/training/monitoring-device-state/doze-standby) |

**Background command handling:** FlutterFire can receive an FCM background message, but its background handler runs in a separate isolate without a UI context and should not directly draw a Flutter screen. Use the push as a wake-up signal, reconcile the command with the backend, and hand presentation to the Android overlay/notification implementation; report the real result. Android force-stop can still prevent delivery until the borrower opens the app again. [FlutterFire background-message guidance](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages#background_messages), [Android background activity limits](https://developer.android.com/guide/components/activities/secure-bal).

Platform references: [notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission), [overlay grant](https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context)), [Device Admin activation](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#ACTION_ADD_DEVICE_ADMIN), [active-admin uninstall behavior](https://android.googlesource.com/platform/frameworks/base/+/a38d32bb09756370c5c28d210a051415e85e0be2/packages/PackageInstaller/res/values/strings.xml), [write-settings grant](https://developer.android.com/reference/android/provider/Settings.System#canWrite(android.content.Context)), [battery optimization guidance](https://developer.android.com/training/monitoring-device-state/doze-standby), [location permission design](https://developer.android.com/develop/sensors-and-location/location/permissions), and [Google Play Accessibility policy](https://support.google.com/googleplay/android-developer/answer/18258653).

The Android manifest binds `com.solutions.runningapp.DeviceAdminReceiver` with `BIND_DEVICE_ADMIN` and `@xml/device_admin_receiver`. That XML declares `force-lock`, `disable-camera`, `wipe-data`, password policies, and other legacy Device Admin policies. It binds `RestrictedMonitorService` with `BIND_ACCESSIBILITY_SERVICE` and `@xml/accessibility_service_config`; the service requests broad event types and window-content retrieval. These declarations are **capability requests**, not proof of a successful grant. They also do not override version-specific limits: `setCameraDisabled()` is denied/ignored for a modern-target legacy admin, and `wipeData()` on the primary user throws for apps targeting Android 14 (API 34) or later. The newer whole-device `wipeDevice()` requires Device Owner or an eligible organization-owned Profile Owner. [Android camera policy](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setCameraDisabled(android.content.ComponentName,%20boolean)), [Android wipe APIs](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#wipeData(int)).

On Android 13+, a sideloaded app can encounter Restricted Settings before a user can enable some sensitive services. Do not automate or obscure this OS decision. [Android Restricted Settings help](https://support.google.com/android/answer/12623953), [Android Device Admin guide](https://developer.android.com/work/device-admin).

### Permissions that look powerful but do not make a normal app privileged

The manifest names `READ_PRIVILEGED_PHONE_STATE`, `WRITE_SECURE_SETTINGS`, `INSTALL_PACKAGES`, `DELETE_PACKAGES`, `REBOOT`, `MANAGE_DEVICE_ADMINS`, `MANAGE_FACTORY_RESET_PROTECTION`, `INTERNAL_SYSTEM_WINDOW`, `REAL_GET_TASKS`, `DUMP`, `MANAGE_DEVICE_POLICY_LOCK_TASK`, and other privileged/system permissions. A third-party APK does not gain these powers by declaring them. Android 10+ specifically restricts IMEI and other persistent identifiers; Device Owner or certain special roles are exceptions. The sample registration flow asks for an IMEI and declares `READ_PRIVILEGED_PHONE_STATE`, but a normally installed running-device app targeting SDK 34 should **not** be designed around reading IMEI from Android. The chosen borrower-entry flow is different: it records a typed claim that the app cannot independently verify. [Android 10 identifier restrictions](https://developer.android.com/about/versions/10/privacy/changes#non-resettable-device-ids), [TelephonyManager reference](https://developer.android.com/reference/android/telephony/TelephonyManager).

## 5. Observed control paths in the APK

### 5.1 Remote command and lock path

`services.FirebaseMessanging.onMessageReceived()` examines FCM data strings including `LApp`, `UnLApp`, `remind`, `GetLocation`, and `GetUserPhoneNumber`. Its `sendLockCommand(boolean)` starts `LockService`, calls `DevicePolicyManager.lockNow()` when admin is active, and updates local flags `should_lock` / `lock_triggered`. `services.LockService` starts a foreground notification, launches `FinanceLockActivity`, persists `shouldLock` in `LockPrefs`, and adds overlays at the top and navigation-bar areas. `FinanceLockActivity` tries to remain visible through screen-state callbacks, immersive UI flags, task movement, and relaunch on pause/destroy.

This is a **layered best-effort lock presentation**. `lockNow()` itself immediately locks the screen; it does not make a durable finance kiosk or let the lender remotely clear the borrower's system PIN. Launching an activity from FCM/service/background and keeping it over other apps is version- and OEM-sensitive. Modern Android limits background activity starts and foreground-service starts, including additional Android 14 requirements. [DevicePolicyManager `lockNow`](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()), [background activity launch restrictions](https://developer.android.com/guide/components/activities/secure-bal), [foreground-service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

**Kiosk, overlay, and extra screen:** The sample's `FinanceLockActivity` may look kiosk-like because it uses immersive flags and relaunch attempts, while `LockService` also adds overlays. The static analysis does **not** prove managed Android lock-task mode for a normally installed copy or document whether its lock layout contains a payment button. Managed kiosk/lock-task mode requires device-policy allowlisting and can restrict leaving approved apps; a `TYPE_APPLICATION_OVERLAY` window is a revocable app window above ordinary activities but below critical system UI. [Android lock task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode), [Android overlay windows](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY).

For EMI Shield's **new** running app, make the lock overlay interactive: Pay Now opens the existing QR/proof screen and Temp Unlock opens the existing unlock-request screen. Keep those screens usable while the EMI restriction is active and restore the overlay when the borrower returns, unless the backend has authorized a full or timed unlock. `TEMP_UNLOCK` must be tied to `tempUnlockExpiresAt`; a local deadline restores the overlay during offline periods, and the shared backend expiry job queues `LOCK` on reconnect. This is a product implementation decision, not behavior proven in the sample APK.

For EMI Shield's new app, the overlay can contain touchable **Pay EMI**, **View dues**, and **Contact support** buttons. It may expand to an additional overlay panel, or a tap can open a normal Flutter Activity/screen. If opening an Activity, remove or hide the overlay while that screen is visible so the overlay does not cover its own controls; when the user returns, sync the latest server policy before restoring any restriction. A notification tap can provide the same route if an overlay cannot be shown. This is a proposed UI design, not an observed button in the sample APK or a new backend control. Android restricts unsolicited background Activity launches, so use a borrower tap or notification interaction and test the flow on supported Android/OEM versions. [Android background Activity limits](https://developer.android.com/guide/components/activities/secure-bal), [notification-to-Activity navigation](https://developer.android.com/develop/ui/views/notifications/navigation).

### 5.2 Settings monitoring and anti-disable path

`services.RestrictedMonitorService` reads Accessibility events and window text. Its bytecode includes terms for admin removal, Accessibility settings, uninstall, force-stop, reset, Play Protect, usage access, and overlay settings; it calls `performGlobalAction()`, displays a touch-blocking overlay, and attempts to move the user away from some settings screens. This is **observed code**, not a recommended EMI Shield feature. It is brittle across languages/OEM UI and conflicts with the user-control boundary a normally installed app must respect. Google Play's Accessibility policy forbids using that API to work around platform security/privacy controls or prevent disabling/uninstalling except within stated authorized management exceptions; any Accessibility use also requires appropriate declaration, disclosure, and consent. [Google Play Accessibility policy](https://support.google.com/googleplay/android-developer/answer/16558241).

The code contains stale identity strings (`Qaswa`, `com.lock.runningapp`) while the manifest package is `com.solutions.runningapp`. That mismatch further reduces confidence in its anti-disable detection. The strings `TestDPC` and `EMISAFE` appear elsewhere, reinforcing that multiple codebases/brands were combined.

**Accessibility and Allow restricted settings — manual troubleshooting:** Android 16 includes Accessibility and Display over other apps among restricted settings for covered downloaded/local-file installs. On 13 October 2026, the user confirmed that manually allowing restricted settings resolved the overlay denial on their Android 16 phone. That is a user-tested permission troubleshooting result; separate Accessibility activation has not been verified. For a trusted sample or a future approved Accessibility feature:

1. Open **Settings → Apps → See all apps → the app** to reach **App info**.
2. Tap **⋮ → Allow restricted settings** and complete Android's confirmation if the user trusts the app and chooses to proceed.
3. Return to **Settings → Accessibility → Downloaded apps / Installed apps / Installed services**, select the app's service, and enable it explicitly. Labels vary by OEM.
4. Return to the APK and verify that its specific service is enabled. Allowing restricted settings does not automatically grant Accessibility or overlay; the overlay switch must be granted separately in **Special app access → Display over other apps**.

If the App info menu lacks **Allow restricted settings**, attempt the blocked service/special-access switch to display the denial warning, then reopen App info. The stock Android denial dialog makes the app eligible for the clearance action. If the option remains unavailable, investigate the device's policy/OEM behavior. This guidance does not add Accessibility to CredNexa's required permissions or justify copying the sample's Settings-obstruction behavior. See the [permission assessment](Running%20APK%20permission%20assessment.md) for the APK-handler trace and the distinction between the original bottom-to-top observation and the confirmed manual resolution. [Android Restricted Settings help](https://support.google.com/android/answer/12623953), [Android 16 compatibility rules](https://source.android.com/docs/compatibility/16/android-16-cdd), [denial-dialog implementation](https://android.googlesource.com/platform/packages/modules/Permission/+/5693f485645dfc06571b9400a6d0cf4aa6c48b52/PermissionController/src/com/android/permissioncontroller/ecm/EnhancedConfirmationDialogActivity.kt)

### 5.3 Device Owner-only paths mixed into the sample

`PermissionActivity$ApplyAppPolicies` and `RegisterActivity$ApplyAppPolicies` reference `setUninstallBlocked`, `setLockTaskPackages`, and `addUserRestriction`. Other custom classes reference `setApplicationHidden`, `setStatusBarDisabled`, reboot, and package/home-policy APIs. Several of these require Device Owner or a qualifying Profile Owner/privileged role and will fail or be ineffective under ordinary Device Admin. The sample has a separate Device Owner provisioning surface (`GetProvisioningModeActivity`, `FinalizeActivity`, Device Owner services); that does not upgrade a running-device install. [Android Enterprise device control](https://developer.android.com/work/dpc/device-management.html), [`setLockTaskPackages` API requirements](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setLockTaskPackages(android.content.ComponentName,%20java.lang.String[])).

### 5.4 Boot, SMS, location, and phone data

- `receiver.BootcompleteReceiver` reads `LockPrefs.shouldLock` and starts the lock service on `BOOT_COMPLETED`. This is recovery logic, not a guarantee after force-stop or OEM power management.
- `receiver.SMSreceiver` parses `LOCK ME` / `UNLOCK ME` and compares sender details before invoking a lock command. SMS is not an appropriate secure command channel for EMI Shield: sender identity can be unreliable, sensitive SMS permissions face strict distribution restrictions, and the command lacks EMI Shield's authenticated, audited server workflow. [Google Play SMS/Call Log policy](https://support.google.com/googleplay/android-developer/answer/10208820).
- `services.LocationForegroundService` and `services.GetContactForegroundService` include location and SIM-phone-number collection paths. The latter accesses `SubscriptionManager`/`SubscriptionInfo`, rather than proving full contact-book collection. The APK's registration class nonetheless contains contact permission strings. Do not carry over broad data collection without a specific, disclosed requirement.
- `services.FirebaseMessanging.completelyRemoveApp()` removes active Device Admin and opens Android screens to disable special accesses/uninstall. This suggests a release path but does not establish that it works unattended on current Android.

### 5.5 Network protocol observed in the APK

The Retrofit base URL string is `https://king.emirakshak.com/api/`. `network.ApiInterface` annotations expose:

| Method | Path | Role inferred from names/callers |
|---|---|---|
| `POST` | `device/enroll_device_by_imei` | Register a device, including `imei`, `fcm_token`, `agent_code`, `key`, and `is_running=Y` in `RegisterActivity.onSubmitClick()` |
| `GET` | `device/data/{userId}` | Fetch agent/device data for the lock screen |
| `PUT` | `device/location` | Upload location |
| `PUT` | `users/postUserContactNo` | Upload SIM number/carrier data |
| `POST` | `users/token` | Update a user/device push token |
| `PUT` | `device/update_token` | Update another token used by the app |

`ApiClient` adds `Package-Id`, `Package-Hash`, `Device-Id`, and `Client-Time` headers. These are client-originated values; they should not be treated as a substitute for borrower authentication or a server-verified device binding. This URL and protocol belong to the sample and should **not** be integrated into EMI Shield.

### 5.6 Sample APK concerns to avoid copying

| Observation | Why it matters for a new app |
|---|---|
| Debuggable, Android Debug certificate, backup enabled | Use a release build, production signing, and explicit backup rules for secrets and device state. |
| Cleartext traffic permitted | Require HTTPS; reject non-TLS endpoints in release builds. |
| 67 unique declared permissions, including broad SMS/phone/storage/package permissions | Request only the minimum needed for a defined EMI Shield feature and distribution channel. Google Play's financial-app rules may restrict several of these if the app falls within the personal-loan/facilitator category. [Financial Services policy](https://support.google.com/googleplay/android-developer/answer/9876821). |
| `FirebaseMessanging`, `LockService`, `PreventUserService`, many receivers and a content provider are exported | Review every exported component, protect any required external entry point with permissions or validation, and default internal components to non-exported. Static inspection alone does not establish exploitability. |
| Duplicate manifest permissions and stale package/brand strings | Indicates merged legacy code; start a clean app module instead of repackaging this APK. |
| UI-blocking Accessibility logic | Do not imitate system prompts, obstruct security settings, or make uninstallability claims that Android cannot guarantee. |

## 6. What EMI Shield can implement on a running phone

The matrix separates a **normal install** from EMI Shield's existing **Device Owner provisioning**. “Conditional” means subject to explicit user grant, Android version, OEM behavior, and test results; it is not a contractual guarantee.

| Product action | Running app | Current Device Owner app | Proposed running-mode treatment |
|---|---|---|---|
| Borrower onboarding, consent, EMI display, payment proof, unlock request | Yes | Yes | Reuse existing backend flows with a new installation method. |
| FCM wake-up, policy fetch, command sync, offline queue | Yes, delivery is best effort | Yes, with stronger persistence | Keep FCM as a wake-up signal; always fetch server state. |
| Lock the **system screen now** | Technically possible with a declared `force-lock` policy, but excluded from the CredNexa running APK | Yes | The implemented running `LOCK` is an app overlay, with its actual result acknowledged to the server. |
| Remotely clear system PIN / remotely unlock Android keyguard | No | Not the normal meaning of EMI policy unlock | `UNLOCK` clears EMI Shield's own restriction state only. |
| Show EMI Shield's own lock/reminder overlay | Conditional on Android grant and presentation rules | Yes | This is the selected running-mode lock and pending/upcoming reminder method; report whether it was actually shown. Do not promise that it covers every app at all times. |
| Infer foreground app through Usage Access or obstruct settings with Accessibility | Conditional and fragile | Stronger DPM package controls | Not part of the selected running controls; any future use needs separate product, privacy, platform, and OEM review. |
| Suspend WhatsApp, YouTube, Play Store or hide third-party apps | No ordinary-app DPM authority | Yes, subject to managed policy | Mark unsupported for `RUNNING_APP`. |
| Block normal direct uninstall while Device Admin is active | Yes, until the borrower deactivates Device Admin | Owner policy can provide stronger controls | Request Device Admin, allow refusal, report active state, and deactivate it on authorized release. Do not claim permanent uninstall prevention. |
| Block force-stop, admin deactivation, factory reset, safe mode, USB debugging, unknown-app installs | No | Some through Device Owner policy | Mark unsupported; record lost control and inform tenant. |
| Kiosk / lock task / disable status bar / force Home launcher | No durable full-device form | Yes | Do not expose as running-mode controls. |
| Camera disable | No for a modern-target legacy Device Admin | Yes | Mark unsupported in running mode. |
| On-demand location | Conditional explicit permission and visible/background constraints | Managed capability per current contract | Separate opt-in feature; do not collect routine location in ping/sync. |
| IMEI-based device identity | Direct reading generally unavailable to normal app on Android 10+; borrower can type the displayed number | Available to qualifying owner | Keep existing `imei`/`imei2` inventory fields using borrower entry and label them unverified. Current app authentication uses the borrower JWT; no separate installation key is implemented. |
| Whole-device wipe or permanent release of management | Modern-target ordinary admin cannot call the current whole-device wipe API; app can deregister itself | Device Owner release/wipe flow | Do not offer wipe in running mode. `RELEASE` clears local EMI Shield state and server enrollment; no Device Owner-removal ack. |

The inspected sample calls `DevicePolicyManager.lockNow()`, but the CredNexa running APK must not. Its Device Admin request has a different purpose: an active administrator makes ordinary direct uninstall fail until the borrower deactivates it. This adds friction rather than permanent prevention. [Android active-admin uninstall behavior](https://android.googlesource.com/platform/frameworks/base/+/a38d32bb09756370c5c28d210a051415e85e0be2/packages/PackageInstaller/res/values/strings.xml).

## 7. Early backend architecture proposal

This section preserves the reasoning that informed the later implementation. Its table describes gaps as they appeared during the **5 October analysis**, before the backend work. It is not a current API inventory or a list of remaining changes. The implemented routes, payloads, mode gates, and errors are in the [running APK backend API contract](running%20apk%20backend%20api%20contract.md).

### 7.1 Separate three concepts already close together in the code

1. **Tenant payment-control mode** stays `EMI_AUTOMATED` or `MANUAL` in `TenantPolicy.deviceControlRules.mode` ([`Tenant Mode.md`](../Tenant%20Mode.md)). It answers who triggers EMI actions.
2. **Enrollment mode** becomes `DEVICE_OWNER_QR` or `RUNNING_APP`. It answers how this installation was activated.
3. **Observed capabilities** are per device and time-varying: e.g. `deviceAdminActive`, `notificationsAllowed`, `locationGrant`, `overlayAllowed`. They answer what the app reports it can do **now**; Device Admin status describes the normal-uninstall step, not screen locking.

Do not infer Device Owner from an APK type or a claimed permission. Keep `Device.deviceOwnerStatus` for actual managed-device status; add a distinct enrollment/assurance field. Set running devices to a clear lower-assurance category instead of `CONFIRMED` Device Owner.

### 7.2 Integration points identified at the time

| Existing code | Current assumption | Proposed change |
|---|---|---|
| [`distributor.controller.js`](../backend/src/modules/distributor/distributor.controller.js) `registerBorrower`, `generateEnrollmentQr`, `regenerateEnrollmentQr` | Registration creates schedule/token; QR is an Android `PROVISIONING_*` payload | Reuse borrower creation. Save the Add Borrower enrollment type on `User` and token, defaulting to new-device mode for old clients. Keep the token-based QR route owner-only; extend the existing borrower-scoped regeneration route to return an opaque running-app link QR when the saved mode is `RUNNING_APP`, without Android provisioning extras. Bind the final device to the same mode. |
| [`app.controller.js`](../backend/src/modules/app/app.controller.js) `acceptConsent`, `registerDevice` | OTP/consent then registration; registration requires `imei` and accepts `imei2` | Preserve immutable consent and existing IMEI registration fields. For running mode, bind the exact scanned token and accept manually entered IMEI 1/2 with clear provenance and a body `activationRequestId` for retry. |
| [`Device.js`](../backend/src/models/Device.js) | One device shape, required IMEI, optional IMEI 2, `deviceOwnerStatus` | Keep required IMEI and existing lifecycle states. Add enrollment mode, activation retry ID, a timestamped capability snapshot, and identifier-entry provenance. Derive actual enforcement from existing command ack/history. |
| [`EnrollmentToken.js`](../backend/src/models/EnrollmentToken.js) | Token has no mode | Add mode, expiry, one-time claim, and optional tenant-issued activation metadata. Preserve tenant/user scope. |
| [`DeviceCommand.js`](../backend/src/models/DeviceCommand.js) and command services | DPM-style commands can be queued for all devices | Apply a capability/assurance filter **before** queueing. Unsupported commands return a clear API error; they must not sit pending forever or be marked acknowledged. |
| `getDeviceSyncState`, `acknowledgeDeviceCommand` | Device reports applied policy | Include supported command set and mode; require command-specific evidence/result. Distinguish `requested`, `delivered`, `applied`, `failed`, and `unverifiable`. |
| [`deviceRelease.service.js`](../backend/src/services/deviceRelease.service.js) | `RELEASE_DEVICE` expects Device Owner cleanup | Dispatch a mode-specific release payload; running app deregisters and clears its own state. Do not require false `deviceOwnerStatus=RELEASED` evidence. |
| Admin/tenant device pages | State label can imply strong enforcement | Show “Running app · lower assurance,” permission health, last sync, and actual enforcement result. Disable unsupported controls. |

This historical gap analysis led to mode-aware registration, exact running-claim checks, JWT-based linked-device resolution, and command filtering in the backend. The suggested installation-key binding was not implemented. Keep existing `Device.state` and `DeviceCommand.status`; present command acknowledgement details beside the requested state because an FCM send or `LOCK` record is not proof of a durable lock.

### 7.3 Suggested enrollment and authentication sequence

The sequence below is an earlier architecture sketch, not the final app screen order. Follow the current [endpoint sequence](running%20apk%20backend%20api%20contract.md#3-enrollment-sequence-and-endpoint-index) and [app development plan](Running%20Device%20APK%20development%20plan.md) for implementation.

```text
Tenant registers borrower and selects RUNNING_APP
  → backend creates short-lived, single-use activation token bound to user + tenant
  → borrower installs the separately signed app and scans/opens the activation link
  → app shows EMI Shield identity, lender identity, exact capabilities and limits
  → existing borrower OTP and versioned consent are completed
  → borrower manually enters IMEI 1 and IMEI 2 from Android settings
  → app requests only the chosen, disclosed Android grants
  → app submits exact QR, borrower JWT, IMEIs, activationRequestId, and fresh capabilities
  → backend stores entered IMEIs in existing fields and links the borrower/device
  → app reports observed capabilities and syncs desired state
```

Manually entered IMEI, FCM token, Android ID, package hash, or SIM number must not be treated as an authenticator. Ask for both IMEIs when the phone has two; leave IMEI 2 absent if it genuinely has only one rather than inventing a value. Validate format and duplicates, and record that the borrower entered them. The backend authenticates app calls with the existing borrower JWT and resolves the linked device; it does not bind a key to the APK installation. A stolen valid JWT can therefore call protected app APIs. Earlier research considered Play Integrity as an additional signal; the final running-device contract skips it and leaves owner-device Play Integrity behavior intact.

Google Play's User Data policy restricts linking persistent identifiers such as IMEI with personal data, with narrow exceptions including Device Owner management. A manually entered IMEI does not give a running app that exception. Treat Play distribution of this IMEI-linked design as a launch blocker pending specific policy review; a direct APK download still needs clear consent and privacy review. [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311).

**Illustrative API sketch.** The full request and response shapes are in the [running APK backend API contract](running%20apk%20backend%20api%20contract.md).

```http
POST /api/distributor/users/:userId/enrollment/qr
  { enrollmentMode: "RUNNING_APP" }
  → { qrText, tokenExpiresAt, enrollmentMode: "RUNNING_APP" }

POST /api/app/running-enrollment/preview
  { enrollmentToken }
  → { enrollmentId, requirementsVersion, requiredCapabilities }

POST /api/app/consent/initiate, /verify-otp, /accept
  → { accessToken: "borrower JWT", nextStep: "REGISTER_DEVICE" }

POST /api/app/device/register  (existing route, extended by mode)
  { enrollmentToken, activationRequestId, imei, imei2?, requirementsVersion, capabilities, fcmToken }
  → { deviceId, enrollmentMode, state: "ACTIVE", appConfig, policy }

POST /api/app/device/capabilities
  { capabilities: { notificationsAllowed, overlayAllowed, observedAt }, fcmToken?, appVersion? }
  → { deviceId, capabilitiesObservedAt, capabilitiesReceivedAt }
```

Consent remains in the existing immutable `ConsentRecord`; record the running-app mode, IMEI-entry disclosure, capabilities presented, and rendered consent version/hash in its evidence/metadata without retroactively rewriting prior records. If the user refuses a required grant, derive an “access missing” warning from the current capability snapshot and show it to the tenant. Do not add `LIMITED`/`INCOMPLETE` to the device-state enum or silently treat that installation as managed.

### 7.4 Command handling and state semantics

For `RUNNING_APP`, reuse existing `LOCK`, `UNLOCK`, `TEMP_UNLOCK`, `EMI_REMINDER`, `GET_LOCATION`, and `RELEASE_DEVICE` commands, with `POLICY_UPDATE`/`NOTIFICATION` only as needed by the existing sync contract. The selected `LOCK` presentation is an app-controlled overlay, and `TEMP_UNLOCK` clears that overlay until its deadline. Do not call `lockNow()`; Device Admin is used only for normal-uninstall friction. `GET_LOCATION` remains a separate optional, consented capability. Block `WIPE_DEVICE`, factory-reset, USB-debugging, unknown-install, third-party package restriction (including WhatsApp, caller/dialer, and YouTube), and Device Owner kiosk commands at the server. The implemented unsupported-control code is `UNSUPPORTED_FOR_ENROLLMENT_MODE`.

The app should use FCM as a **wake-up**, then call `/app/device/sync`, compare desired policy version, apply only supported local actions, and acknowledge the actual outcome. The current ACK contract uses command-specific fields such as `appRestrictionApplied`, `lockOverlayShown`, `presentationResult`, `soundPlayed`, and `releaseCompleted`; the generic field list in the early proposal is superseded. On offline recovery, apply the latest valid state, discard superseded commands, and use the existing idempotency/version logic. Periodic WorkManager reconciliation can recover missed FCM events, but is not instant or unstoppable. [WorkManager guidance](https://developer.android.com/develop/background-work/background-tasks/persistent).

Use existing `Device.state` for requested policy, `DeviceCommand.status` and `ackPayload` for delivery/application evidence, plus `lastSeenAt`, `lastSyncAt`, and policy versions for freshness. The API can derive operator text such as “queued,” “app restriction applied,” “overlay shown,” or “outcome unknown/offline” without persisting new lifecycle states. `lastSeenAt` must age out; stale/offline/revoked devices produce a warning, not a fabricated locked state.

### 7.5 Security issue found during the original survey

The original survey found that [`app.controller.js`](../backend/src/modules/app/app.controller.js) exposed `POST /api/app/testing/access-token` without a live production guard. The backend implementation subsequently added `if (env.nodeEnv === "production") return 404`, so this specific prerequisite is **addressed in the workspace**. Keep that gate verified during deployment. This is historical context, not a claim that the route was exploited.

## 8. Suggested Android app design considerations

These are design ideas from the APK analysis, not an approved build specification. The current [API contract](running%20apk%20backend%20api%20contract.md) defines the server-enforced onboarding grants, payloads, and ACK fields. Product/Android teams should validate the UI, Android behavior, and distribution requirements before implementation.

Build a fresh package with a production signing key, `debuggable=false`, `allowBackup=false` or tightly scoped backup rules, and cleartext traffic disabled. Keep the UI explicit about lender identity, consent, enabled access, and the fact that this mode is less secure than Device Owner. A native Kotlin app or native Android module beneath a cross-platform UI could handle FCM, secure JWT storage, overlays, and background work. Share API models and design language with the current borrower app; do not copy the sample's TestDPC-derived policy UI or stale receiver/service graph.

Possible modules: `enrollment` (QR/OTP/consent/activation), `session` (borrower JWT and refresh token storage), `policy` (desired-state reducer and local store), `command` (FCM wake-up/sync/idempotent ack), `payments`, `support`, and `health` (permission/last-sync status). A Device Admin module handles activation/status/removal for normal-uninstall friction only. Keep command execution isolated from screens and driven by server state. The app should never claim to prevent factory reset or permanent uninstall.

Suggested permission sequence:

1. Install and open app. Scan the running-device QR displayed on the dealer phone; show lender, borrower, loan, data use, and mode limitations; complete OTP and the existing versioned consent.
2. Ask the borrower to type IMEI 1 and IMEI 2 from phone settings, and review them before submission. If the handset has only one IMEI, leave IMEI 2 empty with a clear explanation. Store the values in the existing fields and show a masked confirmation to the dealer; label them **borrower entered**, not hardware verified.
3. Request and verify notification access for EMI reminders. The current backend requires `notificationsAllowed: true` at final activation; if denied, keep onboarding incomplete until the borrower grants access or the product contract changes. [Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission).
4. Explain and request **Draw over other apps** for the selected running lock and pending/upcoming EMI overlay. The current backend requires `overlayAllowed: true` at final activation. Recheck the grant after Settings returns and before each presentation. Also request Device Admin to add a deactivation step before ordinary uninstall. If declined, explain the limitation and continue enrollment; the backend does not make it an activation gate.
5. Ask for location only if the product explicitly includes an on-demand location feature, using foreground access first. Background collection needs its own permission/product review and may fail under Android 14 while-in-use foreground-service rules. [FGS location restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).
6. Do **not** make Accessibility, Usage Access, SMS, contacts, call logs, or unrestricted battery behavior mandatory for the running flow. If a future feature genuinely needs one, define a narrow purpose, user disclosure, graceful denial, platform-policy review, and OEM test matrix first.
7. On an authorized final release after settlement, clear the local EMI restriction, cancel work, deactivate this app's Device Admin if active, remove the local management binding, and show released status. Confirm admin deactivation before a successful release ACK; do not imply Device Owner removal.

### 8.1 Device Admin for normal-uninstall friction

The new APK should include a `DeviceAdminReceiver` with `android.permission.BIND_DEVICE_ADMIN`, an `android.app.device_admin` metadata entry pointing to its policy XML, and an `android.app.action.DEVICE_ADMIN_ENABLED` intent filter. Declare no `force-lock`, wipe, camera-disable, or password policy solely for uninstall friction. Android displays the administrator activation screen; the borrower may decline. This activation is separate from Device Owner provisioning. [Device Admin setup](https://developer.android.com/work/device-admin).

The enable button launches `DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN` with `DevicePolicyManager.EXTRA_DEVICE_ADMIN` set to this app's receiver. On return, query `isAdminActive(receiver)`; an Activity result alone is not proof. Report the state in capabilities. If inactive, continue enrollment with a clear lower-assurance notice. The borrower may deactivate it later; the APK must not obstruct that OS choice. On authorized release, call `removeActiveAdmin(receiver)` for its own component, wait until inactive, then complete local cleanup. [Device Admin activation](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#ACTION_ADD_DEVICE_ADMIN), [admin removal](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#removeActiveAdmin(android.content.ComponentName)).

For command delivery, treat FCM as a wake-up, not as independent authorization for a lock: a client can receive delayed or replayed messages. The implemented FCM payload includes command type and, for running EMI reminders, presentation data; the current [API contract](running%20apk%20backend%20api%20contract.md#7-fcm-and-command-handling-contract) shows its shape. On receipt, schedule a bounded sync, authenticate to EMI Shield, fetch the current desired state and supported command list, apply one idempotent action, and POST the command-specific result. Do not start a lock activity directly from a background FCM callback as the sole enforcement mechanism. Retry failed acknowledgements and retain them locally until accepted or superseded.

### 8.2 Suggested capability and health reporting

Send a snapshot at app start, after returning from permission Settings, after a grant changes, and at least once every 24 hours. This is **self-reported health**, not remote proof that a device is controlled. The implemented `/device/capabilities` request requires a fresh `observedAt` plus boolean `notificationsAllowed` and `overlayAllowed`; other fields below are optional design ideas, not required server fields:

| Field | Meaning |
|---|---|
| `enrollmentMode` | Fixed server value `RUNNING_APP`; the client may echo but cannot choose or upgrade it. |
| `deviceAdminActive` | Optional report of the actual admin state for ordinary-uninstall friction; it does not gate current activation or `LOCK`. Do not report `screenLockAvailable`, since the new APK does not use `lockNow()`. |
| `notificationsAllowed` | Required boolean for current activation; report current notification grant and presentation ability. |
| `overlayAllowed` | Required boolean for current activation; recheck before lock/reminder overlay presentation. |
| `locationGrant` | Optional current grant; the backend recognizes lowercase `approximate`, `precise`, `coarse`, `fine`, `foreground`, and `background` for Get location. |
| `batteryOptimizationExempt` | Diagnostic only; never treated as a persistence guarantee. |
| `appVersion`, `sdkInt`, `manufacturer`, `model` | Troubleshooting and compatibility, without relying on a privileged hardware identifier. |
| `observedAt` | Client ISO timestamp required in the capability request. The server records its own `capabilitiesReceivedAt`; the client does not submit that server timestamp. |

The server should derive effective capability from enrollment mode, policy allowlist, this snapshot, and recency. It must never promote a running app to Device Owner based on a client claim. A missing or expired snapshot should reduce assurance and block unsupported commands.

For any screen presented during a delinquency flow, retain obvious access to emergency calls and support and avoid covering Android emergency UI. The existing EMI Shield contract requires emergency access even on managed devices; running mode should be at least as conservative. The app must never request contacts/photos/chats/messages for debt collection. Distribution policy for financial or loan-facilitator apps can prohibit contacts, photos, fine location, phone numbers, broad package visibility, and storage permissions; determine the product's exact Play classification before release. [Financial Services policy](https://support.google.com/googleplay/android-developer/answer/9876821), [Personal Loans in India policy](https://support.google.com/googleplay/android-developer/answer/16604194).

## 9. Suggested physical-device test ideas

This matrix is a suggested QA starting point, not the final release gate. Test on physical devices from at least two OEMs and Android 8/10/12/13/14/15/16 where supported; record device model, OS, install source, and granted special accesses. Use Play-distributed and sideloaded test tracks if both are considered. The sample APK's target SDK 34 behavior is not a substitute for testing the new app against the target SDK required at release.

| Scenario | Expected result |
|---|---|
| Fresh running-device enrollment | No provisioning QR or factory reset; one-time token consumed once; consent and device key bound to correct borrower/tenant. |
| Android 10+ without IMEI API access | Borrower manually enters IMEI 1/2 from phone settings; app does not request `READ_PRIVILEGED_PHONE_STATE` or claim device verification. |
| Device Admin denied or later revoked | Enrollment and overlay `LOCK` continue according to required overlay/notification capability; ordinary uninstall no longer has the admin deactivation step. Report actual admin status. |
| FCM delivered, delayed, duplicated, or missed | App reconciles from server; command idempotency holds; no double lock/unlock or false ack. |
| App force-stopped, offline, rebooted, or battery restricted | App resumes when Android permits; server shows stale/offline status and does not claim successful enforcement. |
| Android 13 Restricted Settings on sideload | Any optional sensitive service has a clear, honest user flow and graceful denial; no attempt to bypass OS settings. |
| Lock while emergency call/phone screen is active | Emergency access remains usable; app does not obscure or intercept it. |
| Payment approved / full unlock / final release | Server state, app UI, command ACK, and tenant view agree; a prior temporary-unlock deadline cannot relock after payment or release. |
| Pay Now / Temp Unlock from running lock overlay | Pay Now opens existing payment QR/proof flow for automatic dealers; Temp Unlock opens existing borrower unlock-request form, followed by operator approval, `TEMP_UNLOCK` command, truthful overlay-clear ACK, and timed overlay relock. |
| Unsupported DPM control on running mode | Backend rejects before queueing with a stable error code; portal disables the action. |
| Reinstall / cloned FCM token / replayed activation link | One-time QR and linked-device rule prevent a second activation through the same claim; operator-reviewed replacement is needed. A valid borrowed JWT can still call app APIs, so the app must protect its session tokens. |
| Production auth gate | `/api/app/testing/access-token` unavailable; borrower and device auth required for protected routes. |

## 10. Original suggested implementation order

This was the order proposed at the time of the APK survey. It is **not** a live project tracker: the backend API work and production testing-token guard were subsequently implemented in the workspace. Use the [master plan](master%20plan.md) for phased status and the [running APK backend API contract](running%20apk%20backend%20api%20contract.md) for the borrower app integration.

1. **Backend security gate:** disable the public testing token route in production; define mode/capability schema and a single command-support policy. **Workspace status:** implemented; deployment still needs verification.
2. **Enrollment:** add running activation token and OTP/consent JWT integration to the existing device-registration flow with mode-specific validation; retain the existing Device Owner QR path unchanged.
3. **Android MVP:** clean separate app with consent, session, FCM sync, borrower payments/support, required overlay/notification reporting, Device Admin request for normal-uninstall friction with a decline path, and local release that deactivates its own admin.
4. **Operator surfaces:** tenant/super-admin labels, unsupported-control disablement, stale/offline alerts, command result detail, and audit history.
5. **Physical QA and rollout:** execute the matrix above, review distribution and financial-app policies, pilot with a small tenant cohort, and monitor permission drop-off, delivery delay, and actual command outcomes.

**Suggested acceptance principle:** no running-mode API or UI calls a device “fully managed” or “locked” merely because a command was queued or an APK was installed. The record should state the actual enrollment mode, granted capability, last observation, and command result. The definitive release criteria belong in the current master plan and QA sign-off.
