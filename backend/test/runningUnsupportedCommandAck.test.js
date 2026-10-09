import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import { ENROLLMENT_MODES } from "../src/constants/enrollmentModes.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { Device } from "../src/models/Device.js";
import { DEVICE_COMMAND_FAILURE_SOURCES, DeviceCommand } from "../src/models/DeviceCommand.js";
import { acknowledgeDeviceCommand } from "../src/modules/app/app.controller.js";

const response = () => ({
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }
});

test("an existing unsupported running command accepts only a terminal failed ACK", async () => {
  const original = {
    deviceFind: Device.findById,
    commandFind: DeviceCommand.findOne,
    auditCreate: AuditLog.create,
    log: console.log,
    error: console.error
  };
  const deviceId = new mongoose.Types.ObjectId();
  const commandId = new mongoose.Types.ObjectId();
  const device = {
    _id: deviceId,
    tenantId: new mongoose.Types.ObjectId(),
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    state: "ACTIVE",
    saveCalls: 0,
    async save() { this.saveCalls += 1; }
  };
  let command = {
    _id: commandId,
    commandType: "RESTRICTIONS_UPDATE",
    status: "pending",
    payload: { restrictions: { whatsapp: true } },
    nextRetryAt: new Date(),
    saveCalls: 0,
    async save() { this.saveCalls += 1; }
  };
  const audits = [];
  let commandQueries = 0;
  Device.findById = async () => device;
  DeviceCommand.findOne = async (filter) => {
    commandQueries += 1;
    return String(filter._id) === String(command._id) && String(filter.deviceId) === String(deviceId)
      ? command : null;
  };
  AuditLog.create = async (items) => { audits.push(items[0]); return items; };
  console.log = () => {};
  console.error = () => {};
  const call = async (body) => {
    const res = response();
    await acknowledgeDeviceCommand({
      auth: { id: "borrower-id" },
      runningDevice: device,
      body: { commandId: String(commandId), ...body }
    }, res);
    return res;
  };

  try {
    const accepted = await call({ status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });
    assert.equal(accepted.code, 200);
    assert.equal(accepted.body.data.status, "failed");
    assert.equal(accepted.body.data.deviceState, "ACTIVE");
    assert.equal(command.status, "failed");
    assert.equal(command.failureReason, "UNSUPPORTED_FOR_ENROLLMENT_MODE");
    assert.equal(command.failureSource, DEVICE_COMMAND_FAILURE_SOURCES.DEVICE_ENFORCEMENT);
    assert.equal(command.nextRetryAt, undefined);
    assert.deepEqual(command.ackPayload, {
      commandId: String(commandId), status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE"
    });
    assert.equal(command.saveCalls, 1);
    assert.equal(device.saveCalls, 0);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].metadata.previousStatus, "pending");

    const repeat = await call({ status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });
    assert.equal(repeat.code, 200);
    assert.equal(command.saveCalls, 1);
    assert.equal(audits.length, 1);

    for (const body of [
      { status: "acknowledged", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" },
      { status: "success", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" },
      { status: "failed", failureReason: "OTHER_REASON" },
      { status: "failed" }
    ]) {
      const rejected = await call(body);
      assert.equal(rejected.code, 409);
      assert.equal(rejected.body.data.code, "UNSUPPORTED_FOR_ENROLLMENT_MODE");
    }
    assert.equal(command.saveCalls, 1);
    assert.equal(device.saveCalls, 0);

    const invalidId = response();
    await acknowledgeDeviceCommand({
      auth: { id: "borrower-id" }, runningDevice: device,
      body: { commandId: "not-an-object-id", status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" }
    }, invalidId);
    assert.equal(invalidId.code, 400);
    assert.equal(commandQueries, 6);

    command = { ...command, _id: new mongoose.Types.ObjectId(), status: "pending", saveCalls: 0 };
    const wrongCommand = await call({ status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });
    assert.equal(wrongCommand.code, 404);
    assert.equal(command.saveCalls, 0);
  } finally {
    Device.findById = original.deviceFind;
    DeviceCommand.findOne = original.commandFind;
    AuditLog.create = original.auditCreate;
    console.log = original.log;
    console.error = original.error;
  }
});

test("expired stale commands can be failed, while supported and owner ACK paths stay intact", async () => {
  const original = {
    deviceFind: Device.findById,
    ownerDeviceFind: Device.findOne,
    commandFind: DeviceCommand.findOne,
    auditCreate: AuditLog.create,
    log: console.log,
    error: console.error
  };
  const commandId = new mongoose.Types.ObjectId();
  const device = {
    _id: new mongoose.Types.ObjectId(), tenantId: new mongoose.Types.ObjectId(),
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP, state: "ACTIVE",
    saveCalls: 0, async save() { this.saveCalls += 1; }
  };
  let command = {
    _id: commandId, commandType: "SET_USB_DEBUGGING_BLOCKED", status: "expired",
    failureReason: "Control is not supported for running-device enrollment",
    saveCalls: 0, async save() { this.saveCalls += 1; }
  };
  const audits = [];
  Device.findById = async () => device;
  Device.findOne = async () => device;
  DeviceCommand.findOne = async () => command;
  AuditLog.create = async (items) => { audits.push(items[0]); return items; };
  console.log = () => {};
  console.error = () => {};
  const ack = async (body, running = true) => {
    const res = response();
    await acknowledgeDeviceCommand({
      auth: { id: "borrower-id" },
      ...(running ? { runningDevice: device } : {}),
      body: { commandId: String(commandId), ...body }
    }, res);
    return res;
  };

  try {
    const stale = await ack({ status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });
    assert.equal(stale.code, 200);
    assert.equal(command.status, "failed");
    assert.equal(audits[0].metadata.previousStatus, "expired");
    assert.equal(device.saveCalls, 0);

    command = {
      ...command, commandType: "POLICY_UPDATE", status: "pending",
      payload: { policyKey: "EMI_LOCKED", targetState: "LOCKED", restrictions: { whatsapp: true } },
      failureSource: undefined, failureReason: undefined, saveCalls: 0
    };
    const managedPolicy = await ack({ status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });
    assert.equal(managedPolicy.code, 200);
    assert.equal(command.status, "failed");
    assert.equal(device.saveCalls, 0);

    command = {
      ...command, commandType: "WIPE_DEVICE", status: "acknowledged",
      failureSource: undefined, failureReason: undefined, saveCalls: 0
    };
    const alreadyAcknowledged = await ack({ status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });
    assert.equal(alreadyAcknowledged.code, 409);
    assert.equal(command.status, "acknowledged");
    assert.equal(command.saveCalls, 0);

    command = {
      ...command, status: "failed", failureSource: DEVICE_COMMAND_FAILURE_SOURCES.DEVICE_ENFORCEMENT,
      failureReason: "ANOTHER_DEVICE_ERROR", saveCalls: 0
    };
    const differentFailure = await ack({ status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });
    assert.equal(differentFailure.code, 409);
    assert.equal(command.failureReason, "ANOTHER_DEVICE_ERROR");
    assert.equal(command.saveCalls, 0);

    command = { ...command, commandType: "LOCK", status: "pending", saveCalls: 0 };
    const supported = await ack({ status: "failed", failureReason: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });
    assert.equal(supported.code, 400);
    assert.equal(command.saveCalls, 0);

    device.enrollmentMode = ENROLLMENT_MODES.DEVICE_OWNER_QR;
    command = { ...command, commandType: "RESTRICTIONS_UPDATE", status: "pending", saveCalls: 0 };
    const owner = await ack({ status: "failed", failureReason: "APK_ERROR" }, false);
    assert.equal(owner.code, 200);
    assert.equal(command.status, "failed");
    assert.equal(command.failureReason, "APK_ERROR");
    assert.equal(device.saveCalls, 0);
  } finally {
    Device.findById = original.deviceFind;
    Device.findOne = original.ownerDeviceFind;
    DeviceCommand.findOne = original.commandFind;
    AuditLog.create = original.auditCreate;
    console.log = original.log;
    console.error = original.error;
  }
});
