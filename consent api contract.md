# Borrower App Consent API Contract

This document defines the consent onboarding flow for the borrower app.

## Base URL

`{BASE_URL}` means the deployment-specific API origin and prefix. The borrower-app routes begin with `/app`.

Example: `{BASE_URL}/app/consent/terms`

## Important integration rules

- The enrollment QR contains an opaque `enrollmentToken`.
- Do not send `userId` or `tenantId`; the backend resolves both from the enrollment token.
- Send the same enrollment token during OTP initiation, OTP verification, and consent retrieval.
- The borrower app must use `POST /consent/terms` to retrieve personalized consent.
- Do not replace consent placeholders in the app. The backend returns fully rendered text.
- Keep the returned `version` and `renderedConsentHash` together and send both when accepting consent.
- Do not calculate, alter, or normalize `renderedConsentHash` in the app.
- Personalized consent responses must not be cached.
- Treat the enrollment token and access token as secrets. Do not log them or place them in URLs.

## Recommended flow

```text
Scan enrollment QR
        ↓
Initiate OTP
        ↓
Verify OTP and receive access token
        ↓
Fetch personalized consent using enrollment token
        ↓
Display all consent sections and obtain explicit acceptance
        ↓
Accept consent using access token, version, and rendered consent hash
        ↓
Continue to device registration or synchronization
```

## Standard response format

Successful responses use this envelope:

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
```

Error responses normally use this envelope:

```json
{
  "success": false,
  "error": "Error description"
}
```

The app should use both the HTTP status code and the `success` field.

---

## 1. Initiate OTP

Starts borrower verification for the enrollment token.

### Request

```http
POST /app/consent/initiate
Content-Type: application/json
```

```json
{
  "mobile": "9876543210",
  "enrollmentToken": "<token-from-enrollment-qr>"
}
```

### Success response

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "verificationSessionId": "<session-id>",
    "otpSent": true,
    "flowType": "ONBOARDING_CONSENT",
    "nextStep": "VERIFY_OTP",
    "maskedMobile": "******3210",
    "expiresInSeconds": 300,
    "retryAfterSeconds": 30
  }
}
```

Retain `verificationSessionId` for OTP verification or resend.

---

## 2. Resend OTP

Use this only after the retry period returned by the API.

### Request

```http
POST /app/consent/resend-otp
Content-Type: application/json
```

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "<session-id>"
}
```

An optional `retryType` may be sent if the app supports multiple OTP delivery methods.

### Success response

The response contains the verification session, masked mobile number, OTP expiry, and retry delay in the standard success envelope.

---

## 3. Verify OTP

Verifies the borrower and returns the access token required to accept consent.

### Request

```http
POST /app/consent/verify-otp
Content-Type: application/json
```

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "<session-id>",
  "otp": "123456",
  "enrollmentToken": "<same-token-from-enrollment-qr>"
}
```

### Success response

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "accessToken": "<jwt-access-token>",
    "tokenType": "user",
    "flowType": "ONBOARDING_CONSENT",
    "nextStep": "SHOW_CONSENT",
    "user": {
      "id": "<user-id>",
      "name": "Borrower Name",
      "mobile": "9876543210",
      "tenantId": "<tenant-id>",
      "consentRecordId": null,
      "isDeviceLinked": false,
      "linkedDeviceId": null
    }
  }
}
```

Store the access token securely. When `nextStep` is `SHOW_CONSENT`, fetch the personalized consent before showing the acceptance screen.

---

## 4. Fetch personalized consent

Returns the current active consent with borrower and tenant placeholders populated by the backend.

### Request

```http
POST /app/consent/terms
Content-Type: application/json
```

```json
{
  "enrollmentToken": "<same-token-from-enrollment-qr>"
}
```

This endpoint is public and does not require the bearer access token.

### Supported placeholders

| Placeholder | Backend value |
|---|---|
| `[USER NAME]` | Borrower's registered name |
| `[SELLER NAME]` | Tenant/seller name |
| `[SELLER SUPPORT]` | Tenant support phone, email, or WhatsApp contact |
| `[DE-ENROLMENT TIME]` | `24 hours` |

The app must render the response exactly as received and must not perform its own placeholder replacement.

### Success response

```json
{
  "success": true,
  "message": "Consent terms fetched successfully",
  "data": {
    "_id": "<consent-version-id>",
    "version": "1.1",
    "title": "Borrower Consent",
    "borrowerAgreementText": "Rendered borrower agreement text...",
    "deviceControlConsentText": "Rendered device-control consent text...",
    "privacyPolicyText": "Rendered privacy policy text...",
    "tripartiteAckText": "Rendered tripartite acknowledgement text...",
    "isCurrent": true,
    "publishedAt": "2026-08-01T10:00:00.000Z",
    "renderedConsentHash": "<64-character-sha256-hash>"
  }
}
```

The API may return additional consent metadata. The app should depend only on the documented fields.

### Consent screen requirements

- Show the title and all four text sections.
- Require the borrower to scroll through the consent text.
- Require an explicit acceptance checkbox or equivalent affirmative action.
- Keep `version` and `renderedConsentHash` from this exact response.
- Disable submission while the accept request is in progress to avoid duplicate submissions.

### Raw consent compatibility endpoint

```http
GET /app/consent/terms
```

`GET /consent/terms`, or `POST /consent/terms` without an enrollment token, returns the raw active consent. Raw consent can still contain placeholders and should not be used for the borrower onboarding acceptance screen.

---

## 5. Accept consent

Records the exact consent snapshot displayed to the borrower.

### Request

```http
POST /app/consent/accept
Authorization: Bearer <access-token-from-otp-verification>
Content-Type: application/json
X-Device-Fingerprint: <optional-device-fingerprint>
```

```json
{
  "consentCheckboxAccepted": true,
  "consentVersion": "1.1",
  "renderedConsentHash": "<exact-hash-returned-by-post-consent-terms>"
}
```

Although older app versions may be accepted without `renderedConsentHash`, it is mandatory for all new borrower-app integrations.

### New acceptance response

HTTP status: `201 Created`

```json
{
  "success": true,
  "message": "Consent accepted successfully",
  "data": {
    "consentRecordId": "<consent-record-id>",
    "consentAccepted": true,
    "renderedConsentHash": "<stored-rendered-consent-hash>",
    "accessToken": "<access-token>",
    "tokenType": "user",
    "nextStep": "REGISTER_DEVICE",
    "user": {
      "id": "<user-id>",
      "name": "Borrower Name",
      "tenantId": "<tenant-id>",
      "consentRecordId": "<consent-record-id>"
    }
  }
}
```

### Already accepted response

An idempotent repeat request can return `200 OK` with:

- `consentAccepted: true`
- the existing `consentRecordId`
- `nextStep: REGISTER_DEVICE` or `SYNC_DEVICE`

Treat both `200 OK` and `201 Created` as successful when `success` and `consentAccepted` are `true`.

### Consent changed response

HTTP status: `409 Conflict`

```json
{
  "success": false,
  "error": "Consent terms changed. Fetch the consent terms again before accepting."
}
```

On `409`:

1. Fetch personalized consent again.
2. Replace the displayed consent with the new response.
3. Require the borrower to review and accept it again.
4. Submit the new `version` and `renderedConsentHash`.

Do not silently retry acceptance with a new hash.

---

## Error handling

| HTTP status | Typical cause | App action |
|---|---|---|
| `400` | Missing/invalid input, invalid or expired enrollment token, mobile mismatch, invalid/expired OTP session, unchecked consent, or consent version mismatch | Show an appropriate message. Return to QR enrollment if the token is invalid. |
| `401` | Missing, expired, or invalid bearer access token | Restart authentication/OTP verification. |
| `409` | Displayed consent no longer matches the backend-rendered consent | Refetch, redisplay, and obtain acceptance again. |
| `422` | Active consent contains an unsupported placeholder or required tenant support information is unavailable | Show a temporary configuration error and offer retry/contact support. |
| `429` | OTP request or resend rate limit reached | Disable retry until the returned retry period has passed. |
| `500`/`503` | Backend unavailable or unexpected server error | Preserve safe local UI state and offer retry. Do not mark consent as accepted locally. |

Network timeouts and dropped connections have an unknown outcome. If an accept request times out, retrying it is safe: the endpoint returns the existing acceptance when consent was already recorded.

## Data stored by the backend

After successful acceptance, the backend stores a consent record containing:

- Borrower and tenant references
- Accepted consent version
- Exact rendered title and all four rendered consent sections
- `renderedConsentHash`
- Acceptance time and audit metadata
- Optional device fingerprint

The app does not need to upload the rendered text. It sends only the consent version and the hash returned by the fetch endpoint.

## App integration checklist

- [ ] Read `enrollmentToken` from the enrollment QR.
- [ ] Never send a frontend-selected `userId` or `tenantId` for consent lookup.
- [ ] Initiate and verify OTP with the same enrollment token.
- [ ] Store the returned access token securely.
- [ ] Use `POST /app/consent/terms` with the enrollment token.
- [ ] Display all consent sections exactly as returned.
- [ ] Require explicit borrower acceptance.
- [ ] Submit the exact `version` and `renderedConsentHash` from the same response.
- [ ] Handle `409` by redisplaying the latest consent.
- [ ] Treat successful `200` and `201` accept responses as completion.
- [ ] Do not mark consent accepted until the backend confirms it.
- [ ] Continue using the `nextStep` returned by the backend.
