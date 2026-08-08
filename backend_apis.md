# Backend APIs

Base path: `/api`

## Navigation

1. [Admin APIs](#admin-apis)
   - [Dashboard](#get-admindashboard)
   - [Channel Partners](#get-adminchannel-partners)
   - [Tenants](#get-admintenants)
   - [Accounts](#get-adminaccounts)
   - [Consent Versions](#get-adminconsent-versions)
   - [Escalations / Cases](#get-adminescalations)
   - [Devices and Commands](#get-admindevices)
   - [Risk Flags](#get-adminrisk-flags)
   - [Audit Logs](#get-adminaudit-logs)
2. [Tenant / Distributor APIs](#tenant-apis)
   - [Dashboard](#get-tenantdashboard)
   - [Borrower Registration and Enrollment](#post-tenantusersregister)
   - [Borrowers](#get-tenantusers)
   - [Upcoming EMI Borrowers](#get-tenantuserspending-emis)
   - [Overdue EMI Borrowers](#get-tenantusersoverdue-emis)
   - [Borrower EMI Installments](#get-tenantusersidemi-installments)
   - [Devices](#get-tenantdevices)
   - [Upcoming Payment Reminder](#post-tenantdevicesidupcoming-payment-reminder)
   - [Payment QR Codes](#get-tenantqr-codes)
   - [Payment Approval](#get-tenantpaymentsapproval-requests)
   - [Unlock Requests](#get-tenantunlock-requests)
3. [Partner APIs](#partner-apis)
   - [Dashboard](#get-partnerdashboard)
   - [Tenants](#get-partnertenants)
   - [Accounts](#get-partneraccounts)
   - [Escalations / Cases](#get-partnerescalations)
4. [App APIs](#app-apis)
   - [Testing Token](#post-apptestingaccess-token)
   - [Consent](#get-appconsentterms)
   - [Device](#post-appdeviceregister)
   - [Payments](#get-apppaymentqr)
   - [Unlock Request](#post-appunlock-request)
5. [Shared Auth](#shared-auth)
6. [Health](#health)

Success response format:

```json
{
  "success": true,
  "message": "Operation message",
  "data": {}
}
```

Error response format:

```json
{
  "success": false,
  "error": "Error message"
}
```

Most protected routes require:

```http
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

Account tokens use `tokenType: "account"`. User app tokens use `tokenType: "user"`.

## Shared Auth

### `POST /auth/login`

Logs in a super admin, partner admin, or tenant admin account. Returns an access token and stores the refresh token in an HTTP-only cookie.

Sample request body:

```json
{
  "email": "admin@crednexa.in",
  "password": "Welcome@123"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "jwt-access-token",
    "tokenType": "account",
    "account": {
      "id": "665f00000000000000000001",
      "name": "Super Admin",
      "email": "admin@crednexa.in",
      "role": "super_admin",
      "tenantId": null,
      "channelPartnerId": null
    }
  }
}
```

### `POST /auth/refresh-token`

Uses the refresh token cookie to issue a new account access token.

Sample request body:

```json
{}
```

Sample response:

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

### `POST /auth/logout`

Clears the refresh token cookie.

Sample request body:

```json
{}
```

Sample response:

```json
{
  "success": true,
  "message": "Logout successful",
  "data": null
}
```

### `GET /auth/me`

Fetches the current authenticated account.

Sample response:

```json
{
  "success": true,
  "message": "Current account fetched successfully",
  "data": {
    "account": {
      "id": "665f00000000000000000001",
      "name": "Super Admin",
      "email": "admin@crednexa.in",
      "role": "super_admin",
      "tenantId": null,
      "channelPartnerId": null
    }
  }
}
```

## Admin APIs

All `/admin` APIs require a `super_admin` account token.

### `GET /admin/dashboard`

Returns platform metrics across partners, tenants, accounts, devices, escalations, risk flags, and recent activity.

Sample response:

```json
{
  "success": true,
  "message": "Dashboard fetched successfully",
  "data": {
    "counts": {
      "partners": 1,
      "tenants": 3,
      "accounts": 5,
      "devices": 12,
      "openCases": 2,
      "riskFlags": 1
    },
    "devicesByState": {
      "ACTIVE": 10,
      "LOCKED": 2
    },
    "recentEscalations": [],
    "recentRiskFlags": []
  }
}
```

### `GET /admin/channel-partners`

Lists channel partners.

Query params: `status`, `type`, `search`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Channel partners fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000010",
        "name": "Bharat Finance Group",
        "type": "nbfc_group",
        "contactEmail": "ops@bharatfinance.in",
        "isActive": true
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

### `POST /admin/channel-partners`

Creates a channel partner.

Sample request body:

```json
{
  "name": "Bharat Finance Group",
  "type": "nbfc_group",
  "contactEmail": "ops@bharatfinance.in",
  "contactPhone": "9800000001"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Channel partner created successfully",
  "data": {
    "_id": "665f00000000000000000010",
    "name": "Bharat Finance Group",
    "type": "nbfc_group",
    "isActive": true
  }
}
```

### `GET /admin/channel-partners/:id`

Fetches one channel partner.

Sample response:

```json
{
  "success": true,
  "message": "Channel partner fetched successfully",
  "data": {
    "_id": "665f00000000000000000010",
    "name": "Bharat Finance Group",
    "type": "nbfc_group",
    "contactEmail": "ops@bharatfinance.in",
    "contactPhone": "9800000001",
    "isActive": true
  }
}
```

### `PATCH /admin/channel-partners/:id`

Updates partner profile fields.

Sample request body:

```json
{
  "name": "Bharat Finance Group",
  "contactEmail": "ops@bharatfinance.in",
  "contactPhone": "9800000001"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Channel partner updated successfully",
  "data": {
    "_id": "665f00000000000000000010",
    "name": "Bharat Finance Group"
  }
}
```

### `PATCH /admin/channel-partners/:id/status`

Activates or deactivates a channel partner.

Sample request body:

```json
{
  "isActive": false,
  "reason": "Contract ended"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Channel partner status updated successfully",
  "data": {
    "_id": "665f00000000000000000010",
    "isActive": false
  }
}
```

### `GET /admin/tenants`

Lists tenants.

Query params: `channelPartnerId`, `capability`, `status`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Tenants fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000020",
        "name": "Bharat Finance - Pune",
        "type": "nbfc",
        "channelPartnerId": {
          "_id": "665f00000000000000000010",
          "name": "Bharat Finance Group"
        },
        "isActive": true
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

### `POST /admin/tenants`

Creates a tenant and copies centralized default tenant and device policies. `tenantPolicy` and `devicePolicies` must not be sent because policies are centrally managed.

Sample request body:

```json
{
  "name": "Bharat Finance - Pune",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "channelPartnerId": "665f00000000000000000010",
  "supportPhone": "9800000002",
  "supportEmail": "support@tenant.in"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Tenant created successfully",
  "data": {
    "tenant": {
      "_id": "665f00000000000000000020",
      "name": "Bharat Finance - Pune",
      "isActive": true
    },
    "tenantPolicy": {
      "_id": "665f00000000000000000021",
      "version": 1
    },
    "devicePolicies": [
      {
        "_id": "665f00000000000000000022",
        "policyKey": "EMI_PAID",
        "isActive": true
      }
    ]
  }
}
```

### `GET /admin/tenants/:id`

Fetches tenant detail with tenant policy, device policies, accounts, device summary, open cases, and risk flags.

Sample response:

```json
{
  "success": true,
  "message": "Tenant fetched successfully",
  "data": {
    "tenant": {
      "_id": "665f00000000000000000020",
      "name": "Bharat Finance - Pune"
    },
    "tenantPolicy": {
      "lockRules": {
        "dpd": 30,
        "gracePeriodDays": 7
      }
    },
    "devicePolicies": [],
    "accounts": [],
    "deviceSummary": [],
    "openCases": [],
    "riskFlags": []
  }
}
```

### `PATCH /admin/tenants/:id`

Updates tenant profile and support details.

Sample request body:

```json
{
  "supportPhone": "9800000009",
  "supportEmail": "support@tenant.in",
  "address": {
    "city": "Pune"
  }
}
```

Sample response:

```json
{
  "success": true,
  "message": "Tenant updated successfully",
  "data": {
    "_id": "665f00000000000000000020",
    "supportPhone": "9800000009",
    "supportEmail": "support@tenant.in"
  }
}
```

### `PATCH /admin/tenants/:id/status`

Activates or deactivates a tenant.

Sample request body:

```json
{
  "isActive": false,
  "reason": "Tenant offboarded"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Tenant status updated successfully",
  "data": {
    "_id": "665f00000000000000000020",
    "isActive": false
  }
}
```

### `GET /admin/accounts`

Lists `partner_admin` and `tenant_admin` accounts.

Query params: `role`, `tenantId`, `channelPartnerId`, `status`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Accounts fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000030",
        "name": "Priya Sharma",
        "email": "priya@tenant.in",
        "role": "tenant_admin",
        "isActive": true
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

### `POST /admin/accounts`

Creates a `partner_admin` or `tenant_admin` account.

Sample request body:

```json
{
  "name": "Priya Sharma",
  "email": "priya@tenant.in",
  "mobile": "9800000003",
  "role": "tenant_admin",
  "tenantId": "665f00000000000000000020",
  "temporaryPassword": "Welcome@123"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "_id": "665f00000000000000000030",
    "name": "Priya Sharma",
    "email": "priya@tenant.in",
    "role": "tenant_admin",
    "tenantId": "665f00000000000000000020",
    "isActive": true
  }
}
```

### `GET /admin/accounts/:accountId`

Fetches one admin account.

Sample response:

```json
{
  "success": true,
  "message": "Account fetched successfully",
  "data": {
    "_id": "665f00000000000000000030",
    "name": "Priya Sharma",
    "email": "priya@tenant.in",
    "role": "tenant_admin",
    "tenantId": {
      "_id": "665f00000000000000000020",
      "name": "Bharat Finance - Pune"
    }
  }
}
```

### `PATCH /admin/accounts/:accountId`

Updates admin account profile or scope.

Sample request body:

```json
{
  "name": "Priya S. Sharma",
  "mobile": "9800000099"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Account updated successfully",
  "data": {
    "_id": "665f00000000000000000030",
    "name": "Priya S. Sharma",
    "mobile": "9800000099"
  }
}
```

### `PATCH /admin/accounts/:accountId/status`

Activates or deactivates an admin account.

Sample request body:

```json
{
  "isActive": false,
  "reason": "Admin left organisation"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Account status updated successfully",
  "data": {
    "_id": "665f00000000000000000030",
    "isActive": false
  }
}
```

### `GET /admin/consent-versions`

Lists consent versions.

Query params: `status`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Consent versions fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000040",
        "version": "1.2",
        "title": "EMI Shield Device Control Agreement",
        "isCurrent": true
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

### `POST /admin/consent-versions`

Creates a consent version as a draft or inactive version.

Sample request body:

```json
{
  "version": "1.2",
  "title": "EMI Shield Device Control Agreement",
  "borrowerAgreementText": "Borrower agreement text...",
  "deviceControlConsentText": "Device control consent text...",
  "privacyPolicyText": "Privacy policy text...",
  "tripartiteAckText": "Tripartite acknowledgement text..."
}
```

Sample response:

```json
{
  "success": true,
  "message": "Consent version created successfully",
  "data": {
    "_id": "665f00000000000000000040",
    "version": "1.2",
    "title": "EMI Shield Device Control Agreement",
    "isCurrent": false
  }
}
```

### `GET /admin/consent-versions/:id`

Fetches consent version detail.

Sample response:

```json
{
  "success": true,
  "message": "Consent version fetched successfully",
  "data": {
    "_id": "665f00000000000000000040",
    "version": "1.2",
    "title": "EMI Shield Device Control Agreement",
    "borrowerAgreementText": "Borrower agreement text...",
    "deviceControlConsentText": "Device control consent text...",
    "privacyPolicyText": "Privacy policy text...",
    "tripartiteAckText": "Tripartite acknowledgement text..."
  }
}
```

### `PATCH /admin/consent-versions/:id/publish`

Publishes a consent version and marks it current.

Sample request body:

```json
{
  "reason": "Updated legal language"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Consent version published successfully",
  "data": {
    "_id": "665f00000000000000000040",
    "version": "1.2",
    "isCurrent": true,
    "publishedAt": "2026-05-30T10:00:00.000Z"
  }
}
```

### `GET /admin/escalations`

Lists super-admin-visible cases.

Query params: `status`, `tenantId`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Escalations fetched successfully",
  "data": {
    "items": [
      {
        "caseId": "CASE-2026-ABCDE",
        "status": "ESCALATED_ADMIN",
        "reason": "Payment made but device is still locked"
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

### `GET /admin/escalations/:caseId`

Fetches case detail with related command and audit data.

Sample response:

```json
{
  "success": true,
  "message": "Escalation fetched successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "ESCALATED_ADMIN"
    },
    "commands": [],
    "auditLogs": []
  }
}
```

### `POST /admin/escalations/:caseId/unlock`

Super admin full unlock for an escalated case. Resolves all unpaid EMI installments as paid or waived.

Sample request body:

```json
{
  "reason": "Tenant and partner breached SLA. Payment verified.",
  "emiAction": "mark_paid"
}
```

Allowed `emiAction`: `mark_paid`, `waive`.

Sample response:

```json
{
  "success": true,
  "message": "Admin unlock override queued successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "RESOLVED_SUPER_ADMIN",
      "resolutionAction": "unlocked"
    },
    "device": {
      "_id": "665f00000000000000000050",
      "state": "UNLOCK_PENDING"
    },
    "command": {
      "_id": "665f00000000000000000051",
      "commandType": "UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /admin/escalations/:caseId/temp-unlock`

Super admin temporary unlock for an escalated case.

Sample request body:

```json
{
  "durationHours": 24,
  "reason": "Emergency access approved"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Admin temporary unlock queued successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "RESOLVED_SUPER_ADMIN",
      "resolutionAction": "temp_unlocked"
    },
    "device": {
      "state": "TEMP_UNLOCK",
      "tempUnlockExpiresAt": "2026-05-31T10:00:00.000Z"
    },
    "command": {
      "commandType": "TEMP_UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /admin/escalations/:caseId/reject`

Rejects an escalated case.

Sample request body:

```json
{
  "reason": "Bank record confirms no payment was received"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Escalation rejected successfully",
  "data": {
    "caseId": "CASE-2026-ABCDE",
    "status": "REJECTED",
    "resolutionAction": "rejected"
  }
}
```

### `GET /admin/devices`

Searches devices across tenants.

Query params: `imei`, `tenantId`, `state`, `mobile`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Devices fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000050",
        "imei": "123456789012345",
        "state": "ACTIVE",
        "userId": {
          "name": "Ramesh Kumar",
          "mobile": "9876543210"
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

### `GET /admin/commands`

Lists device commands across the platform.

Query params: `status`, `commandType`, `triggeredBy`, `tenantId`, `deviceId`, `from`, `to`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Device commands fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000051",
        "commandType": "LOCK",
        "status": "pending",
        "triggeredBy": "super_admin"
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

### `GET /admin/devices/:deviceId`

Fetches one device with current policy, recent commands, cases, and risk flags.

Sample response:

```json
{
  "success": true,
  "message": "Device detail fetched successfully",
  "data": {
    "device": {
      "_id": "665f00000000000000000050",
      "imei": "123456789012345",
      "state": "ACTIVE",
      "currentPolicyKey": "EMI_PAID"
    },
    "currentPolicy": {
      "policyKey": "EMI_PAID",
      "version": 1,
      "restrictions": {
        "lockMode": false
      }
    },
    "commands": [],
    "cases": [],
    "riskFlags": []
  }
}
```

### `POST /admin/devices/:deviceId/lock`

Queues a manual lock command for a device.

Sample request body:

```json
{
  "reason": "Compliance hold requested by lender"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Device lock queued successfully",
  "data": {
    "device": {
      "_id": "665f00000000000000000050",
      "state": "LOCKED"
    },
    "command": {
      "commandType": "LOCK",
      "status": "pending"
    }
  }
}
```

### `POST /admin/devices/:deviceId/temp-unlock`

Queues a temporary unlock command for a device.

Sample request body:

```json
{
  "durationHours": 60,
  "reason": "Emergency access approved"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Temporary unlock queued successfully",
  "data": {
    "device": {
      "_id": "665f00000000000000000050",
      "state": "TEMP_UNLOCK",
      "tempUnlockExpiresAt": "2026-06-01T22:00:00.000Z"
    },
    "command": {
      "commandType": "TEMP_UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /admin/devices/:deviceId/unlock-waive`

Queues a full unlock command and updates all unpaid EMIs as paid or waived.

Sample request body:

```json
{
  "reason": "Payment verified by lender",
  "emiAction": "mark_paid"
}
```

Allowed `emiAction`: `mark_paid`, `waive`.

Sample response:

```json
{
  "success": true,
  "message": "Device unlock with EMI update queued successfully",
  "data": {
    "device": {
      "_id": "665f00000000000000000050",
      "state": "UNLOCK_PENDING"
    },
    "command": {
      "commandType": "UNLOCK",
      "status": "pending"
    },
    "updatedInstallmentIds": ["665f00000000000000000061"]
  }
}
```

### `GET /admin/devices/:deviceId/commands`

Fetches command history for one device.

Sample response:

```json
{
  "success": true,
  "message": "Device commands fetched successfully",
  "data": [
    {
      "_id": "665f00000000000000000051",
      "commandType": "LOCK",
      "status": "acknowledged"
    }
  ]
}
```

### `GET /admin/devices/:deviceId/audit-logs`

Fetches audit logs for one device.

Sample response:

```json
{
  "success": true,
  "message": "Device audit logs fetched successfully",
  "data": [
    {
      "_id": "665f00000000000000000070",
      "eventType": "MANUAL_LOCK_TRIGGERED",
      "deviceId": "665f00000000000000000050"
    }
  ]
}
```

### `GET /admin/risk-flags`

Lists platform risk flags.

Query params: `severity`, `status`, `tenantId`, `deviceId`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Risk flags fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000080",
        "type": "ROOT_DETECTED",
        "severity": "high",
        "status": "open",
        "message": "su binary found"
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

### `PATCH /admin/risk-flags/:flagId/acknowledge`

Acknowledges a risk flag.

Sample request body:

```json
{
  "note": "Reviewed with tenant"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Risk flag acknowledged successfully",
  "data": {
    "_id": "665f00000000000000000080",
    "status": "acknowledged",
    "acknowledgedAt": "2026-05-30T10:00:00.000Z"
  }
}
```

### `GET /admin/audit-logs`

Lists platform audit logs.

Query params: `tenantId`, `channelPartnerId`, `eventType`, `actorId`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Audit logs fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000070",
        "eventType": "OVERRIDE_EXECUTED",
        "actorId": {
          "name": "Super Admin"
        },
        "tenantId": {
          "name": "Bharat Finance - Pune"
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

## Tenant APIs

Tenant APIs are mounted at both `/tenant` and `/distributor`. Prefer `/tenant` for new clients. They require an account token. Most actions are intended for `tenant_admin` accounts scoped to one tenant.

### `GET /tenant/dashboard`

Returns tenant dashboard metrics.

Sample response:

```json
{
  "success": true,
  "message": "Dashboard fetched successfully",
  "data": {
    "borrowers": {
      "total": 10,
      "registeredToday": 1
    },
    "devices": {
      "activated": 8,
      "pendingActivation": 2,
      "byState": {
        "ACTIVE": 7,
        "LOCKED": 1
      }
    },
    "payments": {
      "pendingApproval": 2
    },
    "unlockRequests": {
      "pendingTenant": 1
    }
  }
}
```

### `POST /tenant/users/register`

Registers a borrower, creates an EMI schedule, and generates an enrollment token.

Sample request body:

```json
{
  "name": "Ramesh Kumar",
  "mobile": "9876543210",
  "aadhaarLinkedMobile": "9876543210",
  "loanId": "LOAN-001",
  "loanAmount": 18000,
  "emiAmount": 3000,
  "tenureMonths": 6,
  "disbursementDate": "2026-05-21"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Borrower registered successfully",
  "data": {
    "user": {
      "_id": "665f00000000000000000090",
      "name": "Ramesh Kumar",
      "mobile": "9876543210",
      "loanId": "LOAN-001"
    },
    "emiSchedule": {
      "_id": "665f00000000000000000091",
      "installments": []
    },
    "enrollmentToken": {
      "token": "abcdef123456",
      "expiresAt": "2026-06-06T10:00:00.000Z"
    },
    "qr": {
      "payload": {},
      "qrCodeDataUrl": "data:image/png;base64,..."
    }
  }
}
```

### `POST /tenant/enrollment/qr`

Generates Android Device Owner provisioning QR payload and QR image for an enrollment token.

Sample request body:

```json
{
  "enrollmentToken": "abcdef123456"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Enrollment QR generated successfully",
  "data": {
    "enrollmentToken": "abcdef123456",
    "payload": {
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.emishield.app/.DeviceAdminReceiver"
    },
    "qrCodeDataUrl": "data:image/png;base64,..."
  }
}
```

### `GET /tenant/enrollments/:token/status`

Tracks onboarding status for an enrollment token.

Sample response:

```json
{
  "success": true,
  "message": "Enrollment status fetched successfully",
  "data": {
    "status": "CONSENT_COMPLETED",
    "borrower": {
      "id": "665f00000000000000000090",
      "name": "Ramesh Kumar",
      "mobile": "9876543210"
    },
    "device": null,
    "consentRecord": {
      "_id": "665f00000000000000000092"
    }
  }
}
```

### `POST /tenant/users/:userId/enrollment/qr`

Generates an enrollment QR for one borrower. If a valid, unconsumed token already exists, it reuses that token. If the token is missing, expired, or cancelled, it creates a fresh token and QR.

Sample request body:

```json
{}
```

Sample response:

```json
{
  "success": true,
  "message": "Enrollment QR regenerated successfully",
  "data": {
    "reusedExistingToken": false,
    "oldEnrollmentToken": "expiredabcdef123456",
    "oldEnrollmentTokenId": "665f00000000000000000093",
    "borrower": {
      "id": "665f00000000000000000090",
      "name": "Ramesh Kumar",
      "mobile": "9876543210",
      "loanId": "LOAN-001"
    },
    "qrPayload": {},
    "qrCodeDataUrl": "data:image/png;base64,...",
    "qrCodeMimeType": "image/png",
    "enrollmentToken": "newabcdef123456",
    "tokenExpiresAt": "2026-06-08T10:00:00.000Z"
  }
}
```

### `GET /tenant/users`

Lists borrowers under the tenant with pagination and search.

Query params: `page`, `limit`, `search`, `onboardingStatus`.

Allowed `onboardingStatus`: `onboarded`, `pending`.

Sample response:

```json
{
  "success": true,
  "message": "Users fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000090",
        "name": "Ramesh Kumar",
        "mobile": "9876543210",
        "email": "ramesh@example.com",
        "loanId": "LOAN-001",
        "isDeviceLinked": true,
        "linkedDeviceId": {
          "_id": "665f00000000000000000050",
          "imei": "123456789012345",
          "state": "ACTIVE"
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

### `GET /tenant/users/pending-emis`

Lists borrowers who have an upcoming unpaid EMI installment due in the next `days` days.

Query params: `days`, `page`, `limit`, `search`.

`days` defaults to `10` and is capped at `365`.

Sample response:

```json
{
  "success": true,
  "message": "Borrowers with upcoming EMIs fetched successfully",
  "data": {
    "items": [
      {
        "borrower": {
          "_id": "665f00000000000000000090",
          "name": "Ramesh Kumar",
          "mobile": "9876543210",
          "loanId": "LOAN-001",
          "isDeviceLinked": true
        },
        "emiScheduleId": "665f00000000000000000091",
        "loanId": "LOAN-001",
        "installmentCount": 1,
        "totalAmount": 3000,
        "overdueAmount": 0,
        "overdueInstallments": 0,
        "dpd": 0,
        "upcomingInstallments": [
          {
            "_id": "665f00000000000000000092",
            "installmentNumber": 2,
            "dueDate": "2026-06-21T00:00:00.000Z",
            "emiAmount": 3000,
            "status": "pending"
          }
        ]
      }
    ],
    "days": 10,
    "dueUntil": "2026-06-10T10:00:00.000Z",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "pages": 1
    }
  }
}
```

### `GET /tenant/users/overdue-emis`

Lists borrowers who have overdue EMI installments.

Query params: `page`, `limit`, `search`.

Sample response:

```json
{
  "success": true,
  "message": "Borrowers with overdue EMIs fetched successfully",
  "data": {
    "items": [
      {
        "borrower": {
          "_id": "665f00000000000000000090",
          "name": "Ramesh Kumar",
          "mobile": "9876543210",
          "loanId": "LOAN-001",
          "isDeviceLinked": true
        },
        "emiScheduleId": "665f00000000000000000091",
        "loanId": "LOAN-001",
        "installmentCount": 1,
        "totalAmount": 3000,
        "overdueAmount": 3000,
        "overdueInstallments": 1,
        "dpd": 5,
        "overdueEmiInstallments": [
          {
            "_id": "665f00000000000000000092",
            "installmentNumber": 1,
            "dueDate": "2026-05-21T00:00:00.000Z",
            "emiAmount": 3000,
            "status": "overdue"
          }
        ]
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

### `GET /tenant/users/:id/emi-installments`

Fetches all EMI installments for one borrower.

Sample response:

```json
{
  "success": true,
  "message": "EMI installments fetched successfully",
  "data": {
    "borrower": {
      "id": "665f00000000000000000090",
      "name": "Ramesh Kumar",
      "mobile": "9876543210",
      "email": "ramesh@example.com",
      "loanId": "LOAN-001"
    },
    "emiScheduleId": "665f00000000000000000091",
    "installments": [
      {
        "_id": "665f00000000000000000092",
        "installmentNumber": 1,
        "dueDate": "2026-06-21T00:00:00.000Z",
        "emiAmount": 3000,
        "status": "pending",
        "paidAmount": 0
      }
    ],
    "overdueAmount": 0,
    "overdueInstallments": 0,
    "dpd": 0
  }
}
```

### `GET /tenant/users/:id`

Fetches borrower detail with EMI schedule, consent, enrollment, and linked device data.

Sample response:

```json
{
  "success": true,
  "message": "Borrower detail fetched successfully",
  "data": {
    "borrower": {
      "_id": "665f00000000000000000090",
      "name": "Ramesh Kumar",
      "loanId": "LOAN-001",
      "isDeviceLinked": true,
      "linkedDeviceId": "665f00000000000000000050"
    },
    "emiSchedule": {
      "installments": []
    },
    "enrollment": {
      "status": "ACTIVATION_COMPLETE"
    },
    "device": {
      "_id": "665f00000000000000000050",
      "state": "ACTIVE"
    },
    "consentRecord": {
      "_id": "665f00000000000000000092"
    }
  }
}
```

### `GET /tenant/devices`

Lists devices under the tenant with borrower details, pagination, filters, and search.

Query params: `page`, `limit`, `search`, `state`, `policyKey`, `imei`.

Sample response:

```json
{
  "success": true,
  "message": "Devices fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000050",
        "imei": "123456789012345",
        "state": "ACTIVE",
        "currentPolicyKey": "EMI_PAID",
        "userId": {
          "name": "Ramesh Kumar",
          "mobile": "9876543210",
          "loanId": "LOAN-001"
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

### `GET /tenant/devices/:id`

Fetches one tenant device with linked borrower, EMI schedule, and current policy.

Sample response:

```json
{
  "success": true,
  "message": "Device detail fetched successfully",
  "data": {
    "device": {
      "_id": "665f00000000000000000050",
      "imei": "123456789012345",
      "state": "ACTIVE"
    },
    "borrower": {
      "name": "Ramesh Kumar",
      "mobile": "9876543210"
    },
    "emiSchedule": {
      "_id": "665f00000000000000000091",
      "loanId": "LOAN-001",
      "overdueAmount": 0,
      "overdueInstallments": 0,
      "dpd": 0,
      "installments": [
        {
          "_id": "665f00000000000000000092",
          "installmentNumber": 1,
          "dueDate": "2026-06-21T00:00:00.000Z",
          "emiAmount": 3000,
          "status": "pending"
        }
      ]
    },
    "currentPolicy": {
      "policyKey": "EMI_PAID",
      "version": 1,
      "restrictions": {
        "lockMode": false
      }
    }
  }
}
```

### `POST /tenant/devices/:id/upcoming-payment-reminder`

Checks whether the device borrower has an upcoming unpaid EMI within the configured window and queues an `UPCOMING_PAYMENT` FCM command only when one exists.

Sample request body:

```json
{
  "windowDays": 7,
  "note": "Reminder before due date"
}
```

Sample response when a payment is upcoming:

```json
{
  "success": true,
  "message": "Upcoming payment reminder command queued successfully",
  "data": {
    "queued": true,
    "command": {
      "_id": "665f00000000000000000051",
      "commandType": "UPCOMING_PAYMENT",
      "status": "pending"
    },
    "upcomingInstallment": {
      "_id": "665f00000000000000000092",
      "installmentNumber": 2,
      "dueDate": "2026-06-21T00:00:00.000Z",
      "emiAmount": 3000,
      "status": "pending"
    }
  }
}
```

Sample response when no payment is upcoming:

```json
{
  "success": true,
  "message": "No upcoming payment found for device",
  "data": {
    "queued": false,
    "deviceId": "665f00000000000000000050",
    "windowDays": 7
  }
}
```

### `POST /tenant/devices/:id/lock`

Queues a tenant manual lock command.

Sample request body:

```json
{
  "reason": "EMI grace period expired"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Device lock queued successfully",
  "data": {
    "device": {
      "state": "LOCKED"
    },
    "command": {
      "commandType": "LOCK",
      "status": "pending"
    }
  }
}
```

### `POST /tenant/devices/:id/unlock`

Queues a tenant manual unlock command.

Sample request body:

```json
{
  "reason": "Manual payment verified"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Device unlock queued successfully",
  "data": {
    "device": {
      "state": "UNLOCK_PENDING"
    },
    "command": {
      "commandType": "UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /tenant/devices/:id/temp-unlock`

Queues a tenant temporary unlock command.

Sample request body:

```json
{
  "durationHours": 24,
  "reason": "Emergency access approved"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Temporary unlock queued successfully",
  "data": {
    "device": {
      "state": "TEMP_UNLOCK",
      "tempUnlockExpiresAt": "2026-05-31T10:00:00.000Z"
    },
    "command": {
      "commandType": "TEMP_UNLOCK",
      "status": "pending"
    }
  }
}
```

### `GET /tenant/qr-codes`

Lists tenant payment QR codes.

Sample response:

```json
{
  "success": true,
  "message": "QR codes fetched successfully",
  "data": [
    {
      "_id": "665f000000000000000000a0",
      "label": "PhonePe Business QR",
      "imageUrl": "https://storage.example.com/qr.png",
      "isActive": true
    }
  ]
}
```

### `POST /tenant/qr-codes`

Adds a tenant payment QR code.

Sample request body:

```json
{
  "label": "PhonePe Business QR",
  "imageUrl": "https://storage.example.com/qr.png",
  "activate": true
}
```

Sample response:

```json
{
  "success": true,
  "message": "QR code added successfully",
  "data": {
    "_id": "665f000000000000000000a0",
    "label": "PhonePe Business QR",
    "imageUrl": "https://storage.example.com/qr.png",
    "isActive": true
  }
}
```

### `PATCH /tenant/qr-codes/:qrId/activate`

Activates one tenant payment QR code and deactivates the others.

Sample request body:

```json
{}
```

Sample response:

```json
{
  "success": true,
  "message": "QR code activated successfully",
  "data": {
    "_id": "665f000000000000000000a0",
    "isActive": true
  }
}
```

### `DELETE /tenant/qr-codes/:qrId`

Deletes an inactive tenant payment QR code.

Sample response:

```json
{
  "success": true,
  "message": "QR code deleted successfully",
  "data": null
}
```

### `GET /tenant/payments/pending-approval`

Lists borrower QR payments pending tenant approval.

Sample response:

```json
{
  "success": true,
  "message": "Pending payments fetched successfully",
  "data": [
      {
        "_id": "665f000000000000000000b0",
        "amount": 3500,
        "metadata": {
          "reference": "UPI123456"
        },
        "approvalStatus": "pending_approval"
      }
  ]
}
```

### `GET /tenant/payments/approval-requests`

Lists all tenant payment approval requests with pagination and borrower/device search.

Query params: `page`, `limit`, `status`, `search`.

Allowed `status`: `pending_approval`, `approved`, `rejected`, `all`.

Sample response:

```json
{
  "success": true,
  "message": "Payment approval requests fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f000000000000000000b0",
        "amount": 3500,
        "status": "approval_pending",
        "approvalStatus": "pending_approval",
        "metadata": {
          "reference": "UPI123456"
        },
        "userId": {
          "name": "Ramesh Kumar",
          "mobile": "9876543210",
          "loanId": "LOAN-001"
        },
        "deviceId": {
          "imei": "123456789012345",
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

### `GET /tenant/payments/:paymentId`

Fetches tenant payment detail.

Sample response:

```json
{
  "success": true,
  "message": "Payment fetched successfully",
  "data": {
    "_id": "665f000000000000000000b0",
    "amount": 3500,
    "status": "approval_pending",
    "approvalStatus": "pending_approval",
    "metadata": {
      "reference": "UPI123456"
    }
  }
}
```

### `POST /tenant/payments/:paymentId/approve`

Approves borrower QR payment and queues device unlock.

Sample request body:

```json
{
  "note": "Verified UPI credit in bank statement"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Payment approved and device unlock queued successfully",
  "data": {
    "payment": {
      "_id": "665f000000000000000000b0",
      "status": "success",
      "approvalStatus": "approved"
    },
    "command": {
      "commandType": "UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /tenant/payments/:paymentId/reject`

Rejects borrower QR payment.

Sample request body:

```json
{
  "reason": "No matching credit found in bank statement"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Payment rejected successfully",
  "data": {
    "_id": "665f000000000000000000b0",
    "status": "rejected",
    "approvalStatus": "rejected"
  }
}
```

### `GET /tenant/unlock-requests`

Lists tenant borrower unlock requests with pagination.

Query params: `page`, `limit`, `status`, `search`.

Sample response:

```json
{
  "success": true,
  "message": "Unlock requests fetched successfully",
  "data": {
    "items": [
      {
        "caseId": "CASE-2026-ABCDE",
        "status": "PENDING_TENANT",
        "reason": "Payment made but device is still locked",
        "userId": {
          "name": "Ramesh Kumar",
          "mobile": "9876543210",
          "loanId": "LOAN-001"
        },
        "deviceId": {
          "imei": "123456789012345",
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

### `GET /tenant/unlock-requests/:caseId`

Fetches one tenant borrower unlock request.

Sample response:

```json
{
  "success": true,
  "message": "Unlock request fetched successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "PENDING_TENANT"
    },
    "commands": []
  }
}
```

### `POST /tenant/unlock-requests/:caseId/approve`

Approves a borrower unlock request as tenant admin.

Sample request body:

```json
{
  "note": "Payment proof verified",
  "emiAction": "none"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Unlock request approved successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "RESOLVED_TENANT",
      "resolutionAction": "unlocked"
    },
    "command": {
      "commandType": "UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /tenant/unlock-requests/:caseId/temp-unlock`

Temporarily unlocks a borrower request as tenant admin.

Sample request body:

```json
{
  "durationHours": 24,
  "note": "Emergency access approved"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Temporary unlock approved successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "RESOLVED_TENANT",
      "resolutionAction": "temp_unlocked"
    },
    "command": {
      "commandType": "TEMP_UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /tenant/unlock-requests/:caseId/reject`

Rejects a borrower unlock request as tenant admin.

Sample request body:

```json
{
  "note": "No matching payment found"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Unlock request rejected successfully",
  "data": {
    "caseId": "CASE-2026-ABCDE",
    "status": "REJECTED",
    "resolutionAction": "rejected"
  }
}
```

## Partner APIs

All `/partner` APIs require a `partner_admin` account token.

### `GET /partner/dashboard`

Returns partner dashboard metrics across owned tenants, borrowers, devices, and escalations.

Sample response:

```json
{
  "success": true,
  "message": "Partner dashboard fetched successfully",
  "data": {
    "tenants": {
      "total": 3,
      "active": 3
    },
    "borrowers": {
      "total": 30
    },
    "devices": {
      "total": 25,
      "byState": {
        "ACTIVE": 23,
        "LOCKED": 2
      }
    },
    "escalations": {
      "pending": 1
    }
  }
}
```

### `GET /partner/tenants`

Lists tenants owned by the partner.

Query params: `status`, `capability`, `search`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Tenants fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000020",
        "name": "Bharat Finance - Jaipur",
        "isActive": true
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

### `POST /partner/tenants`

Creates a tenant under the authenticated partner and copies centralized default policies.

Sample request body:

```json
{
  "name": "Bharat Finance - Jaipur",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "supportPhone": "9800000002",
  "supportEmail": "support@tenant.in"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Tenant created successfully",
  "data": {
    "tenant": {
      "_id": "665f00000000000000000020",
      "name": "Bharat Finance - Jaipur"
    },
    "tenantPolicy": {
      "version": 1
    },
    "devicePolicies": []
  }
}
```

### `GET /partner/accounts`

Lists `tenant_admin` accounts under partner-owned tenants.

Query params: `tenantId`, `status`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Accounts fetched successfully",
  "data": {
    "items": [
      {
        "_id": "665f00000000000000000030",
        "name": "Priya Sharma",
        "role": "tenant_admin",
        "tenantId": {
          "name": "Bharat Finance - Jaipur"
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

### `POST /partner/accounts`

Creates a `tenant_admin` account for a partner-owned tenant.

Sample request body:

```json
{
  "name": "Priya Sharma",
  "email": "priya@tenant.in",
  "mobile": "9800000003",
  "tenantId": "665f00000000000000000020",
  "temporaryPassword": "Welcome@123"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "_id": "665f00000000000000000030",
    "name": "Priya Sharma",
    "email": "priya@tenant.in",
    "role": "tenant_admin"
  }
}
```

### `PATCH /partner/accounts/:accountId`

Updates a `tenant_admin` account profile or tenant scope under the partner.

Sample request body:

```json
{
  "name": "Priya S. Sharma",
  "mobile": "9800000099",
  "tenantId": "665f00000000000000000020"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Account updated successfully",
  "data": {
    "_id": "665f00000000000000000030",
    "name": "Priya S. Sharma"
  }
}
```

### `PATCH /partner/accounts/:accountId/status`

Activates or deactivates a `tenant_admin` account under the partner.

Sample request body:

```json
{
  "isActive": false,
  "reason": "Admin left organisation"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Account status updated successfully",
  "data": {
    "_id": "665f00000000000000000030",
    "isActive": false
  }
}
```

### `GET /partner/escalations`

Lists partner escalations.

Query params: `status`, `tenantId`, `page`, `limit`.

Sample response:

```json
{
  "success": true,
  "message": "Escalations fetched successfully",
  "data": {
    "items": [
      {
        "caseId": "CASE-2026-ABCDE",
        "status": "ESCALATED_PARTNER",
        "reason": "Payment made but device is still locked"
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

### `GET /partner/escalations/:caseId`

Fetches partner escalation detail.

Sample response:

```json
{
  "success": true,
  "message": "Escalation fetched successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "ESCALATED_PARTNER"
    },
    "commands": [],
    "auditLogs": []
  }
}
```

### `POST /partner/escalations/:caseId/unlock`

Partner full unlock for an escalated case.

Sample request body:

```json
{
  "note": "Verified borrower proof. Unlock approved."
}
```

Sample response:

```json
{
  "success": true,
  "message": "Partner unlock queued successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "RESOLVED_PARTNER",
      "resolutionAction": "unlocked"
    },
    "device": {
      "state": "UNLOCK_PENDING"
    },
    "command": {
      "commandType": "UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /partner/escalations/:caseId/temp-unlock`

Partner temporary unlock for an escalated case.

Sample request body:

```json
{
  "durationHours": 24,
  "note": "Emergency access approved."
}
```

Sample response:

```json
{
  "success": true,
  "message": "Partner temporary unlock queued successfully",
  "data": {
    "unlockRequest": {
      "caseId": "CASE-2026-ABCDE",
      "status": "RESOLVED_PARTNER",
      "resolutionAction": "temp_unlocked"
    },
    "device": {
      "state": "TEMP_UNLOCK"
    },
    "command": {
      "commandType": "TEMP_UNLOCK",
      "status": "pending"
    }
  }
}
```

### `POST /partner/escalations/:caseId/reject`

Partner rejects an escalated case.

Sample request body:

```json
{
  "note": "No valid payment proof found."
}
```

Sample response:

```json
{
  "success": true,
  "message": "Partner escalation rejected successfully",
  "data": {
    "caseId": "CASE-2026-ABCDE",
    "status": "REJECTED",
    "resolutionAction": "rejected"
  }
}
```

## App APIs

App APIs are used by the borrower/device app. Most protected routes require a user-app token returned after consent confirmation or generated from the testing helper.

### `POST /app/testing/access-token`

Generates a user-app access token for local testing. Disabled in production by returning 404.

Sample request body:

```json
{
  "mobile": "9876543210"
}
```

Alternative identifiers: `userId` or `loanId`.

Sample response:

```json
{
  "success": true,
  "message": "Test user access token generated successfully",
  "data": {
    "accessToken": "jwt-user-access-token",
    "tokenType": "user",
    "expiresIn": "15m",
    "user": {
      "id": "665f00000000000000000090",
      "name": "Ramesh Kumar",
      "mobile": "9876543210",
      "loanId": "LOAN-001",
      "tenantId": "665f00000000000000000020",
      "consentRecordId": "665f00000000000000000092"
    }
  }
}
```

### `GET /app/consent/terms`

Fetches current consent terms.

Sample response:

```json
{
  "success": true,
  "message": "Consent terms fetched successfully",
  "data": {
    "_id": "665f00000000000000000040",
    "version": "1.2",
    "title": "EMI Shield Device Control Agreement",
    "borrowerAgreementText": "Borrower agreement text...",
    "deviceControlConsentText": "Device control consent text...",
    "privacyPolicyText": "Privacy policy text..."
  }
}
```

### `POST /app/consent/initiate`

Initiates mocked Cashfree Aadhaar OTP for onboarding.

Sample request body:

```json
{
  "enrollmentToken": "abcdef123456",
  "aadhaarLinkedMobile": "9876543210"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Aadhaar OTP sent successfully",
  "data": {
    "verificationSessionId": "cf_mock_abcdef123456",
    "otpSent": true,
    "maskedMobile": "98****3210",
    "expiresInSeconds": 600,
    "mockOtp": "123456"
  }
}
```

### `POST /app/consent/confirm`

Confirms mocked Cashfree Aadhaar OTP, creates immutable consent record, consumes enrollment token, and returns a user access token.

Sample request body:

```json
{
  "enrollmentToken": "abcdef123456",
  "verificationSessionId": "cf_mock_abcdef123456",
  "otp": "123456",
  "consentCheckboxAccepted": true,
  "consentVersion": "1.2"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Consent confirmed successfully",
  "data": {
    "consentRecordId": "665f00000000000000000092",
    "consentAccepted": true,
    "accessToken": "jwt-user-access-token",
    "tokenType": "user",
    "user": {
      "id": "665f00000000000000000090",
      "name": "Ramesh Kumar",
      "tenantId": "665f00000000000000000020",
      "consentRecordId": "665f00000000000000000092"
    }
  }
}
```

### `POST /app/device/register`

Registers borrower device after consent. This also marks the borrower document as onboarded with `isDeviceLinked: true`, `linkedDeviceId`, and `deviceLinkedAt`.

Sample request body:

```json
{
  "imei": "123456789012345",
  "deviceModel": "Samsung A15",
  "manufacturer": "Samsung",
  "androidVersion": "14",
  "appVersion": "1.0.0",
  "fcmToken": "firebase-registration-token"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Device registered successfully",
  "data": {
    "deviceId": "665f00000000000000000050",
    "userId": "665f00000000000000000090",
    "tenantId": "665f00000000000000000020",
    "state": "ACTIVE",
    "currentPolicyKey": "EMI_PAID",
    "policy": {
      "policyKey": "EMI_PAID",
      "restrictions": {
        "lockMode": false
      }
    }
  }
}
```

### `GET /app/device/policy`

Fetches current device policy for authenticated borrower.

Sample response:

```json
{
  "success": true,
  "message": "Device policy fetched successfully",
  "data": {
    "deviceState": "ACTIVE",
    "policyKey": "EMI_PAID",
    "policyVersion": 1,
    "restrictions": {
      "lockMode": false,
      "disableFactoryReset": true
    },
    "tempUnlockExpiresAt": null
  }
}
```

### `POST /app/device/ping`

Receives device heartbeat and optionally updates FCM token/app version.

Sample request body:

```json
{
  "batteryLevel": 79,
  "networkType": "wifi",
  "appVersion": "1.0.1",
  "fcmToken": "new-firebase-registration-token"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Device ping received",
  "data": {
    "deviceId": "665f00000000000000000050",
    "serverTime": "2026-05-30T10:00:00.000Z",
    "desiredPolicyVersion": 2,
    "lastAppliedPolicyVersion": 1
  }
}
```

### `POST /app/device/sync`

Syncs device state and fetches pending commands.

Sample request body:

```json
{
  "lastAppliedPolicyVersion": 3,
  "state": "ACTIVE",
  "isRooted": false,
  "isTampered": false
}
```

Sample response:

```json
{
  "success": true,
  "message": "Device sync completed",
  "data": {
    "deviceState": "ACTIVE",
    "currentPolicyKey": "EMI_PAID",
    "desiredPolicyVersion": 3,
    "policy": {
      "policyKey": "EMI_PAID"
    },
    "pendingCommands": [
      {
        "_id": "665f00000000000000000051",
        "commandType": "LOCK",
        "status": "pending"
      }
    ]
  }
}
```

### `POST /app/device/command/ack`

Acknowledges a device command after local policy application.

Sample request body:

```json
{
  "commandId": "665f00000000000000000051",
  "status": "acknowledged",
  "appliedPolicyVersion": 4
}
```

Sample response:

```json
{
  "success": true,
  "message": "Device command acknowledgement saved",
  "data": {
    "commandId": "665f00000000000000000051",
    "status": "acknowledged",
    "deviceState": "LOCKED"
  }
}
```

### `POST /app/security/event`

Reports a device security event and creates a risk flag.

Sample request body:

```json
{
  "type": "ROOT_DETECTED",
  "severity": "high",
  "message": "su binary found",
  "metadata": {
    "path": "/system/xbin/su"
  }
}
```

Sample response:

```json
{
  "success": true,
  "message": "Security event recorded",
  "data": {
    "riskFlagId": "665f00000000000000000080",
    "status": "open"
  }
}
```

### `GET /app/payment/qr`

Fetches active tenant QR code for borrower payment.

Sample response:

```json
{
  "success": true,
  "message": "Payment QR fetched successfully",
  "data": {
    "qrCodeId": "665f000000000000000000a0",
    "label": "PhonePe Business QR",
    "imageUrl": "https://storage.example.com/qr.png"
  }
}
```

### `POST /app/payment/submit`

Submits QR payment for tenant approval.

Sample request body:

```json
{
  "qrCodeId": "665f000000000000000000a0",
  "amount": 3500,
  "reference": "UPI123456"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Payment submitted for tenant approval",
  "data": {
    "paymentId": "665f000000000000000000b0",
    "status": "approval_pending",
    "approvalStatus": "pending_approval"
  }
}
```

### `GET /app/payment/history`

Lists borrower payment history.

Sample response:

```json
{
  "success": true,
  "message": "Payment history fetched successfully",
  "data": [
    {
      "_id": "665f000000000000000000b0",
      "amount": 3500,
      "status": "approval_pending",
      "reference": "UPI123456"
    }
  ]
}
```

### `GET /app/payment/:paymentId`

Fetches one borrower payment.

Sample response:

```json
{
  "success": true,
  "message": "Payment fetched successfully",
  "data": {
    "_id": "665f000000000000000000b0",
    "amount": 3500,
    "status": "approval_pending",
    "approvalStatus": "pending_approval",
    "reference": "UPI123456"
  }
}
```

### `POST /app/unlock-request`

Creates borrower unlock request for tenant review.

Sample request body:

```json
{
  "reason": "Payment made but device is still locked",
  "reasonCategory": "payment_made",
  "details": "UPI ref UPI123456",
  "imageUrl": "https://storage.example.com/proof.png"
}
```

Sample response:

```json
{
  "success": true,
  "message": "Unlock request created successfully",
  "data": {
    "caseId": "CASE-2026-ABCDE",
    "status": "PENDING_TENANT",
    "slaDeadline": "2026-05-31T10:00:00.000Z"
  }
}
```

### `GET /app/unlock-request/active`

Fetches the active borrower unlock request.

Sample response:

```json
{
  "success": true,
  "message": "Active unlock request fetched successfully",
  "data": {
    "caseId": "CASE-2026-ABCDE",
    "status": "PENDING_TENANT",
    "reason": "Payment made but device is still locked"
  }
}
```

## Health

### `GET /`

Returns service health.

Sample response:

```json
{
  "success": true,
  "message": "Server is healthy",
  "data": {
    "uptime": 120.5,
    "database": "connected",
    "timestamp": "2026-05-30T10:00:00.000Z"
  }
}
```
