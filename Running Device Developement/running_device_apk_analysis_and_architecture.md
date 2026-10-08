# Running-device enrollment: APK analysis and implementation plan

**Prepared:** 5 October 2026  
**Photo addendum:** 8 October 2026  
**Audience:** EMI Shield backend, Android, tenant-app, QA, and product developers  
**Sample:** `C:\Users\HP\Downloads\king_locker_running_app.apk`  
**SHA-256:** `59DFC34CB73D3E59FE8AEBD6F97616F1C653A439E35817A1AB43E0D745471D6C`

## 1. Decision in one page

Develop a **separate, clearly identified running-device borrower app** and reuse EMI Shield's borrower, consent, payment, case, command, and audit services. Introduce an explicit `RUNNING_APP` enrollment mode and a capability-aware command path. The running-device app can offer borrower self-service, reminders, remote **screen lock** through voluntarily enabled Device Admin, and possibly a **best-effort** in-app restriction experience. It cannot deliver the same whole-device kiosk, uninstall prevention, factory-reset control, package suspension, or persistent policy enforcement as a fully managed Device Owner app.

The supplied APK demonstrates how a competing/other app assembles permissions: a user-facing permission screen opens Android settings for Device Admin, Accessibility, Usage Access, overlay, write settings, and battery optimization; FCM and SMS handlers trigger a foreground lock service; the service repeatedly displays a lock activity and adds screen overlays. It also bundles a large amount of Device Owner/TestDPC-like code. **The Device Owner methods in the APK do not become available just because the APK requests permissions or is installed on a running phone.** Android's fully managed provisioning is a separate ownership flow, normally on a new or factory-reset device. [Android Enterprise provisioning](https://developer.android.com/work/dpc/dedicated-devices), [Device Admin activation](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#ACTION_ADD_DEVICE_ADMIN).

The recommended minimum product is: enrollment on an already set-up device; explicit borrower consent; device-bound app identity; user-enabled Device Admin for `lockNow()` where available; FCM-triggered reconciliation; payment/unlock and support flows; capability and permission health visible to the tenant. **Updated product choice:** the running app will also collect IMEI 1 and IMEI 2 by manual borrower entry to reuse the existing registration/inventory fields. Those entries are not verified by Android and must not authenticate the app. Treat missing permissions, force-stop, uninstall, offline state, and factory reset as **loss of assurance**, not as a proven locked state.

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
| Declared permissions | 76 `<uses-permission>` entries, 67 unique; several repeated |
| Components | 27 activities, 23 services, 17 receivers, 4 providers, 1 activity alias |
| Build flags | `android:debuggable=true`, `android:allowBackup=true`, `android:usesCleartextTraffic=true` |
| Signing metadata | APK Signing Block v2 contains a certificate with subject `C=US,O=Android,CN=Android Debug`; certificate SHA-256 `5FEABA4F8922442B4211FC2619D98CB891EE37E6C2BDE383788ABF840B595671` |

The signing block was parsed for certificate metadata; its cryptographic signature was **not independently verified**. The debug build/certificate and cleartext flag make this sample unsuitable as a production foundation. The APK also includes a Retrofit `HttpLoggingInterceptor`; the static method reference alone does not establish its configured logging level. Review the source/build pipeline before using any of its implementation patterns.

The package includes many `com.solutions.runningapp.policy`, `DevicePolicyManagerGateway`, COSU, provisioning, and `TestDPC` strings. This is strong evidence of TestDPC-derived or sample enterprise-management code being bundled. It is **not** evidence that this installation becomes Device Owner. The APK's custom running-device flow is concentrated in `activity`, `services`, `receiver`, `network`, and `util` classes.

## 4. How this APK asks for access

The actionable permission journey is in `com.solutions.runningapp.activity.PermissionActivity` and its click listeners:

| Access | Observed request/check | What a normal installed app receives |
|---|---|---|
| Device Admin | Opens `android.app.action.ADD_DEVICE_ADMIN` with `android.app.extra.DEVICE_ADMIN`; checks `DevicePolicyManager.isAdminActive()` | User may activate a legacy Device Admin. This **does not** grant Device Owner. `force-lock` and declared Device Admin policies become available within their documented scope. |
| Accessibility | Opens `android.settings.ACCESSIBILITY_SETTINGS`; checks `enabled_accessibility_services` | User must enable the declared service. A sideloaded app may additionally face Android's Restricted Settings flow. The service can observe/interact with permitted UI but is not a dependable system-policy authority. |
| Usage Access | Opens `android.settings.USAGE_ACCESS_SETTINGS`; checks AppOps `android:get_usage_stats` | User grants special access to usage data. The app can infer foreground usage; it cannot intrinsically block another app. |
| Draw over other apps | Opens `android.settings.action.MANAGE_OVERLAY_PERMISSION`; checks `Settings.canDrawOverlays()` | User grants `SYSTEM_ALERT_WINDOW`. The app can display allowed overlays, subject to Android's UI and background restrictions. |
| Write system settings | Opens `android.settings.action.MANAGE_WRITE_SETTINGS`; checks `Settings.System.canWrite()` | User grants only the supported `Settings.System` changes. This is not `WRITE_SECURE_SETTINGS` or Device Owner. |
| Ignore battery optimization | Opens `android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; checks `PowerManager.isIgnoringBatteryOptimizations()` | User may grant an exception, subject to platform and distribution rules; it does not make an app immortal. |
| Runtime permissions | Requests phone/call-related runtime access; registration code also contains location, SMS, contacts, storage and camera names | Each request remains subject to the actual manifest, Android version, role, and user decision. A string in bytecode does not grant the permission. |
| Notifications | `SplashActivity` references `POST_NOTIFICATIONS` | On Android 13+, notification display requires the runtime grant for non-exempt notifications. |

### Photographed checklist and EMI Shield enrollment decision

The user-provided [upper photo](reference/permission_checklist_top.jpeg) and [lower photo](reference/permission_checklist_bottom.jpeg) show a running-phone app's **App Permissions** screen. Together they show ten rows. **Write Setting** has a green tick; the other nine have red crosses. These icons are the app's own UI and do not independently verify Android grants. The photos do not reveal which Android screen each row opens, what **Runtime Permission** contains, whether **Battery Optimization** differs from **Battery Power Usage**, or whether **Continue** actually blocks completion. They also do not establish the package identity of the pictured app. The APK bytecode observations in the preceding table are separate evidence.

| Pictured row | Interpretation and EMI Shield running-app decision |
|---|---|
| Battery Optimization | Likely an Android Doze/battery-exemption journey; the photo alone does not identify the request or grant. **Optional**, never a blanket enrollment gate. Use FCM and scheduled recovery first. A power exemption is user-controlled and does not guarantee delivery. |
| Runtime Permission | Too broad to implement as one checkbox. Split into named requests: `CAMERA` only if the app itself scans the QR, `POST_NOTIFICATIONS` on Android 13+ for reminders, and location only for an eligible Get location feature. Manually entered IMEIs do **not** justify phone-state access. Do not carry over the sample APK's SMS, contacts, call, or storage requests without a separate approved feature. |
| Overlay Permission | Maps to **Draw over other apps** / `SYSTEM_ALERT_WINDOW` if the app uses the agreed pending/upcoming EMI overlay with sound. **Required for that first-release presentation**, checked with `Settings.canDrawOverlays()` after returning from system settings and again at delivery. Android may still block a particular presentation, so use one notification fallback and report the actual result. |
| Usage Access Permission | Gives access to usage statistics; it is **not needed** for the agreed lock, unlock, reminders, location, or release. Do not request or block enrollment on it. It does not grant Device Owner control. |
| Device Admin Permission | **Required for the agreed one-time Android `lockNow()` screen-lock call**. Declare only the needed `force-lock` Device Admin policy, open Android's activation screen, then check `isAdminActive()` again. It does not make the app Device Owner or prevent borrower uninstall/revocation. |
| Battery Power Usage | Label is ambiguous from the photo and may refer to an OEM power-management screen rather than a distinct Android permission. **Optional guidance only** unless its click target and benefit are established for a supported OEM; never mark it granted from a tap alone. |
| Write Setting | The photo shows a green tick. `WRITE_SETTINGS` / `Settings.System.canWrite()` allows supported system-settings changes; it is **not required** to play a reminder sound or implement the five agreed controls. Do not request it for EMI Shield merely because the sample app did. |
| Accessibility Permission | The inspected APK uses Accessibility to watch and obstruct parts of the system UI. EMI Shield's agreed controls do **not** require it. Do not request it or use it to interfere with security settings, permission revocation, or uninstall. |
| Auto Start | Typically an OEM-specific power/startup setting, not one standard Android runtime grant. **Optional help text**, not an enrollment gate. The app cannot truthfully promise background execution from a green tick here. |
| Location Permission | **Conditional**: require the supported foreground location grant only when the specific build/tenant offers Get location and its consent/distribution policy is settled. Keep the action unavailable when the grant is absent or revoked. Do not silently request background location as part of a generic checklist. |

The screenshot has no separate **Notifications** row, but the agreed overdue notification and pending/upcoming fallback require the app to request and verify notification access where Android requires it. Required grants for final activation are therefore a **server-versioned, feature-specific list**: notification access, overlay access for the chosen overlay presentation, active Device Admin for `lockNow()`, and location only when Get location is actually offered; QR camera access is requested only if the app uses its own camera scanner. Recheck these at final OK and after enrollment. A revoked grant changes capability/allowed actions and delivery outcomes; it does not retroactively turn the device into a Device Owner or erase enrollment.

Platform references: [notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission), [overlay grant](https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context)), [Device Admin `lockNow()`](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()), [write-settings grant](https://developer.android.com/reference/android/provider/Settings.System#canWrite(android.content.Context)), [battery optimization guidance](https://developer.android.com/training/monitoring-device-state/doze-standby), [location permission design](https://developer.android.com/develop/sensors-and-location/location/permissions), and [Google Play Accessibility policy](https://support.google.com/googleplay/android-developer/answer/18258653).

The Android manifest binds `com.solutions.runningapp.DeviceAdminReceiver` with `BIND_DEVICE_ADMIN` and `@xml/device_admin_receiver`. That XML declares `force-lock`, `disable-camera`, `wipe-data`, password policies, and other legacy Device Admin policies. It binds `RestrictedMonitorService` with `BIND_ACCESSIBILITY_SERVICE` and `@xml/accessibility_service_config`; the service requests broad event types and window-content retrieval. These declarations are **capability requests**, not proof of a successful grant. They also do not override version-specific limits: `setCameraDisabled()` is denied/ignored for a modern-target legacy admin, and `wipeData()` on the primary user throws for apps targeting Android 14 (API 34) or later. The newer whole-device `wipeDevice()` requires Device Owner or an eligible organization-owned Profile Owner. [Android camera policy](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setCameraDisabled(android.content.ComponentName,%20boolean)), [Android wipe APIs](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#wipeData(int)).

On Android 13+, a sideloaded app can encounter Restricted Settings before a user can enable some sensitive services. Do not automate or obscure this OS decision. [Android Restricted Settings help](https://support.google.com/android/answer/12623953), [Android Device Admin guide](https://developer.android.com/work/device-admin).

### Permissions that look powerful but do not make a normal app privileged

The manifest names `READ_PRIVILEGED_PHONE_STATE`, `WRITE_SECURE_SETTINGS`, `INSTALL_PACKAGES`, `DELETE_PACKAGES`, `REBOOT`, `MANAGE_DEVICE_ADMINS`, `MANAGE_FACTORY_RESET_PROTECTION`, `INTERNAL_SYSTEM_WINDOW`, `REAL_GET_TASKS`, `DUMP`, `MANAGE_DEVICE_POLICY_LOCK_TASK`, and other privileged/system permissions. A third-party APK does not gain these powers by declaring them. Android 10+ specifically restricts IMEI and other persistent identifiers; Device Owner or certain special roles are exceptions. The sample registration flow asks for an IMEI and declares `READ_PRIVILEGED_PHONE_STATE`, but a normally installed running-device app targeting SDK 34 should **not** be designed around reading IMEI from Android. The chosen borrower-entry flow is different: it records a typed claim that the app cannot independently verify. [Android 10 identifier restrictions](https://developer.android.com/about/versions/10/privacy/changes#non-resettable-device-ids), [TelephonyManager reference](https://developer.android.com/reference/android/telephony/TelephonyManager).

## 5. Observed control paths in the APK

### 5.1 Remote command and lock path

`services.FirebaseMessanging.onMessageReceived()` examines FCM data strings including `LApp`, `UnLApp`, `remind`, `GetLocation`, and `GetUserPhoneNumber`. Its `sendLockCommand(boolean)` starts `LockService`, calls `DevicePolicyManager.lockNow()` when admin is active, and updates local flags `should_lock` / `lock_triggered`. `services.LockService` starts a foreground notification, launches `FinanceLockActivity`, persists `shouldLock` in `LockPrefs`, and adds overlays at the top and navigation-bar areas. `FinanceLockActivity` tries to remain visible through screen-state callbacks, immersive UI flags, task movement, and relaunch on pause/destroy.

This is a **layered best-effort lock presentation**. `lockNow()` itself immediately locks the screen; it does not make a durable finance kiosk or let the lender remotely clear the borrower's system PIN. Launching an activity from FCM/service/background and keeping it over other apps is version- and OEM-sensitive. Modern Android limits background activity starts and foreground-service starts, including additional Android 14 requirements. [DevicePolicyManager `lockNow`](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()), [background activity launch restrictions](https://developer.android.com/guide/components/activities/secure-bal), [foreground-service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

### 5.2 Settings monitoring and anti-disable path

`services.RestrictedMonitorService` reads Accessibility events and window text. Its bytecode includes terms for admin removal, Accessibility settings, uninstall, force-stop, reset, Play Protect, usage access, and overlay settings; it calls `performGlobalAction()`, displays a touch-blocking overlay, and attempts to move the user away from some settings screens. This is **observed code**, not a recommended EMI Shield feature. It is brittle across languages/OEM UI and conflicts with the user-control boundary a normally installed app must respect. Google Play's Accessibility policy forbids using that API to work around platform security/privacy controls or prevent disabling/uninstalling except within stated authorized management exceptions; any Accessibility use also requires appropriate declaration, disclosure, and consent. [Google Play Accessibility policy](https://support.google.com/googleplay/android-developer/answer/16558241).

The code contains stale identity strings (`Qaswa`, `com.lock.runningapp`) while the manifest package is `com.solutions.runningapp`. That mismatch further reduces confidence in its anti-disable detection. The strings `TestDPC` and `EMISAFE` appear elsewhere, reinforcing that multiple codebases/brands were combined.

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
| Lock the **system screen now** | Conditional: active Device Admin with `force-lock` | Yes | Report this as an outcome within existing `LOCK` acknowledgement. Do not report “whole device restricted.” |
| Remotely clear system PIN / remotely unlock Android keyguard | No | Not the normal meaning of EMI policy unlock | `UNLOCK` clears EMI Shield's own restriction state only. |
| Show EMI Shield's own lock/reminder screen | Conditional | Yes | Provide a user-visible, accessible screen; do not promise that it covers every app at all times. |
| Hide/cover other apps with overlays or infer foreground app through Usage Access | Conditional and fragile | Stronger DPM package controls | Do not make this the core repayment enforcement. Any optional implementation needs separate policy, privacy, OEM, and accessibility review. |
| Suspend WhatsApp, YouTube, Play Store or hide third-party apps | No ordinary-app DPM authority | Yes, subject to managed policy | Mark unsupported for `RUNNING_APP`. |
| Block uninstall, force-stop, admin removal, factory reset, safe mode, USB debugging, unknown-app installs | No | Some through Device Owner policy | Mark unsupported; record lost control and inform tenant. |
| Kiosk / lock task / disable status bar / force Home launcher | No durable full-device form | Yes | Do not expose as running-mode controls. |
| Camera disable | No for a modern-target legacy Device Admin | Yes | Mark unsupported in running mode. |
| On-demand location | Conditional explicit permission and visible/background constraints | Managed capability per current contract | Separate opt-in feature; do not collect routine location in ping/sync. |
| IMEI-based device identity | Direct reading generally unavailable to normal app on Android 10+; borrower can type the displayed number | Available to qualifying owner | Keep existing `imei`/`imei2` inventory fields using borrower entry, label them unverified, and use a separate cryptographic installation binding for app authentication. |
| Whole-device wipe or permanent release of management | Modern-target ordinary admin cannot call the current whole-device wipe API; app can deregister itself | Device Owner release/wipe flow | Do not offer wipe in running mode. `RELEASE` clears local EMI Shield state and server enrollment; no Device Owner-removal ack. |

`DevicePolicyManager.lockNow()` forces an immediate screen lock, but the borrower can unlock with their existing Android credential. It is **not** a persistent lender-controlled lock. Design the product copy and backend state to reflect that. [Android Device Admin guide](https://developer.android.com/work/device-admin), [`lockNow()` reference](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()).

## 7. Proposed backend architecture

### 7.1 Separate three concepts already close together in the code

1. **Tenant payment-control mode** stays `EMI_AUTOMATED` or `MANUAL` in `TenantPolicy.deviceControlRules.mode` ([`Tenant Mode.md`](../Tenant%20Mode.md)). It answers who triggers EMI actions.
2. **Enrollment mode** becomes `DEVICE_OWNER_QR` or `RUNNING_APP`. It answers how this installation was activated.
3. **Observed capabilities** are per device and time-varying: e.g. `screenLock`, `notifications`, `location`, `accessibility`, `overlay`, `usageAccess`. It answers what the app can actually do **now**.

Do not infer Device Owner from an APK type or a claimed permission. Keep `Device.deviceOwnerStatus` for actual managed-device status; add a distinct enrollment/assurance field. Set running devices to a clear lower-assurance category instead of `CONFIRMED` Device Owner.

### 7.2 Current integration points and required changes

| Existing code | Current assumption | Proposed change |
|---|---|---|
| [`distributor.controller.js`](../backend/src/modules/distributor/distributor.controller.js) `registerBorrower`, `generateEnrollmentQr`, `regenerateEnrollmentQr` | Registration creates schedule/token; QR is an Android `PROVISIONING_*` payload | Reuse borrower creation. Save the Add Borrower enrollment type on `User` and token, defaulting to new-device mode for old clients. Keep the token-based QR route owner-only; extend the existing borrower-scoped regeneration route to return an opaque running-app link QR when the saved mode is `RUNNING_APP`, without Android provisioning extras. Bind the final device to the same mode. |
| [`app.controller.js`](../backend/src/modules/app/app.controller.js) `acceptConsent`, `registerDevice` | OTP/consent then registration; registration requires `imei` and accepts `imei2` | Preserve immutable consent and existing IMEI registration fields. For running mode, bind the exact scanned token and accept manually entered IMEI 1/2 with clear provenance plus an installation key. |
| [`Device.js`](../backend/src/models/Device.js) | One device shape, required IMEI, optional IMEI 2, `deviceOwnerStatus` | Keep required IMEI and existing lifecycle states. Add enrollment mode, public-key binding, a timestamped capability snapshot, and identifier-entry provenance. Derive actual enforcement from existing command ack/history. |
| [`EnrollmentToken.js`](../backend/src/models/EnrollmentToken.js) | Token has no mode | Add mode, expiry, one-time claim, and optional tenant-issued activation metadata. Preserve tenant/user scope. |
| [`DeviceCommand.js`](../backend/src/models/DeviceCommand.js) and command services | DPM-style commands can be queued for all devices | Apply a capability/assurance filter **before** queueing. Unsupported commands return a clear API error; they must not sit pending forever or be marked acknowledged. |
| `getDeviceSyncState`, `acknowledgeDeviceCommand` | Device reports applied policy | Include supported command set and mode; require command-specific evidence/result. Distinguish `requested`, `delivered`, `applied`, `failed`, and `unverifiable`. |
| [`deviceRelease.service.js`](../backend/src/services/deviceRelease.service.js) | `RELEASE_DEVICE` expects Device Owner cleanup | Dispatch a mode-specific release payload; running app deregisters and clears its own state. Do not require false `deviceOwnerStatus=RELEASED` evidence. |
| Admin/tenant device pages | State label can imply strong enforcement | Show “Running app · lower assurance,” permission health, last sync, and actual enforcement result. Disable unsupported controls. |

The current `registerDevice` validates `imei` and creates `Device` with it, so the running path can reuse those fields and its transaction. It still needs mode and exact-token checks plus installation authentication. The current `getDeviceSyncState()` returns all pending commands, so command capability filtering should happen centrally and in any scheduler/manual/admin entry point. Keep existing `Device.state` and `DeviceCommand.status`; present command acknowledgement details beside the requested state because an FCM send or `LOCK` record is not proof of a durable lock.

### 7.3 Suggested enrollment and authentication sequence

```text
Tenant registers borrower and selects RUNNING_APP
  → backend creates short-lived, single-use activation token bound to user + tenant
  → borrower installs the separately signed app and scans/opens the activation link
  → app shows EMI Shield identity, lender identity, exact capabilities and limits
  → existing borrower OTP and versioned consent are completed
  → borrower manually enters IMEI 1 and IMEI 2 from Android settings
  → app creates a non-exportable Android Keystore signing key
  → backend verifies a fresh challenge signed by that key
  → optional Play Integrity verdict is verified server-side
  → backend stores entered IMEIs in existing fields and binds app installation key
  → app requests only the chosen, disclosed Android grants
  → app reports observed capabilities and syncs desired state
```

Use a random installation ID and device-bound key; manually entered IMEI, FCM token, Android ID, package hash, or SIM number must not be the sole authenticator. Ask for both IMEIs when the phone has two; leave IMEI 2 absent if it genuinely has only one rather than inventing a value. Validate format and duplicates, and record that the borrower entered them. The server should bind each request to the authenticated borrower **and** enrolled app key where feasible, rotate/revoke on reinstall, and prevent a second active enrollment without an explicit replacement flow. Play Integrity can add an app/device signal, but its verdict must be checked by the backend and is not a substitute for consent or Device Owner. Hardware-backed key attestation can increase confidence where supported; handle devices without it as lower assurance. [Android Keystore](https://developer.android.com/privacy-and-security/keystore), [key attestation](https://developer.android.com/privacy-and-security/security-key-attestation), [Play Integrity standard requests](https://developer.android.com/google/play/integrity/standard).

Google Play's User Data policy restricts linking persistent identifiers such as IMEI with personal data, with narrow exceptions including Device Owner management. A manually entered IMEI does not give a running app that exception. Treat Play distribution of this IMEI-linked design as a launch blocker pending specific policy review; a direct APK download still needs clear consent and privacy review. [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311).

**Proposed API shapes** (names are design suggestions, not existing routes):

```http
POST /api/distributor/users/:userId/running-enrollment
  → { activationUrl, expiresAt, enrollmentMode: "RUNNING_APP" }

POST /api/app/running-enrollment/challenge
  { activationToken, publicKey, appInstanceId }
  → { challengeId, nonce, expiresAt }

POST /api/app/device/register  (existing route, extended by mode)
  { enrollmentToken, challengeId, signature, imei, imei2?, identifierSource: "borrower_entered", integrityToken?, appVersion, platform, fcmToken }
  → { deviceId, enrollmentMode, assuranceLevel, supportedCommands, appConfig }

POST /api/app/device/capabilities
  { deviceId, permissionSnapshot, observedAt, appVersion }
  → { accepted, serverTime, effectiveCapabilities }
```

Consent remains in the existing immutable `ConsentRecord`; record the running-app mode, IMEI-entry disclosure, capabilities presented, and rendered consent version/hash in its evidence/metadata without retroactively rewriting prior records. If the user refuses a required grant, derive an “access missing” warning from the current capability snapshot and show it to the tenant. Do not add `LIMITED`/`INCOMPLETE` to the device-state enum or silently treat that installation as managed.

### 7.4 Command handling and state semantics

For `RUNNING_APP`, reuse existing `LOCK`, `UNLOCK`, `EMI_REMINDER`, `GET_LOCATION`, and `RELEASE_DEVICE` commands, with `POLICY_UPDATE`/`NOTIFICATION` only as needed by the existing sync contract. Within `LOCK`, the running app may call `lockNow()` when Device Admin is active and reports that separate result in `ackPayload`; no new `SCREEN_LOCK` command or device lifecycle state is necessary. `GET_LOCATION` remains a separate optional, consented capability. Block `WIPE_DEVICE`, factory-reset, USB-debugging, unknown-install, third-party package restriction, and Device Owner kiosk commands at the server. Return a precise `UNSUPPORTED_IN_RUNNING_MODE` result for an unsupported request.

The app should use FCM as a **wake-up**, then call `/app/device/sync`, compare desired policy version, apply only supported local actions, and acknowledge with `{commandId, status, appliedPolicyVersion, enforcementMethod, capabilitySnapshot, failureCode}`. Acknowledgement must say exactly what happened: e.g. `SYSTEM_SCREEN_LOCK_CALLED` is not `DEVICE_UNUSABLE`. On offline recovery, apply the latest valid state, discard superseded commands, and use the existing idempotency/version logic. Periodic WorkManager reconciliation can recover missed FCM events, but is not instant or unstoppable. [WorkManager guidance](https://developer.android.com/develop/background-work/background-tasks/persistent).

Use existing `Device.state` for requested policy, `DeviceCommand.status` and `ackPayload` for delivery/application evidence, plus `lastSeenAt`, `lastSyncAt`, and policy versions for freshness. The API can derive operator text such as “queued,” “app restriction applied,” “screen lock called,” or “outcome unknown/offline” without persisting new lifecycle states. `lastSeenAt` must age out; stale/offline/revoked devices produce a warning, not a fabricated locked state.

### 7.5 Security and rollout prerequisite found in the current backend

[`app.controller.js`](../backend/src/modules/app/app.controller.js) exposes `POST /api/app/testing/access-token`. Its production guard is currently commented out, and the handler can look up a borrower by `userId`, `mobile`, or `loanId` before issuing a user token. This must be removed or hard-disabled in production **before** broadening running-device enrollment; otherwise the new device-binding work can be bypassed through an existing public token path. This is a code observation, not a claim that the route has been exploited.

## 8. Android app development plan

Build a fresh package with a production signing key, `debuggable=false`, `allowBackup=false` or tightly scoped backup rules, and cleartext traffic disabled. Keep the UI explicit about lender identity, consent, enabled access, and the fact that this mode is less secure than Device Owner. Prefer a small native Kotlin app or a native Android module beneath a cross-platform UI for Device Admin, FCM, Keystore, and background work. Share API models and design language with the current borrower app; do not copy the sample's TestDPC-derived policy UI or stale receiver/service graph.

Recommended modules: `enrollment` (activation/OTP/consent/key binding), `session` (token refresh and device signature), `policy` (desired-state reducer and local store), `command` (FCM wake-up/sync/idempotent ack), `admin` (DeviceAdminReceiver and capability check), `payments`, `support`, and `health` (permission/last-sync status). Keep command execution isolated from screens and driven by server state. The app should never unlock the Android keyguard or claim to prevent factory reset/uninstall.

Suggested permission sequence:

1. Install and open app. Scan the running-device QR displayed on the dealer phone; show lender, borrower, loan, data use, and mode limitations; complete OTP and the existing versioned consent.
2. Ask the borrower to type IMEI 1 and IMEI 2 from phone settings, and review them before submission. If the handset has only one IMEI, leave IMEI 2 empty with a clear explanation. Store the values in the existing fields and show a masked confirmation to the dealer; label them **borrower entered**, not hardware verified.
3. Request `POST_NOTIFICATIONS` contextually for EMI reminders and command-status notices on Android 13+. If denied, keep enrollment but report missing notification capability. [Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission).
4. Offer a clearly explained **optional/contract-required** Device Admin activation using `ACTION_ADD_DEVICE_ADMIN`, with only the policies actually used (initially `force-lock`). Check `isAdminActive()` on every command and after resume; do not infer it from a stored flag. Borrower can later revoke it.
5. Ask for location only if the product explicitly includes an on-demand location feature, using foreground access first. Background collection needs its own permission/product review and may fail under Android 14 while-in-use foreground-service rules. [FGS location restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).
6. Do **not** make Accessibility, overlay, Usage Access, SMS, contacts, call logs, or unrestricted battery behavior mandatory for the MVP. If a future feature genuinely needs one, define a narrow purpose, user disclosure, graceful denial, platform-policy review, and OEM test matrix first.
7. On borrower request or final settlement, clear local EMI restriction, cancel work, revoke server-bound session/FCM token, and show released status. Do not silently remove user-managed grants or imply Device Owner removal.

### 8.1 Minimal Android Device Admin implementation boundary

The Android module only needs a `DeviceAdminReceiver` and the `force-lock` policy for the initial screen-lock feature. In the new app's manifest, register a receiver with `android.permission.BIND_DEVICE_ADMIN`, an `android.app.device_admin` metadata entry pointing to a policy XML resource, and an `android.app.action.DEVICE_ADMIN_ENABLED` intent filter. The policy XML should contain only `<force-lock />` under `<uses-policies>`. Do not carry over the sample's `wipe-data`, `disable-camera`, or password policies. Android displays the declared scope on the system activation screen. [Device Admin setup](https://developer.android.com/work/device-admin).

When the borrower taps an explanatory enable button, launch `DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN` with `DevicePolicyManager.EXTRA_DEVICE_ADMIN` set to the receiver component and a short human-readable explanation. On return, query `isAdminActive(receiver)`; an Activity result alone is not proof of activation. On every remote screen-lock command, check again, call `lockNow()` only when active, catch `SecurityException`, and acknowledge the **API call result**. The server should then record `SCREEN_LOCK_CALLED`, not “device locked until repayment.” A user may unlock with their own Android credential and may revoke Device Admin later. [Device Admin activation](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#ACTION_ADD_DEVICE_ADMIN), [`lockNow()`](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#lockNow()).

For command delivery, place only a command/version identifier in FCM data. The FCM payload must not itself authorize a lock: a client can receive delayed or replayed messages. On receipt, schedule a bounded sync, authenticate to EMI Shield, fetch the current desired state and supported command list, verify command ID/version/expiry, apply one idempotent action, and POST the result. Do not start a lock activity directly from a background FCM callback as the sole enforcement mechanism. Retry failed acknowledgements and retain them in local storage until accepted or superseded. The app's receipt should include `deviceId`, `commandId`, `policyVersion`, `adminActiveAtExecution`, `resultCode`, and `executedAt`; the backend must validate that the authenticated device owns the referenced command.

### 8.2 Capability snapshot contract

Send a snapshot after enrollment, app start, permission-settings return, admin disable callback, and periodic sync. This is **self-reported health**, not remote proof that a device is controlled. Suggested fields:

| Field | Meaning |
|---|---|
| `enrollmentMode` | Fixed server value `RUNNING_APP`; the client may echo but cannot choose or upgrade it. |
| `adminActive` | Fresh `isAdminActive()` result for this receiver. |
| `screenLockAvailable` | `adminActive` plus local API/feature check; recompute at command time. |
| `notificationsAllowed` | Current notification grant and channel status; affects reminders, not core enrollment. |
| `locationGrant` | `NONE`, `WHILE_IN_USE`, or `BACKGROUND`, if location is a separately approved feature. |
| `batteryOptimizationExempt` | Diagnostic only; never treated as a persistence guarantee. |
| `appVersion`, `sdkInt`, `manufacturer`, `model` | Troubleshooting and compatibility, without relying on a privileged hardware identifier. |
| `observedAt`, `serverReceivedAt` | Both timestamps retained so stale permission claims expire. |

The server should derive effective capability from enrollment mode, policy allowlist, this snapshot, and recency. It must never promote a running app to Device Owner based on a client claim. A missing or expired snapshot should reduce assurance and block unsupported commands.

For any screen presented during a delinquency flow, retain obvious access to emergency calls and support and avoid covering Android emergency UI. The existing EMI Shield contract requires emergency access even on managed devices; running mode should be at least as conservative. The app must never request contacts/photos/chats/messages for debt collection. Distribution policy for financial or loan-facilitator apps can prohibit contacts, photos, fine location, phone numbers, broad package visibility, and storage permissions; determine the product's exact Play classification before release. [Financial Services policy](https://support.google.com/googleplay/android-developer/answer/9876821), [Personal Loans in India policy](https://support.google.com/googleplay/android-developer/answer/16604194).

## 9. Test and acceptance matrix

Test on physical devices from at least two OEMs and Android 8/10/12/13/14/15/16 where supported; record device model, OS, install source, and granted special accesses. Use Play-distributed and sideloaded test tracks if both are considered. The sample APK's target SDK 34 behavior is not a substitute for testing the new app against the target SDK required at release.

| Scenario | Expected result |
|---|---|
| Fresh running-device enrollment | No provisioning QR or factory reset; one-time token consumed once; consent and device key bound to correct borrower/tenant. |
| Android 10+ without IMEI API access | Borrower manually enters IMEI 1/2 from phone settings; app does not request `READ_PRIVILEGED_PHONE_STATE` or claim device verification. |
| Device Admin denied or later revoked | Existing `LOCK` can report its app-specific outcome but records no system screen-lock call; tenant sees the missing capability. |
| FCM delivered, delayed, duplicated, or missed | App reconciles from server; command idempotency holds; no double lock/unlock or false ack. |
| App force-stopped, offline, rebooted, or battery restricted | App resumes when Android permits; server shows stale/offline status and does not claim successful enforcement. |
| Android 13 Restricted Settings on sideload | Any optional sensitive service has a clear, honest user flow and graceful denial; no attempt to bypass OS settings. |
| Lock while emergency call/phone screen is active | Emergency access remains usable; app does not obscure or intercept it. |
| Payment approved / temp unlock / final release | Server state, app UI, command ack, and tenant view agree; no system-PIN unlock claim. |
| Unsupported DPM control on running mode | Backend rejects before queueing with a stable error code; portal disables the action. |
| Reinstall / cloned FCM token / replayed activation link | Prior binding revoked or replacement approved; one-time token and signed challenge reject replay. |
| Production auth gate | `/api/app/testing/access-token` unavailable; borrower and device auth required for protected routes. |

## 10. Implementation order

1. **Backend security gate:** disable the public testing token route in production; define mode/capability schema and a single command-support policy.
2. **Enrollment:** add running activation token, OTP/consent integration, and key binding to the existing device-registration flow with mode-specific validation; retain the existing Device Owner QR path unchanged.
3. **Android MVP:** clean separate app with consent, session, FCM sync, borrower payments/support, Device Admin screen lock, permission-health reporting, and local release.
4. **Operator surfaces:** tenant/super-admin labels, unsupported-control disablement, stale/offline alerts, command result detail, and audit history.
5. **Physical QA and rollout:** execute the matrix above, review distribution and financial-app policies, pilot with a small tenant cohort, and monitor permission drop-off, delivery delay, and actual command outcomes.

**Acceptance criterion:** no running-mode API or UI calls a device “fully managed” or “locked” merely because a command was queued or an APK was installed. The record must state the actual enrollment mode, granted capability, last observation, and command result.
