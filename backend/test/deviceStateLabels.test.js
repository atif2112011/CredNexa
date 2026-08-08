import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_POLICY_KEYS,
  DEVICE_STATES,
  getDevicePolicyLabel,
  getDeviceStateLabel
} from "../src/constants/deviceStates.js";

test("provides canonical tenant-facing device state labels", () => {
  assert.equal(getDeviceStateLabel(DEVICE_STATES.GRACE_PERIOD), "Grace Period");
  assert.equal(getDeviceStateLabel(DEVICE_STATES.TEMP_UNLOCK), "Temp Unlocked");
  assert.equal(getDeviceStateLabel(DEVICE_STATES.RELEASED), "Released");
});

test("labels the temporary-unlock policy without exposing its enum value", () => {
  assert.equal(
    getDevicePolicyLabel(DEVICE_POLICY_KEYS.TEMP_UNLOCKED),
    "Temp Unlocked"
  );
});

