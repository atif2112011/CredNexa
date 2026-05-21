import { DEVICE_POLICY_KEYS } from "./deviceStates.js";

export const DEFAULT_TENANT_POLICY = Object.freeze({
  lockRules: {
    dpd: 30,
    gracePeriodDays: 7,
    lockOnGraceExpiry: true
  },
  unlockRules: {
    unlockType: "instant",
    delayMinutes: 0,
    requireFullPayment: true,
    partialUnlockOnPartialPayment: false,
    requireReasonOnManualUnlock: true
  },
  tempUnlockRules: {
    defaultDurationHours: 24,
    maxDurationHours: 72
  },
  escalationRules: {
    slaHours: 24,
    partnerEscalationSlaHours: 48,
    autoEscalateOnSLABreach: true
  }
});

export const DEFAULT_DEVICE_POLICIES = Object.freeze([
  {
    policyKey: DEVICE_POLICY_KEYS.EMI_PAID,
    restrictions: {
      lockMode: false,
      allowedApps: [],
      blockedApps: [],
      disableFactoryReset: true,
      disableStatusBar: false,
      disableAdb: false
    }
  },
  {
    policyKey: DEVICE_POLICY_KEYS.EMI_GRACE,
    restrictions: {
      lockMode: false,
      allowedApps: [],
      blockedApps: [],
      disableFactoryReset: true,
      disableStatusBar: false,
      disableAdb: false
    }
  },
  {
    policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
    restrictions: {
      lockMode: true,
      allowedApps: ["com.emishield.app", "com.android.dialer"],
      blockedApps: [],
      disableFactoryReset: true,
      disableStatusBar: true,
      disableAdb: true
    }
  },
  {
    policyKey: DEVICE_POLICY_KEYS.TEMP_UNLOCKED,
    restrictions: {
      lockMode: false,
      allowedApps: [],
      blockedApps: [],
      disableFactoryReset: true,
      disableStatusBar: false,
      disableAdb: false
    }
  },
  {
    policyKey: DEVICE_POLICY_KEYS.CONSENT_INVALID,
    restrictions: {
      lockMode: false,
      allowedApps: [],
      blockedApps: [],
      disableFactoryReset: true,
      disableStatusBar: false,
      disableAdb: false
    }
  }
]);
