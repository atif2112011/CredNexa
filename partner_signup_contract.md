# Partner App Signup Contract

Base URL:

```text
/api
```

Partner signup endpoints are public and live under the existing partner prefix.

## 1. Initiate Signup OTP

```http
POST /api/partner/signup/initiate-otp
```

### Request

```json
{
  "mobile": "9876543210"
}
```

### Success Response

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

For now the OTP is always `123456`.

## 2. Verify Signup OTP

```http
POST /api/partner/signup/verify-otp
```

### Request

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "otp_...",
  "otp": "123456"
}
```

### Success Response

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "verified": true,
    "verificationSessionId": "otp_..."
  }
}
```

## 3. Complete Signup

```http
POST /api/partner/signup/complete?createAccount=true
```

### Request

```json
{
  "name": "Ramesh Kumar",
  "mobile": "9876543210",
  "type": "independent",
  "verificationSessionId": "otp_...",
  "password": "Pass@123",
  "confirmPassword": "Pass@123",
  "email": "optional@example.com",
  "address": {
    "street": "Shop 12, Main Road",
    "city": "Pune",
    "district": "Pune",
    "state": "Maharashtra",
    "pincode": "411001"
  }
}
```

Allowed `type` values:

```text
nbfc_group
retail_chain_group
independent
```

`email` is optional. The single `email` field is copied to both `ChannelPartner.contactEmail` and the created `partner_admin` `Account.email`. `address` is required and uses the same object format as tenant address: `street`, `city`, `district`, `state`, and `pincode`. `password` and `confirmPassword` are required when `createAccount=true`. `confirmPassword` is validation only and is never stored.

### Success Response

```json
{
  "success": true,
  "message": "Partner signup completed successfully",
  "data": {
    "channelPartner": {
      "id": "channelPartnerId",
      "name": "Ramesh Kumar",
      "type": "independent",
      "contactPhone": "9876543210",
      "contactEmail": "optional@example.com",
      "address": {
        "street": "Shop 12, Main Road",
        "city": "Pune",
        "district": "Pune",
        "state": "Maharashtra",
        "pincode": "411001"
      },
      "adminAccountId": "accountId",
      "isActive": true
    },
    "account": {
      "id": "accountId",
      "name": "Ramesh Kumar",
      "mobile": "9876543210",
      "email": "optional@example.com",
      "role": "partner_admin",
      "channelPartnerId": "channelPartnerId"
    }
  }
}
```

## 4. Login After Signup

Existing email login still works:

```http
POST /api/auth/login
```

```json
{
  "email": "optional@example.com",
  "password": "Pass@123"
}
```

The Partner App can also log in with mobile:

```json
{
  "identifier": "9876543210",
  "password": "Pass@123"
}
```

## Validation

- Mobile must be exactly 10 digits.
- Mobile must not already exist in an account or channel partner.
- Name is required.
- Type is required and must be one of the allowed partner types.
- Password must be at least 8 characters and include at least one letter and one number.
- Confirm password is required when creating the partner admin account and must match password.
- If email is provided, it must not already exist on an account.
- Address is required and stored on the partner record using the same object shape as tenant address, including `district`.
