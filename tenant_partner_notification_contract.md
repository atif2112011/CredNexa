# Tenant And Partner App Notification Contract

## Summary

Tenant App and Partner App notifications use account-level FCM tokens.

Borrower app/device notifications are separate and continue to use borrower device registration. Tenant and Partner apps must register their own FCM token after account login.

Supported apps:

```text
tenant_app
partner_app
```

Role mapping:

```text
tenant_admin  -> tenant_app
partner_admin -> partner_app
```

## Firebase Setup For App Developer

Create separate Firebase Web Apps in the Firebase Console:

```text
Tenant App Firebase Web App
Partner App Firebase Web App
```

Get and configure the required Firebase client env variables separately for both apps.

Suggested env variable names:

```text
TENANT_FIREBASE_API_KEY
TENANT_FIREBASE_AUTH_DOMAIN
TENANT_FIREBASE_PROJECT_ID
TENANT_FIREBASE_STORAGE_BUCKET
TENANT_FIREBASE_MESSAGING_SENDER_ID
TENANT_FIREBASE_APP_ID
TENANT_FIREBASE_MEASUREMENT_ID
TENANT_FIREBASE_VAPID_KEY

PARTNER_FIREBASE_API_KEY
PARTNER_FIREBASE_AUTH_DOMAIN
PARTNER_FIREBASE_PROJECT_ID
PARTNER_FIREBASE_STORAGE_BUCKET
PARTNER_FIREBASE_MESSAGING_SENDER_ID
PARTNER_FIREBASE_APP_ID
PARTNER_FIREBASE_MEASUREMENT_ID
PARTNER_FIREBASE_VAPID_KEY
```

`VAPID_KEY` is required for web push notification permission/token generation.

Do not hardcode Firebase config directly in source code. Use app environment/config files.

## Register Push Token

Endpoint:

```text
POST /api/auth/push-token
```

Headers:

```text
Authorization: Bearer <account_access_token>
Content-Type: application/json
```

Tenant App request:

```json
{
  "targetApp": "tenant_app",
  "platform": "android",
  "fcmToken": "firebase-token",
  "appVersion": "1.0.12"
}
```

Partner App request:

```json
{
  "targetApp": "partner_app",
  "platform": "android",
  "fcmToken": "firebase-token",
  "appVersion": "1.0.12"
}
```

Supported platform values:

```text
android
ios
web
```

Rules:

- Tenant App must send `targetApp: "tenant_app"`.
- Partner App must send `targetApp: "partner_app"`.
- `tenant_admin` cannot register a `partner_app` token.
- `partner_admin` cannot register a `tenant_app` token.
- Register the token after successful login.
- Register the token again when Firebase refreshes the token.
- Register the token on app start if the user is already logged in.
- Re-registering the same token is safe; backend updates the existing token record.

Success response:

```json
{
  "success": true,
  "message": "Push token registered successfully",
  "data": {
    "id": "accountPushTokenId",
    "targetApp": "tenant_app",
    "platform": "android",
    "tokenHash": "sha256-token-hash",
    "isActive": true,
    "lastSeenAt": "2026-06-24T10:00:00.000Z"
  }
}
```

## Deactivate Push Token On Logout

Endpoint:

```text
POST /api/auth/push-token/deactivate
```

Headers:

```text
Authorization: Bearer <account_access_token>
Content-Type: application/json
```

Tenant App request:

```json
{
  "targetApp": "tenant_app",
  "fcmToken": "firebase-token"
}
```

Partner App request:

```json
{
  "targetApp": "partner_app",
  "fcmToken": "firebase-token"
}
```

Optional:

```json
{
  "targetApp": "tenant_app",
  "platform": "android",
  "fcmToken": "firebase-token"
}
```

Rules:

- Call this before or during logout.
- Send the exact FCM token from the current device.
- Backend deactivates only that token.
- If the same admin is logged in on two devices, logout from Device A must not stop notifications on Device B.

Success response:

```json
{
  "success": true,
  "message": "Push token deactivated successfully",
  "data": {
    "deactivatedCount": 1
  }
}
```

## Notification Payload Received By App

FCM notification payload:

```json
{
  "notification": {
    "title": "Payment approval pending",
    "body": "A borrower payment is waiting for approval."
  },
  "data": {
    "type": "APP_NOTIFICATION",
    "notificationJobId": "jobId",
    "notificationType": "PAYMENT_APPROVAL_PENDING",
    "targetApp": "tenant_app",
    "title": "Payment approval pending",
    "text": "A borrower payment is waiting for approval."
  }
}
```

Common fields:

```text
type                APP_NOTIFICATION
notificationJobId   Backend notification job id
notificationType    Backend event type
targetApp           tenant_app or partner_app
title               Notification title
text                Notification body text
```

Backend may also send extra keys in `data`. Treat all `data` values as strings. Parse JSON only for keys where the app expects JSON.

Android notification channel used by backend:

```text
app_notifications
```

App should create this notification channel locally before displaying notifications.

## Suggested Notification Types

Tenant App may receive:

```text
PAYMENT_APPROVAL_PENDING
UNLOCK_REQUEST_PENDING
PENDING_EMIS
OVERDUE_EMIS
CUSTOM
```

Partner App may receive:

```text
PARTNER_ESCALATION
TENANT_CREATED
PAYOUT_UPDATE
CUSTOM
```

App should handle unknown `notificationType` safely by opening the home screen or notification center.

## App Handling Requirements

On login or app start:

```text
1. Initialize Firebase for the correct app.
2. Request notification permission.
3. Get FCM token.
4. Call POST /api/auth/push-token.
5. Listen for token refresh and call POST /api/auth/push-token again.
```

On logout:

```text
1. Get current FCM token if available.
2. Call POST /api/auth/push-token/deactivate.
3. Clear local auth session.
```

Foreground notification:

```text
Show in-app banner, local notification, or update badge count based on notificationType.
```

Background notification tap:

```text
Open the relevant screen based on notificationType and payload data.
```

Fallback:

```text
If notificationType or required data is missing, open home screen.
```

## Security And Logging Notes

Do not log:

```text
FCM token
access token
refresh token
Authorization header
cookie value
OTP
mobile number
```

Safe app logs may include:

```text
targetApp
platform
appVersion
notificationType
notificationJobId
token registration success/failure status
```

## Testing Checklist

Tenant App:

```text
1. Login as tenant_admin.
2. Generate FCM token.
3. Register token with targetApp tenant_app.
4. Confirm tenant_admin cannot register partner_app token.
5. Receive test tenant notification.
6. Logout and deactivate exact token.
7. Login on two devices and confirm both receive notifications.
8. Logout from one device and confirm other device still receives notifications.
```

Partner App:

```text
1. Login as partner_admin.
2. Generate FCM token.
3. Register token with targetApp partner_app.
4. Confirm partner_admin cannot register tenant_app token.
5. Receive test partner notification.
6. Logout and deactivate exact token.
7. Login on two devices and confirm both receive notifications.
8. Logout from one device and confirm other device still receives notifications.
```
