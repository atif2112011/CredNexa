# Test Profiles

Purpose: reusable partner and tenant profiles for Partner App and backend API testing.

Base URL:

```text
/api
```

Mock OTP for partner signup and tenant creation:

```text
123456
```

## Field Rules From Current Repo

Partner signup:

- Public endpoints: `POST /api/partner/signup/initiate-otp`, `POST /api/partner/signup/verify-otp`, `POST /api/partner/signup/complete?createAccount=true`.
- Partner fields: `name`, `mobile`, `type`, `verificationSessionId`, `password`, `confirmPassword`, optional `email`, optional `address`.
- Partner signup `email` is copied to both `ChannelPartner.contactEmail` and the created `partner_admin` `Account.email`.
- Allowed partner `type`: `nbfc_group`, `retail_chain_group`, `independent`.
- `password` must be at least 8 characters and include at least one letter and one number.
- Signup creates a `ChannelPartner` and, with `createAccount=true`, a linked `partner_admin` account.

Partner tenant creation:

- Authenticated endpoints: `POST /api/partner/tenants/initiate-verification`, `POST /api/partner/tenants/verify-verification`, `POST /api/partner/tenants?app=true`.
- Create-tenant form fields: `name`, `type`, `capabilities`, `parentTenantId`, `supportPhone`, `supportEmail`, `supportWhatsapp`, `tenantCreationVerificationMode`, `tenantCreationVerificationSessionId`, `isAdhaarVerificationEnabled`, `address`, `tenantAdmin`.
- `tenantAdmin.mobile` is the required tenant-admin login identifier when `app=true`; `tenantAdmin.email` is optional.
- Allowed tenant `type` values in the model/docs: `nbfc`, `retail_chain`, `standalone_outlet`, `pos_outlet`.
- Allowed `capabilities`: `lend`, `distribute`.
- Allowed `tenantCreationVerificationMode`: `mobile_otp`, `aadhaar_otp`.
- Do not send `channelPartnerId`, `tenantPolicy`, or `devicePolicies`; partner scope and default policies are backend-managed.
- Current backend note: the controller currently validates `capabilities`, but stores partner-created tenants as `type: "standalone_outlet"` and `capabilities: ["lend", "distribute"]` regardless of submitted `type` and `capabilities`.
- Current backend note: `supportWhatsapp` is included because it is part of the form/model/docs, but the current partner create-tenant controller does not persist it in the `Tenant.create` payload.

## Common API Sequence

For each partner:

```http
POST /api/partner/signup/initiate-otp
```

```json
{
  "mobile": "<partner mobile>"
}
```

```http
POST /api/partner/signup/verify-otp
```

```json
{
  "mobile": "<partner mobile>",
  "verificationSessionId": "<signup verificationSessionId>",
  "otp": "123456"
}
```

```http
POST /api/partner/signup/complete?createAccount=true
```

Use the partner signup payload from the profile below.

Then login:

```http
POST /api/auth/login
```

```json
{
  "identifier": "<partner mobile>",
  "password": "<partner password>"
}
```

Use the returned `accessToken` for tenant creation.

For each tenant:

```http
POST /api/partner/tenants/initiate-verification
Authorization: Bearer <partnerAdminAccessToken>
```

```json
{
  "name": "<tenant name>",
  "supportPhone": "<tenant supportPhone>",
  "tenantCreationVerificationMode": "<tenantCreationVerificationMode>"
}
```

```http
POST /api/partner/tenants/verify-verification
Authorization: Bearer <partnerAdminAccessToken>
```

```json
{
  "supportPhone": "<tenant supportPhone>",
  "tenantCreationVerificationMode": "<tenantCreationVerificationMode>",
  "verificationSessionId": "<tenant verificationSessionId>",
  "otp": "123456"
}
```

```http
POST /api/partner/tenants?app=true
Authorization: Bearer <partnerAdminAccessToken>
```

Use the tenant create payload from the profile below and replace `tenantCreationVerificationSessionId` with the verified session ID.

## Profile 1 - Apex Rural Finance

### Partner Signup Payload

```json
{
  "name": "Apex Rural Finance",
  "mobile": "9000010101",
  "type": "nbfc_group",
  "verificationSessionId": "<signup verificationSessionId>",
  "password": "ApexTest123",
  "confirmPassword": "ApexTest123",
  "email": "partner.apex.rural@example.com",
  "address": {
    "street": "2nd Floor, Apex Tower, FC Road",
    "city": "Pune",
    "state": "Maharashtra",
    "pincode": "411004"
  }
}
```

### Login

```json
{
  "identifier": "9000010101",
  "password": "ApexTest123"
}
```

### Tenant 1 - Apex Pune Lending

```json
{
  "name": "Apex Pune Lending",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "parentTenantId": null,
  "supportPhone": "9000010111",
  "supportEmail": "support.apex.pune@example.com",
  "supportWhatsapp": "9000010111",
  "tenantCreationVerificationMode": "mobile_otp",
  "tenantCreationVerificationSessionId": "<tenant verificationSessionId>",
  "isAdhaarVerificationEnabled": false,
  "address": {
    "street": "Office 301, JM Road",
    "city": "Pune",
    "state": "Maharashtra",
    "pincode": "411005"
  },
  "tenantAdmin": {
    "name": "Priya Deshmukh",
    "mobile": "9000010112",
    "temporaryPassword": "ApexPune123",
    "confirmPassword": "ApexPune123"
  }
}
```

### Tenant 2 - Apex Nashik Field Office

```json
{
  "name": "Apex Nashik Field Office",
  "type": "standalone_outlet",
  "capabilities": ["lend"],
  "parentTenantId": null,
  "supportPhone": "9000010121",
  "supportEmail": "support.apex.nashik@example.com",
  "supportWhatsapp": "9000010121",
  "tenantCreationVerificationMode": "mobile_otp",
  "tenantCreationVerificationSessionId": "<tenant verificationSessionId>",
  "isAdhaarVerificationEnabled": true,
  "address": {
    "street": "Shop 18, College Road",
    "city": "Nashik",
    "state": "Maharashtra",
    "pincode": "422005"
  },
  "tenantAdmin": {
    "name": "Sagar Kulkarni",
    "mobile": "9000010122",
    "temporaryPassword": "ApexNashik123",
    "confirmPassword": "ApexNashik123"
  }
}
```

## Profile 2 - Metro Retail Connect

### Partner Signup Payload

```json
{
  "name": "Metro Retail Connect",
  "mobile": "9000020202",
  "type": "retail_chain_group",
  "verificationSessionId": "<signup verificationSessionId>",
  "password": "MetroTest123",
  "confirmPassword": "MetroTest123",
  "email": "partner.metro.retail@example.com",
  "address": {
    "street": "Retail House, Ring Road",
    "city": "Ahmedabad",
    "state": "Gujarat",
    "pincode": "380015"
  }
}
```

### Login

```json
{
  "identifier": "9000020202",
  "password": "MetroTest123"
}
```

### Tenant 1 - Metro Ahmedabad Phones

```json
{
  "name": "Metro Ahmedabad Phones",
  "type": "retail_chain",
  "capabilities": ["distribute"],
  "parentTenantId": null,
  "supportPhone": "9000020211",
  "supportEmail": "support.metro.ahmedabad@example.com",
  "supportWhatsapp": "9000020211",
  "tenantCreationVerificationMode": "aadhaar_otp",
  "tenantCreationVerificationSessionId": "<tenant verificationSessionId>",
  "isAdhaarVerificationEnabled": true,
  "address": {
    "street": "C G Road Showroom",
    "city": "Ahmedabad",
    "state": "Gujarat",
    "pincode": "380009"
  },
  "tenantAdmin": {
    "name": "Neha Shah",
    "mobile": "9000020212",
    "temporaryPassword": "MetroAhm123",
    "confirmPassword": "MetroAhm123"
  }
}
```

### Tenant 2 - Metro Surat Mobility

```json
{
  "name": "Metro Surat Mobility",
  "type": "pos_outlet",
  "capabilities": ["lend", "distribute"],
  "parentTenantId": null,
  "supportPhone": "9000020221",
  "supportEmail": "support.metro.surat@example.com",
  "supportWhatsapp": "9000020221",
  "tenantCreationVerificationMode": "mobile_otp",
  "tenantCreationVerificationSessionId": "<tenant verificationSessionId>",
  "isAdhaarVerificationEnabled": false,
  "address": {
    "street": "Adajan Main Road",
    "city": "Surat",
    "state": "Gujarat",
    "pincode": "395009"
  },
  "tenantAdmin": {
    "name": "Kunal Patel",
    "mobile": "9000020222",
    "temporaryPassword": "MetroSurat123",
    "confirmPassword": "MetroSurat123"
  }
}
```

## Profile 3 - CitySure Partners

### Partner Signup Payload

```json
{
  "name": "CitySure Partners",
  "mobile": "9000030303",
  "type": "independent",
  "verificationSessionId": "<signup verificationSessionId>",
  "password": "CitySure123",
  "confirmPassword": "CitySure123",
  "email": "partner.citysure@example.com",
  "address": {
    "street": "12 Civil Lines",
    "city": "Jaipur",
    "state": "Rajasthan",
    "pincode": "302006"
  }
}
```

### Login

```json
{
  "identifier": "9000030303",
  "password": "CitySure123"
}
```

### Tenant 1 - CitySure Jaipur Finance

```json
{
  "name": "CitySure Jaipur Finance",
  "type": "nbfc",
  "capabilities": ["lend"],
  "parentTenantId": null,
  "supportPhone": "9000030311",
  "supportEmail": "support.citysure.jaipur@example.com",
  "supportWhatsapp": "9000030311",
  "tenantCreationVerificationMode": "mobile_otp",
  "tenantCreationVerificationSessionId": "<tenant verificationSessionId>",
  "isAdhaarVerificationEnabled": false,
  "address": {
    "street": "MI Road Branch",
    "city": "Jaipur",
    "state": "Rajasthan",
    "pincode": "302001"
  },
  "tenantAdmin": {
    "name": "Ankit Meena",
    "mobile": "9000030312",
    "temporaryPassword": "CityJaipur123",
    "confirmPassword": "CityJaipur123"
  }
}
```

## Profile 4 - Eastern Device Finance

### Partner Signup Payload

```json
{
  "name": "Eastern Device Finance",
  "mobile": "9000040404",
  "type": "nbfc_group",
  "verificationSessionId": "<signup verificationSessionId>",
  "password": "Eastern123",
  "confirmPassword": "Eastern123",
  "email": "partner.eastern.device@example.com",
  "address": {
    "street": "Salt Lake Sector V",
    "city": "Kolkata",
    "state": "West Bengal",
    "pincode": "700091"
  }
}
```

### Login

```json
{
  "identifier": "9000040404",
  "password": "Eastern123"
}
```

### Tenant 1 - Eastern Kolkata Lending

```json
{
  "name": "Eastern Kolkata Lending",
  "type": "nbfc",
  "capabilities": ["lend", "distribute"],
  "parentTenantId": null,
  "supportPhone": "9000040411",
  "supportEmail": "support.eastern.kolkata@example.com",
  "supportWhatsapp": "9000040411",
  "tenantCreationVerificationMode": "aadhaar_otp",
  "tenantCreationVerificationSessionId": "<tenant verificationSessionId>",
  "isAdhaarVerificationEnabled": true,
  "address": {
    "street": "Park Street Office",
    "city": "Kolkata",
    "state": "West Bengal",
    "pincode": "700016"
  },
  "tenantAdmin": {
    "name": "Riya Banerjee",
    "mobile": "9000040412",
    "temporaryPassword": "EasternKol123",
    "confirmPassword": "EasternKol123"
  }
}
```

### Tenant 2 - Eastern Siliguri Retail

```json
{
  "name": "Eastern Siliguri Retail",
  "type": "retail_chain",
  "capabilities": ["distribute"],
  "parentTenantId": null,
  "supportPhone": "9000040421",
  "supportEmail": "support.eastern.siliguri@example.com",
  "supportWhatsapp": "9000040421",
  "tenantCreationVerificationMode": "mobile_otp",
  "tenantCreationVerificationSessionId": "<tenant verificationSessionId>",
  "isAdhaarVerificationEnabled": false,
  "address": {
    "street": "Sevoke Road Store",
    "city": "Siliguri",
    "state": "West Bengal",
    "pincode": "734001"
  },
  "tenantAdmin": {
    "name": "Arjun Roy",
    "mobile": "9000040422",
    "temporaryPassword": "EasternSil123",
    "confirmPassword": "EasternSil123"
  }
}
```
