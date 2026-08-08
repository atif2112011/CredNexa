export const DEVICE_STATES = Object.freeze({
  ACTIVE: "ACTIVE",
  GRACE_PERIOD: "GRACE_PERIOD",
  LOCKED: "LOCKED",
  TEMP_UNLOCK: "TEMP_UNLOCK",
  UNLOCK_PENDING: "UNLOCK_PENDING",
  OFFLINE_PENDING: "OFFLINE_PENDING",
  CONSENT_INVALID: "CONSENT_INVALID",
  RELEASE_PENDING: "RELEASE_PENDING",
  RELEASED: "RELEASED"
});

export const DEVICE_RELEASE_STATES = Object.freeze([
  DEVICE_STATES.RELEASE_PENDING,
  DEVICE_STATES.RELEASED
]);

export const isDeviceReleaseState = (state) => DEVICE_RELEASE_STATES.includes(state);

export const DEVICE_STATE_LABELS = Object.freeze({
  [DEVICE_STATES.ACTIVE]: "Active",
  [DEVICE_STATES.GRACE_PERIOD]: "Grace Period",
  [DEVICE_STATES.LOCKED]: "Locked",
  [DEVICE_STATES.TEMP_UNLOCK]: "Temp Unlocked",
  [DEVICE_STATES.UNLOCK_PENDING]: "Unlock Pending",
  [DEVICE_STATES.OFFLINE_PENDING]: "Offline Pending",
  [DEVICE_STATES.CONSENT_INVALID]: "Consent Invalid",
  [DEVICE_STATES.RELEASE_PENDING]: "Release Pending",
  [DEVICE_STATES.RELEASED]: "Released"
});

export const getDeviceStateLabel = (state) =>
  DEVICE_STATE_LABELS[state] || String(state || "");

export const DEVICE_POLICY_KEYS = Object.freeze({
  EMI_PAID: "EMI_PAID",
  EMI_GRACE: "EMI_GRACE",
  EMI_LOCKED: "EMI_LOCKED",
  TEMP_UNLOCKED: "TEMP_UNLOCKED",
  CONSENT_INVALID: "CONSENT_INVALID"
});

export const DEVICE_POLICY_LABELS = Object.freeze({
  [DEVICE_POLICY_KEYS.EMI_PAID]: "EMI Paid",
  [DEVICE_POLICY_KEYS.EMI_GRACE]: "Grace Period",
  [DEVICE_POLICY_KEYS.EMI_LOCKED]: "EMI Locked",
  [DEVICE_POLICY_KEYS.TEMP_UNLOCKED]: "Temp Unlocked",
  [DEVICE_POLICY_KEYS.CONSENT_INVALID]: "Consent Invalid"
});

export const getDevicePolicyLabel = (policyKey) =>
  DEVICE_POLICY_LABELS[policyKey] || String(policyKey || "");
