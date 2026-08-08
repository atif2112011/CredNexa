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
POST  /api/admin/app-builds/upload-sessions
POST  /api/admin/app-builds/upload-sessions/:sessionId/complete
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
appbuilduploadsessions / AppBuildUploadSession
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

1. The portal sends build metadata and the selected file descriptor to the backend.
2. The backend authenticates the Super Admin, validates the metadata, rejects an existing version code, and creates a two-hour upload session.
3. The browser uploads the APK directly to the returned Firebase Storage resumable URL in 8 MiB chunks. APK bytes never pass through the Vercel API proxy.
4. The portal asks the backend to complete the upload session.
5. The backend verifies the Firebase object, exact size, MIME type, and ZIP/APK signature, then streams the object to calculate `apkSha256`.
6. The backend copies the verified object from staging to its permanent server-generated path and creates the build as `draft`.
7. Super Admin publishes the draft build separately.
8. The backend archives any previously published build for the same `platform + packageName + channel`.
9. Borrower app update checks start using the newly published build.

Publishing is separate from upload so the admin can review the uploaded build before it reaches borrower devices.

## Direct Upload APIs

### Create Upload Session

Endpoint:

```text
POST /api/admin/app-builds/upload-sessions
```

Content type:

```text
application/json
```

Request:

```json
{
  "fileName": "app-release.apk",
  "fileSize": 187432960,
  "mimeType": "application/vnd.android.package-archive",
  "platform": "android",
  "packageName": "com.crednexa.app",
  "channel": "production",
  "versionName": "1.0.15",
  "versionCode": 15,
  "minimumSupportedVersionCode": 10,
  "buildType": "release",
  "checksumRequired": true,
  "releaseNotes": "Bug fixes and security improvements"
}
```

Response data:

```json
{
  "uploadSessionId": "68872f9ad3538e5cc41a1090",
  "uploadUrl": "https://storage.googleapis.com/upload/storage/v1/...",
  "expiresAt": "2026-07-27T15:30:00.000Z",
  "chunkSize": 8388608
}
```

Important validation:

```text
Super Admin authentication is required
platform must be android
packageName must be com.crednexa.app
channel must be production or qa
versionCode must be a positive integer
minimumSupportedVersionCode must be a positive integer
versionCode must be >= minimumSupportedVersionCode
fileName must end in .apk
fileSize must be between 1 byte and 500 MiB inclusive
mimeType must be an accepted Android package or ZIP type
the platform/package/channel/versionCode combination must not already exist
the portal origin must be listed in DIRECT_UPLOAD_ALLOWED_ORIGINS
```

The `uploadUrl` is a temporary credential and must not be logged or stored in browser persistence. The portal sends chunks directly to this URL using `PUT` and `Content-Range`.

### Complete Upload Session

Endpoint:

```text
POST /api/admin/app-builds/upload-sessions/:sessionId/complete
```

The request body is empty. The backend uses only the authenticated user and the stored upload session; the client cannot supply or replace the Storage path, APK URL, checksum, size, or MIME type.

Completion behavior:

```text
Requires the same Super Admin who created the session
Rejects expired, failed, missing, or incomplete uploads
Validates stored object size, MIME type, and ZIP/APK signature
Streams the APK from Firebase Storage to calculate SHA-256
Moves the verified APK from staging to a permanent path
Creates and returns the draft AppBuild
Returns the same AppBuild when an already-completed session is retried
```

Upload sessions expire after two hours. Incomplete staging objects are deleted by the bucket lifecycle rule after one day.

## Legacy Multipart Upload API

The original API remains available for existing integrations:

```text
POST /api/admin/app-builds
Content-Type: multipart/form-data
File field: apkFile
```

It still passes the entire APK through the application server and retains its 150 MB limit. The Super Admin portal no longer calls this endpoint.

Legacy example:

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

## Firebase Storage Deployment

Required backend environment:

```text
APP_FIREBASE_STORAGE_BUCKET=<project-bucket>
ADMIN_FIREBASE_PROJECT_ID=<service-account-project>
ADMIN_FIREBASE_CLIENT_EMAIL=<service-account-email>
ADMIN_FIREBASE_PRIVATE_KEY=<service-account-private-key>
DIRECT_UPLOAD_ALLOWED_ORIGINS=http://localhost:3000,https://<super-admin-domain>
```

`FIREBASE_SERVICE_ACCOUNT_JSON` or application-default credentials can be used instead of the three `ADMIN_FIREBASE_*` values. Credentials remain backend-only and are never exposed to the portal.

Before applying the included Storage configuration, replace the production origin in `backend/storage.cors.json` if the Super Admin domain differs:

```bash
gcloud storage buckets update gs://<project-bucket> --cors-file=backend/storage.cors.json
gcloud storage buckets update gs://<project-bucket> --lifecycle-file=backend/storage.lifecycle.json
```

The CORS policy must allow `PUT` and expose `Range` so chunk status can be resumed. The lifecycle configuration deletes only objects under `app-builds/staging/` that are at least one day old.

Troubleshooting:

```text
403 when creating a session: confirm the browser origin is in DIRECT_UPLOAD_ALLOWED_ORIGINS.
CORS failure during PUT: apply storage.cors.json to the correct bucket and verify the deployed portal origin.
Firebase credential/signing error: verify the service account or application-default credentials can create resumable uploads and manage Storage objects.
409 during completion: confirm the upload finished and the same Super Admin/session ID is being used.
410 during completion: the two-hour session expired; start a new upload.
Invalid ZIP/APK: rebuild the APK and confirm the selected file is an Android package.
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
backend/src/models/AppBuildUploadSession.js
backend/src/services/appBuildDirectUpload.service.js
backend/src/services/appBuildUploadValidation.js
backend/src/services/appUpdate.service.js
backend/src/config/firebaseAdminStorage.js
backend/src/middleware/parseApkUpload.js
backend/src/utils/firebaseFileUpload.js
backend/src/modules/app/app.controller.js
backend/src/modules/app/app.routes.js
backend/src/modules/admin/admin.controller.js
backend/src/modules/admin/admin.routes.js
backend/src/app.js
backend/storage.cors.json
backend/storage.lifecycle.json
super-admin-portal/src/lib/firebase-resumable-upload.ts
super-admin-portal/src/app/(dashboard)/builds/builds-table.tsx
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

Direct-upload security properties:

```text
The Super Admin JWT authorizes session creation and completion.
Firebase service-account credentials remain on the backend.
The backend generates every staging and permanent object path.
The temporary resumable URL is bound to the allowed portal origin.
The backend verifies the stored object rather than trusting client metadata.
Upload sessions are owned by one Super Admin, expire after two hours, and are single-use.
Abandoned staging objects are removed by a one-day Storage lifecycle rule.
```

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

Automated checks:

```bash
cd backend
npm test
npx eslint src/services/appBuildDirectUpload.service.js src/services/appBuildUploadValidation.js src/config/firebaseAdminStorage.js src/models/AppBuildUploadSession.js

cd ../super-admin-portal
npm run typecheck
npm run build
```

Deployment checks:

```text
1. Apply the Storage CORS and lifecycle files to the Firebase bucket.
2. Upload a large QA APK and confirm browser network traffic sends APK chunks directly to storage.googleapis.com.
3. Confirm the page shows upload percentage, supports cancellation, and transitions to final verification.
4. Confirm the new draft has the correct byte size, Firebase path, HTTPS URL, and SHA-256.
5. Retry the completion request and confirm it returns the same build without creating a duplicate.
6. Publish the QA build and confirm /api/app/update/check with channel=qa returns its metadata.
7. Upload and publish a production build and confirm production and QA use different APK URLs.
8. Test no-update, optional-update, and force-update versionCode cases.
9. Confirm invalid packageName, platform, extension, MIME type, origin, and files above 500 MiB are rejected.
10. Confirm objects abandoned under app-builds/staging/ are removed after the configured lifecycle age.
```
