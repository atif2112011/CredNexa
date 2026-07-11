# App Developer Contract: Company Support Contact

This document explains the backend API contract for maintaining and fetching the company's support email, support phone, and support WhatsApp number.

## API Base

All APIs are under:

```text
/api
```

Backend responses use the standard envelope:

```json
{
  "success": true,
  "message": "Success message",
  "data": {}
}
```

Error responses use:

```json
{
  "success": false,
  "error": "Error message"
}
```

## Collection

Mongo collection/model:

```text
CompanySupportContact
```

The backend maintains one global document using:

```json
{
  "key": "global",
  "supportEmail": "support@example.com",
  "supportPhone": "+911234567890",
  "supportWhatsapp": "+911234567890",
  "updatedBy": "accountId",
  "metadata": {},
  "createdAt": "2026-07-11T00:00:00.000Z",
  "updatedAt": "2026-07-11T00:00:00.000Z"
}
```

If no document exists, the backend creates one automatically with empty contact fields.

## App API: Fetch Support Contact

Use this API from the borrower app help/support screen.

```http
GET /api/app/support-contact
```

Authentication is not required. This lets the app show support details before login, onboarding, or device registration.

### Success Response

```json
{
  "success": true,
  "message": "Company support contact fetched successfully",
  "data": {
    "supportEmail": "support@example.com",
    "supportPhone": "+911234567890",
    "supportWhatsapp": "+911234567890",
    "updatedAt": "2026-07-11T00:00:00.000Z"
  }
}
```

### Empty Configuration Response

If super admin has not configured contact details yet:

```json
{
  "success": true,
  "message": "Company support contact fetched successfully",
  "data": {
    "supportEmail": "",
    "supportPhone": "",
    "supportWhatsapp": "",
    "updatedAt": "2026-07-11T00:00:00.000Z"
  }
}
```

### App Display Rules

- Show Email action only when `supportEmail` is not empty.
- Show Call action only when `supportPhone` is not empty.
- Show WhatsApp action only when `supportWhatsapp` is not empty.
- If all three fields are empty, show a fallback message such as support details are currently unavailable.

## Super Admin API: Fetch Support Contact

```http
GET /api/admin/support-contact
Authorization: Bearer <super_admin_access_token>
```

Requires Super Admin authentication.

### Success Response

```json
{
  "success": true,
  "message": "Company support contact fetched successfully",
  "data": {
    "_id": "supportContactId",
    "key": "global",
    "supportEmail": "support@example.com",
    "supportPhone": "+911234567890",
    "supportWhatsapp": "+911234567890",
    "updatedBy": "accountId",
    "metadata": {},
    "createdAt": "2026-07-11T00:00:00.000Z",
    "updatedAt": "2026-07-11T00:00:00.000Z"
  }
}
```

## Super Admin API: Update Support Contact

```http
PATCH /api/admin/support-contact
Authorization: Bearer <super_admin_access_token>
Content-Type: application/json
```

Requires Super Admin authentication.

### Request Body

All fields are optional, but at least one field must be sent.

```json
{
  "supportEmail": "support@example.com",
  "supportPhone": "+911234567890",
  "supportWhatsapp": "+911234567890"
}
```

To clear a field, send an empty string:

```json
{
  "supportWhatsapp": ""
}
```

### Success Response

```json
{
  "success": true,
  "message": "Company support contact updated successfully",
  "data": {
    "_id": "supportContactId",
    "key": "global",
    "supportEmail": "support@example.com",
    "supportPhone": "+911234567890",
    "supportWhatsapp": "+911234567890",
    "updatedBy": "superAdminAccountId",
    "metadata": {},
    "createdAt": "2026-07-11T00:00:00.000Z",
    "updatedAt": "2026-07-11T00:00:00.000Z"
  }
}
```

## Validation Rules

- `supportEmail` can be empty or a valid email address.
- `supportPhone` can be empty or a valid phone-like number.
- `supportWhatsapp` can be empty or a valid phone-like number.
- Phone and WhatsApp values may include `+`, spaces, parentheses, dots, and hyphens.
- At least one of `supportEmail`, `supportPhone`, or `supportWhatsapp` must be present in the update request.
- Email is stored lowercase.
- Phone and WhatsApp values are stored trimmed.

## Common Error Responses

Missing update fields:

```json
{
  "success": false,
  "error": "At least one support contact field is required"
}
```

Invalid email:

```json
{
  "success": false,
  "error": "supportEmail must be a valid email address"
}
```

Invalid phone:

```json
{
  "success": false,
  "error": "supportPhone must be a valid phone number"
}
```

Invalid WhatsApp:

```json
{
  "success": false,
  "error": "supportWhatsapp must be a valid phone number"
}
```

Unauthenticated admin request:

```json
{
  "success": false,
  "error": "Authentication required"
}
```

Unauthorized non-super-admin request:

```json
{
  "success": false,
  "error": "Forbidden"
}
```

## Audit

Every successful super-admin update writes an audit log with:

```text
COMPANY_SUPPORT_CONTACT_UPDATED
```

The audit metadata contains only the fields changed in that request.
