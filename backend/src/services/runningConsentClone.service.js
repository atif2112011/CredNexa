import { ENROLLMENT_MODES, getEnrollmentMode } from "../constants/enrollmentModes.js";

const replaceOnce = (text, previous, next) => {
  const value = String(text || "");
  if (value.split(previous).length !== 2) {
    throw new Error(`Owner consent has changed; review its ${JSON.stringify(previous)} clause before cloning`);
  }
  return value.replace(previous, next);
};

/** Copy the current owner agreement while correcting claims an installed app cannot make. */
export const buildRunningConsentFromOwner = (owner) => {
  if (!owner?.isCurrent || getEnrollmentMode(owner) !== ENROLLMENT_MODES.DEVICE_OWNER_QR) {
    throw new Error("A current Device Owner consent version is required");
  }

  let deviceControlConsentText = String(owner.deviceControlConsentText || "");
  deviceControlConsentText = replaceOnce(
    deviceControlConsentText,
    "Prevent factory reset, safe mode, debugging, or removal of device management.",
    "Show an app-controlled lock overlay when a restriction is requested. This installed app cannot prevent factory reset, safe mode, debugging, or its removal."
  );
  deviceControlConsentText = replaceOnce(
    deviceControlConsentText,
    "Restrict access to non-essential apps if an EMI remains overdue.",
    "Show an app-controlled overlay if an EMI remains overdue. It does not block individual apps or provide Android Device Owner kiosk control."
  );
  deviceControlConsentText = replaceOnce(
    deviceControlConsentText,
    "Continue the last applicable restriction while the device is offline.",
    "Continue attempting to show the last applicable overlay while the device is offline, while the required Android permissions remain granted."
  );
  deviceControlConsentText = replaceOnce(
    deviceControlConsentText,
    "I understand that EMI Shield will not remotely erase my personal data or monitor my calls, messages, photos, microphone, or location.",
    "I understand that EMI Shield will not remotely erase my personal data or monitor my calls, messages, photos, or microphone. A one-time device location may be requested only if I separately consent and grant Android location access; continuous location monitoring is not part of this enrollment."
  );
  deviceControlConsentText += "\n\nI will enter the device IMEI number(s) during enrollment. I understand that I can revoke app permissions or uninstall this running-device app, which may prevent its overlay and reminders from working.";

  const privacyPolicyText = `${String(owner.privacyPolicyText || "")}\n\nA one-time location may be collected for an authorized location request only if I separately consent and grant Android location access.`;

  return {
    version: `running-${owner.version}`,
    enrollmentMode: ENROLLMENT_MODES.RUNNING_APP,
    title: `Running Device Consent ${owner.version}`,
    borrowerAgreementText: owner.borrowerAgreementText,
    deviceControlConsentText,
    privacyPolicyText,
    tripartiteAckText: owner.tripartiteAckText || ""
  };
};
