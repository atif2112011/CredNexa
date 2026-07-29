export const DEVICE_SECURITY_CONTROLS = Object.freeze({
  factoryReset: {
    key: "factoryReset",
    path: "factory-reset",
    commandType: "SET_FACTORY_RESET_BLOCKED"
  },
  usbDebugging: {
    key: "usbDebugging",
    path: "usb-debugging",
    commandType: "SET_USB_DEBUGGING_BLOCKED"
  },
  unknownAppInstalls: {
    key: "unknownAppInstalls",
    path: "unknown-app-installs",
    commandType: "SET_UNKNOWN_APP_INSTALL_BLOCKED"
  }
});

export const DEVICE_SECURITY_CONTROL_KEYS = Object.freeze(
  Object.keys(DEVICE_SECURITY_CONTROLS)
);

export const DEVICE_SECURITY_CONTROL_COMMAND_TYPES = Object.freeze(
  DEVICE_SECURITY_CONTROL_KEYS.map(
    (key) => DEVICE_SECURITY_CONTROLS[key].commandType
  )
);

export const getDeviceSecurityControl = (key) =>
  DEVICE_SECURITY_CONTROLS[String(key || "")] || null;

export const getDeviceSecurityControlByCommandType = (commandType) =>
  Object.values(DEVICE_SECURITY_CONTROLS).find(
    (control) => control.commandType === commandType
  ) || null;

export const normalizeDeviceSecurityControlEntry = (entry = {}) => ({
  desiredBlocked: Boolean(entry?.desiredBlocked),
  appliedBlocked: Boolean(entry?.appliedBlocked),
  desiredVersion: Math.max(Number(entry?.desiredVersion || 0), 0),
  appliedVersion: Math.max(Number(entry?.appliedVersion || 0), 0),
  updatedAt: entry?.updatedAt || null,
  appliedAt: entry?.appliedAt || null,
  updatedBy: entry?.updatedBy || null
});

export const normalizeDeviceSecurityControlState = (state = {}) =>
  DEVICE_SECURITY_CONTROL_KEYS.reduce((normalized, key) => {
    normalized[key] = normalizeDeviceSecurityControlEntry(state?.[key]);
    return normalized;
  }, {});

