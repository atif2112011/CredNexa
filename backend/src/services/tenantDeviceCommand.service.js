import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../constants/deviceStates.js";

const IDEMPOTENT_COMMAND_TARGETS = Object.freeze({
  LOCK: {
    state: DEVICE_STATES.LOCKED,
    policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED
  },
  UNLOCK: {
    state: DEVICE_STATES.UNLOCK_PENDING,
    policyKey: DEVICE_POLICY_KEYS.EMI_PAID
  }
});

export const isTenantDeviceCommandStateSatisfied = (device, commandType) => {
  const target = IDEMPOTENT_COMMAND_TARGETS[commandType];
  if (!target) return false;

  return device?.state === target.state && device?.currentPolicyKey === target.policyKey;
};

