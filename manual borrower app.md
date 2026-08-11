# Manual Mode in the Borrower App

## Purpose

Every borrower belongs to a tenant whose device-control mode is one of:

- `EMI_AUTOMATED` — the normal borrower EMI and payment experience is enabled.
- `MANUAL` — the tenant handles EMI payment records and device locking manually. The borrower app must not show EMI or payment features.

The mode is selected when the tenant is created and cannot be changed later.

## Configuration received by the borrower app

The backend converts the tenant mode into an `appConfig` object:

### Automatic tenant

```json
{
  "appConfig": {
    "deviceControlMode": "EMI_AUTOMATED",
    "showEmiDetails": true,
    "paymentSubmissionEnabled": true,
    "showPaymentHistory": true,
    "emiNotificationsEnabled": true,
    "unlockRequestEnabled": true
  }
}
```

### Manual tenant

```json
{
  "appConfig": {
    "deviceControlMode": "MANUAL",
    "showEmiDetails": false,
    "paymentSubmissionEnabled": false,
    "showPaymentHistory": false,
    "emiNotificationsEnabled": false,
    "unlockRequestEnabled": true
  }
}
```

The borrower app should make UI decisions from the feature flags. `deviceControlMode` can be retained for analytics, diagnostics, or mode-specific text, but individual UI components should use their corresponding flags.

## APIs that propagate `appConfig`

The configuration is returned through the normal borrower/device lifecycle:

| API | When to consume it |
|---|---|
| Device registration response | Save the initial configuration after enrollment. |
| Device OTP login response | Refresh configuration when an existing device logs in. |
| `GET /api/app/device/policy` | Refresh while fetching the active device policy. |
| `POST /api/app/device/ping` | Refresh during heartbeat processing. |
| `POST /api/app/device/sync` | Refresh during device synchronization. |
| `GET /api/app/dashboard` | Use for the current borrower dashboard UI. |
| `GET /api/app/utility/tenant` | Refresh alongside tenant name/details. |

Example sync response fragment:

```json
{
  "success": true,
  "message": "Device sync completed",
  "data": {
    "serverTime": "2026-08-10T10:00:00.000Z",
    "deviceState": "ACTIVE",
    "appConfig": {
      "deviceControlMode": "MANUAL",
      "showEmiDetails": false,
      "paymentSubmissionEnabled": false,
      "showPaymentHistory": false,
      "emiNotificationsEnabled": false,
      "unlockRequestEnabled": true
    },
    "currentPolicyKey": "EMI_PAID",
    "desiredPolicyVersion": 4,
    "pendingCommands": []
  }
}
```

## Local configuration handling

The borrower app should:

1. Parse `appConfig` after registration or login.
2. Persist the last valid configuration in local app storage.
3. Update the stored configuration whenever any supported API returns a newer copy.
4. Expose the configuration through one shared application-state provider so every screen uses the same values.
5. Re-render visible screens when the stored configuration is refreshed.

Tenant mode is immutable, so no dedicated tenant-mode push notification is required. Ping and sync responses keep the local configuration consistent after app restarts or reinstalls.

If one response unexpectedly omits `appConfig`, retain the last valid value. If the app has no saved value, use `EMI_AUTOMATED` defaults for compatibility with legacy tenants.

## What to show and hide

### EMI details

Use `appConfig.showEmiDetails`.

When `true`, the app may show:

- Loan amount
- EMI amount
- Current EMI due
- EMI due date
- Installment schedule
- Paid, pending, partial, and overdue installment states
- Overdue amount
- Days past due
- EMI-related recent activity

When `false`, hide all of the above. Do not show empty EMI cards or placeholder amounts. The borrower dashboard backend also omits `loanDetails`, `currentEmiDue`, and EMI-related recent activity for a manual tenant.

### Payment submission

Use `appConfig.paymentSubmissionEnabled`.

When `true`, the app may show:

- **Pay now** button
- Payment QR
- Payment amount input
- Payment proof upload
- Submit payment action
- Payment-submission status

When `false`, hide all payment submission entry points. This includes shortcuts, dashboard buttons, EMI-detail actions, menus, banners, and deep-link destinations.

If a stale deep link opens a payment screen while the feature is disabled, redirect to the borrower dashboard instead of rendering the payment form.

### Payment history

Use `appConfig.showPaymentHistory`.

When `true`, show payment history and payment details normally.

When `false`, hide:

- Payment history menu/sidebar entry
- Recent payment list
- Payment receipt/detail screens
- Links from notifications or old local history

If an old deep link targets payment history, redirect to the dashboard.

### EMI notifications

Use `appConfig.emiNotificationsEnabled`.

When `true`, the app may display and schedule EMI reminders.

When `false`:

- Do not schedule local EMI due reminders.
- Cancel previously scheduled local EMI reminders for the borrower.
- Ignore EMI reminder notifications that were cached before registration/login refresh.
- Do not show EMI reminder banners, badges, or notification-center items inside the app.

Device security, account, support, unlock-request, and command notifications are not EMI notifications and should continue to work.

### Unlock request

Use `appConfig.unlockRequestEnabled`.

This remains `true` in both modes. A borrower whose device is locked may continue to see **Request unlock** according to the existing device-state rules.

For a manual tenant, locked-screen wording should direct the borrower to contact the tenant and may present **Request unlock**. It must not mention paying an EMI through the borrower app.

## Screen-by-screen behavior

| Screen/component | `EMI_AUTOMATED` | `MANUAL` |
|---|---|---|
| Dashboard EMI card | Show | Hide |
| Current EMI due | Show when available | Hide |
| Loan/EMI summary | Show | Hide |
| Installment schedule | Show | Hide |
| Overdue/DPD details | Show | Hide |
| EMI recent activity | Show | Hide |
| Pay now | Show | Hide |
| Payment QR/submission | Show | Hide |
| Payment proof upload | Show | Hide |
| Payment history | Show | Hide |
| Local EMI reminders | Enable | Disable and cancel existing reminders |
| Device state | Show | Show |
| Device policy/sync | Continue | Continue |
| Request unlock | Show when applicable | Show when applicable |
| Tenant support/contact | Show | Show |
| Account/profile | Show | Show |

## Navigation rules

The app must build navigation from the current feature flags:

- Remove EMI schedule destinations when `showEmiDetails` is `false`.
- Remove payment submission destinations when `paymentSubmissionEnabled` is `false`.
- Remove payment history destinations when `showPaymentHistory` is `false`.
- Guard routes as well as hiding buttons. A deep link or restored navigation state must not bypass the configuration.
- If a guarded route becomes unavailable, navigate to the dashboard and clear it from the back stack.

## Backend enforcement

UI hiding is not the security boundary. The backend rejects borrower EMI/payment requests for a manual tenant, including requests from an outdated or modified app.

Disabled EMI APIs return HTTP `403`:

```text
GET /api/app/installments
GET /api/app/installments/:installmentId
```

Error response:

```json
{
  "success": false,
  "error": "Borrower EMI details are not enabled for this tenant",
  "data": {
    "code": "BORROWER_EMI_FEATURE_DISABLED"
  }
}
```

Disabled payment APIs return HTTP `403`:

```text
GET  /api/app/payment/qr
POST /api/app/payment/submit
GET  /api/app/payment/history
GET  /api/app/payment/:paymentId
```

Error response:

```json
{
  "success": false,
  "error": "Borrower payments are not enabled for this tenant",
  "data": {
    "code": "BORROWER_PAYMENT_FEATURE_DISABLED"
  }
}
```

If either error code is received, immediately refresh `appConfig`, close the unavailable screen, and return to the dashboard.

## Device synchronization remains enabled

Manual mode only changes EMI/payment presentation and EMI automation. The borrower app must continue to:

- Ping and sync normally.
- Receive and acknowledge lock, unlock, temporary-unlock, policy, security, and release commands.
- Apply the desired device policy/version.
- Report device state and security signals.
- Show locked, unlock-pending, release-pending, and released device states appropriately.

A manual tenant's device lock/unlock actions still reach the borrower device through the existing command and sync flow.

## Acceptance checklist

- Registration and login persist the returned `appConfig`.
- Ping, sync, policy, dashboard, and tenant responses refresh the stored configuration.
- Every EMI component uses `showEmiDetails`.
- Every Pay Now/payment-submission entry point uses `paymentSubmissionEnabled`.
- Every payment-history entry point uses `showPaymentHistory`.
- Manual mode cancels and suppresses local EMI reminders.
- Deep links and restored navigation cannot open disabled EMI/payment screens.
- Manual mode continues device sync, policy enforcement, and command acknowledgement.
- Request Unlock remains available when allowed by the device state.
- HTTP `403` feature-disabled responses safely return the user to the dashboard.
- Automatic tenants retain the existing borrower experience.

