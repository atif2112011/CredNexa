import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";

import { env } from "../src/config/env.js";
import { ENROLLMENT_MODES, getEnrollmentMode } from "../src/constants/enrollmentModes.js";
import { ACCOUNT_ROLES } from "../src/constants/roles.js";
import { TENANT_CAPABILITIES } from "../src/constants/tenant.js";
import { buildPolicyUpdateMessage } from "../src/jobs/fcmDeliveryWorker.js";
import { getDistributorUsers, regenerateEnrollmentQr } from "../src/modules/distributor/distributor.controller.js";
import { acknowledgeDeviceCommand, getPaymentQr } from "../src/modules/app/app.controller.js";
import { registerRunningDevice } from "../src/modules/app/runningEnrollment.controller.js";
import { resolveRunningDevice } from "../src/middleware/resolveRunningDevice.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { Device } from "../src/models/Device.js";
import { DeviceCommand } from "../src/models/DeviceCommand.js";
import { EnrollmentToken } from "../src/models/EnrollmentToken.js";
import { ProvisioningDetails } from "../src/models/ProvisioningDetails.js";
import { Tenant } from "../src/models/Tenant.js";
import { TenantPolicy } from "../src/models/TenantPolicy.js";
import { User } from "../src/models/User.js";
import { backfillManualOverrideTokens, generateManualOverrideTokenForDevice } from "../src/services/manualOverrideToken.service.js";
import {
  assertRunningActionCapability,
  assertRunningCommandAllowed,
  formatControlResult,
  formatDeviceReference,
  getRunningAllowedActions
} from "../src/services/runningDevicePolicy.service.js";
import {
  decryptRunningSecret,
  encryptRunningSecret,
  hashRunningSecret,
  isValidActivationRequestId,
  isValidImei,
  matchesEnrollmentSecret,
  validateRunningCapabilities
} from "../src/services/runningEnrollment.service.js";

test("dealer borrower list exposes saved mode and link status for Generate QR", async () => {
  const originalTenantFind = Tenant.findById;
  const originalUserFind = User.find;
  const originalCount = User.countDocuments;
  const tenantId = new mongoose.Types.ObjectId().toString();
  const users = [
    { _id: "running-user", enrollmentMode: ENROLLMENT_MODES.RUNNING_APP, isDeviceLinked: false },
    { _id: "legacy-owner-user", isDeviceLinked: true }
  ];
  Tenant.findById = () => ({ lean: async () => ({
    _id: tenantId, isActive: true, capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  }) });
  User.find = () => ({
    populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
    lean: async () => users
  });
  User.countDocuments = async () => users.length;
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await getDistributorUsers({
      auth: { role: ACCOUNT_ROLES.TENANT_ADMIN, tenantId }, query: {}
    }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.data.items[0].enrollmentMode, ENROLLMENT_MODES.RUNNING_APP);
    assert.equal(res.body.data.items[0].isDeviceLinked, false);
    assert.equal(res.body.data.items[1].enrollmentMode, ENROLLMENT_MODES.DEVICE_OWNER_QR);
    assert.equal(res.body.data.items[1].isDeviceLinked, true);
  } finally {
    Tenant.findById = originalTenantFind;
    User.find = originalUserFind;
    User.countDocuments = originalCount;
  }
});

test("borrower-list Generate QR preserves owner response and serves running QR from saved mode", async () => {
  const original = {
    startSession: mongoose.startSession,
    tenantFind: Tenant.findById,
    userFind: User.findOne,
    policyFind: TenantPolicy.findOne,
    deviceFind: Device.findOne,
    tokenFind: EnrollmentToken.findOne,
    provisioningFind: ProvisioningDetails.findOne,
    auditCreate: AuditLog.create,
    log: console.log,
    secretKey: env.runningEnrollmentSecretKey,
    linkBase: env.runningEnrollmentLinkBase
  };
  const tenantId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();
  const secret = crypto.randomBytes(32).toString("base64url");
  let mode = ENROLLMENT_MODES.RUNNING_APP;
  let linkedDevice = null;
  let userLinked = false;
  const logged = [];
  const expiry = new Date(Date.now() + 60_000);
  const runningToken = {
    _id: "running-claim",
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    runningTokenCiphertext: null,
    expiresAt: expiry,
    async save() {}
  };
  const ownerToken = {
    _id: "owner-claim",
    enrollmentMode: ENROLLMENT_MODES.DEVICE_OWNER_QR,
    token: "owner-enrollment-secret",
    expiresAt: expiry,
    async save() {}
  };
  const response = () => ({
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    env.runningEnrollmentSecretKey = crypto.randomBytes(32).toString("hex");
    env.runningEnrollmentLinkBase = "https://enroll.example.test/running-enrollment";
    runningToken.runningTokenCiphertext = encryptRunningSecret(secret);
    mongoose.startSession = async () => ({ inTransaction: () => false, endSession() {} });
    Tenant.findById = () => ({ lean: async () => ({
      _id: tenantId, isActive: true, capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
    }) });
    User.findOne = () => ({ lean: async () => ({
      _id: userId, tenantId, isActive: true, isDeviceLinked: userLinked, enrollmentMode: mode,
      name: "Borrower", mobile: "9876543210", loanId: "LOAN-1"
    }) });
    TenantPolicy.findOne = () => ({ select: () => ({ lean: async () => ({ runningEnrollmentEnabled: true }) }) });
    Device.findOne = () => ({ lean: async () => linkedDevice });
    EnrollmentToken.findOne = (filter) => ({
      select: () => ({ sort: async () => filter.enrollmentMode === ENROLLMENT_MODES.RUNNING_APP
        ? runningToken : ownerToken })
    });
    ProvisioningDetails.findOne = () => ({ lean: async () => ({
      adminComponentName: "com.emishield.app/.AdminReceiver",
      adminPackageDownloadUrl: "https://example.test/owner.apk",
      adminSignatureChecksum: "checksum"
    }) });
    AuditLog.create = async () => [{}];
    console.log = (...args) => { logged.push(args); };

    const req = (body) => ({
      auth: { id: "dealer-id", role: ACCOUNT_ROLES.TENANT_ADMIN, tenantId },
      params: { userId }, body
    });
    const running = response();
    await regenerateEnrollmentQr(req({ enrollmentMode: ENROLLMENT_MODES.RUNNING_APP }), running);
    assert.equal(running.code, 200);
    assert.equal(running.body.data.reusedExistingToken, true);
    assert.equal(running.body.data.qrType, "RUNNING_APP_LINK");
    assert.equal(new URL(running.body.data.qrText).searchParams.get("code"), secret);
    assert.match(running.body.data.qrCodeDataUrl, /^data:image\/png;base64,/);
    assert.equal(running.body.data.enrollmentToken, undefined);

    const oldDealer = response();
    await regenerateEnrollmentQr(req({}), oldDealer);
    assert.equal(oldDealer.code, 409);
    assert.equal(oldDealer.body.data.code, "DEALER_APP_UPGRADE_REQUIRED");

    mode = ENROLLMENT_MODES.DEVICE_OWNER_QR;
    const owner = response();
    await regenerateEnrollmentQr(req({}), owner);
    assert.equal(owner.code, 200);
    assert.equal(owner.body.data.enrollmentToken, ownerToken.token);
    assert.equal(owner.body.data.qrPayload["android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE"].enrollmentToken,
      ownerToken.token);
    assert.equal(owner.body.data.qrType, undefined);

    const mismatch = response();
    await regenerateEnrollmentQr(req({ enrollmentMode: ENROLLMENT_MODES.RUNNING_APP }), mismatch);
    assert.equal(mismatch.code, 409);
    assert.equal(mismatch.body.data.code, "ENROLLMENT_MODE_MISMATCH");

    linkedDevice = { _id: "already-linked" };
    const linked = response();
    await regenerateEnrollmentQr(req({}), linked);
    assert.equal(linked.code, 400);
    assert.match(linked.body.error, /already registered/);

    linkedDevice = null;
    userLinked = true;
    const linkedFlag = response();
    await regenerateEnrollmentQr(req({}), linkedFlag);
    assert.equal(linkedFlag.code, 400);
    assert.match(linkedFlag.body.error, /already registered/);

    const logText = JSON.stringify(logged);
    assert.equal(logText.includes(secret), false);
    assert.equal(logText.includes(ownerToken.token), false);
    assert.equal(logText.includes(running.body.data.qrCodeDataUrl), false);
  } finally {
    mongoose.startSession = original.startSession;
    Tenant.findById = original.tenantFind;
    User.findOne = original.userFind;
    TenantPolicy.findOne = original.policyFind;
    Device.findOne = original.deviceFind;
    EnrollmentToken.findOne = original.tokenFind;
    ProvisioningDetails.findOne = original.provisioningFind;
    AuditLog.create = original.auditCreate;
    console.log = original.log;
    env.runningEnrollmentSecretKey = original.secretKey;
    env.runningEnrollmentLinkBase = original.linkBase;
  }
});

test("missing enrollment mode keeps the owner-device contract", () => {
  assert.equal(getEnrollmentMode({}), ENROLLMENT_MODES.DEVICE_OWNER_QR);
  assertRunningCommandAllowed({}, "RESTRICTIONS_UPDATE");
  assertRunningActionCapability({}, "LOCK");
  assert.equal(matchesEnrollmentSecret({ token: "legacy-qr" }, "legacy-qr"), true);
});

test("running QR secret encrypts for redisplay and hashes for lookup", () => {
  const originalKey = env.runningEnrollmentSecretKey;
  env.runningEnrollmentSecretKey = crypto.randomBytes(32).toString("hex");
  try {
    const secret = crypto.randomBytes(32).toString("base64url");
    const encrypted = encryptRunningSecret(secret);
    assert.notEqual(encrypted, secret);
    assert.equal(decryptRunningSecret(encrypted), secret);
    assert.equal(matchesEnrollmentSecret({
      enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
      runningTokenHash: hashRunningSecret(secret)
    }, secret), true);
    assert.equal(matchesEnrollmentSecret({
      enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
      runningTokenHash: hashRunningSecret(secret)
    }, "wrong"), false);
  } finally {
    env.runningEnrollmentSecretKey = originalKey;
  }
});

test("running activation requires fresh controls and valid borrower-entered IMEIs", () => {
  assert.equal(validateRunningCapabilities({
    notificationsAllowed: true,
    overlayAllowed: true,
    deviceAdminActive: true,
    observedAt: new Date().toISOString()
  }), null);
  assert.match(validateRunningCapabilities({
    notificationsAllowed: true,
    overlayAllowed: false,
    deviceAdminActive: true,
    observedAt: new Date().toISOString()
  }), /Overlay/);
  assert.equal(isValidImei("490154203237518"), true);
  assert.equal(isValidImei("490154203237519"), false);
});

test("running activation retry ID has a strict body format and is not an auth credential", () => {
  assert.equal(isValidActivationRequestId("activation_request_123456"), true);
  assert.equal(isValidActivationRequestId("short"), false);
  assert.equal(isValidActivationRequestId("spaces are forbidden 123"), false);
});

test("running registration replays only the original activation request ID", async () => {
  const originalStartSession = mongoose.startSession;
  const originalFindDevice = Device.findOne;
  let sessionsEnded = 0;
  mongoose.startSession = async () => ({ endSession() { sessionsEnded += 1; }, inTransaction() { return false; } });
  Device.findOne = () => ({ lean: async () => ({
    _id: "linked-device-id",
    state: "ACTIVE",
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    activationIdempotencyKey: "activation_request_123456"
  }) });
  const makeRes = () => ({
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const user = { _id: "borrower-id", tenantId: "tenant-id" };
  try {
    const retry = makeRes();
    await registerRunningDevice({ body: { activationRequestId: "activation_request_123456" } }, retry, user);
    assert.equal(retry.code, 200);
    assert.equal(retry.body.data.deviceId, "linked-device-id");

    const conflicting = makeRes();
    await registerRunningDevice({ body: { activationRequestId: "different_request_123456" } }, conflicting, user);
    assert.equal(conflicting.code, 409);
    assert.equal(conflicting.body.data.code, "DEVICE_ALREADY_LINKED");
    assert.equal(sessionsEnded, 2);
  } finally {
    mongoose.startSession = originalStartSession;
    Device.findOne = originalFindDevice;
  }
});

test("linked running requests resolve by borrower JWT without installation headers", async () => {
  const originalFindUser = User.findById;
  const originalFindDevice = Device.findOne;
  const user = {
    _id: "user-id",
    tenantId: "tenant-id",
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    isDeviceLinked: true,
    linkedDeviceId: "device-id"
  };
  const device = { _id: "device-id", enrollmentMode: ENROLLMENT_MODES.RUNNING_APP };
  User.findById = () => ({ select: () => ({ lean: async () => user }) });
  Device.findOne = () => ({ lean: async () => device });
  try {
    const req = { auth: { id: user._id } };
    let nextCalled = false;
    await resolveRunningDevice(req, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.runningDevice, device);

    user.enrollmentMode = ENROLLMENT_MODES.DEVICE_OWNER_QR;
    const ownerReq = { auth: { id: user._id } };
    let ownerNextCalled = false;
    await resolveRunningDevice(ownerReq, {}, () => { ownerNextCalled = true; });
    assert.equal(ownerNextCalled, true);
    assert.equal(ownerReq.runningDevice, undefined);
  } finally {
    User.findById = originalFindUser;
    Device.findOne = originalFindDevice;
  }
});

test("shared payment API selects the exact running device and preserves owner lookup", async () => {
  const originalFindDevice = Device.findOne;
  const filters = [];
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
  Device.findOne = (filter) => {
    filters.push(filter);
    return { lean: async () => null };
  };
  try {
    await getPaymentQr({ auth: { id: "borrower-id" }, runningDevice: { _id: "linked-device-id" } }, res);
    assert.equal(res.code, 400);
    assert.deepEqual(filters[0], { _id: "linked-device-id", userId: "borrower-id" });

    await getPaymentQr({ auth: { id: "borrower-id" } }, res);
    assert.deepEqual(filters[1], { userId: "borrower-id" });
  } finally {
    Device.findOne = originalFindDevice;
  }
});

test("running JWT with a missing linked device cannot fall back to another device", async () => {
  const originalFindUser = User.findById;
  const originalFindDevice = Device.findOne;
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
  User.findById = () => ({ select: () => ({ lean: async () => ({
    _id: "borrower-id",
    tenantId: "tenant-id",
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    isDeviceLinked: true,
    linkedDeviceId: "missing-device-id"
  }) }) });
  Device.findOne = () => ({ lean: async () => null });
  try {
    let nextCalled = false;
    await resolveRunningDevice({ auth: { id: "borrower-id" } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.code, 403);
  } finally {
    User.findById = originalFindUser;
    Device.findOne = originalFindDevice;
  }
});

test("pending running enrollment permits registration but rejects device operations", async () => {
  const originalFindUser = User.findById;
  User.findById = () => ({ select: () => ({ lean: async () => ({
    _id: "borrower-id",
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    isDeviceLinked: false,
    linkedDeviceId: null
  }) }) });
  const makeRes = () => ({
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    let nextCalled = false;
    await resolveRunningDevice({ auth: { id: "borrower-id" }, path: "/device/register" }, makeRes(),
      () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    const res = makeRes();
    nextCalled = false;
    await resolveRunningDevice({ auth: { id: "borrower-id" }, path: "/device/sync" }, res,
      () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.code, 403);
  } finally {
    User.findById = originalFindUser;
  }
});

test("running controls allow timed overlay unlock but reject owner-only commands and revoked location access", () => {
  const device = {
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    state: "ACTIVE",
    capabilitiesReceivedAt: new Date(),
    locationConsentAccepted: true,
    capabilities: {
      overlayAllowed: true,
      notificationsAllowed: true,
      locationGrant: "precise"
    }
  };
  assert.doesNotThrow(() => assertRunningCommandAllowed(device, "TEMP_UNLOCK"));
  assert.throws(() => assertRunningCommandAllowed(device, "RESTRICTIONS_UPDATE"), /not supported/);
  for (const commandType of [
    "SET_FACTORY_RESET_BLOCKED",
    "SET_UNKNOWN_APP_INSTALL_BLOCKED",
    "SET_USB_DEBUGGING_BLOCKED"
  ]) {
    assert.throws(
      () => assertRunningCommandAllowed(device, commandType),
      (error) => error.statusCode === 409 && error.code === "UNSUPPORTED_FOR_ENROLLMENT_MODE"
    );
  }
  assert.equal(getRunningAllowedActions(device).tempUnlock.enabled, true);
  assert.equal(getRunningAllowedActions({ ...device, state: "RELEASED" }).tempUnlock.enabled, false);
  assert.throws(() => assertRunningActionCapability({ ...device, state: "RELEASED" }, "TEMP_UNLOCK"), /DEVICE_RELEASE_IN_PROGRESS/);
  assert.equal(getRunningAllowedActions(device, { locationEnabled: true }).location.enabled, true);
  assert.equal(getRunningAllowedActions(device).location.enabled, false);
  assert.throws(() => assertRunningActionCapability(device, "GET_LOCATION"), /LOCATION_NOT_AVAILABLE/);
  assert.equal(getRunningAllowedActions({ ...device, capabilitiesReceivedAt: new Date(0) }).lock.enabled, false);
  assert.deepEqual(formatDeviceReference({ ...device, imei: "490154203237518", activationIdempotencyKey: "internal" }).imei,
    "***********7518");
  assert.equal(formatDeviceReference({ ...device, activationIdempotencyKey: "internal" }).activationIdempotencyKey, undefined);
  assert.equal(formatControlResult({ device: { ...device, activationIdempotencyKey: "internal" } }).device.activationIdempotencyKey,
    undefined);
});

test("manual override token generation rejects a running device before signing", async () => {
  await assert.rejects(
    generateManualOverrideTokenForDevice({ enrollmentMode: ENROLLMENT_MODES.RUNNING_APP }),
    (error) => error.statusCode === 409 && error.code === "UNSUPPORTED_FOR_ENROLLMENT_MODE"
  );
});

test("manual override renewal scans only owner-enrolled devices", async () => {
  const originalFind = Device.find;
  let query;
  Device.find = (filter) => {
    query = filter;
    return { limit: async () => [] };
  };
  try {
    const result = await backfillManualOverrideTokens({ limit: 10 });
    assert.equal(result.scanned, 0);
    assert.deepEqual(query.enrollmentMode.$in, [ENROLLMENT_MODES.DEVICE_OWNER_QR, null]);
  } finally {
    Device.find = originalFind;
  }
});

test("running FCM carries its command type and reminder data while owner payload stays unchanged", () => {
  const runningDevice = { enrollmentMode: ENROLLMENT_MODES.RUNNING_APP, fcmToken: "running-fcm" };
  const ownerDevice = { fcmToken: "owner-fcm" };
  const reminder = {
    _id: "command-id",
    commandType: "EMI_REMINDER",
    payload: { reminderType: "UPCOMING", message: "Payment soon" }
  };
  assert.equal(buildPolicyUpdateMessage({ device: runningDevice, command: reminder }).data.reminderType, "UPCOMING");
  assert.equal(buildPolicyUpdateMessage({ device: ownerDevice, command: reminder }).data.reminderType, undefined);
  assert.equal(buildPolicyUpdateMessage({
    device: runningDevice,
    command: { ...reminder, commandType: "LOCK" }
  }).data.type, "LOCK");
  const expiry = new Date("2026-10-09T10:00:00.000Z");
  const tempUnlock = buildPolicyUpdateMessage({
    device: runningDevice,
    command: { ...reminder, commandType: "TEMP_UNLOCK", payload: { durationHours: 2, tempUnlockExpiresAt: expiry } }
  });
  assert.equal(tempUnlock.data.type, "TEMP_UNLOCK");
  assert.equal(tempUnlock.data.tempUnlockExpiresAt, expiry.toISOString());
});

test("running temporary unlock ACK requires the overlay to clear and rejects an expired deadline", async () => {
  const originalFindDevice = Device.findById;
  const originalFindCommand = DeviceCommand.findOne;
  const tempCommandId = new mongoose.Types.ObjectId().toString();
  const device = {
    _id: "running-device",
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    state: "TEMP_UNLOCK",
    tempUnlockExpiresAt: new Date(Date.now() + 60_000)
  };
  Device.findById = async () => device;
  DeviceCommand.findOne = async () => ({
    _id: tempCommandId,
    commandType: "TEMP_UNLOCK",
    status: "pending",
    payload: { tempUnlockExpiresAt: device.tempUnlockExpiresAt }
  });
  const response = () => ({
    code: null,
    status(value) { this.code = value; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    const missingProof = response();
    await acknowledgeDeviceCommand({
      runningDevice: device,
      auth: { id: "borrower" },
      body: { commandId: tempCommandId, status: "acknowledged" }
    }, missingProof);
    assert.equal(missingProof.code, 400);
    assert.match(missingProof.body.error, /temporary unlock acknowledgement/);

    device.tempUnlockExpiresAt = new Date(Date.now() - 1_000);
    const expired = response();
    await acknowledgeDeviceCommand({
      runningDevice: device,
      auth: { id: "borrower" },
      body: { commandId: tempCommandId, status: "acknowledged", appRestrictionCleared: true, lockOverlayCleared: true }
    }, expired);
    assert.equal(expired.code, 409);
    assert.equal(expired.body.data.code, "COMMAND_EXPIRED");
  } finally {
    Device.findById = originalFindDevice;
    DeviceCommand.findOne = originalFindCommand;
  }
});
