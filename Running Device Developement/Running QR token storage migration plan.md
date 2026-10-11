# Running QR token storage migration plan

**Prepared:** 11 October 2026  
**Status:** Proposed for future implementation. No code, database, or deployed configuration changes are authorized by this document.  
**Scope:** Change how `RUNNING_APP` enrollment codes are stored, redisplayed, and matched on the backend. Keep Android Device Owner provisioning and all app-facing enrollment behavior intact.

## Decision and contract boundary

Use the existing Device Owner enrollment-token storage pattern for **new running claims**: generate a cryptographically random value and store that actual QR credential in `EnrollmentToken.token`. The borrower-scoped Generate QR endpoint reads the same value to redisplay an unexpired claim. A running QR still contains an HTTPS link with an opaque `code` query parameter; it must **not** become an Android Device Owner provisioning JSON payload.

**No changes are required to the running borrower APK API contract.** The app continues to scan the running QR, extract `code`, and submit it as `enrollmentToken` to preview, terms, OTP, consent, and device registration. Endpoint paths, HTTP methods, request field names, success/error envelopes, and required app screens remain the same. The code is opaque to the app; the backend may issue a different random character format. The dealer-facing borrower-scoped Generate QR response must also retain `qrType: "RUNNING_APP_LINK"`, `qrText`, `qrCodeDataUrl`, expiry, reuse/rotation status, and existing error behavior. Keep the current running borrower-registration response limited to `enrollmentId` and expiry; do not start returning the raw code there.

The old owner QR and legacy borrowers without `enrollmentMode` retain their current storage, provisioning payload, and API responses. The old `POST /api/distributor/enrollment/qr` remains owner-only.

## Current implementation and reason for migration

| Concern | Device Owner QR today | Running QR today | Target running QR |
| --- | --- | --- | --- |
| Credential stored in `EnrollmentToken.token` | Actual random bearer token | Internal `run_...` identifier, **not** the QR credential | Actual random bearer token |
| Additional fields | None | `runningTokenHash` and `runningTokenCiphertext` | None for newly issued claims |
| Generate QR again | Read `token` | Decrypt `runningTokenCiphertext` with `RUNNING_ENROLLMENT_SECRET_KEY` | Read `token` |
| Validate submitted code | Direct token lookup/equality | SHA-256 hash lookup/comparison | Direct token lookup/equality, restricted to `RUNNING_APP` |
| QR contents | Android provisioning JSON with token in admin extras | HTTPS app link with `code` | Same HTTPS app link with `code` |

Relevant code: [token model](../backend/src/models/EnrollmentToken.js), [running token service](../backend/src/services/runningEnrollment.service.js), [dealer registration and QR endpoint](../backend/src/modules/distributor/distributor.controller.js), [preview and activation](../backend/src/modules/app/runningEnrollment.controller.js), and [OTP/consent handlers](../backend/src/modules/app/app.controller.js).

The change removes the operational need for a separate running QR encryption key **after all legacy encrypted claims have expired or been dealt with**. It also removes the protection that key currently provides against a database-only disclosure of active running QR codes. Continue treating the QR as a bearer credential: restrict database access, do not log codes, do not put them in list/detail responses or analytics, and deliver them only through the authenticated dealer QR endpoint. OTP, consent, expiry, and single-use activation remain additional checks; they do not make a disclosed QR harmless.

## Validation behavior to preserve

Changing storage must change only the credential lookup and comparison. Preserve these checks at every stage:

1. **QR preview and consent terms:** Accept only a nonempty, reasonably bounded code that resolves to an unexpired, unconsumed, uncancelled `RUNNING_APP` claim. Confirm the borrower and tenant are active, the borrower is not already device-linked, and running enrollment is enabled where the current route requires it. Return only the existing masked preview or mode-specific consent terms. Preview must not consume or echo the code.
2. **OTP initiation and verification:** Match the registered borrower's mobile under the existing Aadhaar/mobile rule. Bind the OTP record to the exact enrollment claim ID. At verification, compare the submitted code to that same claim and reject a different, rotated, expired, or cancelled claim.
3. **Consent acceptance:** Require a verified OTP session for the same borrower and claim, the current `RUNNING_APP` consent version, and the submitted code matching that claim. Keep the existing rendered-consent and location-consent checks. Preserve the audit record's claim ID.
4. **Final device registration:** Require the borrower JWT, a matching active claim for the same borrower and tenant, accepted consent bound to that claim, required Android capabilities, valid borrower-entered IMEI values, FCM token, and the existing idempotency request ID. Atomically consume the claim and link/create one device; a concurrent or repeated use must not create a second device.
5. **Mode isolation:** An owner code must never resolve as a running code. A running code must never be accepted by the owner-only legacy QR route or treated as an Android setup QR. Preserve the owner path for records with no `enrollmentMode`.

The lookup helper and the claim comparison helper must both change. Updating only the QR display would make newly issued codes fail preview/OTP/consent/activation; updating only the lookup would leave QR redisplay dependent on ciphertext.

## Safe compatibility design

Do **not** simply add `{ token: submittedCode, enrollmentMode: "RUNNING_APP" }` to the current lookup. Existing running rows hold a random internal `run_...` value in `token`; that shortcut would turn an internal identifier into an unintended second enrollment credential.

Use an explicit storage discriminator during the transition. A new direct-token claim can be recognized by a new internal storage-version marker, or by a carefully tested predicate that excludes every claim with `runningTokenHash`. Prefer an explicit marker if any old claims exist. For legacy running rows, continue validating only `runningTokenHash` and redisplaying only by decrypting `runningTokenCiphertext`. For new direct-token rows, validate only the stored `token` and redisplay from it. Never allow either format's internal fields to serve as an alternate credential. Keep tenant, mode, expiry, consumption, cancellation, borrower, and consent predicates identical on both paths.

The last read-only production check on **11 October 2026** found zero total and zero active running claims. This is a snapshot, not a deployment guarantee. Recount immediately before rollout, including claims created when registering a borrower **before** the dealer presses Generate QR. If any claims appear, retain the dual-format path until they are consumed, cancelled, or expired. Rotation of an old claim may create a new direct-token claim, but must cancel the old code and require the existing fresh OTP/consent steps when applicable.

## Phased implementation

### Phase 0 — inventory and release preparation

- Record read-only counts of total, active, consumed, cancelled, and expired running claims. Check whether any active running QR has already been delivered. Do not print or export token/code values.
- Confirm the current `RUNNING_ENROLLMENT_SECRET_KEY` is available for rollback and for redisplaying any old-format active claim. Keep `RUNNING_ENROLLMENT_LINK_BASE`; the HTTPS QR text remains part of the contract.
- Identify all backend call sites that read, compare, create, return, or log enrollment credentials. In particular inspect borrower registration, Generate QR reuse/rotation, preview, terms, OTP verification, consent acceptance, activation, and dealer/admin list/detail responses.
- Prepare a deployable previous-version artifact and a database backup. A production test should use an isolated test borrower and clean up its records and credit effects afterward.

### Phase 1 — compatibility release, old writes retained

- Extend `findEnrollmentTokenBySecret` and `matchesEnrollmentSecret` to read both old encrypted-running and new direct-running formats with strict mode and storage-version separation. Update QR redisplay to branch by the same discriminator.
- Keep **old-format writes** during this phase. This lets the compatibility release be deployed and tested without immediately issuing a new credential format.
- Add tests for both formats and prove that submitting an old `run_...` internal identifier fails. Verify owner and missing-mode legacy records still follow the owner branch.
- Deploy the compatibility release and verify existing owner QR generation, running QR generation, preview, OTP, consent, and activation in a staging environment.

### Phase 2 — switch new running writes to the owner-style token field

- In running borrower registration and QR rotation, generate the random bearer code into `EnrollmentToken.token` using the existing owner generator or an equivalent high-entropy generator. Do not write `runningTokenHash` or `runningTokenCiphertext` on new claims.
- Build the running HTTPS `qrText` from that stored token. Reuse the same token for repeated Generate QR calls while the claim remains valid; `rotate: true` cancels it and issues a different one. Preserve the present response shapes and code-redaction rules.
- Keep the Phase 1 dual-read/redisplay path so previously issued encrypted QRs remain usable. Verify the new direct-token path in staging, then deploy and monitor invalid-token rates and QR redisplay errors.
- If rollback is needed, return to the **Phase 1 compatibility release**, which already understands both formats. Do not roll back to the current hash-only running implementation after direct-token claims have been issued; it would not accept those new codes.

### Phase 3 — retire legacy fields and key

- After a fresh count confirms no active old-format running claims, remove their read/redisplay branch in a later release. Preserve historical claim records and audit links as required by retention policy; do not rewrite a consumed claim into a usable credential.
- Remove the now-unused running hash/ciphertext model fields, index, crypto helpers, key validation, and `RUNNING_ENROLLMENT_SECRET_KEY` from `.env.example`, deployment configuration, and implementation documentation. Keep a controlled copy of the former key through the agreed rollback window; do not rotate or delete it before old claims are drained.
- Keep `RUNNING_ENROLLMENT_LINK_BASE` because the running QR still uses an HTTPS link. Do not alter the APK download link or Android package identifier as part of this migration.

## Tests and acceptance criteria

| Area | Required result |
| --- | --- |
| Owner regression | Owner borrower registration, legacy owner QR, borrower-scoped owner Generate QR, owner provisioning payload, OTP/consent, and activation retain their current shapes and behavior. |
| New running claim | Registration returns `enrollmentId` without raw code. Generate QR returns the expected HTTPS `qrText` and PNG. A second click redisplays the same active code. |
| Rotation | Rotation produces a different code, cancels the previous claim, and enforces fresh OTP/consent when existing behavior requires it. |
| Code validation | Valid direct code works through preview, terms, OTP, consent, and activation. Wrong, malformed, expired, cancelled, consumed, cross-tenant, cross-borrower, owner, and old internal `run_...` values fail at the appropriate step. |
| Existing encrypted claim | During the compatibility window, its real QR code still works and can be redisplayed; its `token` internal identifier is rejected. |
| Single use and retry | Parallel activations create at most one linked device. A retry with the same `activationRequestId` keeps the existing idempotent response. |
| Data exposure | No QR credential appears in registration, borrower/device lists, ordinary detail/status responses, logs, analytics, or audit metadata. Only the authorized Generate QR response carries the running QR text/image. |
| API contract | Running APK sends the same `enrollmentToken` field and receives the same response shapes/errors; no app release or new endpoint is required for the storage change. |

Run backend lint and the full backend test suite, then stage an end-to-end dealer QR to running-app activation test. Recheck production claim counts before Phase 2. Completion means the direct-token flow works, owner behavior is unchanged, old-format active claims are supported until drained, and the running APK contract remains unchanged.

## Documents to reconcile when implemented

Update [backend API implementation.md](backend%20API%20implementation.md), [master plan.md](master%20plan.md), and tests that currently describe hash/encrypted storage. In [running apk backend api contract.md](running%20apk%20backend%20api%20contract.md), preserve every endpoint and request/response example; only an internal implementation note may need editing. Do not present this proposed plan as already deployed.
