# Build Management System

## Purpose

The build management system lets Super Admin upload Android APK builds, publish one active build per app channel, and lets the borrower app check whether it should continue, show an optional update, or force update.

The borrower update-check endpoint is intentionally independent of borrower PII and does not require a borrower token. This allows the app to check for mandatory updates early during startup.

## Implemented Backend Surface

### Borrower App APIs

```text
GET  /api/app/update/check
POST /api/app/update/check
```

Both methods use the same implementation. `POST` is the primary app API. `GET` is kept for compatibility and quick testing.

### Super Admin Build APIs

All admin APIs are protected by the existing Super Admin middleware:

```text
GET   /api/admin/app-builds
POST  /api/admin/app-builds
GET   /api/admin/app-builds/:buildId
PATCH /api/admin/app-builds/:buildId
PATCH /api/admin/app-builds/:buildId/publish
PATCH /api/admin/app-builds/:buildId/archive
```

## Collection

Collection/model:

```text
appbuilds / AppBuild
```

Main fields:

```text
platform
packageName
channel
versionName
versionCode
minimumSupportedVersionCode
apkUrl
apkSha256
apkStoragePath
apkSizeBytes
apkMimeType
releaseNotes
buildType
checksumRequired
status
publishedAt
publishedBy
createdBy
updatedBy
createdAt
updatedAt
```

Allowed values:

```text
platform: android
packageName: com.crednexa.app
channel: production, qa
buildType: release, debug, qa
status: draft, published, archived
```

Indexes:

```text
platform + packageName + channel + versionCode is unique
platform + packageName + channel + status supports active build lookup
```

## Admin Build Lifecycle

1. Super Admin uploads an APK with build metadata.
2. Backend validates the metadata and APK file.
3. Backend uploads the APK to Firebase Storage.
4. Backend computes and stores `apkSha256`.
5. Build is saved as `draft`.
6. Super Admin publishes the draft build.
7. Backend archives any previously published build for the same `platform + packageName + channel`.
8. Borrower app update check starts using the newly published build.

Publishing is separate from upload so the admin can review the uploaded build before it reaches borrower devices.

## Upload Build API

Endpoint:

```text
POST /api/admin/app-builds
```

Content type:

```text
multipart/form-data
```

File field:

```text
apkFile
```

Form fields:

```text
platform=android
packageName=com.crednexa.app
channel=production
versionName=1.0.15
versionCode=15
minimumSupportedVersionCode=10
buildType=release
checksumRequired=true
releaseNotes=Bug fixes and security improvements
```

Important validation:

```text
platform must be android
packageName must be com.crednexa.app
channel must be production or qa
versionCode must be a positive integer
minimumSupportedVersionCode must be a positive integer
versionCode must be >= minimumSupportedVersionCode
apkFile is required on create
apkFile must look like a ZIP/APK file
```

Example cURL:

```bash
curl -X POST "https://cred-nexa-t1o7.vercel.app/api/admin/app-builds" \
  -H "Authorization: Bearer <SUPER_ADMIN_ACCESS_TOKEN>" \
  -F "apkFile=@./app-release.apk" \
  -F "platform=android" \
  -F "packageName=com.crednexa.app" \
  -F "channel=production" \
  -F "versionName=1.0.15" \
  -F "versionCode=15" \
  -F "minimumSupportedVersionCode=10" \
  -F "buildType=release" \
  -F "checksumRequired=true" \
  -F "releaseNotes=Bug fixes and security improvements"
```

## Publish Build API

Endpoint:

```text
PATCH /api/admin/app-builds/:buildId/publish
```

Example:

```bash
curl -X PATCH "https://cred-nexa-t1o7.vercel.app/api/admin/app-builds/<buildId>/publish" \
  -H "Authorization: Bearer <SUPER_ADMIN_ACCESS_TOKEN>"
```

Behavior:

```text
Marks selected build as published.
Archives any previous published build for the same platform/package/channel.
Does not mix production and qa builds.
```

## Update Build API

Endpoint:

```text
PATCH /api/admin/app-builds/:buildId
```

Supports metadata updates and optional APK replacement using multipart form-data.

Published builds cannot change identity fields:

```text
platform
packageName
channel
versionCode
```

## Archive Build API

Endpoint:

```text
PATCH /api/admin/app-builds/:buildId/archive
```

Behavior:

```text
Marks the build as archived.
Archived builds are not used by borrower update checks.
If a published build is archived, that channel has no active build until another build is published.
```

## Borrower Update Check API

Endpoint:

```text
POST /api/app/update/check
```

Request:

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

`channel` defaults to `production` if missing.

Decision logic:

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

No-update response:

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
    "latestVersion": "1.0.15",
    "latestVersionCode": 15,
    "minimumSupportedVersionCode": 10,
    "releaseNotes": "Bug fixes and security improvements",
    "checksumRequired": true
  }
}
```

Update response:

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

Force-update response:

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

## Implementation Files

```text
backend/src/models/AppBuild.js
backend/src/services/appUpdate.service.js
backend/src/middleware/parseApkUpload.js
backend/src/utils/firebaseFileUpload.js
backend/src/modules/app/app.controller.js
backend/src/modules/app/app.routes.js
backend/src/modules/admin/admin.controller.js
backend/src/modules/admin/admin.routes.js
backend/src/app.js
```

## Security Notes

The borrower update check does not require:

```text
mobile number
IMEI
Aadhaar
FCM token
enrollment token
payment proof
access token
refresh token
cookie
Authorization header
OTP
```

Backend request logging redacts sensitive request body fields before printing logs.

Safe operational fields:

```text
packageName
platform
currentVersionCode
latestVersionCode
minimumSupportedVersionCode
channel
updateAvailable
forceUpdate
statusCode
failureReason
```

## Verification

Syntax checks were run on the changed backend files with `node --check`.

Recommended functional checks:

```text
1. Upload a QA draft build.
2. Publish the QA build.
3. Confirm GET /api/app/update/check with channel=qa returns QA metadata.
4. Upload and publish a production build.
5. Confirm production and QA return different APK URLs.
6. Test no-update, optional-update, and force-update versionCode cases.
7. Confirm invalid packageName and invalid platform return 400.
```
