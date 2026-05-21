import type { FieldConfig } from "@/components/data/form-dialog";

export const partnerFields: FieldConfig[] = [
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
  { name: "contactPhone", label: "Contact phone" }
];

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
  { name: "capabilities", label: "Capabilities", required: true, placeholder: "lend, distribute" },
  { name: "channelPartnerId", label: "Channel partner ID", required: true },
  { name: "supportPhone", label: "Support phone" },
  { name: "supportEmail", label: "Support email", type: "email" },
  { name: "supportWhatsapp", label: "Support WhatsApp" }
];

export const tenantUpdateFields: FieldConfig[] = [
  { name: "name", label: "Name" },
  { name: "supportPhone", label: "Support phone" },
  { name: "supportEmail", label: "Support email", type: "email" },
  { name: "supportWhatsapp", label: "Support WhatsApp" }
];

export const accountFields: FieldConfig[] = [
  { name: "name", label: "Name", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "mobile", label: "Mobile" },
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
