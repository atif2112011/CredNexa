# Tenant QR Upload API Guide

This document is for the tenant app developer.

It explains how to upload a tenant payment QR image, what request format to use, what validations apply, and what response to expect.

## Purpose

This API lets the tenant upload a payment QR that borrowers can use while making payments.

The uploaded QR is stored against the tenant and can later be:

- listed
- activated
- deleted

## Endpoint

```http
POST /api/distributor/qr-codes
Authorization: Bearer <accountAccessToken>
```

This is a tenant-side authenticated endpoint.

The token must be an `account` token.

## Supported Request Modes

Two request modes are supported:

1. Multipart upload with an actual image file
2. JSON fallback with an already hosted `imageUrl`

## Recommended Mode: Multipart Upload

Use multipart upload when the app is directly sending the QR image file.

### Multipart Fields

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `label` | Yes | string | Human-readable QR label |
| `activate` | No | boolean/string | `true` or `"true"` makes this QR active immediately |
| `qrImage` | Yes | file | Image file to upload |

### Accepted Image Types

The uploaded `qrImage` must be one of:

- `image/jpeg`
- `image/png`
- `image/webp`

### File Size Limit

- Maximum size: `5 MB`

### Important Upload Behavior

When a file is uploaded:

- the backend uploads it to Firebase
- the backend compresses it using QR-specific compression
- the stored Firebase object becomes a PNG
- response metadata reflects the transformed file, not necessarily the original uploaded file

## JSON Fallback Mode

Use this only if the app already has a hosted image URL and does not need this backend to upload the image file.

### JSON Body

```json
{
  "label": "PhonePe Business QR",
  "imageUrl": "https://storage.example.com/qr.png",
  "activate": true
}
```

### Important Fallback Note

In JSON fallback mode:

- no file is uploaded through this backend
- no Firebase compression happens in this flow
- the provided `imageUrl` is stored as-is

## Multipart Example

```bash
curl -X POST /api/distributor/qr-codes \
  -H "Authorization: Bearer <accountAccessToken>" \
  -F "label=PhonePe Business QR" \
  -F "activate=true" \
  -F "qrImage=@/path/to/qr-image.jpg"
```

## Success Response

```json
{
  "success": true,
  "message": "QR code added successfully",
  "data": {
    "_id": "665f6f0b6f0f6f0b6f0f6f0b",
    "label": "PhonePe Business QR",
    "imageUrl": "https://firebasestorage.googleapis.com/...",
    "imageStoragePath": "tenant-payment-qr-codes/tenantId/accountId/665f6f0b6f0f6f0b6f0f6f0b-1720000000000.png",
    "imageMimeType": "image/png",
    "imageSize": 48291,
    "imageUploadedAt": "2026-07-02T12:00:00.000Z",
    "isActive": true,
    "uploadedBy": "665f6f0b6f0f6f0b6f0f6f0c"
  }
}
```

## Field Notes

- `imageUrl`: final Firebase URL that the app should use for rendering
- `imageStoragePath`: Firebase storage object path
- `imageMimeType`: stored MIME type after backend transformation
- `imageSize`: stored file size after compression
- `isActive`: whether this QR is currently active for borrower payments

## Activation Behavior

If:

- `activate=true`, or
- this is the tenant's first QR code

then the uploaded QR becomes active immediately.

If a new QR is activated, older QR codes are marked inactive.

## Validation Errors

Possible validation failures include:

- missing `label`
- missing both `qrImage` and `imageUrl`
- unsupported file type
- file larger than `5 MB`
- file MIME type not matching actual file content

## Related APIs

These APIs work with the uploaded tenant QR codes:

- `GET /api/distributor/qr-codes`
- `PATCH /api/distributor/qr-codes/:qrId/activate`
- `DELETE /api/distributor/qr-codes/:qrId`

## App Integration Recommendation

For normal app behavior, use the returned `data.imageUrl` for display and do not assume the original extension is preserved.

If the app uploads `jpg`, `png`, or `webp`, the stored QR image may still come back as:

- `image/png`
- `.png` storage object

That is expected behavior.
