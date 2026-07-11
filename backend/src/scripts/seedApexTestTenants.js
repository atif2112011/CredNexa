import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { connectDatabase } from "../config/database.js";
import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { DEFAULT_DEVICE_POLICIES, DEFAULT_TENANT_POLICY } from "../constants/defaultPolicies.js";
import { ACCOUNT_ROLES } from "../constants/roles.js";
import { TENANT_CAPABILITIES, TENANT_TYPES } from "../constants/tenant.js";
import { Account } from "../models/Account.js";
import { AuditLog } from "../models/AuditLog.js";
import { ChannelPartner } from "../models/ChannelPartner.js";
import { DevicePolicy } from "../models/DevicePolicy.js";
import { Tenant } from "../models/Tenant.js";
import { TenantPolicy } from "../models/TenantPolicy.js";
import { buildEmptyTenantMetrics } from "../services/tenantMetrics.service.js";

const PARTNER_ID = "6a40d28094c9b128b68568c3";
const TEMP_PASSWORD = "TestTenant123";

const tenants = [
  {
    name: "Apex Test Finance Hub 01",
    supportPhone: "9011101001",
    supportEmail: "apex.test.tenant01@example.com",
    supportWhatsapp: "9011101001",
    city: "Lucknow",
    district: "Lucknow",
    state: "Uttar Pradesh",
    pincode: "226010",
    pocName: "Aarav Sharma",
    pocPhone: "9011101101",
    pocDesignation: "Branch Manager",
    creditPurchasePerKeyPrice: 125,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Mobile Point 02",
    supportPhone: "9011101002",
    supportEmail: "apex.test.tenant02@example.com",
    supportWhatsapp: "9011101002",
    city: "Kanpur",
    district: "Kanpur Nagar",
    state: "Uttar Pradesh",
    pincode: "208001",
    pocName: "Isha Verma",
    pocPhone: "9011101102",
    pocDesignation: "Store Lead",
    creditPurchasePerKeyPrice: 99,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Rural Credit 03",
    supportPhone: "9011101003",
    supportEmail: "apex.test.tenant03@example.com",
    supportWhatsapp: "9011101003",
    city: "Patna",
    district: "Patna",
    state: "Bihar",
    pincode: "800001",
    pocName: "Rohan Kumar",
    pocPhone: "9011101103",
    pocDesignation: "Credit Officer",
    creditPurchasePerKeyPrice: 149,
    capabilities: [TENANT_CAPABILITIES.LEND]
  },
  {
    name: "Apex Test Device Mart 04",
    supportPhone: "9011101004",
    supportEmail: "apex.test.tenant04@example.com",
    supportWhatsapp: "9011101004",
    city: "Jaipur",
    district: "Jaipur",
    state: "Rajasthan",
    pincode: "302001",
    pocName: "Meera Singh",
    pocPhone: "9011101104",
    pocDesignation: "Operations Head",
    creditPurchasePerKeyPrice: 175,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test EMI Store 05",
    supportPhone: "9011101005",
    supportEmail: "apex.test.tenant05@example.com",
    supportWhatsapp: "9011101005",
    city: "Bhopal",
    district: "Bhopal",
    state: "Madhya Pradesh",
    pincode: "462001",
    pocName: "Kabir Khan",
    pocPhone: "9011101105",
    pocDesignation: "Collection Lead",
    creditPurchasePerKeyPrice: 110,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Credit Kendra 06",
    supportPhone: "9011101006",
    supportEmail: "apex.test.tenant06@example.com",
    supportWhatsapp: "9011101006",
    city: "Indore",
    district: "Indore",
    state: "Madhya Pradesh",
    pincode: "452001",
    pocName: "Nisha Patel",
    pocPhone: "9011101106",
    pocDesignation: "Area Coordinator",
    creditPurchasePerKeyPrice: 135,
    capabilities: [TENANT_CAPABILITIES.LEND]
  },
  {
    name: "Apex Test Smart Phones 07",
    supportPhone: "9011101007",
    supportEmail: "apex.test.tenant07@example.com",
    supportWhatsapp: "9011101007",
    city: "Ahmedabad",
    district: "Ahmedabad",
    state: "Gujarat",
    pincode: "380001",
    pocName: "Dev Mehta",
    pocPhone: "9011101107",
    pocDesignation: "Retail Manager",
    creditPurchasePerKeyPrice: 160,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Lending Desk 08",
    supportPhone: "9011101008",
    supportEmail: "apex.test.tenant08@example.com",
    supportWhatsapp: "9011101008",
    city: "Surat",
    district: "Surat",
    state: "Gujarat",
    pincode: "395003",
    pocName: "Priya Shah",
    pocPhone: "9011101108",
    pocDesignation: "Finance Manager",
    creditPurchasePerKeyPrice: 145,
    capabilities: [TENANT_CAPABILITIES.LEND]
  },
  {
    name: "Apex Test Mobile Plaza 09",
    supportPhone: "9011101009",
    supportEmail: "apex.test.tenant09@example.com",
    supportWhatsapp: "9011101009",
    city: "Nagpur",
    district: "Nagpur",
    state: "Maharashtra",
    pincode: "440001",
    pocName: "Arjun Rao",
    pocPhone: "9011101109",
    pocDesignation: "Store Owner",
    creditPurchasePerKeyPrice: 120,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Secure EMI 10",
    supportPhone: "9011101010",
    supportEmail: "apex.test.tenant10@example.com",
    supportWhatsapp: "9011101010",
    city: "Pune",
    district: "Pune",
    state: "Maharashtra",
    pincode: "411001",
    pocName: "Tanvi Joshi",
    pocPhone: "9011101110",
    pocDesignation: "Business Head",
    creditPurchasePerKeyPrice: 199,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Loan Counter 11",
    supportPhone: "9011101011",
    supportEmail: "apex.test.tenant11@example.com",
    supportWhatsapp: "9011101011",
    city: "Ranchi",
    district: "Ranchi",
    state: "Jharkhand",
    pincode: "834001",
    pocName: "Sahil Gupta",
    pocPhone: "9011101111",
    pocDesignation: "Loan Officer",
    creditPurchasePerKeyPrice: 105,
    capabilities: [TENANT_CAPABILITIES.LEND]
  },
  {
    name: "Apex Test Device Corner 12",
    supportPhone: "9011101012",
    supportEmail: "apex.test.tenant12@example.com",
    supportWhatsapp: "9011101012",
    city: "Raipur",
    district: "Raipur",
    state: "Chhattisgarh",
    pincode: "492001",
    pocName: "Kavya Nair",
    pocPhone: "9011101112",
    pocDesignation: "Service Manager",
    creditPurchasePerKeyPrice: 115,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Digital Finance 13",
    supportPhone: "9011101013",
    supportEmail: "apex.test.tenant13@example.com",
    supportWhatsapp: "9011101013",
    city: "Bhubaneswar",
    district: "Khordha",
    state: "Odisha",
    pincode: "751001",
    pocName: "Aditya Das",
    pocPhone: "9011101113",
    pocDesignation: "Cluster Lead",
    creditPurchasePerKeyPrice: 155,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Easy EMI 14",
    supportPhone: "9011101014",
    supportEmail: "apex.test.tenant14@example.com",
    supportWhatsapp: "9011101014",
    city: "Guwahati",
    district: "Kamrup Metropolitan",
    state: "Assam",
    pincode: "781001",
    pocName: "Ritika Bora",
    pocPhone: "9011101114",
    pocDesignation: "Branch Coordinator",
    creditPurchasePerKeyPrice: 140,
    capabilities: [TENANT_CAPABILITIES.LEND]
  },
  {
    name: "Apex Test Retail Credit 15",
    supportPhone: "9011101015",
    supportEmail: "apex.test.tenant15@example.com",
    supportWhatsapp: "9011101015",
    city: "Dehradun",
    district: "Dehradun",
    state: "Uttarakhand",
    pincode: "248001",
    pocName: "Manav Rawat",
    pocPhone: "9011101115",
    pocDesignation: "Retail Partner",
    creditPurchasePerKeyPrice: 130,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  }
];

const buildAdminAccount = ({ tenant, index, channelPartnerId, createdBy, passwordHash }) => ({
  name: `${tenant.pocName} Admin`,
  email: `apex.test.admin${String(index + 1).padStart(2, "0")}@example.com`,
  mobile: String(9022201001 + index),
  role: ACCOUNT_ROLES.TENANT_ADMIN,
  tenantId: tenant._id,
  channelPartnerId,
  passwordHash,
  createdBy
});

const run = async () => {
  await connectDatabase();

  const channelPartner = await ChannelPartner.findById(PARTNER_ID).lean();
  if (!channelPartner) {
    throw new Error(`Channel partner not found: ${PARTNER_ID}`);
  }

  const createdBy = channelPartner.adminAccountId || (await Account.findOne({ channelPartnerId: PARTNER_ID, role: ACCOUNT_ROLES.PARTNER_ADMIN }).select("_id").lean())?._id;
  if (!createdBy) {
    throw new Error(`No partner admin account found for ${channelPartner.name}`);
  }

  const tenantNames = tenants.map((tenant) => tenant.name);
  const adminMobiles = tenants.map((_, index) => String(9022201001 + index));
  const adminEmails = tenants.map((_, index) => `apex.test.admin${String(index + 1).padStart(2, "0")}@example.com`);
  const supportPhones = tenants.map((tenant) => tenant.supportPhone);

  const [existingTenants, existingAccounts] = await Promise.all([
    Tenant.find({
      channelPartnerId: PARTNER_ID,
      $or: [{ name: { $in: tenantNames } }, { supportPhone: { $in: supportPhones } }]
    })
      .select("name supportPhone")
      .lean(),
    Account.find({
      $or: [{ mobile: { $in: adminMobiles } }, { email: { $in: adminEmails } }]
    })
      .select("mobile email")
      .lean()
  ]);

  if (existingTenants.length || existingAccounts.length) {
    throw new Error(
      `Seed data conflict. Existing tenants: ${JSON.stringify(existingTenants)} Existing accounts: ${JSON.stringify(existingAccounts)}`
    );
  }

  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 12);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const createdTenants = [];
    const createdAccounts = [];

    for (const [index, tenantInput] of tenants.entries()) {
      const [tenant] = await Tenant.create(
        [
          {
            name: tenantInput.name,
            type: TENANT_TYPES.STANDALONE_OUTLET,
            capabilities: tenantInput.capabilities,
            channelPartnerId: PARTNER_ID,
            parentTenantId: null,
            supportPhone: tenantInput.supportPhone,
            supportEmail: tenantInput.supportEmail,
            supportWhatsapp: tenantInput.supportWhatsapp,
            address: {
              street: `${index + 1}, Test Market Road`,
              city: tenantInput.city,
              district: tenantInput.district,
              state: tenantInput.state,
              pincode: tenantInput.pincode
            },
            pocName: tenantInput.pocName,
            pocPhone: tenantInput.pocPhone,
            pocDesignation: tenantInput.pocDesignation,
            creditPurchasePerKeyPrice: tenantInput.creditPurchasePerKeyPrice,
            metrics: buildEmptyTenantMetrics(),
            isAdhaarVerificationEnabled: index % 3 === 0,
            createdBy
          }
        ],
        { session, ordered: true }
      );

      const [account] = await Account.create([buildAdminAccount({ tenant, index, channelPartnerId: PARTNER_ID, createdBy, passwordHash })], {
        session,
        ordered: true
      });

      tenant.adminAccountId = account._id;
      await tenant.save({ session });

      await TenantPolicy.create([{ tenantId: tenant._id, ...DEFAULT_TENANT_POLICY, updatedBy: createdBy }], { session, ordered: true });

      await DevicePolicy.create(
        DEFAULT_DEVICE_POLICIES.map((policy) => ({
          tenantId: tenant._id,
          policyKey: policy.policyKey,
          restrictions: policy.restrictions,
          createdBy
        })),
        { session, ordered: true }
      );

      await AuditLog.create(
        [
          {
            eventType: AUDIT_EVENTS.TENANT_CREATED,
            actorId: createdBy,
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            metadata: {
              name: tenant.name,
              type: tenant.type,
              capabilities: tenant.capabilities,
              source: "seed_apex_test_tenants"
            }
          },
          {
            eventType: AUDIT_EVENTS.ACCOUNT_CREATED,
            actorId: createdBy,
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            metadata: {
              accountId: account._id,
              role: account.role,
              email: account.email,
              source: "seed_apex_test_tenants"
            }
          },
          {
            eventType: AUDIT_EVENTS.TENANT_POLICY_CREATED,
            actorId: createdBy,
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            metadata: { source: "seed_apex_test_tenants" }
          },
          {
            eventType: AUDIT_EVENTS.DEVICE_POLICIES_CREATED,
            actorId: createdBy,
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            metadata: {
              policyKeys: DEFAULT_DEVICE_POLICIES.map((policy) => policy.policyKey),
              source: "seed_apex_test_tenants"
            }
          }
        ],
        { session, ordered: true }
      );

      createdTenants.push(tenant);
      createdAccounts.push(account);
    }

    await session.commitTransaction();

    console.log(
      JSON.stringify(
        {
          channelPartner: {
            id: channelPartner._id,
            name: channelPartner.name
          },
          tenantCount: createdTenants.length,
          defaultTenantAdminPassword: TEMP_PASSWORD,
          tenants: createdTenants.map((tenant, index) => ({
            tenantId: tenant._id,
            tenantName: tenant.name,
            adminAccountId: createdAccounts[index]._id,
            adminMobile: createdAccounts[index].mobile,
            adminEmail: createdAccounts[index].email
          }))
        },
        null,
        2
      )
    );
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
