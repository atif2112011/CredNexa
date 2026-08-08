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
    name: "Apex Test Collection Hub 16",
    supportPhone: "9011101016",
    supportEmail: "apex.test.tenant16@example.com",
    supportWhatsapp: "9011101016",
    city: "Meerut",
    district: "Meerut",
    state: "Uttar Pradesh",
    pincode: "250001",
    pocName: "Vihaan Agarwal",
    pocPhone: "9011101116",
    pocDesignation: "Collection Manager",
    creditPurchasePerKeyPrice: 118,
    capabilities: [TENANT_CAPABILITIES.LEND]
  },
  {
    name: "Apex Test Phone Bazaar 17",
    supportPhone: "9011101017",
    supportEmail: "apex.test.tenant17@example.com",
    supportWhatsapp: "9011101017",
    city: "Varanasi",
    district: "Varanasi",
    state: "Uttar Pradesh",
    pincode: "221001",
    pocName: "Ananya Mishra",
    pocPhone: "9011101117",
    pocDesignation: "Outlet Manager",
    creditPurchasePerKeyPrice: 132,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Loan Seva 18",
    supportPhone: "9011101018",
    supportEmail: "apex.test.tenant18@example.com",
    supportWhatsapp: "9011101018",
    city: "Gaya",
    district: "Gaya",
    state: "Bihar",
    pincode: "823001",
    pocName: "Harsh Raj",
    pocPhone: "9011101118",
    pocDesignation: "Loan Desk Lead",
    creditPurchasePerKeyPrice: 142,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Secure Devices 19",
    supportPhone: "9011101019",
    supportEmail: "apex.test.tenant19@example.com",
    supportWhatsapp: "9011101019",
    city: "Jodhpur",
    district: "Jodhpur",
    state: "Rajasthan",
    pincode: "342001",
    pocName: "Sanya Rathore",
    pocPhone: "9011101119",
    pocDesignation: "Device Sales Lead",
    creditPurchasePerKeyPrice: 168,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Credit Plaza 20",
    supportPhone: "9011101020",
    supportEmail: "apex.test.tenant20@example.com",
    supportWhatsapp: "9011101020",
    city: "Udaipur",
    district: "Udaipur",
    state: "Rajasthan",
    pincode: "313001",
    pocName: "Dhruv Jain",
    pocPhone: "9011101120",
    pocDesignation: "Credit Partner",
    creditPurchasePerKeyPrice: 152,
    capabilities: [TENANT_CAPABILITIES.LEND]
  },
  {
    name: "Apex Test Mobile Credit 21",
    supportPhone: "9011101021",
    supportEmail: "apex.test.tenant21@example.com",
    supportWhatsapp: "9011101021",
    city: "Nashik",
    district: "Nashik",
    state: "Maharashtra",
    pincode: "422001",
    pocName: "Sneha Kulkarni",
    pocPhone: "9011101121",
    pocDesignation: "Retail Finance Lead",
    creditPurchasePerKeyPrice: 188,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test EMI Junction 22",
    supportPhone: "9011101022",
    supportEmail: "apex.test.tenant22@example.com",
    supportWhatsapp: "9011101022",
    city: "Kolhapur",
    district: "Kolhapur",
    state: "Maharashtra",
    pincode: "416001",
    pocName: "Omkar Patil",
    pocPhone: "9011101122",
    pocDesignation: "Branch Supervisor",
    creditPurchasePerKeyPrice: 126,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Finance Mitra 23",
    supportPhone: "9011101023",
    supportEmail: "apex.test.tenant23@example.com",
    supportWhatsapp: "9011101023",
    city: "Jamshedpur",
    district: "East Singhbhum",
    state: "Jharkhand",
    pincode: "831001",
    pocName: "Riya Sen",
    pocPhone: "9011101123",
    pocDesignation: "Finance Coordinator",
    creditPurchasePerKeyPrice: 137,
    capabilities: [TENANT_CAPABILITIES.LEND]
  },
  {
    name: "Apex Test Gadget Finance 24",
    supportPhone: "9011101024",
    supportEmail: "apex.test.tenant24@example.com",
    supportWhatsapp: "9011101024",
    city: "Cuttack",
    district: "Cuttack",
    state: "Odisha",
    pincode: "753001",
    pocName: "Nikhil Mohanty",
    pocPhone: "9011101124",
    pocDesignation: "Dealer Principal",
    creditPurchasePerKeyPrice: 174,
    capabilities: [TENANT_CAPABILITIES.LEND, TENANT_CAPABILITIES.DISTRIBUTE]
  },
  {
    name: "Apex Test Easy Device 25",
    supportPhone: "9011101025",
    supportEmail: "apex.test.tenant25@example.com",
    supportWhatsapp: "9011101025",
    city: "Siliguri",
    district: "Darjeeling",
    state: "West Bengal",
    pincode: "734001",
    pocName: "Tanya Chatterjee",
    pocPhone: "9011101125",
    pocDesignation: "Regional Retail Lead",
    creditPurchasePerKeyPrice: 164,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  }
];

const adminEmailForIndex = (index) => `apex.test.admin${String(index).padStart(2, "0")}@example.com`;
const adminMobileForIndex = (index) => String(9022201000 + index);

const run = async () => {
  await connectDatabase();

  const channelPartner = await ChannelPartner.findById(PARTNER_ID).lean();
  if (!channelPartner) {
    throw new Error(`Channel partner not found: ${PARTNER_ID}`);
  }

  const createdBy =
    channelPartner.adminAccountId ||
    (await Account.findOne({ channelPartnerId: PARTNER_ID, role: ACCOUNT_ROLES.PARTNER_ADMIN }).select("_id").lean())?._id;
  if (!createdBy) {
    throw new Error(`No partner admin account found for ${channelPartner.name}`);
  }

  const tenantNames = tenants.map((tenant) => tenant.name);
  const supportPhones = tenants.map((tenant) => tenant.supportPhone);
  const adminMobiles = tenants.map((_, index) => adminMobileForIndex(index + 16));
  const adminEmails = tenants.map((_, index) => adminEmailForIndex(index + 16));

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

    for (const [offset, tenantInput] of tenants.entries()) {
      const tenantNumber = offset + 16;
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
              street: `${tenantNumber}, Test Commerce Lane`,
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
            isAdhaarVerificationEnabled: tenantNumber % 4 === 0,
            createdBy
          }
        ],
        { session, ordered: true }
      );

      const [account] = await Account.create(
        [
          {
            name: `${tenantInput.pocName} Admin`,
            email: adminEmailForIndex(tenantNumber),
            mobile: adminMobileForIndex(tenantNumber),
            role: ACCOUNT_ROLES.TENANT_ADMIN,
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            passwordHash,
            createdBy
          }
        ],
        { session, ordered: true }
      );

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
              source: "seed_apex_more_test_tenants"
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
              source: "seed_apex_more_test_tenants"
            }
          },
          {
            eventType: AUDIT_EVENTS.TENANT_POLICY_CREATED,
            actorId: createdBy,
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            metadata: { source: "seed_apex_more_test_tenants" }
          },
          {
            eventType: AUDIT_EVENTS.DEVICE_POLICIES_CREATED,
            actorId: createdBy,
            tenantId: tenant._id,
            channelPartnerId: PARTNER_ID,
            metadata: {
              policyKeys: DEFAULT_DEVICE_POLICIES.map((policy) => policy.policyKey),
              source: "seed_apex_more_test_tenants"
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
