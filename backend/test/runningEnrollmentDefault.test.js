import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_TENANT_POLICY } from "../src/constants/defaultPolicies.js";
import { DEVICE_CONTROL_MODES } from "../src/constants/tenant.js";
import { TenantPolicy } from "../src/models/TenantPolicy.js";

test("new automatic and manual dealer policies enable running enrollment by default", () => {
  assert.equal(DEFAULT_TENANT_POLICY.runningEnrollmentEnabled, true);
  for (const mode of [DEVICE_CONTROL_MODES.EMI_AUTOMATED, DEVICE_CONTROL_MODES.MANUAL]) {
    const policy = new TenantPolicy({
      ...DEFAULT_TENANT_POLICY,
      deviceControlRules: { mode }
    });
    assert.equal(policy.runningEnrollmentEnabled, true);
    assert.equal(policy.deviceControlRules.mode, mode);
  }
  assert.equal(new TenantPolicy().runningEnrollmentEnabled, true);
});
