# Partner App Signup Contract For App Developer

Base URL:

```text
/api
```

This flow is for zero-contact partner onboarding from the Partner App.

## Step 1: Send OTP

```http
POST /api/partner/signup/initiate-otp
Content-Type: application/json
```

Request:

```json
{
  "mobile": "9876543210"
}
```

Success response:

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

For now, the OTP is always:

```text
123456
```

## Step 2: Verify OTP

```http
POST /api/partner/signup/verify-otp
Content-Type: application/json
```

Request:

```json
{
  "mobile": "9876543210",
  "verificationSessionId": "otp_...",
  "otp": "123456"
}
```

Success response:

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

## Step 3: Complete Signup

```http
POST /api/partner/signup/complete?createAccount=true
Content-Type: application/json
```

Request:

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

`email` is optional. `address` is required.

`address` uses the same shape as tenant address:

```json
{
  "street": "Shop 12, Main Road",
  "city": "Pune",
  "district": "Pune",
  "state": "Maharashtra",
  "pincode": "411001"
}
```

`confirmPassword` is required when creating the account, but it is only used for validation and is not stored.

Success response:

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

## Login After Signup

Use the existing login endpoint.

```http
POST /api/auth/login
Content-Type: application/json
```

Mobile login:

```json
{
  "identifier": "9876543210",
  "password": "Pass@123"
}
```

Email login also works if email was provided:

```json
{
  "email": "optional@example.com",
  "password": "Pass@123"
}
```

## Validation Rules

- Mobile must be exactly 10 digits.
- Mobile must not already be used.
- Name is required.
- Type is required.
- Password must be at least 8 characters and include at least one letter and one number.
- Confirm password is required and must match password.
- Email is optional.
- If email is provided, it must be unique.
- Address is required and uses the same `street`, `city`, `district`, `state`, `pincode` shape as tenant address.
- OTP expires in 10 minutes.
- Wrong OTP is rejected after maximum attempts.

## Common Errors

```json
{
  "success": false,
  "error": "Valid 10 digit mobile number is required"
}
```

```json
{
  "success": false,
  "error": "Phone number is already used"
}
```

```json
{
  "success": false,
  "error": "Invalid OTP"
}
```

```json
{
  "success": false,
  "error": "Invalid partner type"
}
```

```json
{
  "success": false,
  "error": "Password must be at least 8 characters and include at least one letter and one number"
}
```

```json
{
  "success": false,
  "error": "Password and confirm password must match"
}
```
