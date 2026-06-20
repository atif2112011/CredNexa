# Partner App Backend API Contract

Base URL:

```text
/api
```

Partner signup endpoints under `/api/partner/signup/*` are public.

Operational Partner APIs require an account access token from `/api/auth/login`.

```http
Authorization: Bearer <accessToken>
```

The logged-in account must have:

```text
role = partner_admin
tokenType = account
channelPartnerId = present
```

All responses use the shared shape:

```json
{
  "success": true,
  "message": "Message",
  "data": {}
}
```

Errors use:

```json
{
  "success": false,
  "error": "Error message"
}
```

## 1. Partner Signup

### Initiate OTP

```http
POST /api/partner/signup/initiate-otp
```

```json
{
  "mobile": "9876543210"
}
```

Response:

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "verificationSessionId": "otp_...",
    "otpSent": true,
    "expiresInSeconds": 600
  }
}
```

OTP is mocked as `123456` for now.

### Verify OTP

```http
POST /api/partner/signup/verify-otp
```

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "otp_...",
  "otp": "123456"
}
```

### Complete Signup

```http
POST /api/partner/signup/complete?createAccount=true
```

```json
{
  "name": "Ramesh Kumar",
  "mobile": "9876543210",
  "type": "independent",
  "verificationSessionId": "otp_...",
  "password": "Pass@123",
  "email": "optional@example.com"
}
```

Allowed `type` values: `nbfc_group`, `retail_chain_group`, `independent`.

`email` is optional. `password` is required when `createAccount=true`.

## 2. Partner Login

```http
POST /api/auth/login
```

Use partner admin email/password or mobile/password.

### Request

```json
{
  "email": "partner-admin@example.com",
  "password": "Password@123"
}
```

Mobile login:

```json
{
  "identifier": "9876543210",
  "password": "Password@123"
}
```

### Success Response

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "jwt-access-token",
    "tokenType": "account",
    "account": {
        "id": "accountId",
        "name": "Partner Admin",
        "email": "partner-admin@example.com",
        "mobile": "9876543210",
        "role": "partner_admin",
        "tenantId": null,
        "channelPartnerId": "channelPartnerId"
    }
  }
}
```

Refresh token is set as an HTTP-only cookie.

### Errors

```json
{
  "success": false,
  "error": "Email or identifier and password are required"
}
```

```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

## 3. Get Logged-In Profile

```http
GET /api/auth/me
```

Use for Profile screen and session validation.

### Success Response

```json
{
  "success": true,
  "message": "Current account fetched successfully",
  "data": {
    "account": {
      "id": "accountId",
      "name": "Partner Admin",
      "email": "partner-admin@example.com",
      "role": "partner_admin",
      "tenantId": null,
      "channelPartnerId": {
        "_id": "channelPartnerId",
        "name": "North Partner",
        "type": "regional_partner"
      }
    }
  }
}
```

## 4. Refresh Session

```http
POST /api/auth/refresh-token
```

Refresh token is read from the HTTP-only cookie.

### Request

No body required.

### Success Response

```json
{
  "success": true,
  "message": "Access token refreshed successfully",
  "data": {
    "accessToken": "new-jwt-access-token",
    "tokenType": "account"
  }
}
```

### Error

```json
{
  "success": false,
  "error": "Invalid or expired refresh token"
}
```

## 5. Logout

```http
POST /api/auth/logout
```

Clears the refresh cookie.

### Request

No body required.

### Success Response

```json
{
  "success": true,
  "message": "Logout successful",
  "data": null
}
```

## 6. Partner Dashboard

```http
GET /api/partner/dashboard
```

Shows tenants, borrowers, devices, open cases, partner escalations, and recent escalations.

### Success Response

```json
{
  "success": true,
  "message": "Partner dashboard fetched successfully",
  "data": {
    "channelPartner": {
      "id": "channelPartnerId",
      "name": "North Partner",
      "type": "regional_partner"
    },
    "tenants": {
      "total": 12,
      "active": 10,
      "inactive": 2
    },
    "accounts": {
      "tenantAdmins": 12
    },
    "borrowers": {
      "total": 320
    },
    "devices": {
      "total": 300,
      "byState": {
        "ACTIVE": 240,
        "LOCKED": 20,
        "TEMP_UNLOCK": 3
      }
    },
    "cases": {
      "open": 8,
      "escalatedToPartner": 3
    },
    "tenantIds": ["tenantId1", "tenantId2"],
    "recentEscalations": [
      {
        "_id": "unlockRequestId",
        "caseId": "CASE-2026-ABC123",
        "status": "ESCALATED_PARTNER",
        "tenantId": {
          "_id": "tenantId",
          "name": "Bharat Finance",
          "type": "nbfc"
        },
        "userId": {
          "_id": "userId",
          "name": "Borrower Name",
          "mobile": "9876543210",
          "loanId": "LOAN-001"
        },
        "deviceId": {
          "_id": "deviceId",
          "imei": "123456789012345",
          "deviceModel": "Pixel 7",
          "manufacturer": "Google",
          "state": "LOCKED"
        }
      }
    ]
  }
}
```

## 7. Tenant List

```http
GET /api/partner/tenants
```

Shows all tenants under the logged-in partner.

### Query Params

| Param | Notes |
| --- | --- |
| `status` | `active` or `inactive` |
| `capability` | Tenant capability, for example `lend` |
| `search` | Case-insensitive tenant name search |
| `page` | Default `1` |
| `limit` | Default `20`, max `100` |

### Example

```http
GET /api/partner/tenants?status=active&capability=lend&search=pune&page=1&limit=20
```

### Success Response

```json
{
  "success": true,
  "message": "Partner tenants fetched successfully",
  "data": {
    "items": [
      {
        "_id": "tenantId",
        "name": "Bharat Finance - Pune",
        "type": "nbfc",
        "capabilities": ["lend", "distribute"],
        "channelPartnerId": "channelPartnerId",
        "parentTenantId": null,
        "adminAccountId": "accountId",
        "supportPhone": "9800000002",
        "supportEmail": "support@tenant.in",
        "supportWhatsapp": "9800000002",
        "address": {
          "street": "MG Road",
          "city": "Pune",
          "state": "Maharashtra",
          "pincode": "411001"
        },
        "creditBalance": 0,
        "isActive": true,
        "createdBy": "accountId",
        "createdAt": "2026-06-14T00:00:00.000Z",
        "updatedAt": "2026-06-14T00:00:00.000Z"
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

## 8. Create Tenant

```http
POST /api/partner/tenants?app=true
```

Creates a tenant under the logged-in partner, copies default tenant/device policies, creates the default tenant admin account, and returns the tenant admin credentials.

Use `app=true` for the partner app tenant creation flow.

### Request

```json
{
  "name": "Bharat Finance - Jaipur",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "parentTenantId": "optional-parent-tenant-id",
  "supportPhone": "9800000002",
  "supportEmail": "support@tenant.in",
  "supportWhatsapp": "9800000002",
  "isAdhaarVerificationEnabled": false,
  "address": {
    "street": "MI Road",
    "city": "Jaipur",
    "state": "Rajasthan",
    "pincode": "302001"
  },
  "tenantAdmin": {
    "name": "Priya Sharma",
    "email": "priya@tenant.in",
    "mobile": "9800000003",
    "temporaryPassword": "optional-password"
  }
}
```

### Required Fields

```text
name
type
capabilities
```

Do not send:

```text
channelPartnerId
tenantPolicy
devicePolicies
```

These are managed by the backend.

### Tenant Admin Notes

When `app=true`, tenant admin email is required. Backend uses this fallback order:

```text
tenantAdmin.email
adminEmail
supportEmail
```

If `tenantAdmin.temporaryPassword` or root `temporaryPassword` is not sent, backend generates a temporary password and returns it once in the response.

### Success Response

```json
{
  "success": true,
  "message": "Partner tenant created successfully",
  "data": {
    "tenant": {
      "_id": "tenantId",
      "name": "Bharat Finance - Jaipur",
      "type": "nbfc",
      "capabilities": ["lend", "distribute"],
      "channelPartnerId": "channelPartnerId",
      "parentTenantId": null,
      "supportPhone": "9800000002",
      "supportEmail": "support@tenant.in",
      "supportWhatsapp": "9800000002",
      "isAdhaarVerificationEnabled": false,
      "address": {
        "street": "MI Road",
        "city": "Jaipur",
        "state": "Rajasthan",
        "pincode": "302001"
      },
      "isActive": true,
      "createdBy": "partnerAdminAccountId",
      "adminAccountId": "accountId"
    },
    "tenantPolicy": {
      "_id": "tenantPolicyId",
      "tenantId": "tenantId",
      "lockRules": {
        "dpd": 30,
        "gracePeriodDays": 7,
        "lockOnGraceExpiry": true
      },
      "unlockRules": {
        "unlockType": "instant",
        "delayMinutes": 0,
        "requireFullPayment": true,
        "partialUnlockOnPartialPayment": false,
        "requireReasonOnManualUnlock": true
      },
      "tempUnlockRules": {
        "defaultDurationHours": 24,
        "maxDurationHours": 72
      }
    },
    "devicePolicies": [
      {
        "_id": "devicePolicyId",
        "tenantId": "tenantId",
        "policyKey": "EMI_PAID",
        "restrictions": {}
      }
    ],
    "tenantAdmin": {
      "accountId": "accountId",
      "name": "Priya Sharma",
      "email": "priya@tenant.in",
      "mobile": "9800000003",
      "role": "tenant_admin",
      "tenantId": "tenantId",
      "channelPartnerId": "channelPartnerId"
    },
    "credentials": {
      "email": "priya@tenant.in",
      "temporaryPassword": "CNX-generated-password"
    }
  }
}
```

## 9. Escalation List

```http
GET /api/partner/escalations
```

Shows partner escalation queue.

### Query Params

| Param | Notes |
| --- | --- |
| `status` | Defaults to `ESCALATED_PARTNER` |
| `tenantId` | Must belong to this partner |
| `page` | Default `1` |
| `limit` | Default `20`, max `100` |

### Success Response

```json
{
  "success": true,
  "message": "Partner escalations fetched successfully",
  "data": {
    "items": [
      {
        "_id": "unlockRequestId",
        "caseId": "CASE-2026-ABC123",
        "status": "ESCALATED_PARTNER",
        "reasonCategory": "payment_issue",
        "reasonText": "Payment done but device still locked",
        "evidenceImageUrl": "https://...",
        "tenantId": {
          "_id": "tenantId",
          "name": "Bharat Finance",
          "type": "nbfc"
        },
        "userId": {
          "_id": "userId",
          "name": "Borrower Name",
          "mobile": "9876543210",
          "loanId": "LOAN-001"
        },
        "deviceId": {
          "_id": "deviceId",
          "imei": "123456789012345",
          "deviceModel": "Pixel 7",
          "manufacturer": "Google",
          "state": "LOCKED"
        }
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

## 10. Escalation Detail

```http
GET /api/partner/escalations/:caseId
```

Shows borrower, tenant, device, evidence image, reference text/details, command history, and audit trail.

### Success Response

```json
{
  "success": true,
  "message": "Partner escalation fetched successfully",
  "data": {
    "unlockRequest": {
      "_id": "unlockRequestId",
      "caseId": "CASE-2026-ABC123",
      "status": "ESCALATED_PARTNER",
      "reasonCategory": "payment_issue",
      "reasonText": "Payment done but device still locked",
      "evidenceImageUrl": "https://...",
      "metadata": {
        "reference": "UPI123456",
        "details": "Borrower shared bank reference"
      },
      "tenantId": {
        "_id": "tenantId",
        "name": "Bharat Finance",
        "type": "nbfc",
        "supportPhone": "9800000002",
        "supportEmail": "support@tenant.in"
      },
      "userId": {
        "_id": "userId",
        "name": "Borrower Name",
        "mobile": "9876543210",
        "loanId": "LOAN-001",
        "loanAmount": 50000,
        "emiAmount": 3000,
        "tenureMonths": 18
      },
      "deviceId": {
        "_id": "deviceId",
        "imei": "123456789012345",
        "imei2": "123456789012346",
        "deviceModel": "Pixel 7",
        "manufacturer": "Google",
        "androidVersion": "14",
        "state": "LOCKED",
        "currentPolicyKey": "EMI_LOCKED",
        "lastSeenAt": "2026-06-14T00:00:00.000Z"
      }
    },
    "commands": [
      {
        "_id": "commandId",
        "deviceId": "deviceId",
        "commandType": "LOCK",
        "status": "acknowledged",
        "createdAt": "2026-06-14T00:00:00.000Z"
      }
    ],
    "auditLogs": [
      {
        "_id": "auditLogId",
        "eventType": "UNLOCK_REQUEST_CREATED",
        "caseId": "CASE-2026-ABC123",
        "timestamp": "2026-06-14T00:00:00.000Z"
      }
    ]
  }
}
```

## 11. Temporary Unlock Escalation

```http
POST /api/partner/escalations/:caseId/temp-unlock
```

Used from Resolve Escalation. Requires `durationHours` and `note`.

### Request

```json
{
  "durationHours": 24,
  "note": "Emergency access approved after reviewing evidence."
}
```

`durationHours` must be greater than zero and cannot exceed tenant policy `tempUnlockRules.maxDurationHours`.

### Success Response

```json
{
  "success": true,
  "message": "Partner temporary unlock queued successfully",
  "data": {
    "unlockRequest": {
      "_id": "unlockRequestId",
      "caseId": "CASE-2026-ABC123",
      "status": "RESOLVED_PARTNER",
      "resolutionAction": "temp_unlocked",
      "resolutionNote": "Emergency access approved after reviewing evidence.",
      "tempUnlockDurationHours": 24
    },
    "device": {
      "_id": "deviceId",
      "state": "TEMP_UNLOCK",
      "currentPolicyKey": "TEMP_UNLOCKED",
      "desiredPolicyVersion": 5,
      "tempUnlockExpiresAt": "2026-06-15T00:00:00.000Z"
    },
    "command": {
      "_id": "commandId",
      "deviceId": "deviceId",
      "commandType": "TEMP_UNLOCK",
      "status": "pending",
      "triggeredBy": "partner_admin",
      "payload": {
        "note": "Emergency access approved after reviewing evidence.",
        "policyKey": "TEMP_UNLOCKED",
        "desiredPolicyVersion": 5,
        "durationHours": 24
      }
    }
  }
}
```

### Errors

```json
{
  "success": false,
  "error": "note and durationHours are required"
}
```

```json
{
  "success": false,
  "error": "durationHours cannot exceed 72"
}
```

## 12. Reject Escalation

```http
POST /api/partner/escalations/:caseId/reject
```

Used from Resolve Escalation. Requires `note`.

### Request

```json
{
  "note": "Evidence does not match the borrower loan/payment record."
}
```

### Success Response

```json
{
  "success": true,
  "message": "Partner escalation rejected successfully",
  "data": {
    "_id": "unlockRequestId",
    "caseId": "CASE-2026-ABC123",
    "status": "REJECTED",
    "resolutionAction": "rejected",
    "resolutionNote": "Evidence does not match the borrower loan/payment record.",
    "resolvedBy": "partnerAdminAccountId",
    "resolvedAt": "2026-06-14T00:00:00.000Z"
  }
}
```

## Do Not Use In Partner App

### Full Unlock

```http
POST /api/partner/escalations/:caseId/unlock
```

The backend supports this endpoint, but the partner app flow should not expose Full Unlock. Only show:

```text
Temporary Unlock
Reject
```

### Account CRUD Screens

These backend endpoints exist:

```http
GET /api/partner/accounts
POST /api/partner/accounts
PATCH /api/partner/accounts/:accountId
PATCH /api/partner/accounts/:accountId/status
```

Do not build separate account CRUD screens. For tenant creation, use:

```http
POST /api/partner/tenants?app=true
```

This creates the tenant admin and returns credentials directly.

## Backend Gaps / App Notes

1. There is no `GET /api/partner/tenants/:tenantId` endpoint right now.

Use the tenant list item for tenant detail, or add a detail API later.

2. Partner APIs are scoped by the logged-in partner token. Do not send `channelPartnerId` from the app for partner tenant creation.
