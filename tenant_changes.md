# Tenant App Changes

## Manual Mode: Mark EMI as Paid from Upcoming and Overdue Cards

When the authenticated tenant/dealer uses `MANUAL` device-control mode, show a **Mark as paid** button on the installment cards displayed in both of these tenant-app views:

- Upcoming EMIs
- Overdue EMIs

This allows a tenant/dealer to record an offline or otherwise verified payment directly from the operational EMI lists. They should not have to navigate through **Devices -> EMI schedules** to find and mark the latest EMI installment.

The button must only be shown in these cards when the tenant dashboard configuration contains:

```json
{
  "deviceControlMode": "MANUAL"
}
```

The tenant dashboard supplies this mode through `GET /api/tenant/dashboard` (also available as `GET /api/distributor/dashboard`). The upcoming and overdue list responses do not repeat the tenant mode, so the tenant app should keep the dashboard mode in authenticated app state and use it to control button visibility.

### Button placement and installment selection

Render **Mark as paid** against the actual unpaid installment displayed in the card. Use that installment's `_id` when submitting the request. If one borrower card contains multiple matching installments, each displayed installment should have its own button so the app does not have to guess which installment the tenant intended to pay.

Only installments in `pending`, `partial`, or `overdue` status can be marked paid.

## Existing Upcoming EMI Response

Request:

```http
GET /api/tenant/users/pending-emis?days=10&page=1&limit=20&search=
Authorization: Bearer <tenant-account-token>
```

The response already contains the borrower ID and full matching installment records needed by the button:

```json
{
  "success": true,
  "message": "Borrowers with upcoming EMIs fetched successfully",
  "data": {
    "items": [
      {
        "borrower": {
          "_id": "USER_ID",
          "name": "Borrower Name",
          "mobile": "9876543210",
          "email": "borrower@example.com",
          "loanId": "LOAN-001",
          "loanAmount": 50000,
          "emiAmount": 5000,
          "tenureMonths": 10,
          "isDeviceLinked": true,
          "linkedDeviceId": "DEVICE_ID"
        },
        "emiScheduleId": "SCHEDULE_ID",
        "loanId": "LOAN-001",
        "upcomingInstallments": [
          {
            "_id": "INSTALLMENT_ID",
            "installmentNumber": 2,
            "dueDate": "2026-08-25T00:00:00.000Z",
            "principalAmount": 4500,
            "interestAmount": 500,
            "emiAmount": 5000,
            "penaltyAmount": 0,
            "status": "pending",
            "paidAmount": 0
          }
        ],
        "installmentCount": 1,
        "totalAmount": 5000,
        "overdueAmount": 0,
        "overdueInstallments": 0,
        "dpd": 0
      }
    ],
    "days": 10,
    "dueUntil": "2026-08-28T00:00:00.000Z",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "pages": 1
    }
  }
}
```

Use these values for the mark-paid request:

```text
userId        = item.borrower._id
installmentId = item.upcomingInstallments[index]._id
```

## Existing Overdue EMI Response

Request:

```http
GET /api/tenant/users/overdue-emis?page=1&limit=20&search=
Authorization: Bearer <tenant-account-token>
```

The overdue response provides the same required identifiers. Its installment array is named `overdueEmiInstallments`:

```json
{
  "success": true,
  "message": "Borrowers with overdue EMIs fetched successfully",
  "data": {
    "items": [
      {
        "borrower": {
          "_id": "USER_ID",
          "name": "Borrower Name",
          "mobile": "9876543210",
          "loanId": "LOAN-001"
        },
        "emiScheduleId": "SCHEDULE_ID",
        "loanId": "LOAN-001",
        "overdueEmiInstallments": [
          {
            "_id": "INSTALLMENT_ID",
            "installmentNumber": 2,
            "dueDate": "2026-08-16T00:00:00.000Z",
            "principalAmount": 4500,
            "interestAmount": 500,
            "emiAmount": 5000,
            "penaltyAmount": 200,
            "status": "overdue",
            "paidAmount": 0
          }
        ],
        "installmentCount": 1,
        "totalAmount": 5200,
        "overdueAmount": 5200,
        "overdueInstallments": 1,
        "dpd": 2
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "pages": 1
    }
  }
}
```

Use these values for the mark-paid request:

```text
userId        = item.borrower._id
installmentId = item.overdueEmiInstallments[index]._id
```

The APIs do not return a separate per-installment `outstandingAmount`. If it is needed for the card or confirmation dialog, calculate it as:

```text
outstandingAmount = max(emiAmount + penaltyAmount - paidAmount, 0)
```

`totalAmount` is the combined outstanding amount of all matching installments in the borrower card and must not be treated as the amount of an individual installment when multiple installments are present.

## Confirmation and Mark-Paid Request

Tapping **Mark as paid** must first open a confirmation dialog. The dialog should show at least:

- Borrower name
- Loan ID
- Installment number
- Due date
- Outstanding amount
- A warning that the action records the installment as fully paid

Do not show or collect a payment-reason field. The backend currently requires `reason`, so the tenant app must send the fixed default value `"verified"` without exposing it as user input. The dialog may still collect an optional payment reference and payment date.

Suggested actions:

- **Cancel**: close the dialog without making a request.
- **Confirm payment**: disable both the card button and dialog action while submitting, then call the mark-paid endpoint.

Request:

```http
POST /api/tenant/users/:userId/emi-installments/:installmentId/mark-paid
Authorization: Bearer <tenant-account-token>
Content-Type: application/json
```

Body:

```json
{
  "reason": "verified",
  "reference": "CASH-2026-001",
  "paidAt": "2026-08-18T10:00:00.000Z"
}
```

Rules:

- Do not render a `reason` input in any mark-paid dialog.
- Always send `"reason": "verified"` in the request because the backend requires a non-empty reason.
- `reference` is optional.
- `paidAt` is optional. The backend uses the current server time when it is omitted.
- `paidAt` must be a valid date and cannot be in the future.
- Prevent duplicate submissions while a request is running.

## Successful Mark-Paid Response

The existing response contains the updated installment and recalculated schedule totals:

```json
{
  "success": true,
  "message": "EMI installment marked paid successfully",
  "data": {
    "emiScheduleId": "SCHEDULE_ID",
    "scheduleStatus": "active",
    "settlementTime": null,
    "installment": {
      "_id": "INSTALLMENT_ID",
      "installmentNumber": 2,
      "dueDate": "2026-08-16T00:00:00.000Z",
      "emiAmount": 5000,
      "penaltyAmount": 200,
      "paidAmount": 5200,
      "status": "paid",
      "paidAt": "2026-08-18T10:00:00.000Z",
      "markedPaidBy": "ACCOUNT_ID",
      "markPaidReason": "verified",
      "markPaidReference": "CASH-2026-001"
    },
    "overdueAmount": 0,
    "overdueInstallments": 0,
    "dpd": 0,
    "commandScheduled": false,
    "unlockQueued": false,
    "unlockCommand": null,
    "releaseCommand": null
  }
}
```

After a successful request:

1. Close the confirmation dialog.
2. Show a success message.
3. Remove the paid installment from the current upcoming or overdue list because it no longer matches that list's filter.
4. If the borrower has no remaining matching installments, remove the borrower card.
5. Update totals and pagination.

The recommended implementation is to invalidate and re-fetch the active upcoming/overdue query after success. This ensures `installmentCount`, `totalAmount`, `overdueAmount`, `overdueInstallments`, `dpd`, borrower-card visibility, and pagination all match the server. An immediate optimistic removal is acceptable for responsiveness, but it should still be followed by a re-fetch.

If the request fails, leave the current card unchanged, re-enable the controls, keep or reopen the dialog as appropriate, and show the backend error message.

### Locked-device behavior

When an installment is marked paid and the linked device is currently `LOCKED`, the backend automatically moves the device to `UNLOCK_PENDING`, applies the active `EMI_PAID` policy, and queues an `UNLOCK` command. The successful response then includes:

```json
{
  "commandScheduled": true,
  "unlockQueued": true,
  "unlockCommand": {
    "commandId": "COMMAND_ID",
    "commandType": "UNLOCK",
    "status": "pending"
  },
  "releaseCommand": null
}
```

The tenant app should communicate that the payment was recorded and device unlock was queued. A device that is not currently `LOCKED` does not receive an unlock command.

If marking the installment settles the complete EMI schedule, permanent release takes precedence: the backend queues `RELEASE_DEVICE` rather than queuing both release and unlock commands.

### Final-installment warning

If the marked installment is the final unpaid installment, the backend settles the EMI schedule and automatically queues permanent device release. In that case the success response contains:

```json
{
  "scheduleStatus": "settled",
  "commandScheduled": true,
  "releaseCommand": {
    "commandId": "COMMAND_ID",
    "commandType": "RELEASE_DEVICE",
    "status": "pending"
  }
}
```

The confirmation dialog should warn the tenant when the selected installment appears to be the final unpaid installment. The backend remains authoritative, so the success UI must also check `scheduleStatus`, `commandScheduled`, and `releaseCommand` and communicate that device release was queued.

## Additional Changes: EMI Schedule Mark-Paid Button Design

Update the existing **Mark as paid** button design on the EMI schedules page in both navigation paths:

- Borrowers tab -> EMI schedules
- Devices tab -> EMI schedules

The control must visually resemble a primary action button instead of plain text or a low-emphasis action.

Required styling:

- Use a solid green background.
- Use readable high-contrast text, preferably white.
- Include clear hover, pressed, focus-visible, loading, and disabled states.
- Preserve the existing confirmation and mark-paid request behavior, except remove the reason input and send the fixed `"verified"` reason.
- Keep the label **Mark as paid** consistent across Upcoming EMIs, Overdue EMIs, Borrowers -> EMI schedules, and Devices -> EMI schedules.

Suggested visual behavior:

```text
Default:  green background + white text
Hover:    darker green background
Pressed:  darkest green background
Loading:  disabled, with progress indicator or "Marking paid..."
Disabled: reduced opacity with no duplicate submission
Focus:    visible keyboard focus ring
```

## Additional Changes: Remove Reason from Every Mark-Paid Dialog

Remove the payment-reason field from every **Mark as paid** confirmation dialog, including:

- Upcoming EMI cards
- Overdue EMI cards
- Borrowers tab -> EMI schedules
- Devices tab -> EMI schedules

The tenant/dealer must not be asked to enter or select a reason. Keep the confirmation dialog for payment verification, but construct every mark-paid request with this fixed value:

```json
{
  "reason": "verified"
}
```

If reference or payment-date controls already exist, they may remain optional. The fixed reason must be added by the request-building code and must not be displayed as an editable form field.

## Acceptance Criteria

- Manual-mode Upcoming EMI cards show **Mark as paid** for every markable installment.
- Manual-mode Overdue EMI cards show **Mark as paid** for every markable installment.
- Automatic-mode Upcoming and Overdue cards do not show this new shortcut.
- The correct `borrower._id` and installment `_id` are used in the request URL.
- A confirmation dialog appears before submission.
- No mark-paid confirmation dialog displays a reason field.
- Every mark-paid request automatically sends `"reason": "verified"`.
- Successful requests update or re-fetch the active table without requiring manual navigation or a full app restart.
- Marking an installment paid queues an unlock when the linked device is currently locked.
- The success UI communicates whether unlock or permanent release was queued.
- Failed requests do not remove or incorrectly mark the row.
- Final-installment settlement and release are clearly communicated.
- Mark-paid buttons in both EMI schedule navigation paths use the new solid green design.
- Loading and disabled states prevent duplicate mark-paid requests.
