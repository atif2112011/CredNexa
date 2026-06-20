# User App Refresh Token Contract

This document is for the Android Borrower/User App developer.

## What Changed

The User App now receives a refresh token as an HTTP-only cookie whenever the backend issues a user access token.

The refresh token is not returned in the JSON response.

## Token Types

| Token | Sent As | Used For |
|---|---|---|
| `accessToken` | JSON response body | `Authorization: Bearer <accessToken>` for `/api/app/*` APIs |
| `refreshToken` | HTTP-only cookie | Refreshing an expired user access token |

The app must use a networking client with cookie persistence enabled.

## Refresh Endpoint

```http
POST /api/app/refresh-token
```

No request body is required.

The backend reads the refresh token from the HTTP-only cookie.

## Success Response

```json
{
  "success": true,
  "message": "Access token refreshed successfully",
  "data": {
    "accessToken": "<newUserAccessToken>",
    "tokenType": "user",
    "expiresIn": "15m"
  }
}
```

Store the new `accessToken` and retry the failed request once.

## Error Responses

Missing refresh cookie:

```json
{
  "success": false,
  "error": "Refresh token is required"
}
```

Invalid refresh cookie:

```json
{
  "success": false,
  "error": "Invalid refresh token"
}
```

Expired refresh cookie:

```json
{
  "success": false,
  "error": "Invalid or expired refresh token"
}
```

If refresh fails, clear local auth state and send the user back to the OTP login/onboarding resume flow.

## App Behavior

When an API returns:

```json
{
  "success": false,
  "error": "Invalid or expired token"
}
```

the app should:

1. Call `POST /api/app/refresh-token`.
2. Store the returned `accessToken`.
3. Retry the original request once.
4. If refresh fails, clear session and restart OTP flow.

## Do Not Use

Do not call this endpoint for partner/admin/tenant accounts:

```http
POST /api/app/refresh-token
```

Do not call account refresh from the User App:

```http
POST /api/auth/refresh-token
```

`/api/auth/refresh-token` is only for account tokens:

```text
super_admin
partner_admin
tenant_admin
```

The User App must use:

```http
POST /api/app/refresh-token
```

## Cookie Notes For Android

- The refresh token cookie is HTTP-only.
- The app cannot read it directly.
- The HTTP client must preserve and send cookies automatically.
- Use the same base domain for login/OTP and refresh calls.
- If cookies are disabled or not persisted, refresh will return `"Refresh token is required"`.
