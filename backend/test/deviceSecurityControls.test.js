import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_SECURITY_CONTROL_COMMAND_TYPES,
  getDeviceSecurityControl,
  getDeviceSecurityControlByCommandType,
  normalizeDeviceSecurityControlState
} from "../src/constants/deviceSecurityControls.js";
import { buildPolicyUpdateMessage } from "../src/jobs/fcmDeliveryWorker.js";
import {
  buildPendingSecurityControlSupersessionFilter,
  buildReleasedDeviceSecurityControlState,
  formatLatestSecurityControlCommand,
  shouldAdvanceAppliedSecurityControlState,
  validateDeviceSecurityControlRetry,
  validateDeviceSecurityControlUpdate
} from "../src/services/deviceSecurityControls.service.js";

test("defines three independent security controls and command types", () => {
  assert.deepEqual(DEVICE_SECURITY_CONTROL_COMMAND_TYPES, [
    "SET_FACTORY_RESET_BLOCKED",
    "SET_USB_DEBUGGING_BLOCKED",
    "SET_UNKNOWN_APP_INSTALL_BLOCKED"
  ]);
  assert.equal(
    getDeviceSecurityControl("usbDebugging").commandType,
    "SET_USB_DEBUGGING_BLOCKED"
  );
  assert.equal(
    getDeviceSecurityControlByCommandType("SET_UNKNOWN_APP_INSTALL_BLOCKED").key,
    "unknownAppInstalls"
  );
});

test("normalizes missing security control state to allowed defaults", () => {
  const state = normalizeDeviceSecurityControlState();
  for (const entry of Object.values(state)) {
    assert.deepEqual(entry, {
      desiredBlocked: false,
      appliedBlocked: false,
      desiredVersion: 0,
      appliedVersion: 0,
      updatedAt: null,
      appliedAt: null,
      updatedBy: null
    });
  }
});

test("validates toggle and retry requests", () => {
  assert.deepEqual(
    validateDeviceSecurityControlUpdate({ blocked: true, retry: true }),
    { value: { blocked: true, retry: true } }
  );
  assert.equal(
    validateDeviceSecurityControlUpdate({ blocked: "true" }).error,
    "blocked must be a boolean"
  );

  assert.equal(
    validateDeviceSecurityControlRetry({
      entry: {
        desiredBlocked: true,
        appliedBlocked: false,
        desiredVersion: 3,
        appliedVersion: 2
      },
      blocked: true,
      retry: true
    }),
    null
  );
  assert.match(
    validateDeviceSecurityControlRetry({
      entry: {
        desiredBlocked: true,
        appliedBlocked: false,
        desiredVersion: 3,
        appliedVersion: 2
      },
      blocked: false,
      retry: true
    }),
    /must match/
  );
});

test("does not regress applied control versions", () => {
  assert.equal(
    shouldAdvanceAppliedSecurityControlState({
      currentAppliedVersion: 5,
      acknowledgedVersion: 4
    }),
    false
  );
  assert.equal(
    shouldAdvanceAppliedSecurityControlState({
      currentAppliedVersion: 5,
      acknowledgedVersion: 6
    }),
    true
  );
});

test("supersedes pending commands for only the selected control type", () => {
  assert.deepEqual(
    buildPendingSecurityControlSupersessionFilter({
      deviceId: "device-id",
      commandType: "SET_USB_DEBUGGING_BLOCKED"
    }),
    {
      deviceId: "device-id",
      commandType: "SET_USB_DEBUGGING_BLOCKED",
      status: "pending"
    }
  );
});

test("clears and advances every security control during permanent release", () => {
  const releasedAt = new Date("2026-07-30T10:00:00.000Z");
  const state = buildReleasedDeviceSecurityControlState(
    {
      factoryReset: {
        desiredBlocked: true,
        appliedBlocked: false,
        desiredVersion: 4,
        appliedVersion: 3
      },
      usbDebugging: {
        desiredBlocked: true,
        appliedBlocked: true,
        desiredVersion: 2,
        appliedVersion: 2
      }
    },
    releasedAt,
    "account-id"
  );

  assert.deepEqual(state.factoryReset, {
    desiredBlocked: false,
    appliedBlocked: false,
    desiredVersion: 5,
    appliedVersion: 5,
    updatedAt: releasedAt,
    appliedAt: releasedAt,
    updatedBy: "account-id"
  });
  assert.equal(state.usbDebugging.desiredVersion, 3);
  assert.equal(state.unknownAppInstalls.desiredVersion, 1);
  assert.equal(state.unknownAppInstalls.appliedBlocked, false);
});

test("formats latest command control result without fabricating one", () => {
  assert.deepEqual(
    formatLatestSecurityControlCommand({
      _id: "command-id",
      ackPayload: { controlResult: { status: "unsupported" } }
    }).controlResult,
    { status: "unsupported" }
  );
  assert.equal(
    formatLatestSecurityControlCommand({ _id: "command-id", ackPayload: {} })
      .controlResult,
    null
  );
});

test("sends each security control as high-priority data-only FCM", () => {
  for (const commandType of DEVICE_SECURITY_CONTROL_COMMAND_TYPES) {
    const message = buildPolicyUpdateMessage({
      device: { fcmToken: "fcm-token" },
      command: {
        _id: "command-id",
        commandType,
        payload: { blocked: true, controlVersion: 7 }
      }
    });

    assert.equal(message.data.type, commandType);
    assert.equal(message.data.blocked, "true");
    assert.equal(message.data.controlVersion, "7");
    assert.equal(message.android.priority, "high");
    assert.equal(message.notification, undefined);
  }
});
