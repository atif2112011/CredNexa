import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDevicePingTelemetry,
  parseLocationTelemetry,
  sanitizePingEventPayload
} from "../src/services/deviceTelemetry.service.js";

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
