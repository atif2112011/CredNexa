# Offline Manual Override - App Developer Contract

## Purpose

Offline Manual Override lets a borrower temporarily use the device when the backend is unreachable. The backend pre-generates device-specific signed QR tokens while online. During an outage, an admin sends the QR to the borrower. The app verifies the QR fully offline and enters `Manual Override Active` until the existing sync API succeeds again.

This is local-only authorization. It is not a backend unlock command. As soon as backend sync works, the backend state wins.

## Hidden Entry Point

Add a hidden Manual Override screen that can be activated from the login screen by tapping 6 times.

Implementation requirement:

- The trigger must not be shown as a visible button.
- Use a stable login-screen target such as the app logo, title, or version label.
- After 6 taps, open the Manual Override QR scan/input screen.
- The screen must support both QR scanning and manual token paste/input.
- If the app is already in a locked/kiosk state and the login screen is not visible, expose the same hidden screen through the nearest locked-state UI target using the same 6-tap pattern.

## Backend Token Format

The QR contains a signed JWT string. The app must verify the JWT offline using the backend public key embedded in the app.

Expected JWT payload:

```json
{
  "tokenId": "mot_...",
  "deviceId": "66...",
  "purpose": "MANUAL_OVERRIDE",
  "issuedAt": "2026-06-27T10:00:00.000Z",
  "expiresAt": "2026-07-27T10:00:00.000Z",
  "keyId": "manual-override-v1",
  "iat": 1782554400,
  "exp": 1785146400
}
```

Current backend defaults:

- Token validity before scan: 30 days.
- Manual override duration after scan: no fixed local timeout.
- Manual override ends when `POST /api/app/device/sync` succeeds and the returned backend state is applied.

## App-Side Public Key

The app developer must embed:

- The backend manual override public key.
- Trusted `keyId`, currently `manual-override-v1` unless changed by backend env.
- Expected signing algorithm, currently `RS256` unless changed by backend env.

The private key must never be embedded in the app.

Expected public key format:

```text
-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----
```

Use the public key that matches the backend `MANUAL_OVERRIDE_PRIVATE_KEY`. If the backend rotates the private key or changes `MANUAL_OVERRIDE_PUBLIC_KEY_ID`, the app must ship the matching public key/key ID pair before tokens signed by the new key are used.

## QR Verification Rules

When the borrower scans or pastes a token:

1. Decode QR content into a JWT string.
2. Verify the JWT signature offline using the embedded public key.
3. Reject if `keyId` is not trusted.
4. Reject if `purpose !== "MANUAL_OVERRIDE"`.
5. Reject if `deviceId` does not match the currently registered backend device ID.
6. Reject if `exp` or `expiresAt` is expired.
7. Reject if this `tokenId` is already used locally.
8. On success, store `tokenId` as used in app-private persistent storage.
9. Stop kiosk/lock enforcement locally.
10. Show `Manual Override Active`.

Recommended rejection messages:

- `Invalid manual override token`
- `Manual override token expired`
- `Manual override token is for another device`
- `Manual override token already used`

## Manual Override Active Behavior

While manual override is active:

- Keep the device locally unlocked.
- Show `Manual Override Active`.
- Persist this state across app restart and device reboot.
- Retry existing sync every 60 seconds.
- Do not call any new sync API.

Sync request:

`POST /api/app/device/sync`

Include the normal sync fields plus:

```json
{
  "manualOverride": {
    "active": true,
    "tokenId": "mot_...",
    "activatedAt": "2026-06-27T10:05:00.000Z"
  }
}
```

The backend records the token as used if valid. The sync response remains the normal response shape:

```json
{
  "success": true,
  "message": "Device sync completed",
  "data": {
    "serverTime": "2026-06-27T10:06:00.000Z",
    "scheduledLockAt": null,
    "deviceState": "LOCKED",
    "currentPolicyKey": "EMI_LOCKED",
    "desiredPolicyVersion": 12,
    "pendingCommands": []
  }
}
```

## Reconnect Rules

On first successful sync after manual override:

- Apply the returned backend state immediately.
- Clear `Manual Override Active`.
- Stop the 60-second manual override retry loop.
- If backend state is `LOCKED`, re-enter kiosk/lock mode.
- If backend state is `ACTIVE` or `TEMP_UNLOCK`, remain unlocked according to backend state.

The app must not preserve manual override after a successful backend sync.

## Local Storage Requirements

Store these values in app-private persistent storage:

- `manualOverrideActive`
- `manualOverrideTokenId`
- `manualOverrideActivatedAt`
- Set/list of locally used manual override token IDs

The used token list prevents local replay while the backend is unreachable.

## Kiosk/Lock Interaction

Manual override temporarily disables local kiosk/lock enforcement only after successful token verification.

Normal behavior still applies:

- `LOCKED` from backend means show lock/kiosk screen.
- `ACTIVE` from backend means stop kiosk mode.
- `TEMP_UNLOCK` from backend means stop kiosk mode and show temp unlock state.

Manual override does not change EMI status, payment status, policy version, or backend device state.

## Test Cases

The app developer must verify:

- Hidden screen opens from login screen after 6 taps.
- Valid QR unlocks only the matching device.
- Invalid signature is rejected.
- Expired token is rejected.
- Token for another device is rejected.
- Same token cannot be reused locally.
- Manual override survives app restart.
- Manual override survives device reboot.
- Sync retries every 60 seconds while backend is unavailable.
- First successful sync clears manual override and applies backend state.
- If sync returns `LOCKED`, kiosk/lock mode starts again.
