import { DEVICE_CONTROL_MODES } from "../constants/tenant.js";

export const getTenantDeviceControlMode = (tenantPolicy) =>
  tenantPolicy?.deviceControlRules?.mode || DEVICE_CONTROL_MODES.EMI_AUTOMATED;

export const isManualDeviceControl = (tenantPolicy) =>
  getTenantDeviceControlMode(tenantPolicy) === DEVICE_CONTROL_MODES.MANUAL;

export const isAutomaticEmiLockEnabled = (tenantPolicy) =>
  !isManualDeviceControl(tenantPolicy) && tenantPolicy?.lockRules?.lockOnGraceExpiry !== false;

export const getBorrowerAppConfig = (tenantPolicy) => {
  const deviceControlMode = getTenantDeviceControlMode(tenantPolicy);
  const manual = deviceControlMode === DEVICE_CONTROL_MODES.MANUAL;

  return {
    deviceControlMode,
    showEmiDetails: !manual,
    paymentSubmissionEnabled: !manual,
    showPaymentHistory: !manual,
    emiNotificationsEnabled: !manual,
    unlockRequestEnabled: true
  };
};

export const isValidDeviceControlMode = (mode) =>
  Object.values(DEVICE_CONTROL_MODES).includes(mode);
