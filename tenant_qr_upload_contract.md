# Tenant QR Upload API Contract

This contract is for the Tenant App / Distributor App developer.

## Add Payment QR Code

```http
POST /api/distributor/qr-codes
Authorization: Bearer <tenantAdminAccessToken>
Content-Type: multipart/form-data
```

### Form Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| `label` | string | Yes | Human-readable QR name, for example `PhonePe Business QR`. |
| `qrImage` | file | Yes | QR image file. Must be JPEG, PNG, or WebP. Max size is 5 MB. |
| `activate` | boolean/string | No | Send `true` to make this QR active immediately. First QR is activated automatically. |

### Example Multipart Body

```text
label=PhonePe Business QR
activate=true
qrImage=@phonepe-qr.png
```

### Success Response

```json
{
  "success": true,
  "message": "QR code added successfully",
  "data": {
    "_id": "665f6f0b6f0f6f0b6f0f6f0b",
    "label": "PhonePe Business QR",
    "imageUrl": "https://firebasestorage.googleapis.com/...",
    "imageStoragePath": "tenant-payment-qr-codes/<tenantId>/<accountId>/<qrId>-1718000000000.png",
    "imageMimeType": "image/png",
    "imageSize": 128000,
    "imageUploadedAt": "2026-06-17T10:00:00.000Z",
    "isActive": true,
    "uploadedBy": "<tenantAdminAccountId>",
    "createdAt": "2026-06-17T10:00:00.000Z"
  }
}
```

## List Payment QR Codes

```http
GET /api/distributor/qr-codes
Authorization: Bearer <tenantAdminAccessToken>
```

The app should render `data[].imageUrl`.

## Activate Payment QR Code

```http
PATCH /api/distributor/qr-codes/:qrId/activate
Authorization: Bearer <tenantAdminAccessToken>
```

Only one QR code can be active at a time.

## Delete Inactive Payment QR Code

```http
DELETE /api/distributor/qr-codes/:qrId
Authorization: Bearer <tenantAdminAccessToken>
```

The active QR code cannot be deleted.

## Validation Errors

Unsupported file type:

```json
{
  "success": false,
  "error": "Tenant QR image must be JPEG, PNG, or WebP"
}
```

File larger than 5 MB:

```json
{
  "success": false,
  "error": "Tenant QR image must be 5 MB or smaller"
}
```

Invalid image bytes:

```json
{
  "success": false,
  "error": "Tenant QR image content does not match its MIME type"
}
```

Missing required fields:

```json
{
  "success": false,
  "error": "QR label and qrImage are required"
}
```

## Backward Compatibility

The backend still accepts a JSON `imageUrl` fallback for older clients, but the Tenant App should use `multipart/form-data` with `qrImage`.
