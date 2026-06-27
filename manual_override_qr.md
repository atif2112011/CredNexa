# Offline Manual Override QR

This feature lets an administrator prepare signed, device-specific QR tokens while the backend is healthy. If the backend later becomes unavailable, the admin can copy/download the QR from MongoDB Compass or the admin API and send it to the borrower. The borrower app verifies the token offline and enters `Manual Override Active` until the normal sync API works again.

## Backend Contract

Base path: `/api/admin`

All admin endpoints require a super-admin account token.

### Generate one device token

`POST /devices/:deviceId/manual-override-token`

Body:

```json
{
  "reason": "Server outage readiness"
}
```

Response data includes token metadata plus:

```json
{
  "tokenId": "mot_...",
  "signedToken": "eyJ...",
  "qrDataUrl": "data:image/png;base64,...",
  "expiresAt": "2026-07-27T10:00:00.000Z",
  "status": "GENERATED"
}
```

### List tokens

`GET /devices/:deviceId/manual-override-tokens`

`GET /manual-override-tokens?tenantId=...&deviceId=...&status=GENERATED&expiresBefore=2026-07-27T00:00:00.000Z`

List responses intentionally omit `signedToken` and `qrDataUrl`.

### Download/fetch QR token

`GET /manual-override-tokens/:tokenId`

Returns `signedToken` and `qrDataUrl`. If the token was `GENERATED`, it is marked `DOWNLOADED` and audited.

### Revoke token

`POST /manual-override-tokens/:tokenId/revoke`

Body:

```json
{
  "reason": "QR exposed to wrong recipient"
}
```

Used tokens cannot be revoked.

### Backfill existing devices

`POST /manual-override-tokens/backfill`

Body:

```json
{
  "tenantId": "optionalTenantId",
  "deviceId": "optionalDeviceId",
  "limit": 500,
  "dryRun": false
}
```

Creates a token only for devices that do not already have a valid unused token.

## Existing Device Backfill Runbook

Use this once after deploying the manual override feature so already-registered devices receive QR tokens.

Prerequisites:

- Backend env has `MANUAL_OVERRIDE_PRIVATE_KEY` configured.
- Backend API is running.
- You have a super-admin access token.
- MongoDB is reachable.

### 1. Dry-run all existing devices

```bash
curl -X POST "$API_BASE_URL/api/admin/manual-override-tokens/backfill" \
  -H "Authorization: Bearer $SUPER_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"limit\":500,\"dryRun\":true}"
```

Expected response shape:

```json
{
  "success": true,
  "message": "Manual override token backfill completed",
  "data": {
    "scanned": 500,
    "created": 0,
    "skippedAlreadyValid": 0,
    "failed": 0,
    "dryRunWouldCreate": 500,
    "errors": []
  }
}
```

### 2. Run the actual backfill

```bash
curl -X POST "$API_BASE_URL/api/admin/manual-override-tokens/backfill" \
  -H "Authorization: Bearer $SUPER_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"limit\":500,\"dryRun\":false,\"reason\":\"Initial manual override QR backfill\"}"
```

Run it again until `created` becomes `0` and `skippedAlreadyValid` covers the scanned devices.

### 3. Backfill one tenant or one device

Tenant-only:

```bash
curl -X POST "$API_BASE_URL/api/admin/manual-override-tokens/backfill" \
  -H "Authorization: Bearer $SUPER_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tenantId\":\"TENANT_OBJECT_ID\",\"limit\":500,\"dryRun\":false}"
```

Single device:

```bash
curl -X POST "$API_BASE_URL/api/admin/manual-override-tokens/backfill" \
  -H "Authorization: Bearer $SUPER_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"DEVICE_OBJECT_ID\",\"limit\":1,\"dryRun\":false}"
```

### 4. Verify in MongoDB Compass

Collection:

`manualoverridetokens`

Useful filter:

```json
{
  "status": { "$in": ["GENERATED", "DOWNLOADED"] },
  "expiresAt": { "$gt": ISODate("2026-06-27T00:00:00.000Z") }
}
```

For one device:

```json
{
  "deviceId": ObjectId("DEVICE_OBJECT_ID"),
  "status": { "$in": ["GENERATED", "DOWNLOADED"] },
  "expiresAt": { "$gt": ISODate("2026-06-27T00:00:00.000Z") }
}
```

Each valid document should include:

- `tokenId`
- `signedToken`
- `qrDataUrl`
- `expiresAt`
- `status`

### 5. If failures occur

Check the `errors` array in the API response. Common causes:

- `MANUAL_OVERRIDE_PRIVATE_KEY` missing or malformed.
- Device references a missing tenant.
- DB write/index issue.

After fixing the cause, rerun the same backfill request. The API skips devices that already have a valid unused token, so reruns are safe.

### Renew expiring tokens

`POST /manual-override-tokens/renew-expiring`

Body:

```json
{
  "tenantId": "optionalTenantId",
  "deviceId": "optionalDeviceId",
  "limit": 500,
  "dryRun": false
}
```

Creates a fresh 30-day token when a device has no valid unused token lasting at least the next 7 days.

## MongoDB Compass Workflow

Collection: `manualoverridetokens`

Useful filter:

```json
{
  "deviceId": ObjectId("..."),
  "status": { "$in": ["GENERATED", "DOWNLOADED"] },
  "expiresAt": { "$gt": ISODate("2026-06-27T00:00:00.000Z") }
}
```

Open the newest document and copy/download `qrDataUrl`. The QR image encodes `signedToken`.

## Token Format

The QR contains a signed JWT. The app must verify the JWT offline with the embedded public key.

Payload fields:

```json
{
  "tokenId": "mot_...",
  "deviceId": "...",
  "purpose": "MANUAL_OVERRIDE",
  "issuedAt": "2026-06-27T10:00:00.000Z",
  "expiresAt": "2026-07-27T10:00:00.000Z",
  "keyId": "manual-override-v1",
  "iat": 1782554400,
  "exp": 1785146400
}
```

Backend env:

```text
MANUAL_OVERRIDE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
MANUAL_OVERRIDE_PUBLIC_KEY_ID=manual-override-v1
MANUAL_OVERRIDE_SIGNING_ALGORITHM=RS256
MANUAL_OVERRIDE_TOKEN_VALIDITY_DAYS=30
MANUAL_OVERRIDE_RENEWAL_WINDOW_DAYS=7
```

The Android/Flutter app must embed the matching public key and trusted key ID.

The backend accepts the private key with or without wrapping quotes and converts literal `\n` sequences into PEM newlines.

Important `.env` rule:

- Store `MANUAL_OVERRIDE_PRIVATE_KEY` as one single line.
- Use literal `\n` between PEM lines.
- Do not paste the key as multiple physical lines in `.env`; dotenv may read only the first line or produce a value that is no longer a valid asymmetric key.

Correct:

```text
MANUAL_OVERRIDE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIC...\n-----END RSA PRIVATE KEY-----"
```

Incorrect:

```text
MANUAL_OVERRIDE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIC...
-----END RSA PRIVATE KEY-----"
```

Recommended production key size: 2048-bit RSA or stronger.

If you use a 1024-bit RSA key for local testing, `jsonwebtoken` requires:

```text
MANUAL_OVERRIDE_ALLOW_INSECURE_KEY_SIZE=true
```

Do not enable `MANUAL_OVERRIDE_ALLOW_INSECURE_KEY_SIZE` in production. If a private key has been shared in chat, tickets, screenshots, or docs, treat it as exposed and rotate it before production use.

To verify the key size actually loaded by the backend env, run this from the `backend` folder:

```bash
node -e "require('dotenv').config(); const crypto=require('crypto'); let k=process.env.MANUAL_OVERRIDE_PRIVATE_KEY.trim(); if ((k.startsWith('\"') && k.endsWith('\"')) || (k.startsWith(\"'\") && k.endsWith(\"'\"))) k=k.slice(1,-1).trim(); k=k.replace(/\\\\n/g,'\n'); const key=crypto.createPrivateKey({key:k,format:'pem'}); console.log(key.asymmetricKeyType, key.asymmetricKeyDetails);"
```

Expected production output should include:

```text
rsa { modulusLength: 2048, ... }
```

If it prints `modulusLength: 1024`, the running env is still using a 1024-bit key even if another key was generated elsewhere. Restart the backend after changing env values.

## App Developer Requirements

Add a manual override entry point on the lock screen. The existing lock screen copy and actions remain, including `Pay EMI` and `Request Temp Unlock`.

When the user scans a manual override QR:

1. Decode the QR to get the signed JWT.
2. Verify the JWT signature offline with the embedded public key.
3. Reject unless `keyId` is trusted.
4. Reject unless `purpose === "MANUAL_OVERRIDE"`.
5. Reject unless `deviceId` matches the current registered device ID.
6. Reject if `expiresAt`/`exp` is expired.
7. Reject if this `tokenId` was already used locally.
8. Store `tokenId` as locally used.
9. Stop kiosk/lock enforcement locally.
10. Show `Manual Override Active`.

While manual override is active:

- Retry `POST /api/app/device/sync` every 60 seconds.
- Include:

```json
{
  "manualOverride": {
    "active": true,
    "tokenId": "mot_...",
    "activatedAt": "2026-06-27T10:05:00.000Z"
  }
}
```

When sync succeeds:

- Apply the returned backend state immediately.
- Clear `Manual Override Active`.
- If server state is `LOCKED`, re-enter kiosk mode.
- If server state is `ACTIVE` or `TEMP_UNLOCK`, stay unlocked according to server state.

Manual override is local-only authorization. It is not a backend unlock command, and backend state always wins after reconnect.
