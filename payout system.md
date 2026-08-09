# Payout System

This document captures the payout system design, resolved decisions, and remaining open questions.

## Scope

There are three payment/payout parts:

1. Partner gets paid from Admin.
2. Tenant gets paid from User under EMI repayment.
3. Admin gets paid when Tenant purchases credits.

## Actors

- `Admin`
- `Partner`
- `Tenant`
- `User`

## Part 1: Partner Gets Paid From Admin

### Final Decisions

Partner earnings use a credit balance system.

When a tenant under a partner purchases keys, the backend awards partner credit based on the verified purchase amount.

The backend must not trust frontend-supplied payment totals. For the normal tenant purchase-request flow, the approved purchase amount is calculated on the backend as:

```text
grossPurchaseAmount = keysPurchased * basePerKeyPrice
discountAmount = grossPurchaseAmount * tenantSlabDiscountPercentage / 100
purchaseAmount = grossPurchaseAmount - discountAmount
```

`purchaseAmount` is the discounted net amount actually paid by the tenant. Partner commission is calculated from this net amount, not the gross amount.

All payout and credit amounts are stored as rupee numbers, not paisa.

### Payout Constants

Create a `PayoutConstants` collection.

Global default values:

```text
defaultPartnerCreditPercentage = 15
minPartnerPayoutAmount = 0
maxPartnerPayoutAmount = 0
```

`maxPartnerPayoutAmount = 0` means there is no global maximum cap. In that case, the maximum payout range shown to the partner is the partner's available payout balance.

These constants are used for new/default behavior, but partner-specific values can override them.

### Partner Document Fields

Add payout fields to the partner document.

```text
creditPercentage
availablePayoutBalance
payoutHoldBalance
lifetimePayoutEarned
lifetimePayoutPaid
payoutUpiId
payoutUpiName
```

Default partner `creditPercentage` is `15`.

This keeps backward compatibility for existing and newly created partners.

If a partner document does not yet have `creditPercentage`, backend falls back to:

```text
PayoutConstants.defaultPartnerCreditPercentage
```

If constants are not present, backend falls back to:

```text
15
```

### Partner Credit Calculation

Partner credit is awarded only after tenant key purchase/credit approval succeeds.

Current normal purchase hook:

```text
Tenant submits a key-purchase request
-> Backend snapshots base price, gross amount, matched discount slab, discount amount, and net purchaseAmount
-> Admin verifies payment and approves the request
-> Backend adds the purchased keys to the tenant
-> Backend calculates partner credit from the snapshotted net purchaseAmount
-> Partner available payout balance increases
-> Partner credit ledger entry is written
```

Formula:

```text
grossPurchaseAmount = keysPurchased * basePerKeyPrice
discountAmount = grossPurchaseAmount * tenantSlabDiscountPercentage / 100
purchaseAmount = grossPurchaseAmount - discountAmount
partnerCredit = purchaseAmount * creditPercentage / 100
```

Example:

```text
keysPurchased = 100
basePerKeyPrice = 100
tenantSlabDiscountPercentage = 15
grossPurchaseAmount = 10000
discountAmount = 1500
purchaseAmount = 8500
creditPercentage = 15
partnerCredit = 1275
```

### Backend Verification Rule

Frontend may send display values, but backend verifies the calculation.

If frontend sends:

```text
purchaseAmount
```

or:

```text
amount
```

the normal purchase-request backend verifies:

```text
submitted purchaseAmount == backend-calculated discounted purchaseAmount
```

If it does not match, the request fails.

The submitted `discountConfigVersion`, when provided, must match the tenant's latest configuration. A stale version fails with HTTP 409 and the tenant app must refresh purchase options.

### Legacy Manual Credit Adjustment

The following endpoint remains unchanged for backwards compatibility:

```http
POST /api/admin/tenants/:tenantId/credits/adjust
```

For a positive legacy adjustment only:

```text
purchaseAmount = delta * perKeyPrice
partnerCredit = purchaseAmount * creditPercentage / 100
```

This legacy path does not apply tenant discount slabs. New paid key purchases must use the tenant credit purchase-request flow.

### Partner Credit Ledger

Create `PartnerCreditLedger`.

The ledger stores each credit movement and preserves the percentage snapshot used at that time.

Ledger types:

```text
TENANT_KEY_PURCHASE_COMMISSION
PAYOUT_REQUEST_HOLD
PAYOUT_REJECTED_RELEASE
PAYOUT_APPROVED_PAID
ADMIN_ADJUSTMENT
```

Ledger fields include:

```text
channelPartnerId
tenantId
tenantCreditLedgerId
payoutRequestId
type
balanceType
delta
balanceBefore
balanceAfter
keysPurchased
perKeyPrice
grossPurchaseAmount
purchaseDiscountPercentage
purchaseDiscountAmount
purchaseAmount
creditPercentage
actorId
actorCollection
reason
metadata
```

The ledger is required because tenant slab discounts and partner percentages can change later. Old earning records keep the gross amount, discount snapshot, net `purchaseAmount`, and original `creditPercentage` used for that credit.

### Partner Payout Request

### Partner Payout Request Screen

The Partner App payout screen should call an API that returns:

```text
available payout range
partner UPI ID
partner UPI name
current payable credit/balance
```

If UPI name and UPI ID are not present, partner can enter them in the screen.

The payout summary API returns:

```text
creditPercentage
available balance
hold balance
lifetime earned
lifetime paid
minimum payout amount
maximum payout amount
UPI ID
UPI name
```

### Partner Request Payout Flow

```text
Partner opens payout screen
-> App fetches payout range, UPI ID, UPI name
-> Partner enters or confirms UPI details
-> Partner clicks Request Payout
-> Backend creates payout request for Admin
-> Partner tracks payout status in dedicated screen
```

When partner requests payout:

```text
availablePayoutBalance decreases
payoutHoldBalance increases
PartnerPayoutRequest is created as PENDING
PartnerCreditLedger entry is written as PAYOUT_REQUEST_HOLD
```

This prevents the same available balance from being requested multiple times.

### Partner Payout Tracking Screen

Partner should be able to see payout requests with statuses.

Status values:

```text
PENDING
APPROVED
REJECTED
```

Possible payout list fields:

```text
payoutRequestId
requestedAmount
upiId
upiName
status
requestedAt
approvedAt
rejectedAt
adminReferenceId
adminPaymentProofImageUrl
rejectionReason
```

### Admin Payout Approval Flow

Admin reviews partner payout requests.

Admin can approve by attaching:

```text
reference id
payment proof image
```

Admin can reject by providing:

```text
reason
```

When admin approves:

```text
payoutHoldBalance decreases
lifetimePayoutPaid increases
PartnerPayoutRequest becomes APPROVED
adminReferenceId is stored
payment proof image is stored
PartnerCreditLedger entry is written as PAYOUT_APPROVED_PAID
```

When admin rejects:

```text
payoutHoldBalance decreases
availablePayoutBalance increases
PartnerPayoutRequest becomes REJECTED
rejectionReason is stored
PartnerCreditLedger entry is written as PAYOUT_REJECTED_RELEASE
```

### Admin Configuration

Admin can update:

```text
PayoutConstants.defaultPartnerCreditPercentage
PayoutConstants.minPartnerPayoutAmount
PayoutConstants.maxPartnerPayoutAmount
ChannelPartner.creditPercentage
```

Changing `ChannelPartner.creditPercentage` affects only future partner credit calculations. Existing ledger entries keep the percentage that was used at the time.

## Part 2: Tenant Gets Paid By User

### Current Implementation

This flow is already implemented.

```text
EMI becomes due for User
-> User app fetches active Tenant QR
-> User pays using Tenant QR outside the app
-> User submits amount, reference/note, and optional proof image
-> Payment record is created as pending approval
-> Tenant reviews payment
-> Tenant approves or rejects payment
```

### Data Model

Payment records are stored in `Payment`.

Important fields:

```text
userId
tenantId
deviceId
emiScheduleId
amount
currency
paymentMethod = qr
qrCodeId
status
approvalStatus
submittedAt
approvedBy
approvedAt
rejectedBy
rejectedAt
rejectionReason
completedAt
matchedInstallments
proof
metadata.reference
metadata.note
metadata.approvalNote
```

Status values:

```text
status = approval_pending | success | rejected
approvalStatus = pending_approval | approved | rejected
```

### User App APIs

Fetch active tenant QR:

```text
GET /api/app/payment/qr
```

Submit payment:

```text
POST /api/app/payment/submit
```

Multipart fields:

```text
qrCodeId
amount
reference
note
proofImage
```

Payment proof image support:

```text
field name = proofImage
allowed types = JPEG, PNG, WebP
max size = 5 MB
```

List user payment history:

```text
GET /api/app/payment/history
```

Backend rules on submit:

```text
qrCodeId is required
amount is required and must be > 0
QR must belong to the user's active tenant and be active
only one pending payment is allowed per device
payment is created with status = approval_pending
payment is created with approvalStatus = pending_approval
PAYMENT_SUBMITTED audit log is written
```

### Tenant App APIs

List pending payments:

```text
GET /api/tenant/payments/pending-approval
GET /api/distributor/payments/pending-approval
```

List payment approval requests with filters:

```text
GET /api/tenant/payments/approval-requests?status=pending_approval&search=ramesh&page=1&limit=20
GET /api/distributor/payments/approval-requests?status=pending_approval&search=ramesh&page=1&limit=20
```

Fetch payment detail:

```text
GET /api/tenant/payments/:paymentId
GET /api/distributor/payments/:paymentId
```

Approve payment:

```text
POST /api/tenant/payments/:paymentId/approve
POST /api/distributor/payments/:paymentId/approve
```

Reject payment:

```text
POST /api/tenant/payments/:paymentId/reject
POST /api/distributor/payments/:paymentId/reject
```

### Tenant Payment Approval Logic

If approved:

```text
payment.status becomes success
payment.approvalStatus becomes approved
approvedBy is stored
approvedAt is stored
completedAt is stored
approval note is stored in metadata.approvalNote
payment amount is applied to unpaid installments in order
installments become paid or partial
matchedInstallments are stored on payment
EMI schedule overdue counts/amounts are recalculated
grace reminder history is cleared for fully paid installments
UNLOCK command is queued for the device
PAYMENT_APPROVED audit log is written
UNLOCK_TRIGGERED audit log is written
```

If rejected:

```text
reason is required
payment.status becomes rejected
payment.approvalStatus becomes rejected
rejectedBy is stored
rejectedAt is stored
rejectionReason is stored
installments are not changed
no unlock command is queued
PAYMENT_REJECTED audit log is written
```

### Resolved Questions

1. Are we keeping a record of payments approved by a tenant?

Yes. `Payment` stores `approvedBy`, `approvedAt`, `status`, `approvalStatus`, `completedAt`, `matchedInstallments`, and approval note.

2. What exact fields should be visible to the tenant during payment approval?

Tenant should see:

```text
borrower name
borrower mobile
loanId
device IMEI/model/manufacturer/state
amount
reference
note
proof image
submittedAt
status
approvalStatus
matchedInstallments if already resolved
rejectionReason if rejected
```

3. Should tenant approval history be exposed in tenant dashboard or payment detail screens?

Yes. The current backend exposes payment approval list and detail APIs. Dashboard may show summary counts later, but payment list/detail is already enough for history and review workflows.

## Part 3: Admin Gets Paid When Tenant Purchases Credits

### Final Decisions

Tenant can request to purchase credits from Admin.

The tenant pays externally using Admin UPI/QR, uploads proof, and submits a credit purchase request.

The backend creates a pending request. Tenant credits are not added until Admin approves.

### Default Values

Store these in `PayoutConstants`:

```text
defaultTenantCreditPerKeyPrice = 100
minTenantCreditPurchase = 1
maxTenantCreditPurchase = 2000
adminCreditPurchaseUpiId = test@ybl.in
adminCreditPurchaseUpiName = Test Admin
adminCreditPurchaseQrImageUrl = https://placehold.co/600x400
```

All amounts are rupee numbers, not paisa.

### Per Key Price Logic

Use a layered price system:

```text
Tenant.creditPurchasePerKeyPrice if set
else PayoutConstants.defaultTenantCreditPerKeyPrice
```

The effective price is returned to the tenant app from the credit purchase options API.

The backend selects the tenant-specific quantity slab and calculates:

```text
grossPurchaseAmount = requestedCredits * effectivePerKeyPrice
discountAmount = grossPurchaseAmount * discountPercentage / 100
purchaseAmount = grossPurchaseAmount - discountAmount
```

The frontend can display the calculated amount, but backend does not trust frontend amount values.

If frontend sends `purchaseAmount` or `amount`, backend verifies:

```text
submitted amount == backend-calculated discounted purchaseAmount
```

If the values do not match, the request fails.

### Tenant Document Fields

Add these fields to `Tenant`:

```text
creditPurchasePerKeyPrice
creditPurchaseDiscountSlabs
creditPurchaseDiscountVersion
creditPurchaseDiscountUpdatedAt
creditPurchaseDiscountUpdatedBy
totalCreditsPurchased
lifetimeCreditPurchaseAmount
lastCreditPurchasedAt
```

`creditPurchasePerKeyPrice` is optional and allows tenant-specific pricing.

`totalCreditsPurchased`, `lifetimeCreditPurchaseAmount`, and `lastCreditPurchasedAt` are aggregate fields for dashboards and partner metrics. The ledger remains the source of truth.

### Credit Purchase Request

Create `TenantCreditPurchaseRequest`.

Fields:

```text
requested credit quantity
perKeyPrice snapshot
grossPurchaseAmount snapshot
discountPercentage snapshot
discountAmount snapshot
discountSlabSnapshot
discountConfigVersion
purchaseAmount snapshot (net amount paid)
admin UPI/QR snapshot
payment proof image
referenceNumber optional
status
requestedBy
requestedAt
approvedBy
approvedAt
rejectedBy
rejectedAt
rejectionReason
tenantCreditLedgerId
partnerCreditLedgerId
metadata
```

Status values:

```text
PENDING
APPROVED
REJECTED
```

### Tenant Credit Purchase Flow

Tenant gets options:

```text
Tenant opens purchase credits screen
-> App fetches effective per key price, tenant discount slabs, config version, min/max limits, Admin UPI/QR
-> Tenant enters requested credits
-> App displays gross amount, slab discount, and net payable amount
-> Tenant pays externally through UPI/payment app
-> Tenant uploads payment proof image
-> Tenant optionally enters referenceNumber
-> Tenant clicks Request Credit
-> Backend creates credit purchase request
-> Admin reviews request
```

Backend rules on submit:

```text
requestedCredits must be integer
requestedCredits >= minTenantCreditPurchase
requestedCredits <= maxTenantCreditPurchase when max > 0
payment proof image is required
only one pending request per tenant is allowed
purchaseAmount is calculated by backend
gross amount, matched slab, percentage, discount amount, net amount, and config version are snapshotted
tenant creditBalance does not change
partner payout balance does not change
```

### Admin Credit Purchase Approval Flow

Admin checks the credit purchase request.

Admin can approve:

```text
verify payment proof
approve request
add credits to tenant account
write TenantCreditLedger entry
update tenant aggregate counters
award partner credit if tenant belongs to partner
write PartnerCreditLedger entry if partner credit is awarded
mark request approved
```

Admin can reject:

```text
provide rejection reason
mark request rejected
```

When Admin approves:

```text
Tenant.creditBalance increases
Tenant.totalCreditsPurchased increases
Tenant.lifetimeCreditPurchaseAmount increases
Tenant.lastCreditPurchasedAt is set
TenantCreditLedger entry type = TENANT_CREDIT_PURCHASE
Partner credit is calculated from the discounted net purchaseAmount if tenant belongs to a partner
TenantCreditPurchaseRequest status becomes APPROVED
```

When Admin rejects:

```text
Tenant.creditBalance does not change
Partner payout balance does not change
rejectionReason is stored
TenantCreditPurchaseRequest status becomes REJECTED
```

### API Summary

Tenant app:

```text
GET /api/tenant/credits/purchase/options
POST /api/tenant/credits/purchase/requests
GET /api/tenant/credits/purchase/requests
GET /api/tenant/credits/purchase/requests/:requestId
```

Discount management:

```text
PUT /api/admin/tenants/:tenantId/credit-purchase-discounts
PUT /api/partner/tenants/:tenantId/credit-purchase-discounts
```

Both endpoints replace the complete percentage set, keep quantity ranges fixed, lock 0-25 at 0%, cap every percentage at 50%, increment the tenant configuration version, and write an audit log. The partner endpoint can update only tenants owned by that partner.

The legacy `POST /api/admin/tenants/:tenantId/credits/adjust` route is retained unchanged for backwards compatibility and does not use discount slabs.

Admin:

```text
GET /api/admin/tenant-credit-purchases
GET /api/admin/tenant-credit-purchases/:requestId
POST /api/admin/tenant-credit-purchases/:requestId/approve
POST /api/admin/tenant-credit-purchases/:requestId/reject
```

## Cross-System Concepts To Define Later

### Records And Ledgers

Possible records needed:

```text
PartnerCreditLedger
PartnerPayoutRequest
TenantCreditPurchaseRequest
TenantCreditLedger
Payment
```

### Image Support

Payment proof images are needed for:

```text
Partner payout approval by Admin
Tenant credit purchase request by Tenant
User EMI payment proof
```

### UPI Details

UPI details may be needed for:

```text
Partner payout receiving account
Admin credit purchase QR/account
Tenant EMI collection QR/account
```

### Audit Trail

The payout system should preserve audit history for:

```text
credit awarded
credit consumed
payout requested
payout approved
payout rejected
tenant credit purchase requested
tenant credit purchase approved
tenant credit purchase rejected
payment proof submitted
payment proof approved
payment proof rejected
```

## High-Level Flow Summary

```text
Tenant buys credits from Admin
-> Admin approves credit purchase
-> Tenant credit balance increases
-> If tenant belongs to partner, partner credit may increase
-> Partner can request payout from Admin
-> Admin approves or rejects partner payout
```

```text
User pays EMI to Tenant
-> Tenant approves payment
-> EMI/installment state updates
-> Device unlock behavior happens based on current policy/state
```
