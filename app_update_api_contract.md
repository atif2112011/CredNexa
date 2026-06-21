# App Update API Contract

## Borrower App Update Check

Base path in this backend is `/api`, so the borrower app calls:

```text
POST /api/app/update/check
GET  /api/app/update/check
```

`POST` is the primary API. `GET` exists for compatibility and uses the same backend decision logic.

### Request

```json
{
  "platform": "android",
  "packageName": "com.crednexa.app",
  "currentVersion": "1.0.12",
  "currentVersionCode": 12,
  "channel": "production",
  "buildType": "release",
  "deviceOwner": true
}
```

`channel` defaults to `production` when missing. Supported channels are `production` and `qa`.

### No Update Response

```json
{
  "success": true,
  "message": "App update check completed",
  "data": {
    "platform": "android",
    "packageName": "com.crednexa.app",
    "channel": "production",
    "updateAvailable": false,
    "forceUpdate": false,
    "latestVersion": "1.0.12",
    "latestVersionCode": 12,
    "minimumSupportedVersionCode": 10,
    "releaseNotes": "",
    "checksumRequired": true
  }
}
```

### Optional Update Response

```json
{
  "success": true,
  "message": "App update check completed",
  "data": {
    "platform": "android",
    "packageName": "com.crednexa.app",
    "channel": "production",
    "updateAvailable": true,
    "forceUpdate": false,
    "latestVersion": "1.0.15",
    "latestVersionCode": 15,
    "minimumSupportedVersionCode": 10,
    "releaseNotes": "Bug fixes and security improvements",
    "checksumRequired": true,
    "apkUrl": "https://example.com/crednexa-production-v15.apk",
    "apkSha256": "64_character_sha256_hex_digest"
  }
}
```

### Force Update Response

```json
{
  "success": true,
  "message": "App update check completed",
  "data": {
    "platform": "android",
    "packageName": "com.crednexa.app",
    "channel": "production",
    "updateAvailable": true,
    "forceUpdate": true,
    "latestVersion": "1.0.15",
    "latestVersionCode": 15,
    "minimumSupportedVersionCode": 13,
    "releaseNotes": "Security update required",
    "checksumRequired": true,
    "apkUrl": "https://example.com/crednexa-production-v15.apk",
    "apkSha256": "64_character_sha256_hex_digest"
  }
}
```

## Super Admin Build APIs

All admin APIs require Super Admin authentication:

```text
GET   /api/admin/app-builds
POST  /api/admin/app-builds
GET   /api/admin/app-builds/:buildId
PATCH /api/admin/app-builds/:buildId
PATCH /api/admin/app-builds/:buildId/publish
PATCH /api/admin/app-builds/:buildId/archive
```

### Create Draft Build

Use multipart form-data:

```text
apkFile: app-release.apk
platform: android
packageName: com.crednexa.app
channel: production
versionName: 1.0.15
versionCode: 15
minimumSupportedVersionCode: 10
buildType: release
checksumRequired: true
releaseNotes: Bug fixes and security improvements
```

The backend uploads the APK to Firebase Storage and computes `apkSha256`.

### Publish Build

```text
PATCH /api/admin/app-builds/:buildId/publish
```

Publishing one build archives any previous published build for the same `platform + packageName + channel`.

## Decision Logic

```text
if currentVersionCode < minimumSupportedVersionCode:
  updateAvailable = true
  forceUpdate = true
else if currentVersionCode < latestVersionCode:
  updateAvailable = true
  forceUpdate = false
else:
  updateAvailable = false
  forceUpdate = false
```

## Security Notes

The update check does not require borrower PII or a borrower token. Backend request logging redacts sensitive fields including tokens, OTP, mobile, IMEI, Aadhaar, payment proof, enrollment token, and FCM token.
