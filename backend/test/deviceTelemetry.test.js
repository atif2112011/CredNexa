import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDevicePingTelemetry,
  parseLocationTelemetry,
  sanitizePingEventPayload
} from "../src/services/deviceTelemetry.service.js";
import { buildPolicyUpdateMessage } from "../src/jobs/fcmDeliveryWorker.js";
import {
  buildActiveLocationCommandFilter,
  GET_LOCATION_COMMAND_TYPE
} from "../src/services/deviceLocation.service.js";

test("accepts a valid newer location", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const result = parseLocationTelemetry({
    location: {
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 18,
      capturedAt: "2026-07-24T11:59:30.000Z"
    },
    currentLocation: {
      capturedAt: new Date("2026-07-24T11:00:00.000Z")
    },
    now
  });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.value.latitude, 12.9716);
  assert.equal(result.value.receivedAt, now);
});

test("ignores stale, invalid, and future locations with warnings", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const currentLocation = { capturedAt: new Date("2026-07-24T11:30:00.000Z") };

  const stale = parseLocationTelemetry({
    location: {
      latitude: 12,
      longitude: 77,
      accuracyMeters: 10,
      capturedAt: "2026-07-24T11:00:00.000Z"
    },
    currentLocation,
    now
  });
  const invalid = parseLocationTelemetry({
    location: {
      latitude: 100,
      longitude: 77,
      accuracyMeters: 10,
      capturedAt: "2026-07-24T11:59:00.000Z"
    },
    currentLocation,
    now
  });
  const future = parseLocationTelemetry({
    location: {
      latitude: 12,
      longitude: 77,
      accuracyMeters: 10,
      capturedAt: "2026-07-24T12:06:00.000Z"
    },
    currentLocation,
    now
  });

  assert.equal(stale.value, null);
  assert.equal(stale.warnings[0].code, "STALE_LOCATION");
  assert.equal(invalid.value, null);
  assert.equal(invalid.warnings[0].code, "INVALID_LOCATION");
  assert.equal(future.value, null);
  assert.equal(future.warnings[0].code, "FUTURE_LOCATION");
});

test("updates only provided SIM fields and timestamps actual changes", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const device = {
    simInfo: {
      simOperator: "Jio",
      simSerial: "SIM-1",
      phoneNumber: "9000000000"
    }
  };

  applyDevicePingTelemetry({
    device,
    body: {
      simInfo: {
        simOperator: "Airtel",
        phoneNumber: "9111111111"
      }
    },
    now
  });

  assert.deepEqual(device.simInfo, {
    simOperator: "Airtel",
    simSerial: "SIM-1",
    phoneNumber: "9111111111"
  });
  assert.equal(device.simChangedAt, now);
});

test("ignores location supplied by routine ping", () => {
  const device = {
    lastLocation: {
      latitude: 11,
      longitude: 76,
      accuracyMeters: 20,
      capturedAt: new Date("2026-07-24T10:00:00.000Z")
    }
  };
  const previousLocation = device.lastLocation;
  const result = applyDevicePingTelemetry({
    device,
    body: {
      location: {
        latitude: 12,
        longitude: 77,
        accuracyMeters: 10,
        capturedAt: "2026-07-24T12:00:00.000Z"
      }
    }
  });

  assert.equal(device.lastLocation, previousLocation);
  assert.equal(result.telemetryWarnings[0].code, "LOCATION_COMMAND_REQUIRED");
});

test("builds GET_LOCATION as a high-priority data-only command", () => {
  const message = buildPolicyUpdateMessage({
    device: { fcmToken: "fcm-token" },
    command: {
      _id: "command-id",
      commandType: "GET_LOCATION",
      payload: { requestedAt: "2026-07-31T10:00:00.000Z" }
    }
  });

  assert.equal(message.data.type, "GET_LOCATION");
  assert.equal(message.data.requestedAt, "2026-07-31T10:00:00.000Z");
  assert.equal(message.android.priority, "high");
  assert.equal(message.notification, undefined);
});

test("supersedes only active GET_LOCATION commands when refreshing location", () => {
  assert.deepEqual(buildActiveLocationCommandFilter("device-id"), {
    deviceId: "device-id",
    commandType: GET_LOCATION_COMMAND_TYPE,
    status: { $in: ["pending", "sent"] }
  });
});

test("sanitizes precise telemetry from device ping events", () => {
  const payload = sanitizePingEventPayload({
    batteryLevel: 82,
    location: { latitude: 12, longitude: 77 },
    simInfo: { phoneNumber: "9000000000" }
  });

  assert.deepEqual(payload, {
    batteryLevel: 82,
    locationReported: true,
    simInfoReported: true
  });
});
