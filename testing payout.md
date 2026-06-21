# Testing Payout

This document lists payout test cases to use as the system grows.

## Scope

Payout/payment areas:

1. Partner gets paid from Admin.
2. Tenant gets paid from User under EMI repayment.
3. Admin gets paid when Tenant purchases credits.

Part 1 is implemented first. Parts 2 and 3 test cases should be completed after those flows are finalized.

## Part 1: Partner Gets Paid From Admin

### Setup

Required test data:

```text
super_admin account
partner_admin account
channelPartner linked to partner_admin
tenant under channelPartner
tenant credit adjustment endpoint available
```

Recommended starting values:

```text
ChannelPartner.creditPercentage = 15
ChannelPartner.availablePayoutBalance = 0
ChannelPartner.payoutHoldBalance = 0
PayoutConstants.minPartnerPayoutAmount = 0
PayoutConstants.maxPartnerPayoutAmount = 0
```

### Payout Constants

#### TC-PARTNER-PAYOUT-001: Fetch Default Constants

API:

```http
GET /api/admin/payout/constants
```

Expected:

```text
success = true
defaultPartnerCreditPercentage = 15
minPartnerPayoutAmount = 0
maxPartnerPayoutAmount = 0
```

#### TC-PARTNER-PAYOUT-002: Update Constants

API:

```http
PATCH /api/admin/payout/constants
```

Body:

```json
{
  "defaultPartnerCreditPercentage": 15,
  "minPartnerPayoutAmount": 0,
  "maxPartnerPayoutAmount": 0
}
```

Expected:

```text
success = true
values are updated
audit log is written
```

#### TC-PARTNER-PAYOUT-003: Reject Invalid Percentage

Body:

```json
{
  "defaultPartnerCreditPercentage": 101
}
```

Expected:

```text
request fails
error says percentage must be between 0 and 100
```

#### TC-PARTNER-PAYOUT-004: Reject Invalid Min/Max

Body:

```json
{
  "minPartnerPayoutAmount": 1000,
  "maxPartnerPayoutAmount": 500
}
```

Expected:

```text
request fails
max cannot be less than min unless max is 0
```

### Partner Credit Earning

#### TC-PARTNER-PAYOUT-005: Positive Tenant Credit Adjustment Awards Partner Credit

API:

```http
POST /api/admin/tenants/:tenantId/credits/adjust
```

Body:

```json
{
  "delta": 10,
  "perKeyPrice": 100,
  "purchaseAmount": 1000,
  "reason": "Tenant purchased 10 keys"
}
```

Expected:

```text
tenant creditBalance increases by 10
TenantCreditLedger entry is written
partner credit = 1000 * 15 / 100 = 150
ChannelPartner.availablePayoutBalance increases by 150
ChannelPartner.lifetimePayoutEarned increases by 150
PartnerCreditLedger entry type = TENANT_KEY_PURCHASE_COMMISSION
response includes partnerCredit
```

#### TC-PARTNER-PAYOUT-006: Backend Rejects Mismatched Purchase Amount

Body:

```json
{
  "delta": 10,
  "perKeyPrice": 100,
  "purchaseAmount": 999,
  "reason": "Invalid total"
}
```

Expected:

```text
request fails
tenant creditBalance does not change
partner payout balance does not change
no partner credit ledger entry is created
```

#### TC-PARTNER-PAYOUT-007: Positive Adjustment Requires Per Key Price

Body:

```json
{
  "delta": 10,
  "reason": "Missing key price"
}
```

Expected:

```text
request fails
error says perKeyPrice is required
```

#### TC-PARTNER-PAYOUT-008: Negative Tenant Credit Adjustment Does Not Award Partner Credit

Body:

```json
{
  "delta": -2,
  "reason": "Manual correction"
}
```

Expected:

```text
tenant creditBalance decreases by 2 if enough balance exists
TenantCreditLedger entry is written
partner payout balance does not change
no TENANT_KEY_PURCHASE_COMMISSION entry is created
```

#### TC-PARTNER-PAYOUT-009: Partner-Specific Percentage Is Used

Setup:

```text
ChannelPartner.creditPercentage = 20
```

Body:

```json
{
  "delta": 5,
  "perKeyPrice": 200,
  "purchaseAmount": 1000,
  "reason": "Tenant purchased 5 keys"
}
```

Expected:

```text
partner credit = 1000 * 20 / 100 = 200
PartnerCreditLedger.creditPercentage = 20
```

### Partner Payout Summary

#### TC-PARTNER-PAYOUT-010: Fetch Payout Summary

API:

```http
GET /api/partner/payout/summary
```

Expected:

```text
success = true
balances.available is returned
balances.onHold is returned
payoutRange.min is returned
payoutRange.max is returned
upi details are returned
```

#### TC-PARTNER-PAYOUT-011: Max Payout Uses Available Balance When Global Max Is 0

Setup:

```text
PayoutConstants.maxPartnerPayoutAmount = 0
availablePayoutBalance = 150
```

Expected:

```text
payoutRange.max = 150
payoutRange.hasMaximumCap = false
```

#### TC-PARTNER-PAYOUT-012: Max Payout Respects Global Cap

Setup:

```text
PayoutConstants.maxPartnerPayoutAmount = 100
availablePayoutBalance = 150
```

Expected:

```text
payoutRange.max = 100
payoutRange.hasMaximumCap = true
```

### Partner Requests Payout

#### TC-PARTNER-PAYOUT-013: Create Payout Request

API:

```http
POST /api/partner/payout/requests
```

Body:

```json
{
  "amount": 100,
  "upiId": "partner@upi",
  "upiName": "Partner Name"
}
```

Expected:

```text
PartnerPayoutRequest is created with status PENDING
availablePayoutBalance decreases by 100
payoutHoldBalance increases by 100
PartnerCreditLedger entry type = PAYOUT_REQUEST_HOLD
UPI details are stored on ChannelPartner
```

#### TC-PARTNER-PAYOUT-014: Reject Request Above Available Balance

Body:

```json
{
  "amount": 999999,
  "upiId": "partner@upi",
  "upiName": "Partner Name"
}
```

Expected:

```text
request fails
availablePayoutBalance does not change
payoutHoldBalance does not change
no payout request is created
```

#### TC-PARTNER-PAYOUT-015: Reject Missing UPI Details

Body:

```json
{
  "amount": 100
}
```

Expected:

```text
request fails if partner has no saved UPI
error says UPI ID and UPI name are required
```

#### TC-PARTNER-PAYOUT-016: Reject Invalid UPI ID

Body:

```json
{
  "amount": 100,
  "upiId": "invalid-upi",
  "upiName": "Partner Name"
}
```

Expected:

```text
request fails
error says valid UPI ID is required
```

#### TC-PARTNER-PAYOUT-017: Prevent Duplicate Use Of Same Balance

Steps:

```text
availablePayoutBalance = 100
create payout request for 100
try to create another payout request for 100
```

Expected:

```text
first request succeeds
second request fails
availablePayoutBalance remains 0 after first request
payoutHoldBalance remains 100
```

### Partner Payout History

#### TC-PARTNER-PAYOUT-018: List Payout Requests

API:

```http
GET /api/partner/payout/requests?page=1&limit=20
```

Expected:

```text
only authenticated partner's payout requests are returned
pagination is returned
```

#### TC-PARTNER-PAYOUT-019: Filter Payout Requests By Status

API:

```http
GET /api/partner/payout/requests?status=PENDING
```

Expected:

```text
only PENDING requests are returned
```

### Admin Reviews Payout

#### TC-PARTNER-PAYOUT-020: Admin Lists Payout Requests

API:

```http
GET /api/admin/partner-payouts?status=PENDING&page=1&limit=20
```

Expected:

```text
admin sees pending payout requests
partner details are populated
pagination is returned
```

#### TC-PARTNER-PAYOUT-021: Admin Gets Payout Detail

API:

```http
GET /api/admin/partner-payouts/:payoutId
```

Expected:

```text
payout request detail is returned
partner credit ledger entries linked to the payout are returned
```

#### TC-PARTNER-PAYOUT-022: Admin Approves Payout With Image Upload

API:

```http
POST /api/admin/partner-payouts/:payoutId/approve
Content-Type: multipart/form-data
```

Fields:

```text
referenceId = UTR123456
proofImage = image file
```

Expected:

```text
payout status becomes APPROVED
payoutHoldBalance decreases by payout amount
lifetimePayoutPaid increases by payout amount
adminReferenceId is stored
paymentProof image metadata is stored
PartnerCreditLedger entry type = PAYOUT_APPROVED_PAID
audit log is written
```

#### TC-PARTNER-PAYOUT-023: Admin Approves Payout With Image URL Fallback

Body:

```json
{
  "referenceId": "UTR123456",
  "paymentProofImageUrl": "https://storage.example.com/proof.png"
}
```

Expected:

```text
payout is approved
paymentProof.imageUrl is stored
```

#### TC-PARTNER-PAYOUT-024: Reject Approval Without Reference

Expected:

```text
request fails
status remains PENDING
balances remain unchanged
```

#### TC-PARTNER-PAYOUT-025: Reject Approval Without Proof

Expected:

```text
request fails
status remains PENDING
balances remain unchanged
```

#### TC-PARTNER-PAYOUT-026: Admin Rejects Payout

API:

```http
POST /api/admin/partner-payouts/:payoutId/reject
```

Body:

```json
{
  "reason": "UPI ID mismatch"
}
```

Expected:

```text
payout status becomes REJECTED
payoutHoldBalance decreases by payout amount
availablePayoutBalance increases by payout amount
rejectionReason is stored
PartnerCreditLedger entry type = PAYOUT_REJECTED_RELEASE
audit log is written
```

#### TC-PARTNER-PAYOUT-027: Cannot Resolve Already Resolved Payout

Steps:

```text
approve or reject a payout
try to approve it again
try to reject it again
```

Expected:

```text
second action fails
balances do not change again
```

## Part 2: Tenant Gets Paid By User

These cases apply to the implemented tenant EMI payment approval flow.

### Current Flow

```text
User fetches tenant QR
User pays EMI on tenant QR
User submits amount, optional reference/note, and optional proof image
Tenant approves or rejects payment
Approved payment applies to EMI installments
Device unlock command is queued when applicable
```

#### TC-TENANT-USER-PAYMENT-001: User Submits EMI Payment Proof

APIs:

```http
GET /api/app/payment/qr
POST /api/app/payment/submit
```

Expected areas:

```text
QR validation
amount validation
image validation when proofImage is uploaded
only one pending payment per device is allowed
payment status = approval_pending
approvalStatus = pending_approval
tenant scoped payment record created
PAYMENT_SUBMITTED audit log is written
```

#### TC-TENANT-USER-PAYMENT-002: Tenant Approves Payment

API:

```http
POST /api/tenant/payments/:paymentId/approve
POST /api/distributor/payments/:paymentId/approve
```

Expected areas:

```text
payment status becomes success
approvalStatus becomes approved
approvedBy is stored
approvedAt is stored
completedAt is stored
installments receive paid amount
matched installments are stored
overdue counts/amounts are recalculated
grace reminder history is cleared for fully paid installments
device unlock command is queued
audit logs are written
```

#### TC-TENANT-USER-PAYMENT-003: Tenant Rejects Payment

API:

```http
POST /api/tenant/payments/:paymentId/reject
POST /api/distributor/payments/:paymentId/reject
```

Expected areas:

```text
reason is required
payment status becomes rejected
approvalStatus becomes rejected
rejectedBy is stored
rejectedAt is stored
rejection reason is stored
installments are unchanged
no unlock command is queued
PAYMENT_REJECTED audit log is written
```

#### TC-TENANT-USER-PAYMENT-004: Tenant Cannot Approve Another Tenant's Payment

Expected areas:

```text
tenant scoping prevents access
payment remains unchanged
```

#### TC-TENANT-USER-PAYMENT-005: Already Resolved Payment Cannot Be Approved Or Rejected Again

Expected areas:

```text
second action fails
installments are not double-paid
unlock command is not duplicated
```

#### TC-TENANT-USER-PAYMENT-006: Tenant Lists Payment Approval Requests

APIs:

```http
GET /api/tenant/payments/pending-approval
GET /api/tenant/payments/approval-requests?status=pending_approval&page=1&limit=20
GET /api/distributor/payments/pending-approval
GET /api/distributor/payments/approval-requests?status=pending_approval&page=1&limit=20
```

Expected areas:

```text
only tenant-scoped payments are returned
borrower details are populated
device details are populated
pagination is returned for approval-requests
search works by borrower/reference fields
```

#### TC-TENANT-USER-PAYMENT-007: Tenant Fetches Payment Detail

APIs:

```http
GET /api/tenant/payments/:paymentId
GET /api/distributor/payments/:paymentId
```

Expected areas:

```text
only tenant-scoped payment can be fetched
borrower details are populated
device details are populated
proof image metadata is returned
status and approvalStatus are returned
```

## Part 3: Admin Gets Paid When Tenant Purchases Credits

These cases apply to the tenant credit purchase request flow.

### Proposed Flow To Test Later

```text
Tenant opens credit purchase screen
Tenant sees admin QR
Tenant selects keys/credits
Backend calculates amount using perKeyPrice
Tenant uploads payment proof image
Tenant optionally enters reference number
Tenant submits credit purchase request
Admin approves or rejects request
Approved request adds tenant credits
Approved request awards partner credit if tenant belongs to partner
```

Default values:

```text
defaultTenantCreditPerKeyPrice = 100
minTenantCreditPurchase = 1
maxTenantCreditPurchase = 500
adminCreditPurchaseUpiId = test@ybl.in
adminCreditPurchaseUpiName = Test Admin
adminCreditPurchaseQrImageUrl = https://placehold.co/600x400
```

### Future Test Cases To Keep

#### TC-TENANT-CREDIT-PURCHASE-001: Tenant Fetches Admin QR And Price

API:

```http
GET /api/tenant/credits/purchase/options
```

Expected areas:

```text
active admin QR returned
perKeyPrice returned
min/max credits returned if configured
```

#### TC-TENANT-CREDIT-PURCHASE-002: Tenant Submits Credit Purchase Request

API:

```http
POST /api/tenant/credits/purchase/requests
Content-Type: multipart/form-data
```

Expected areas:

```text
requested credits required
payment proof image required
reference number optional
backend calculates amount
request status = PENDING
```

#### TC-TENANT-CREDIT-PURCHASE-003: Backend Rejects Frontend Amount Tampering

Expected areas:

```text
frontend amount does not match keys * perKeyPrice
request fails or backend ignores frontend amount
verified amount is server-calculated
```

#### TC-TENANT-CREDIT-PURCHASE-004: Admin Approves Credit Purchase

API:

```http
POST /api/admin/tenant-credit-purchases/:requestId/approve
```

Expected areas:

```text
request status becomes APPROVED
tenant creditBalance increases
TenantCreditLedger entry is written
PartnerCreditLedger entry is written if tenant has partner
partner available payout balance increases
```

#### TC-TENANT-CREDIT-PURCHASE-005: Admin Rejects Credit Purchase

API:

```http
POST /api/admin/tenant-credit-purchases/:requestId/reject
```

Expected areas:

```text
request status becomes REJECTED
rejection reason is stored
tenant creditBalance does not change
partner payout balance does not change
```

#### TC-TENANT-CREDIT-PURCHASE-006: Already Resolved Credit Purchase Cannot Be Resolved Again

Expected areas:

```text
second action fails
tenant credits are not duplicated
partner credits are not duplicated
```

#### TC-TENANT-CREDIT-PURCHASE-007: Tenant Cannot View Or Submit Request For Another Tenant

Expected areas:

```text
tenant scoping prevents access
request is not created
```
