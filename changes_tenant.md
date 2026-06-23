# Tenant App UI And Dashboard Alert Changes

## Summary

Alert buttons are already created for the following cards/buttons in the app:

```text
Pending EMIs
Overdue EMIs
Approve Payment
Unlock Requests
```

Map those alert buttons to the `/tenant/dashboard` response under `alerts`. Hide any alert badge/count when the value is `0`.

No separate alert collection is required. Alert counts and seen timestamps are stored in the `Tenant` document.

## Dashboard Response Mapping

Endpoint:

```text
GET /api/tenant/dashboard
```

The dashboard response includes:

```json
{
  "alerts": {
    "pendingEmis": 0,
    "overdueEmis": 0,
    "approvePayments": 0,
    "unlockRequests": 0
  }
}
```

App mapping:

```text
Pending EMIs card alert button     -> data.alerts.pendingEmis
Overdue EMIs card alert button     -> data.alerts.overdueEmis
Approve Payment card alert button  -> data.alerts.approvePayments
Unlock Requests navbar badge       -> data.alerts.unlockRequests
```

## Clear Behavior

Opening the related list clears that alert.

```text
GET /api/tenant/users/pending-emis
clears data.alerts.pendingEmis

GET /api/tenant/users/overdue-emis
clears data.alerts.overdueEmis

GET /api/tenant/payments/pending-approval
clears data.alerts.approvePayments

GET /api/tenant/payments/approval-requests?status=pending_approval
clears data.alerts.approvePayments

GET /api/tenant/unlock-requests
clears data.alerts.unlockRequests
```

The list can still contain records after opening. Only the alert count becomes `0`.

## Backend Storage

Stored shape on `Tenant`:

```js
dashboardAlerts: {
  pendingEmis: {
    count: Number,
    seenAt: Date
  },
  overdueEmis: {
    count: Number,
    seenAt: Date
  },
  approvePayments: {
    count: Number,
    seenAt: Date
  },
  unlockRequests: {
    count: Number,
    seenAt: Date
  }
}
```

The dashboard recomputes the alert counts and stores the numbers in the tenant document.

`unlockRequests` is counted from unlock request cases where:

```text
tenantId matches current tenant
status = PENDING_TENANT
```

## Home Screen

- Remove `Pending Approval`, `Unlock Requests`, and `Active Devices` from the home screen.
- For the top cards, show a slight side shadow so users understand that the section is horizontally scrollable.

## Devices Screen

Add cards for:

```text
TOTAL DEVICES
ACTIVE
LOCKED
GRACE_PERIOD
TEMP_UNLOCKED
```

Use existing `/tenant/dashboard` data:

```text
TOTAL DEVICES   -> data.devices.activated
ACTIVE          -> data.devices.byState.ACTIVE
LOCKED          -> data.devices.byState.LOCKED
GRACE_PERIOD    -> data.devices.byState.GRACE_PERIOD
TEMP_UNLOCKED   -> data.devices.byState.TEMP_UNLOCK
```

Display label can be `TEMP_UNLOCKED`, but backend state key is `TEMP_UNLOCK`.

## Device Details Screen

- In current policy status, show only `Lock Mode`.
- Hide other policy restriction fields.

## Borrowers Screen

- In borrower cards, hide `Loan Id`.
- In borrower cards, hide `Registered On`.
- Move `Registered On` to the borrower view details page.

## Register Borrower Form

- Remove the `Loan Id` field completely.
- Do not send `loanId` in the register borrower request.
- Keep the `Tenure Months` field visible.
- Make `Tenure Months` read-only.
- App calculates and sends `tenureMonths` as:

```text
ceil(loanAmount / emiAmount)
```

- Backend validates submitted `tenureMonths` against `loanAmount` and `emiAmount`.
- Backend generates the borrower UID and returns it as `loanId` in the existing response.
- Backend stores the generated UID in the existing `loanId` field for compatibility.

## Borrower Details Page

- In the top card, hide `loanId`.
- Hide Aadhaar verified badge.
- Replace Aadhaar badge with a device status badge:

```text
Device Not Linked
Device Linked
```

- In borrower details, show:

```text
Registered On     -> borrower.createdAt
Device Linked At  -> borrower.deviceLinkedAt, if linked
```

- Add an EMI Details page/section similar to Device Details.
- Use existing backend API:

```text
GET /api/tenant/users/:id/emi-installments
```

## Purchase Credits Page

- Change Reference Number label to:

```text
Reference Number (optional)
```

- Create a separate Purchase History page because the API supports pagination.
- Rename the existing Purchase History section to `Recent Purchases`.
- Show only 5 recent purchases using:

```text
GET /api/tenant/credits/purchase/requests?limit=5
```

- Add `View All Purchases` button under Recent Purchases.
- Full purchase history page uses:

```text
GET /api/tenant/credits/purchase/requests?page=1&limit=20
```

## Support Cases Page

- Show alert badge number on the bottom navbar button.
- Map badge to:

```text
data.alerts.unlockRequests
```

- Hide badge when `0`.
- Rename bottom navbar `Support` button to `Unlock Requests`.
- Change page header from `Support Cases` to `Unlock Requests`.
- Approve Temporary Unlock button should only be enabled when:

```text
case.status === "PENDING_TENANT"
```

- Backend already rejects temporary unlock for non-`PENDING_TENANT`; app should also disable the button.

## View Case Page

- In Case Information card, remove `caseId`.
- Rename `Borrower Reason` to `Unlock Reason`.
- Make `Unlock Reason` bold.

## Sidebar

- Hide role from My Profile page.
- Hide Tenant Admin badge.

## Test Plan

- `/api/tenant/dashboard` returns all four alert keys.
- `unlockRequests` alert count is stored in `Tenant.dashboardAlerts.unlockRequests.count`.
- Opening `/api/tenant/unlock-requests` clears only `unlockRequests`.
- Home screen no longer shows removed cards.
- Devices screen cards map correctly from `devices.activated` and `devices.byState`.
- Register Borrower form does not send `loanId`.
- Register Borrower form shows read-only `Tenure Months` and sends the calculated value.
- Backend rejects mismatched `tenureMonths`.
- Backend returns generated borrower UID as `loanId`.
- Borrower Details EMI page uses `/tenant/users/:id/emi-installments`.
- Purchase Credits recent list uses `limit=5`; full page paginates.
- Temp unlock button is disabled unless case status is `PENDING_TENANT`.
