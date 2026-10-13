import { getEnrollmentMode, isRunningDevice } from "../constants/enrollmentModes.js";
import { DEVICE_STATES } from "../constants/deviceStates.js";

const RUNNING_COMMANDS = new Set([
  "LOCK", "UNLOCK", "TEMP_UNLOCK", "EMI_REMINDER", "GET_LOCATION", "RELEASE_DEVICE", "NOTIFICATION", "POLICY_UPDATE"
]);

export const runningModeError = (message = "Control is not supported for running-device enrollment") =>
  Object.assign(new Error(message), { statusCode: 409, code: "UNSUPPORTED_FOR_ENROLLMENT_MODE" });

/** Add the mode to linked-device references while withholding internal request IDs. */
export const formatDeviceReference = (device, { maskImei = true } = {}) => {
  if (!device) return device;
  if (!isRunningDevice(device)) return { ...device, enrollmentMode: getEnrollmentMode(device) };
  const safe = { ...device };
  delete safe.activationIdempotencyKey;
  delete safe.fcmToken;
  return {
    ...safe,
    enrollmentMode: getEnrollmentMode(device),
    imei: maskImei && device.imei ? `***********${device.imei.slice(-4)}` : device.imei,
    imei2: maskImei && device.imei2 ? `***********${device.imei2.slice(-4)}` : device.imei2
  };
};

export const formatControlResult = (result, options) => result?.device && isRunningDevice(result.device)
  ? { ...result, device: formatDeviceReference(result.device.toObject?.() || result.device, options) }
  : result;

export const assertRunningCommandAllowed = (device, commandType, payload = {}) => {
  if (!isRunningDevice(device)) return;
  if (!RUNNING_COMMANDS.has(commandType)) throw runningModeError();
  // Grace is only an app policy. Managed restrictions must not hide in an allowed command type.
  if (commandType === "POLICY_UPDATE" &&
    (payload.policyKey !== "EMI_GRACE" || payload.targetState !== DEVICE_STATES.GRACE_PERIOD || payload.restrictions)) {
    throw runningModeError("Managed policy update is not supported for running-device enrollment");
  }
};

export const getRunningAllowedActions = (device, { releaseEligible = false, locationEnabled = false } = {}) => {
  if (!isRunningDevice(device)) return null;
  const capability = device.capabilities || {};
  const fresh = device.capabilitiesReceivedAt &&
    Date.now() - new Date(device.capabilitiesReceivedAt).getTime() <= 24 * 60 * 60 * 1000;
  const released = [DEVICE_STATES.RELEASE_PENDING, DEVICE_STATES.RELEASED].includes(device.state);
  const allowed = (enabled, reason) => enabled ? { enabled: true } : { enabled: false, reason };
  return {
    lock: allowed(!released && fresh && capability.overlayAllowed === true,
      released ? "DEVICE_RELEASE_IN_PROGRESS" : "OVERLAY_UNAVAILABLE"),
    unlock: allowed(!released, "DEVICE_RELEASE_IN_PROGRESS"),
    reminder: allowed(!released && fresh && capability.notificationsAllowed === true,
      released ? "DEVICE_RELEASE_IN_PROGRESS" : "NOTIFICATIONS_UNAVAILABLE"),
    location: allowed(!released && locationEnabled && device.locationConsentAccepted === true && fresh &&
      ["approximate", "precise", "coarse", "fine", "foreground", "background"].includes(capability.locationGrant),
      "LOCATION_NOT_AVAILABLE"),
    release: allowed(!released && releaseEligible, released ? "DEVICE_RELEASE_IN_PROGRESS" : "EMI_NOT_SETTLED"),
    // Temporary unlock clears the running overlay until its existing expiry; it needs no new Android grant.
    tempUnlock: allowed(!released, "DEVICE_RELEASE_IN_PROGRESS")
  };
};

export const assertRunningActionCapability = (device, commandType, options = {}) => {
  if (!isRunningDevice(device)) return;
  const actions = getRunningAllowedActions(device, options);
  const key = { LOCK: "lock", UNLOCK: "unlock", TEMP_UNLOCK: "tempUnlock", EMI_REMINDER: "reminder", GET_LOCATION: "location" }[commandType];
  if (key && !actions[key].enabled) {
    throw Object.assign(new Error(actions[key].reason), {
      statusCode: 409,
      code: "CAPABILITY_UNAVAILABLE"
    });
  }
};
