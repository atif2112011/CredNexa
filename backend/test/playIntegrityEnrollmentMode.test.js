import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import { ENROLLMENT_MODES } from "../src/constants/enrollmentModes.js";
import { requireOwnerPlayIntegrity } from "../src/middleware/requireOwnerPlayIntegrity.js";
import { ownerOnlyRiskFlag } from "../src/middleware/requireOwnerEnrollment.js";
import { resolveRunningDevice } from "../src/middleware/resolveRunningDevice.js";
import { Device } from "../src/models/Device.js";
import { RiskFlag } from "../src/models/RiskFlag.js";
import { User } from "../src/models/User.js";
import { adminRoutes } from "../src/modules/admin/admin.routes.js";
import { appRoutes } from "../src/modules/app/app.routes.js";
import { assertRunningCommandAllowed } from "../src/services/runningDevicePolicy.service.js";

const INTEGRITY_PATHS = [
  "/integrity/challenge",
  "/integrity/verify",
  "/integrity/risk/challenge",
  "/integrity/risk/verify"
];

const response = () => ({
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }
});

const query = (record) => ({
  select() { return this; },
  async lean() { return record; }
});

test("all Play Integrity routes guard enrollment mode before running-device resolution", () => {
  const resolverIndex = appRoutes.stack.findIndex((layer) => layer.handle === resolveRunningDevice);
  assert.ok(resolverIndex >= 0);

  for (const path of INTEGRITY_PATHS) {
    const routeIndex = appRoutes.stack.findIndex((layer) => layer.route?.path === path);
    assert.ok(routeIndex >= 0, `${path} must exist`);
    assert.ok(routeIndex < resolverIndex, `${path} must run before running-device resolution`);
    assert.ok(appRoutes.stack[routeIndex].route.stack.some(
      (layer) => layer.handle === requireOwnerPlayIntegrity
    ), `${path} must use the shared mode guard`);
  }
});

test("running borrowers are rejected before and after activation", async () => {
  const originalUserFind = User.findById;
  const originalDeviceFind = Device.findOne;
  const originalErrorLog = console.error;
  const tenantId = "tenant-id";
  const userId = "borrower-id";
  let user = { _id: userId, tenantId, enrollmentMode: ENROLLMENT_MODES.RUNNING_APP };
  let deviceQueries = 0;
  User.findById = () => query(user);
  Device.findOne = () => {
    deviceQueries += 1;
    return query({ enrollmentMode: ENROLLMENT_MODES.RUNNING_APP });
  };
  console.error = () => {};

  try {
    for (const path of INTEGRITY_PATHS) {
      const res = response();
      let nextCalled = false;
      await requireOwnerPlayIntegrity({ auth: { id: userId }, path, body: { enrollmentMode: ENROLLMENT_MODES.DEVICE_OWNER_QR } },
        res, () => { nextCalled = true; });
      assert.equal(res.code, 409);
      assert.equal(res.body.data.code, "UNSUPPORTED_FOR_ENROLLMENT_MODE");
      assert.equal(nextCalled, false);
    }
    assert.equal(deviceQueries, 0, "borrower mode rejects before a device lookup");

    // A stale borrower mode cannot enable Integrity on a linked running device.
    user = { _id: userId, tenantId, linkedDeviceId: "device-id", enrollmentMode: ENROLLMENT_MODES.DEVICE_OWNER_QR };
    for (const path of INTEGRITY_PATHS) {
      const res = response();
      let nextCalled = false;
      await requireOwnerPlayIntegrity({ auth: { id: userId }, path }, res, () => { nextCalled = true; });
      assert.equal(res.code, 409);
      assert.equal(res.body.data.code, "UNSUPPORTED_FOR_ENROLLMENT_MODE");
      assert.equal(nextCalled, false);
    }
    assert.equal(deviceQueries, INTEGRITY_PATHS.length);
  } finally {
    User.findById = originalUserFind;
    Device.findOne = originalDeviceFind;
    console.error = originalErrorLog;
  }
});

test("owner and legacy borrowers retain all Play Integrity routes", async () => {
  const originalUserFind = User.findById;
  const originalDeviceFind = Device.findOne;
  let user;
  let device;
  User.findById = () => query(user);
  Device.findOne = () => query(device);

  try {
    for (const mode of [ENROLLMENT_MODES.DEVICE_OWNER_QR, undefined]) {
      user = { _id: "borrower-id", tenantId: "tenant-id", linkedDeviceId: "device-id", enrollmentMode: mode };
      device = { enrollmentMode: mode };
      for (const path of INTEGRITY_PATHS) {
        const res = response();
        let nextCalled = false;
        await requireOwnerPlayIntegrity({ auth: { id: user._id }, path, body: { enrollmentMode: ENROLLMENT_MODES.RUNNING_APP } },
          res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(res.code, undefined);
      }
    }
  } finally {
    User.findById = originalUserFind;
    Device.findOne = originalDeviceFind;
  }
});

test("admin recheck and command delivery keep running-device Integrity blocked", async () => {
  const recheckRoute = adminRoutes.stack.find((layer) =>
    layer.route?.path === "/risk-flags/:flagId/recheck"
  );
  assert.ok(recheckRoute?.route.stack.some((layer) => layer.handle === ownerOnlyRiskFlag));

  const originalRiskFind = RiskFlag.findById;
  const originalDeviceFind = Device.findById;
  const originalErrorLog = console.error;
  let device = { enrollmentMode: ENROLLMENT_MODES.RUNNING_APP };
  RiskFlag.findById = () => ({ lean: async () => ({ deviceId: new mongoose.Types.ObjectId() }) });
  Device.findById = () => ({ lean: async () => device });
  console.error = () => {};

  try {
    const req = { params: { flagId: new mongoose.Types.ObjectId().toString() } };
    const runningRes = response();
    let nextCalled = false;
    await ownerOnlyRiskFlag(req, runningRes, () => { nextCalled = true; });
    assert.equal(runningRes.code, 409);
    assert.equal(runningRes.body.data.code, "UNSUPPORTED_FOR_ENROLLMENT_MODE");
    assert.equal(nextCalled, false);
    assert.throws(() => assertRunningCommandAllowed(device, "RUN_INTEGRITY_CHECK"),
      (error) => error.statusCode === 409 && error.code === "UNSUPPORTED_FOR_ENROLLMENT_MODE");

    device = { enrollmentMode: ENROLLMENT_MODES.DEVICE_OWNER_QR };
    await ownerOnlyRiskFlag(req, response(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.doesNotThrow(() => assertRunningCommandAllowed(device, "RUN_INTEGRITY_CHECK"));
  } finally {
    RiskFlag.findById = originalRiskFind;
    Device.findById = originalDeviceFind;
    console.error = originalErrorLog;
  }
});
