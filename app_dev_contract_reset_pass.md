# App Developer Contract: Forgot / Reset Password

This document explains the app flow and backend API contract for resetting passwords for Tenant Admin and Partner Admin users.

## Supported Users

Forgot password is available for:

- `tenant_admin`
- `partner_admin`

It is not currently available for `super_admin`.

## API Base

All APIs are under:

```text
/api/auth
```

Backend responses use the standard envelope:

```json
{
  "success": true,
  "message": "Success message",
  "data": {}
}
```

Error responses use:

```json
{
  "success": false,
  "error": "Error message"
}
```

## Screen Flow

### 1. Forgot Password Screen

User enters:

- Mobile number
- Role/app context:
  - Tenant app should send `tenant_admin`
  - Partner app should send `partner_admin`

The app calls `POST /api/auth/forgot-password/send-otp`.

If the mobile number and role match an active account, backend sends OTP and returns a `verificationSessionId`.

### 2. OTP Verification Screen

User enters the OTP received on mobile.

The app calls `POST /api/auth/forgot-password/verify-otp` with:

- Mobile number
- Role
- `verificationSessionId`
- OTP

If OTP is correct, backend returns a short-lived `resetToken`.

### 3. New Password Screen

User enters:

- New password
- Confirm password

The app should apply the same password validation before submitting:

- Minimum 8 characters
- At least one letter
- At least one number

The app calls `POST /api/auth/forgot-password/reset` with the `resetToken`.

After success, redirect the user to the login screen.

## API 1: Send Forgot Password OTP

```http
POST /api/auth/forgot-password/send-otp
```

### Request Body

```json
{
  "mobile": "9876543210",
  "role": "tenant_admin"
}
```

For partner app:

```json
{
  "mobile": "9876543210",
  "role": "partner_admin"
}
```

### Success Response

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "verificationSessionId": "otp_abc123...",
    "otpSent": true,
    "expiresInSeconds": 600
  }
}
```

### Common Error Responses

Invalid or missing role/mobile:

```json
{
  "success": false,
  "error": "mobile and role are required"
}
```

Unknown account for mobile + role:

```json
{
  "success": false,
  "error": "No active account found for this mobile and role"
}
```

## API 2: Resend Forgot Password OTP

```http
POST /api/auth/forgot-password/resend-otp
```

### Request Body

```json
{
  "mobile": "9876543210",
  "role": "tenant_admin",
  "verificationSessionId": "otp_abc123..."
}
```

### Success Response

```json
{
  "success": true,
  "message": "OTP resent successfully",
  "data": {
    "verificationSessionId": "otp_abc123...",
    "otpSent": true,
    "expiresInSeconds": 540
  }
}
```

The same `verificationSessionId` remains active. The resend does not create a new session.

### Common Error Response

```json
{
  "success": false,
  "error": "Invalid or expired OTP session"
}
```

## Resend OTP Button Behavior

Resend OTP is implemented for forgot password.

On the OTP screen:

- Show a countdown timer after OTP is sent.
- Disable the **Resend OTP** button while the timer is running.
- Enable the **Resend OTP** button only after the required timer completes.
- When user taps **Resend OTP**, call `POST /api/auth/forgot-password/resend-otp`.
- Keep using the same `verificationSessionId` returned from the original send OTP API.
- After resend succeeds, restart the resend timer.

Recommended UI behavior:

```text
Resend OTP in 30s
```

Then after timer completion:

```text
Resend OTP
```

The OTP itself expires after `expiresInSeconds`, currently 600 seconds from the original OTP session.

## API 3: Verify Forgot Password OTP

```http
POST /api/auth/forgot-password/verify-otp
```

### Request Body

```json
{
  "mobile": "9876543210",
  "role": "tenant_admin",
  "verificationSessionId": "otp_abc123...",
  "otp": "123456"
}
```

### Success Response

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "resetToken": "reset_token_value...",
    "expiresInSeconds": 600
  }
}
```

The `resetToken` is valid for 10 minutes and can be used only once.

### Common Error Responses

Invalid OTP:

```json
{
  "success": false,
  "error": "Invalid OTP"
}
```

Too many attempts:

```json
{
  "success": false,
  "error": "Maximum OTP verification attempts exceeded"
}
```

Invalid/expired session:

```json
{
  "success": false,
  "error": "Invalid or expired OTP session"
}
```

## API 4: Reset Password

```http
POST /api/auth/forgot-password/reset
```

### Request Body

```json
{
  "resetToken": "reset_token_value...",
  "newPassword": "Password123",
  "confirmPassword": "Password123"
}
```

### Success Response

```json
{
  "success": true,
  "message": "Password reset successfully",
  "data": null
}
```

### Common Error Responses

Password mismatch:

```json
{
  "success": false,
  "error": "Password and confirm password must match"
}
```

Weak password:

```json
{
  "success": false,
  "error": "Password must be at least 8 characters and include at least one letter and one number"
}
```

Invalid, expired, or already used token:

```json
{
  "success": false,
  "error": "Invalid or expired reset token"
}
```

## Mock Mode

For local/testing environments where `OTP_PROVIDER=mock`, the OTP is:

```text
123456
```

For real delivery, backend uses the configured MSG91 provider.

