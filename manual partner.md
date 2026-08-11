# Manual Tenant Mode in the Partner App

## Purpose

The partner chooses a tenant's device-control mode while creating the tenant. The choice is permanent:

- `EMI_AUTOMATED` (**Automatic**): borrower EMI/payment features are available, and EMI reminders, grace transitions, and automatic locking follow the tenant policy. The legacy `lockOnGraceExpiry` field still controls the final automatic EMI lock.
- `MANUAL` (**Manual**): borrower EMI details and payment actions are hidden. The tenant records payments and locks/unlocks devices from the tenant app. EMI-based automatic lock/reminder actions are skipped.

The mode must not be editable after tenant creation.

## Tenant creation form toggle

Add a toggle to the create-tenant form:

**Label:** Manual device control

**Default:** Off

Mapping:

| Toggle | API value | Meaning |
|---|---|---|
| Off | `EMI_AUTOMATED` | EMI automation and borrower payment experience remain enabled. |
| On | `MANUAL` | The tenant controls EMI payment records and device lock/unlock manually. |

Show an information icon next to the toggle. Its content must update with the selected value:

**When off — Automatic**

> EMI details and payment options are shown to borrowers. EMI reminders, grace handling, and device locking follow the configured policy. `lockOnGraceExpiry` continues to control the final automatic lock.

**When on — Manual**

> EMI details and payment options are hidden from borrowers. The tenant must mark installments paid and lock or unlock devices from the tenant app. This choice cannot be changed after creation.

Also show the selected value below the toggle as **Automatic mode** or **Manual mode**. Before submission, include the mode in the final create confirmation because it cannot be changed later.

## Create tenant API

```http
POST /api/partner/tenants?app=true
Authorization: Bearer <partner-admin-access-token>
Content-Type: application/json
```

The partner app flow uses `app=true` when it also creates the tenant-admin account. Keep the existing OTP verification flow. The toggle adds the required `deviceControlMode` field to the final create request.

Example request:

```json
{
  "name": "Bharat Finance - Jaipur",
  "deviceControlMode": "MANUAL",
  "capabilities": ["lend", "distribute"],
  "supportPhone": "9800000002",
  "supportEmail": "support@tenant.in",
  "address": {
    "street": "MI Road",
    "city": "Jaipur",
    "district": "Jaipur",
    "state": "Rajasthan",
    "pincode": "302001"
  },
  "pocName": "Operations Manager",
  "pocPhone": "9800000002",
  "pocDesignation": "Manager",
  "tenantCreationVerificationMode": "mobile_otp",
  "tenantCreationVerificationSessionId": "<verified-session-id>",
  "tenantAdmin": {
    "name": "Tenant Administrator",
    "mobile": "9800000002",
    "email": "admin@tenant.in",
    "password": "<temporary-password>",
    "confirmPassword": "<temporary-password>"
  }
}
```

Mode field:

| Field | Required | Allowed values | Source |
|---|---:|---|---|
| `deviceControlMode` | Yes | `EMI_AUTOMATED`, `MANUAL` | Off -> `EMI_AUTOMATED`; On -> `MANUAL` |

Do not send `tenantPolicy`, `devicePolicies`, or `channelPartnerId`; the backend creates/owns these values.

Successful response:

```json
{
  "success": true,
  "message": "Partner tenant created successfully",
  "data": {
    "tenant": {
      "_id": "<tenant-id>",
      "name": "Bharat Finance - Jaipur",
      "channelPartnerId": "<partner-id>",
      "capabilities": ["lend", "distribute"],
      "supportPhone": "9800000002"
    },
    "tenantPolicy": {
      "_id": "<tenant-policy-id>",
      "tenantId": "<tenant-id>",
      "deviceControlRules": {
        "mode": "MANUAL"
      },
      "lockRules": {
        "lockOnGraceExpiry": true
      }
    },
    "devicePolicies": [
      {
        "_id": "<device-policy-id>",
        "tenantId": "<tenant-id>",
        "policyKey": "EMI_PAID",
        "isActive": true
      }
    ],
    "tenantAdmin": {
      "accountId": "<account-id>",
      "name": "Tenant Administrator",
      "mobile": "9800000002",
      "role": "tenant_admin",
      "tenantId": "<tenant-id>",
      "channelPartnerId": "<partner-id>"
    },
    "credentials": {
      "identifier": "9800000002",
      "mobile": "9800000002",
      "email": "admin@tenant.in",
      "temporaryPassword": "<temporary-password>"
    }
  }
}
```

After success, use `data.tenantPolicy.deviceControlRules.mode` as the authoritative confirmation of what was stored. Show the mode on the success screen/summary.

If `app=true` is omitted, the API still creates the tenant and policies, but does not create a tenant-admin account or return `tenantAdmin` and `credentials`.

Relevant errors:

| HTTP | Error | Form behavior |
|---:|---|---|
| `400` | `Name, deviceControlMode, capabilities, and supportPhone are required` | Mark missing required fields, including the mode mapping. |
| `400` | `deviceControlMode must be EMI_AUTOMATED or MANUAL` | Reset to a valid toggle-derived value. Never send display labels. |
| `400` | OTP session missing, expired, already used, or mismatched | Return the user to the existing verification step. |
| `400` | Invalid phone, address, POC, capability, or password confirmation | Display the backend validation error next to the relevant field. |
| `500` | Internal creation failure | Keep entered form data and allow retry. |

Error response shape:

```json
{
  "success": false,
  "error": "deviceControlMode must be EMI_AUTOMATED or MANUAL"
}
```

## Partner app acceptance checklist

- The create-tenant form has a **Manual device control** toggle, defaulted off.
- Off submits `EMI_AUTOMATED`; on submits `MANUAL`.
- The information text clearly explains both choices and the permanent nature of the choice.
- The final confirmation shows **Automatic mode** or **Manual mode**.
- `deviceControlMode` is always present in the create request.
- The success screen reads the stored mode from `data.tenantPolicy.deviceControlRules.mode`.
- Tenant edit forms do not show an editable mode control.
