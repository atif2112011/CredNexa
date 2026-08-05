import type { FieldConfig } from "@/components/data/form-dialog";
import type { RecordItem } from "@/types/api";

const noneOption = { label: "None", value: "none" };

const optionFromRecord = (item: RecordItem) => ({
  label: String(item.name || item.email || item._id || item.id || "Unnamed"),
  value: String(item._id || item.id || "")
});

const tenantOptionFromRecord = (item: RecordItem) => ({
  ...optionFromRecord(item),
  parentValue: String(
    item.channelPartnerId && typeof item.channelPartnerId === "object"
      ? (item.channelPartnerId as RecordItem)._id || (item.channelPartnerId as RecordItem).id || ""
      : item.channelPartnerId || ""
  )
});

const partnerProfileFields: FieldConfig[] = [
  { name: "name", label: "Name", required: true },
  {
    name: "type",
    label: "Type",
    type: "select",
    required: true,
    options: [
      { label: "NBFC group", value: "nbfc_group" },
      { label: "Retail chain group", value: "retail_chain_group" },
      { label: "Independent", value: "independent" }
    ]
  },
  { name: "contactEmail", label: "Contact email", type: "email" },
  { name: "contactPhone", label: "Contact phone", required: true },
  { name: "creditPercentage", label: "Credit percentage", type: "number" },
  {
    name: "pincodeRestrictionEnabled",
    label: "Pincode onboarding restriction",
    type: "select",
    required: true,
    options: [
      { label: "Enabled", value: "true" },
      { label: "Disabled", value: "false" }
    ]
  },
  { name: "tenantOnboardingLimit", label: "Tenant onboarding limit", type: "number", required: true },
  { name: "addressStreet", label: "Address", required: true },
  { name: "addressCity", label: "City", required: true },
  { name: "addressDistrict", label: "District", required: true },
  { name: "addressState", label: "State", required: true },
  { name: "addressPincode", label: "Pincode", required: true }
];

export const partnerCreateFields: FieldConfig[] = [
  ...partnerProfileFields,
  { name: "temporaryPassword", label: "Password (optional)", type: "password" }
];

export const partnerUpdateFields: FieldConfig[] = partnerProfileFields;

export const tenantFields: FieldConfig[] = [
  { name: "name", label: "Name", required: true },
  {
    name: "type",
    label: "Type",
    type: "select",
    required: true,
    options: [
      { label: "NBFC", value: "nbfc" },
      { label: "Retail chain", value: "retail_chain" },
      { label: "Standalone outlet", value: "standalone_outlet" },
      { label: "POS outlet", value: "pos_outlet" }
    ]
  },
  { name: "channelPartnerId", label: "Channel partner ID", required: true },
  { name: "supportPhone", label: "Support phone", required: true },
  { name: "supportEmail", label: "Support email", type: "email" },
  { name: "creditPurchasePerKeyPrice", label: "Per key price", type: "number" },
  { name: "pocName", label: "POC name", required: true },
  { name: "pocPhone", label: "POC phone number", required: true },
  { name: "pocDesignation", label: "POC designation", required: true },
  { name: "addressStreet", label: "Address", required: true },
  { name: "addressCity", label: "City", required: true },
  { name: "addressDistrict", label: "District", required: true },
  { name: "addressState", label: "State", required: true },
  { name: "addressPincode", label: "Pincode", required: true },
  { name: "temporaryPassword", label: "Password (optional)", type: "password" }
];

export const buildTenantFields = (partners: RecordItem[]): FieldConfig[] =>
  tenantFields.map((field) =>
    field.name === "channelPartnerId"
      ? {
          ...field,
          label: "Channel partner",
          type: "select",
          options: partners.map(optionFromRecord)
        }
      : field
  );

export const tenantUpdateFields: FieldConfig[] = [
  { name: "name", label: "Name" },
  { name: "supportPhone", label: "Support phone", required: true },
  { name: "supportEmail", label: "Support email", type: "email" },
  { name: "creditPurchasePerKeyPrice", label: "Per key price", type: "number" },
  { name: "pocName", label: "POC name", required: true },
  { name: "pocPhone", label: "POC phone number", required: true },
  { name: "pocDesignation", label: "POC designation", required: true },
  { name: "addressStreet", label: "Address", required: true },
  { name: "addressCity", label: "City", required: true },
  { name: "addressDistrict", label: "District", required: true },
  { name: "addressState", label: "State", required: true },
  { name: "addressPincode", label: "Pincode", required: true }
];

export const accountFields: FieldConfig[] = [
  { name: "name", label: "Name", required: true },
  { name: "email", label: "Email", type: "email" },
  { name: "mobile", label: "Mobile", required: true },
  {
    name: "role",
    label: "Role",
    type: "select",
    required: true,
    options: [
      { label: "Partner admin", value: "partner_admin" },
      { label: "Tenant admin", value: "tenant_admin" }
    ]
  },
  { name: "tenantId", label: "Tenant ID" },
  { name: "channelPartnerId", label: "Channel partner ID" },
  { name: "temporaryPassword", label: "Temporary password", type: "password", required: true }
];

export const buildAccountFields = (partners: RecordItem[], tenants: RecordItem[]): FieldConfig[] =>
  accountFields.map((field) => {
    if (field.name === "tenantId") {
      return {
        ...field,
        label: "Tenant",
        type: "select",
        options: [noneOption, ...tenants.map(tenantOptionFromRecord)]
      };
    }

    if (field.name === "channelPartnerId") {
      return {
        ...field,
        label: "Channel partner",
        type: "select",
        options: [noneOption, ...partners.map(optionFromRecord)]
      };
    }

    return field;
  });


export const accountUpdateFields: FieldConfig[] = [
  { name: "name", label: "Name" },
  { name: "mobile", label: "Mobile" },
  { name: "tenantId", label: "Tenant ID" },
  { name: "channelPartnerId", label: "Channel partner ID" }
];

export const consentFields: FieldConfig[] = [
  { name: "version", label: "Version", required: true, placeholder: "1.0" },
  { name: "title", label: "Title", required: true },
  { name: "borrowerAgreementText", label: "Borrower agreement", type: "textarea", required: true },
  { name: "deviceControlConsentText", label: "Device control consent", type: "textarea", required: true },
  { name: "privacyPolicyText", label: "Privacy policy", type: "textarea", required: true },
  { name: "tripartiteAckText", label: "Tripartite acknowledgement", type: "textarea" }
];

export const statusFields: FieldConfig[] = [
  {
    name: "isActive",
    label: "Status",
    type: "select",
    required: true,
    options: [
      { label: "Active", value: "true" },
      { label: "Inactive", value: "false" }
    ]
  },
  { name: "reason", label: "Reason", type: "textarea" }
];

export const escalationReasonFields: FieldConfig[] = [
  { name: "reason", label: "Reason", type: "textarea", required: true }
];

export const tempUnlockFields: FieldConfig[] = [
  { name: "durationHours", label: "Duration hours", type: "number", required: true },
  { name: "reason", label: "Reason", type: "textarea", required: true }
];
