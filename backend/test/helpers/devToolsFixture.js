// In-memory model doubles only: this harness never connects to configured MongoDB.
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { env } from "../../src/config/env.js";
import { adminRoutes } from "../../src/modules/admin/admin.routes.js";
import { distributorRoutes } from "../../src/modules/distributor/distributor.routes.js";
import { Account } from "../../src/models/Account.js";
import { AuditLog } from "../../src/models/AuditLog.js";
import { Device } from "../../src/models/Device.js";
import { EmiSchedule } from "../../src/models/EmiSchedule.js";
import { EnrollmentToken } from "../../src/models/EnrollmentToken.js";
import { ProvisioningDetails } from "../../src/models/ProvisioningDetails.js";
import { Tenant } from "../../src/models/Tenant.js";
import { TenantPolicy } from "../../src/models/TenantPolicy.js";
import { TenantCreditLedger } from "../../src/models/TenantCreditLedger.js";
import { UnlockRequest } from "../../src/models/UnlockRequest.js";
import { User } from "../../src/models/User.js";

export const id = () => new mongoose.Types.ObjectId().toString();
const equal = (a, b) => String(a) === String(b);
export const matches = (row, filter = {}) => Object.entries(filter).every(([key, expected]) => {
  if (key === "$or") return expected.some((entry) => matches(row, entry));
  if (key === "$and") return expected.every((entry) => matches(row, entry));
  const actual = row[key];
  if (expected instanceof RegExp) return expected.test(String(actual || ""));
  if (expected && typeof expected === "object") {
    if ("$regex" in expected) return new RegExp(expected.$regex).test(String(actual || ""));
    if ("$in" in expected) return expected.$in.some((entry) => entry == null ? actual == null : equal(actual, entry));
    if ("$gte" in expected) return actual >= expected.$gte;
    if ("$gt" in expected) return actual > expected.$gt;
  }
  if (expected == null) return actual == null;
  return Array.isArray(actual) ? actual.includes(expected) : equal(actual, expected);
});

export function installDevToolsFixture(replace) {
  const state = { db: { users: [], accounts: [], tenants: [], policies: [], devices: [], schedules: [], tokens: [], ledger: [], audits: [], provisioning: [] },
    collisions: 0, failSchedule: false, aborted: 0, committed: 0 };
  replace(env, "testOtpMobilePrefix", "99999000");
  replace(env, "runningEnrollmentSecretKey", crypto.randomBytes(32).toString("hex"));
  replace(env, "runningEnrollmentLinkBase", "https://enroll.example.test/running-enrollment");
  replace(mongoose, "startSession", async () => {
    let backup;
    return { startTransaction() { backup = structuredClone(state.db); }, inTransaction: () => Boolean(backup),
      async commitTransaction() { backup = null; state.committed++; },
      async abortTransaction() { if (backup) state.db = backup; backup = null; state.aborted++; }, endSession() {} };
  });
  const document = (kind, row) => row ? { ...row, async save() {
    const values = { ...this }; delete values.save;
    state.db[kind][state.db[kind].findIndex((entry) => equal(entry._id, this._id))] = values;
  } } : null;
  function query(kind, filter, single = false) {
    let sorting; let skip = 0; let limit = Infinity; let population;
    const rows = () => {
      let values = state.db[kind].filter((entry) => matches(entry, filter));
      if (sorting) values = [...values].sort((a, b) => {
        for (const [key, direction] of Object.entries(sorting)) {
          if (a[key] > b[key]) return direction;
          if (a[key] < b[key]) return -direction;
        }
        return 0;
      });
      return values.slice(skip, skip + limit);
    };
    const q = {
      select() { return this; }, sort(value) { sorting = value; return this; }, session() { return this; },
      skip(value) { skip = value; return this; }, limit(value) { limit = value; return this; },
      populate(value) { population = value; return this; },
      async lean() {
        const values = structuredClone(rows());
        if (population === "tenantId") for (const row of values) row.tenantId = structuredClone(state.db.tenants.find((tenant) => equal(tenant._id, row.tenantId)) || null);
        return single ? values[0] || null : values;
      },
      then(resolve, reject) { return Promise.resolve(single ? document(kind, rows()[0]) : rows().map((row) => document(kind, row))).then(resolve, reject); }
    };
    return q;
  }
  for (const [model, kind] of [[User, "users"], [Account, "accounts"], [Tenant, "tenants"], [TenantPolicy, "policies"],
    [Device, "devices"], [EmiSchedule, "schedules"], [EnrollmentToken, "tokens"], [AuditLog, "audits"],
    [TenantCreditLedger, "ledger"], [ProvisioningDetails, "provisioning"]]) {
    replace(model, "find", (filter) => query(kind, filter));
    replace(model, "findOne", (filter) => query(kind, filter, true));
    replace(model, "findById", (value) => query(kind, { _id: value }, true));
    replace(model, "exists", async (filter) => state.db[kind].some((row) => matches(row, filter)));
    replace(model, "countDocuments", async (filter) => state.db[kind].filter((row) => matches(row, filter)).length);
    replace(model, "updateOne", async (filter, update) => {
      const row = state.db[kind].find((entry) => matches(entry, filter));
      if (row) Object.assign(row, update.$set || {});
      return { matchedCount: row ? 1 : 0 };
    });
    replace(model, "create", async (data) => {
      if (kind === "users" && (state.collisions > 0 || state.db.users.some((entry) => entry.mobile === data[0].mobile))) {
        if (state.collisions) state.collisions--;
        throw Object.assign(new Error("duplicate mobile"), { code: 11000, keyPattern: { mobile: 1 } });
      }
      if (kind === "schedules" && state.failSchedule) throw new Error("Simulated schedule failure");
      return data.map((entry) => {
        const row = { _id: id(), createdAt: new Date(), ...(kind === "users" ? { isActive: true, isDeviceLinked: false } : {}), ...entry };
        state.db[kind].push(row); return document(kind, row);
      });
    });
  }
  replace(Tenant, "findOneAndUpdate", async (filter, update) => {
    const row = state.db.tenants.find((entry) => matches(entry, filter));
    if (!row) return null;
    const old = structuredClone(row); row.creditBalance += update.$inc.creditBalance; return old;
  });
  replace(UnlockRequest, "countDocuments", async () => 0);
  state.db.provisioning.push({ adminComponentName: "com.example.owner/.AdminReceiver", adminPackageDownloadUrl: "https://example.test/owner.apk", adminSignatureChecksum: "test-checksum", skipEncryption: false });
  state.addDealer = (mode = "EMI_AUTOMATED", enabled = true, name = "Test dealer") => {
    const tenant = { _id: id(), name, isActive: true, capabilities: ["distribute"], creditBalance: 0, channelPartnerId: id() };
    state.db.tenants.push(tenant);
    state.db.policies.push({ _id: id(), tenantId: tenant._id, runningEnrollmentEnabled: enabled, deviceControlRules: { mode } });
    return tenant;
  };
  return state;
}

export async function serveDevTools(state, { ui = false } = {}) {
  const actorId = id();
  const token = (role = "super_admin", tenantId) => jwt.sign({ id: actorId, role, tokenType: "account", tenantId }, env.jwtAccessSecret, { expiresIn: "1h" });
  const app = express(); app.use(express.json());
  if (ui) {
    // Local UI fixture endpoints only. Real Dev Tools requests below still use
    // the production router/controllers with the in-memory model doubles.
    const account = { _id: actorId, role: "super_admin", name: "Fixture admin", email: "fixture@example.test" };
    const initialDb = structuredClone(state.db);
    app.post("/api/auth/login", (req, res) => {
      if (req.body.email !== account.email || req.body.password !== "FixtureOnly123") return res.status(401).json({ success: false });
      state.db = structuredClone(initialDb);
      return res.json({ success: true, data: { accessToken: token(), account } });
    });
    app.get("/api/auth/me", (_req, res) => res.json({ success: true, data: { account } }));
    app.get("/api/admin/dashboard", (_req, res) => res.json({ success: true, data: { totals: {} } }));
    app.post("/api/admin/dev-tools/fixture-link", (req, res) => {
      const user = state.db.users.find((entry) => entry._id === req.body.userId);
      if (!user) return res.status(404).json({ success: false });
      const deviceId = id();
      state.db.devices.push({ _id: deviceId, userId: user._id, tenantId: user.tenantId,
        enrollmentMode: user.enrollmentMode, deviceModel: "Fixture phone", state: "ACTIVE" });
      user.isDeviceLinked = true; user.linkedDeviceId = deviceId;
      return res.json({ success: true, data: { deviceId } });
    });
    app.get("/api/admin/devices/:deviceId/:section", (_req, res) => res.json({ success: true, data: [] }));
    app.get("/api/admin/devices/:deviceId", (req, res) => {
      const device = state.db.devices.find((entry) => entry._id === req.params.deviceId);
      if (!device) return res.status(404).json({ success: false, error: "Fixture device missing" });
      return res.json({ success: true, data: { device: { ...device, tenantId: state.db.tenants.find((entry) => entry._id === device.tenantId),
        userId: state.db.users.find((entry) => entry._id === device.userId) }, riskFlags: [], testingActions: [] } });
    });
  }
  app.use("/api/admin", adminRoutes); app.use("/api/distributor", distributorRoutes);
  const server = await new Promise((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, actorId, token, async request(path, body, auth = token()) {
    const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  } };
}
