# Partner Signup Changes

## Signup Form Fields

The partner signup form should have these fields:

```text
Full Name / Partner Name      required
Partner Type                  required(already shown with a default selected option ie independent)
Mobile Number                 already OTP verified(show as a view only field with number)
Email                         optional
Password                      required
Confirm Password              required, validation only
City                          required
District                      required
State                         required
Address                       required
```

## UI Guidance

Show a unified form.

Do not show separate headers for Partner Profile and Login Credentials.

## Backend Mapping

```text
name              -> ChannelPartner.name and Account.name
type              -> ChannelPartner.type
mobile            -> ChannelPartner.contactPhone and Account.mobile
email             -> ChannelPartner.contactEmail and Account.email
password          -> Account.passwordHash
confirmPassword   -> validation only, not stored
city              -> ChannelPartner.address.city
district          -> ChannelPartner.address.district
state             -> ChannelPartner.address.state
address           -> ChannelPartner.address.street
pincode           -> ChannelPartner.address.pincode
```

## API Support

Endpoint:

```text
POST /api/partner/signup/complete?createAccount=true
```

The API requires `address` using the same format as tenant address:

```json
{
  "address": {
    "street": "Shop 12, Main Road",
    "city": "Pune",
    "district": "Pune",
    "state": "Maharashtra",
    "pincode": "411001"
  }
}
```

For the app form, map:

```text
Address -> address.street
City    -> address.city
District -> address.district
State   -> address.state
```

The API requires `confirmPassword` when `createAccount=true`, and it must match `password`.

## Password Validation

Current backend password validation enforces at least one letter. Update this rule so the password must contain at least one capital letter.

Expected password rule:

```text
minimum 8 characters
at least one capital letter
at least one number
```

## Partner Home Screen Changes

In the current blue card, show only:

```text
hello, {{ partner Name}}
```

In the Total Borrowers card, do not show admin users count.

In the Total Devices card, replace the current `Active` and `Locked` metrics with:

```text
Unlocked
Locked
```

In the Open Cases card, do not show the `Escalated to partner` metric because it matches the Open Case metric.

In the Recent Escalation section, remove this text:

```text
New partner escalation will appear here when the backend sends them
```

## Partner Escalation Page Changes

Remove the urgent filter.

Modify the status filter dropdown to use only these options:

```text
All
Pending Review      param: ESCALATED_PARTNER
Resolved            param: RESOLVED_PARTNER
```

## Create Tenant Form Changes

Change the label:

```text
Company Name -> Name
Support Contact card -> Contacts
Support Contacts -> Contacts
```

Backend tenant type:

```text
The app does not need to send tenant type.
The backend should set type = standalone_outlet during partner app tenant creation.
```

Make these changes in the Contacts card:

```text
Support Phone Number -> Phone, compulsory
Support Email Address -> Email, optional
Remove Support Whatsapp Number
```

Backend API note:

```text
supportPhone is now required for partner tenant creation.
```

Do not show a separate section for Tenant Admin Account.

Use the same unified form fields for tenant contact and tenant admin account creation:

```text
Name  -> Admin Name
Email -> Admin Email, if entered
Phone -> Admin Mobile
```

Add these fields:

```text
Password
Confirm Password
```

Show this text near the password fields:

```text
System will generate a password automatically if left blank.
```

Backend API note:

```text
If Password is entered, Confirm Password must match.
If Password is left blank, backend continues to generate the password automatically.
```

## Sidebar Changes

In the sidebar, show only:

```text
Account Name
Account Number
```
