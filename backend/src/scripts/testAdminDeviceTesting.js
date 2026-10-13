// Explicit opt-in integration run against the configured database. Every write is
// restricted to newly generated fixtures; the manifest also supports recovery.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { connectDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { DEFAULT_DEVICE_POLICIES, DEFAULT_TENANT_POLICY } from "../constants/defaultPolicies.js";
import { Account } from "../models/Account.js";
import { ChannelPartner } from "../models/ChannelPartner.js";
import { Tenant } from "../models/Tenant.js";
import { TenantPolicy } from "../models/TenantPolicy.js";
import { DevicePolicy } from "../models/DevicePolicy.js";
import { User } from "../models/User.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";
import { EmiSchedule } from "../models/EmiSchedule.js";
import { adminRoutes } from "../modules/admin/admin.routes.js";
import { appRoutes } from "../modules/app/app.routes.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { runTempUnlockExpiryJob, runEmiPolicyJob } from "../jobs/scheduledJobs.js";

if (!process.argv.includes("--connected-database") && !process.argv.includes("--cleanup")) {
  throw new Error("Use --connected-database to explicitly enable this disposable fixture run.");
}
env.nodeEnv = "test";
const log = console.log.bind(console);
const errorLog = console.error.bind(console);
console.log = (...args) => { if (args[0] !== "API Success") log(...args); };
console.error = (...args) => { if (args[0] !== "API Error") errorLog(...args); };
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
const outputDir = path.resolve("../output");
await fs.mkdir(outputDir, { recursive: true });
const manifestPath = path.join(outputDir, "admin-device-testing-manifest.json");
let manifest;
let server;
let frontend;
let base;
let token;
let counter = 0;
const results = [];
const record = (name) => { results.push({ name, passed: true }); console.log("PASS", name); };
const allocate = async (kind) => {
  const id = new mongoose.Types.ObjectId();
  manifest.ids[kind] ||= [];
  manifest.ids[kind].push(String(id));
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return id;
};
const request = async (url, { body, auth = token, expected = 200 } = {}) => {
  const response = await fetch(base + url, { method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const payload = await response.json();
  assert.equal(response.status, expected, `${url}: ${payload.error || payload.message}`);
  if (expected === 200) assert.equal(payload.success, true, url);
  return payload.data;
};
const createFixture = async (tenant, mode, { final = false, state = "ACTIVE" } = {}) => {
  const userId = await allocate("users");
  const deviceId = await allocate("devices");
  const scheduleId = await allocate("emischedule");
  const loanId = `${manifest.runId}-${++counter}`;
  await User.create({ _id: userId, tenantId: tenant._id, name: loanId, mobile: `TEST-${loanId}`,
    loanId, enrollmentMode: mode, isDeviceLinked: true, linkedDeviceId: deviceId });
  const capabilities = { notificationsAllowed: true, overlayAllowed: true, locationGrant: "precise", observedAt: new Date() };
  await Device.create({ _id: deviceId, tenantId: tenant._id, userId, enrollmentMode: mode,
    imei: `dummy-${loanId}`, deviceModel: "SYNTHETIC_TEST_DEVICE", manufacturer: "Test",
    state, deviceOwnerStatus: mode === "RUNNING_APP" ? "UNKNOWN" : "CONFIRMED",
    capabilities, capabilitiesReceivedAt: new Date(), locationConsentAccepted: true,
    currentPolicyKey: state === "LOCKED" ? "EMI_LOCKED" : "EMI_PAID" });
  const installments = Array.from({ length: final ? 1 : 3 }, (_, index) => ({ installmentNumber: index + 1,
    emiAmount: 100, dueDate: new Date(Date.now() + (index + 1) * 30 * 86400000), status: "pending" }));
  await EmiSchedule.create({ _id: scheduleId, tenantId: tenant._id, userId, loanId, installments });
  return { deviceId, userId, scheduleId, tenantId: tenant._id,
    userToken: jwt.sign({ id: String(userId), tenantId: String(tenant._id), tokenType: "user" }, env.jwtAccessSecret, { expiresIn: "1h" }) };
};
const testAction = (fixture, action, body = {}, expected = 200) => request(`/admin/devices/${fixture.deviceId}/testing/${action}`, { body, expected });
const detail = (fixture) => request(`/admin/devices/${fixture.deviceId}`);
const acknowledge = async (fixture, command) => {
  const body = { commandId: String(command._id), status: "acknowledged", appliedPolicyVersion: command.payload?.policyVersion,
    appRestrictionApplied: true, lockOverlayShown: true, appRestrictionCleared: true, lockOverlayCleared: true,
    presentationResult: "NOTIFICATION_POSTED", releaseCompleted: true,
    location: { latitude: 0, longitude: 0, accuracyMeters: 5, capturedAt: new Date().toISOString() } };
  const result = await request("/app/device/command/ack", { body, auth: fixture.userToken });
  assert.equal(result.status, "acknowledged");
};
const snapshot = async (fixture) => JSON.stringify({ device: await Device.findById(fixture.deviceId).lean(),
  schedule: await EmiSchedule.findById(fixture.scheduleId).lean(), commands: await DeviceCommand.find({ deviceId: fixture.deviceId }).lean() });
const rejection = async (fixture, action, expected = 409, body = {}) => {
  const before = await snapshot(fixture);
  await testAction(fixture, action, body, expected);
  assert.equal(await snapshot(fixture), before, "Rejected action must not mutate data");
};

const cleanup = async () => {
  const rootIds = Object.values(manifest.ids).flat().map((id) => new mongoose.Types.ObjectId(id));
  if (!rootIds.length) return {};
  const tenantIds = (manifest.ids.tenants || []).map((id) => new mongoose.Types.ObjectId(id));
  const partnerIds = (manifest.ids.partners || []).map((id) => new mongoose.Types.ObjectId(id));
  for (const tenant of await Tenant.find({ _id: { $in: tenantIds } }).select("name").lean()) {
    assert.ok(tenant.name.startsWith(manifest.runId), "Refuse cleanup of a tenant without this run's marker");
  }
  for (const [model, kind, field, prefix] of [[Account, "accounts", "name", manifest.runId],
    [ChannelPartner, "partners", "name", manifest.runId], [User, "users", "loanId", manifest.runId],
    [Device, "devices", "imei", `dummy-${manifest.runId}`], [EmiSchedule, "emischedule", "loanId", manifest.runId]]) {
    const ids = (manifest.ids[kind] || []).map((id) => new mongoose.Types.ObjectId(id));
    for (const record of await model.find({ _id: { $in: ids } }).select(field).lean()) {
      assert.ok(record[field]?.startsWith(prefix), `Refuse cleanup of ${kind} without this run's marker`);
    }
  }
  const ownership = { $or: [{ _id: { $in: rootIds } }, { tenantId: { $in: tenantIds } },
    { channelPartnerId: { $in: partnerIds } }, { userId: { $in: (manifest.ids.users || []).map((id) => new mongoose.Types.ObjectId(id)) } },
    { deviceId: { $in: (manifest.ids.devices || []).map((id) => new mongoose.Types.ObjectId(id)) } },
    { actorId: { $in: (manifest.ids.accounts || []).map((id) => new mongoose.Types.ObjectId(id)) } }] };
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  const removed = {};
  // First remove queued work so no fixture command remains pending during teardown.
  collections.sort((a, b) => (a.name === DeviceCommand.collection.name ? -1 : b.name === DeviceCommand.collection.name ? 1 : 0));
  for (const { name } of collections) {
    if (name.startsWith("system.")) continue;
    const collection = mongoose.connection.db.collection(name);
    const count = (await collection.deleteMany(ownership)).deletedCount;
    if (count) removed[name] = count;
  }
  for (const { name } of collections) {
    if (!name.startsWith("system.")) assert.equal(await mongoose.connection.db.collection(name).countDocuments(ownership), 0, `Residual fixture records in ${name}`);
  }
  await fs.unlink(manifestPath);
  return removed;
};

let failure;
let cleanupResult;
try {
  await connectDatabase();
  if (process.argv.includes("--cleanup")) {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } else {
    try { await fs.access(manifestPath); throw new Error("A previous fixture manifest exists. Run --cleanup first."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    manifest = { runId: `ADMIN-DEVICE-TEST-${crypto.randomUUID()}`, ids: {} };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const accountId = await allocate("accounts");
    await Account.create({ _id: accountId, name: manifest.runId, email: `${crypto.randomUUID()}@example.test`, role: "super_admin", passwordHash: bcrypt.hashSync(crypto.randomUUID(), 4) });
    token = jwt.sign({ id: String(accountId), tokenType: "account", role: "super_admin" }, env.jwtAccessSecret, { expiresIn: "1h" });
    const application = express();
    application.use(express.json());
    application.use("/api/admin", adminRoutes);
    application.use("/api/app", appRoutes);
    application.use("/api/auth", authRoutes);
    server = await new Promise((resolve) => { const listener = application.listen(0, "127.0.0.1", () => resolve(listener)); });
    base = `http://127.0.0.1:${server.address().port}/api`;
    const address = { street: "Test", city: "Test", district: "Test", state: "Test", pincode: "110001" };
    const partnerId = await allocate("partners");
    await ChannelPartner.create({ _id: partnerId, name: manifest.runId, type: "independent", address });
    const tenants = [];
    for (const mode of ["EMI_AUTOMATED", "MANUAL"]) {
      const tenantId = await allocate("tenants");
      const tenant = await Tenant.create({ _id: tenantId, name: `${manifest.runId}-${mode}`, type: "nbfc",
        capabilities: ["lend", "distribute"], channelPartnerId: partnerId, address,
        pocName: "Test", pocPhone: "TEST", pocDesignation: "Test" });
      await TenantPolicy.create({ tenantId, ...DEFAULT_TENANT_POLICY, deviceControlRules: { mode },
        runningLocationEnabled: true, lockRules: { dpd: 2, gracePeriodDays: 7, lockOnGraceExpiry: true } });
      await DevicePolicy.insertMany(DEFAULT_DEVICE_POLICIES.map((policy) => ({ ...policy, tenantId })));
      tenants.push(tenant);
    }
    const renderedFixtures = [];
    for (const tenant of tenants) for (const enrollmentMode of ["RUNNING_APP", "DEVICE_OWNER_QR"]) {
      const tenantPolicy = await TenantPolicy.findOne({ tenantId: tenant._id }).lean();
      const manual = tenantPolicy.deviceControlRules.mode === "MANUAL";
      const combination = `${enrollmentMode}/${tenantPolicy.deviceControlRules.mode}`;
      const initial = await createFixture(tenant, enrollmentMode);
      renderedFixtures.push({ ...initial, combination });
      const initialDetail = await detail(initial);
      assert.equal(initialDetail.device.enrollmentMode, enrollmentMode);
      assert.equal(initialDetail.device.deviceControlMode, tenantPolicy.deviceControlRules.mode);
      const list = await request(`/admin/devices?tenantId=${tenant._id}&imei=${encodeURIComponent(initialDetail.device.imei)}`);
      assert.equal(list.items[0].deviceControlMode, tenantPolicy.deviceControlRules.mode);
      record(`${combination}: list and detail labels`);
      for (const action of initialDetail.testingActions) {
        const fixture = await createFixture(tenant, enrollmentMode, { state: action.action === "simulate-payment-unlock" ? "LOCKED" : "ACTIVE" });
        if (action.action === "simulate-temp-unlock-expiry") {
          const temporary = await testAction(fixture, "simulate-temp-unlock");
          await acknowledge(fixture, temporary.command);
        }
        const result = await testAction(fixture, action.action);
        assert.equal(await mongoose.connection.db.collection("auditlogs").countDocuments({ deviceId: fixture.deviceId,
          eventType: "ADMIN_DEVICE_TEST_ACTION", "metadata.action": action.action }), 1);
        const commands = await DeviceCommand.find({ deviceId: fixture.deviceId, status: { $in: ["pending", "sent"] } }).sort({ createdAt: 1 });
        if (action.action.startsWith("manual-set-")) assert.equal(commands.length, 0);
        if (action.action === "simulate-payment-unlock") assert.equal(result.command.commandType, "UNLOCK");
        if (action.action === "simulate-release") assert.equal(result.command.commandType, "RELEASE_DEVICE");
        if (action.action === "simulate-auto-lock") assert.ok(commands.some((command) => command.commandType === "LOCK"));
        if (action.action === "simulate-device-grace") assert.ok(commands.some((command) => command.commandType === "POLICY_UPDATE"));
        if (action.action === "simulate-upcoming-emi") assert.ok(commands.some((command) => command.commandType === "EMI_REMINDER"));
        if (enrollmentMode === "RUNNING_APP") assert.ok(commands.every((command) => !["RESTRICTIONS_UPDATE", "WIPE_DEVICE", "SET_FACTORY_RESET_BLOCKED"].includes(command.commandType)));
        const sync = await request("/app/device/sync", { body: {}, auth: fixture.userToken });
        assert.equal(sync.appConfig.deviceControlMode, tenantPolicy.deviceControlRules.mode);
        if (enrollmentMode === "RUNNING_APP") assert.deepEqual(sync.policy?.restrictions || {}, {});
        for (const command of commands) await acknowledge(fixture, command);
        const updated = await Device.findById(fixture.deviceId).lean();
        if (action.action === "simulate-release") {
          assert.equal(updated.state, "RELEASED");
          if (enrollmentMode === "RUNNING_APP") assert.notEqual(updated.deviceOwnerStatus, "RELEASED");
          await rejection(fixture, action.action);
        }
        if (action.action === "request-location") assert.equal(updated.lastLocation.latitude, 0);
        if (action.action === "simulate-temp-unlock-expiry") {
          assert.equal(updated.state, "LOCKED");
          const count = await DeviceCommand.countDocuments({ deviceId: fixture.deviceId });
          await runTempUnlockExpiryJob({ deviceId: fixture.deviceId, limit: 1 });
          assert.equal(await DeviceCommand.countDocuments({ deviceId: fixture.deviceId }), count);
          await rejection(fixture, action.action);
        }
        record(`${combination}: ${action.action}, sync and acknowledgements`);
      }
      for (const incompatible of manual ? ["simulate-auto-lock", "simulate-device-grace"] : ["manual-set-paid", "manual-set-overdue", "manual-set-upcoming", "manual-set-grace"]) await rejection(initial, incompatible);
      await rejection(initial, "unsupported-action", 400);
      await rejection(initial, "simulate-temp-unlock", 400, { durationHours: 1 });
      record(`${combination}: incompatible and invalid options reject without mutation`);
      const durationFixture = await createFixture(tenant, enrollmentMode);
      for (const durationHours of [6, 12, 24, 48, 60, 72, 168]) {
        const before = Date.now();
        const temporary = await testAction(durationFixture, "simulate-temp-unlock", { durationHours });
        const expiry = new Date(temporary.command.payload.tempUnlockExpiresAt).getTime();
        assert.ok(Math.abs(expiry - before - durationHours * 3600000) < 10000);
      }
      record(`${combination}: all temporary-unlock duration choices`);
      const final = await createFixture(tenant, enrollmentMode, { final: true, state: "LOCKED" });
      const finalResult = await testAction(final, "simulate-payment-unlock");
      assert.equal(finalResult.command.commandType, "RELEASE_DEVICE");
      await acknowledge(final, finalResult.command);
      const unlocked = await createFixture(tenant, enrollmentMode);
      assert.equal((await testAction(unlocked, "simulate-payment-unlock")).command, null);
      record(`${combination}: final payment releases; active non-final payment queues no unlock`);
      for (const supersedingAction of ["simulate-unlock", "simulate-payment-unlock"]) {
        const fixture = await createFixture(tenant, enrollmentMode);
        const temp = await testAction(fixture, "simulate-temp-unlock");
        await testAction(fixture, supersedingAction);
        assert.equal((await Device.findById(fixture.deviceId)).tempUnlockExpiresAt, undefined);
        assert.deepEqual(await runTempUnlockExpiryJob({ deviceId: fixture.deviceId, limit: 1 }), []);
        if (enrollmentMode === "RUNNING_APP") await request("/app/device/command/ack", { auth: fixture.userToken, expected: 409,
          body: { commandId: String(temp.command._id), status: "acknowledged", appRestrictionCleared: true, lockOverlayCleared: true } });
      }
      record(`${combination}: full unlock and payment supersede temporary expiry`);
      if (manual) {
        const manualFixture = await createFixture(tenant, enrollmentMode);
        await EmiSchedule.updateOne({ _id: manualFixture.scheduleId }, { $set: { "installments.0.dueDate": new Date(Date.now() - 100 * 86400000) } });
        await runEmiPolicyJob({ scheduleId: manualFixture.scheduleId, limit: 1 });
        assert.equal(await DeviceCommand.countDocuments({ deviceId: manualFixture.deviceId, commandType: { $in: ["LOCK", "POLICY_UPDATE"] } }), 0);
        record(`${combination}: manual overdue cron never queues EMI lock or grace policy`);
      }
      if (enrollmentMode === "RUNNING_APP") {
        for (const [change, action] of [[{ capabilitiesReceivedAt: new Date(0) }, "send-overdue-reminder"],
          [{ "capabilities.overlayAllowed": false }, "simulate-lock"],
          [{ "capabilities.notificationsAllowed": false }, "send-overdue-reminder"],
          [{ locationConsentAccepted: false }, "request-location"],
          [{ "capabilities.locationGrant": "none" }, "request-location"]]) {
          const fixture = await createFixture(tenant, enrollmentMode);
          await Device.updateOne({ _id: fixture.deviceId }, { $set: change });
          await rejection(fixture, action);
          assert.equal((await detail(fixture)).testingActions.find((item) => item.action === action).enabled, false);
        }
        record(`${combination}: missing or stale capabilities and location consent reject before mutation`);
      }
      const noSchedule = await createFixture(tenant, enrollmentMode);
      await EmiSchedule.deleteOne({ _id: noSchedule.scheduleId });
      await rejection(noSchedule, "send-overdue-reminder");
      await testAction(noSchedule, "simulate-lock");
      record(`${combination}: missing schedule blocks EMI actions but allows device controls`);
    }
    // Regression: disabled/missing policies and empty schedules must fail before dates change.
    const automatic = tenants[0];
    const blocked = await createFixture(automatic, "RUNNING_APP");
    await TenantPolicy.updateOne({ tenantId: automatic._id }, { $set: { "lockRules.lockOnGraceExpiry": false, runningLocationEnabled: false } });
    await rejection(blocked, "simulate-auto-lock");
    await rejection(blocked, "request-location");
    await DevicePolicy.updateMany({ tenantId: automatic._id, policyKey: "EMI_PAID" }, { $set: { isActive: false } });
    await rejection(blocked, "simulate-device-grace");
    await EmiSchedule.updateOne({ _id: blocked.scheduleId }, { $set: { installments: [] } });
    await rejection(blocked, "simulate-release");
    record("Disabled auto-lock/location, missing policy and empty schedule reject without mutation");
    await DevicePolicy.updateMany({ tenantId: automatic._id }, { $set: { isActive: true } });
    await TenantPolicy.updateOne({ tenantId: automatic._id }, { $set: { "lockRules.lockOnGraceExpiry": true, runningLocationEnabled: true } });
    const unauthorized = await fetch(base + `/admin/devices/${blocked.deviceId}/testing/simulate-lock`, { method: "POST" });
    assert.equal(unauthorized.status, 401);
    const dealerToken = jwt.sign({ id: manifest.ids.accounts[0], tokenType: "account", role: "tenant_admin" }, env.jwtAccessSecret);
    await request(`/admin/devices/${blocked.deviceId}/testing/simulate-lock`, { body: {}, auth: dealerToken, expected: 403 });
    record("Testing endpoint requires super-admin authentication");

    if (process.argv.includes("--render-pages")) {
      const frontendDir = path.resolve("../super-admin-portal");
      const port = 3197;
      frontend = spawn(process.execPath, [path.join(frontendDir, "node_modules/next/dist/bin/next"), "dev", "--port", String(port)], {
        cwd: frontendDir, env: { ...process.env, BACKEND_API_URL: base }, windowsHide: true, stdio: "ignore" });
      const frontendUrl = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        try { await fetch(frontendUrl + "/login", { signal: AbortSignal.timeout(2000) }); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
      }
      assert.ok(ready, "Frontend test server did not start");
      for (const fixture of renderedFixtures) {
        const response = await fetch(frontendUrl + `/devices/${fixture.deviceId}`, { headers: { Cookie: `crednexa_super_admin_token=${token}` }, signal: AbortSignal.timeout(90000) });
        assert.equal(response.status, 200);
        const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
        assert.ok(html.includes(fixture.combination.startsWith("RUNNING_APP") ? "Running provisioned" : "QR provisioned"));
        assert.match(html, new RegExp(`Dealer Mode</dt><dd[^>]*>${fixture.combination.endsWith("MANUAL") ? "Manual" : "Automatic"}</dd>`));
        assert.ok(html.includes("Testing Panel"));
        if (fixture.combination.startsWith("RUNNING_APP")) {
          assert.ok(html.includes("Running App Permission Health"));
          assert.ok(!html.includes("Manual Override Token"));
          assert.ok(!html.includes("Per-device Restrictions"));
          assert.ok(!html.includes("Device Security Controls"));
        } else {
          assert.ok(html.includes("Manual Override Token") && html.includes("Device Security Controls"));
        }
        assert.equal(html.includes("Simulate EMI Auto-lock"), !fixture.combination.endsWith("MANUAL"));
        assert.equal(html.includes("Manual schedule simulations"), fixture.combination.endsWith("MANUAL"));
        record(`${fixture.combination}: rendered detail page`);
      }
      const listPage = await fetch(frontendUrl + "/devices", { headers: { Cookie: `crednexa_super_admin_token=${token}` }, signal: AbortSignal.timeout(90000) });
      assert.equal(listPage.status, 200);
      const html = await listPage.text();
      assert.ok(html.includes("Provisioning") && html.includes("Dealer Mode"));
      record("Rendered device table includes provisioning and dealer mode columns");
    }
  }
} catch (error) {
  failure = error;
  console.error("FAIL", error.message);
} finally {
  if (frontend) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(frontend.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else frontend.kill();
  }
  if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  if (manifest) {
    try { cleanupResult = await cleanup(); console.log("Cleanup verified: zero residual fixture records."); }
    catch (error) { failure ||= error; console.error("Cleanup failed; recovery manifest retained:", error.message); }
  }
  await fs.writeFile(path.join(outputDir, "admin-device-testing-report.json"), JSON.stringify({ runId: manifest?.runId,
    database: mongoose.connection.name, results, failure: failure?.message || null, cleanup: cleanupResult || null,
    verifiedZeroResidualRecords: Boolean(cleanupResult), physicalDeviceAcknowledgements: "simulated" }, null, 2));
  await mongoose.disconnect();
}
if (failure) process.exitCode = 1;
