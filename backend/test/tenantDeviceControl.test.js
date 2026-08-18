import assert from "node:assert/strict";
import test from "node:test";

import { DEVICE_CONTROL_MODES } from "../src/constants/tenant.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../src/constants/deviceStates.js";
import { isTenantDeviceCommandStateSatisfied } from "../src/services/tenantDeviceCommand.service.js";
import {
  getBorrowerAppConfig,
  getTenantDeviceControlMode,
  isAutomaticEmiLockEnabled,
  isManualDeviceControl,
  isValidDeviceControlMode
} from "../src/services/tenantDeviceControl.service.js";

test("legacy tenant policies remain EMI automated", () => {
  const policy = { lockRules: { lockOnGraceExpiry: true } };

  assert.equal(getTenantDeviceControlMode(policy), DEVICE_CONTROL_MODES.EMI_AUTOMATED);
  assert.equal(isManualDeviceControl(policy), false);
  assert.equal(isAutomaticEmiLockEnabled(policy), true);
  assert.deepEqual(getBorrowerAppConfig(policy), {
    deviceControlMode: DEVICE_CONTROL_MODES.EMI_AUTOMATED,
    showEmiDetails: true,
    paymentSubmissionEnabled: true,
    showPaymentHistory: true,
    emiNotificationsEnabled: true,
    unlockRequestEnabled: true
  });
});

test("legacy lockOnGraceExpiry still disables automatic EMI lock only", () => {
  const policy = {
    deviceControlRules: { mode: DEVICE_CONTROL_MODES.EMI_AUTOMATED },
    lockRules: { lockOnGraceExpiry: false }
  };

  assert.equal(isAutomaticEmiLockEnabled(policy), false);
  assert.equal(getBorrowerAppConfig(policy).showEmiDetails, true);
  assert.equal(getBorrowerAppConfig(policy).paymentSubmissionEnabled, true);
});

test("manual mode disables only borrower payment submission regardless of the legacy lock flag", () => {
  const policy = {
    deviceControlRules: { mode: DEVICE_CONTROL_MODES.MANUAL },
    lockRules: { lockOnGraceExpiry: true }
  };

  assert.equal(isManualDeviceControl(policy), true);
  assert.equal(isAutomaticEmiLockEnabled(policy), false);
  assert.deepEqual(getBorrowerAppConfig(policy), {
    deviceControlMode: DEVICE_CONTROL_MODES.MANUAL,
    showEmiDetails: true,
    paymentSubmissionEnabled: false,
    showPaymentHistory: true,
    emiNotificationsEnabled: true,
    unlockRequestEnabled: true
  });
});

test("only supported immutable creation modes validate", () => {
  assert.equal(isValidDeviceControlMode(DEVICE_CONTROL_MODES.EMI_AUTOMATED), true);
  assert.equal(isValidDeviceControlMode(DEVICE_CONTROL_MODES.MANUAL), true);
  assert.equal(isValidDeviceControlMode("manual"), false);
  assert.equal(isValidDeviceControlMode(undefined), false);
});

test("manual lock is a no-op only when lock state and policy already match", () => {
  assert.equal(
    isTenantDeviceCommandStateSatisfied(
      { state: DEVICE_STATES.LOCKED, currentPolicyKey: DEVICE_POLICY_KEYS.EMI_LOCKED },
      "LOCK"
    ),
    true
  );
  assert.equal(
    isTenantDeviceCommandStateSatisfied(
      { state: DEVICE_STATES.LOCKED, currentPolicyKey: DEVICE_POLICY_KEYS.EMI_PAID },
      "LOCK"
    ),
    false
  );
});

test("manual unlock is a no-op only while the matching unlock is pending", () => {
  assert.equal(
    isTenantDeviceCommandStateSatisfied(
      { state: DEVICE_STATES.UNLOCK_PENDING, currentPolicyKey: DEVICE_POLICY_KEYS.EMI_PAID },
      "UNLOCK"
    ),
    true
  );
  assert.equal(
    isTenantDeviceCommandStateSatisfied(
      { state: DEVICE_STATES.LOCKED, currentPolicyKey: DEVICE_POLICY_KEYS.EMI_LOCKED },
      "UNLOCK"
    ),
    false
  );
  assert.equal(
    isTenantDeviceCommandStateSatisfied(
      { state: DEVICE_STATES.TEMP_UNLOCK, currentPolicyKey: DEVICE_POLICY_KEYS.TEMP_UNLOCKED },
      "TEMP_UNLOCK"
    ),
    false
  );
});
