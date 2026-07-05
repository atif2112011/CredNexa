import { DEVICE_POLICY_KEYS } from "./deviceStates.js";

export const DEFAULT_TENANT_POLICY = Object.freeze({
  lockRules: {
    dpd: 0,
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
  },
  riskRules: {
    autoLockOnCriticalSecurityRisk: true,
    destructiveEnforcementEnabled: false,
    wipeRequiresAdminAction: true,
    autoLockTypes: [
      // Confirmed/permanent device compromise.
      "ROOT_DETECTED",
      "TAMPER_DETECTED",
      "SYSTEM_TAMPER_DETECTED",
      "CUSTOM_ROM_DETECTED",
      "BOOTLOADER_UNLOCKED",
      "DEVICE_INTEGRITY_COMPROMISED",
      // Critical app compromise. Protocol/config mismatch and warning-only settings
      // are intentionally excluded from default auto-lock.
      "APP_INTEGRITY_COMPROMISED",
      "APP_TAMPER_DETECTED"
    ]
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
