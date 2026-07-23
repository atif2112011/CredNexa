export const DEVICE_RESTRICTION_KEYS = Object.freeze([
  "dialer",
  "camera",
  "whatsapp",
  "youtube",
  "playStore"
]);

export const DEFAULT_DEVICE_RESTRICTIONS = Object.freeze(
  DEVICE_RESTRICTION_KEYS.reduce((restrictions, key) => {
    restrictions[key] = false;
    return restrictions;
  }, {})
);

export const isDeviceRestrictionKey = (value) => {
  return DEVICE_RESTRICTION_KEYS.includes(String(value || ""));
};

export const normalizeDeviceRestrictions = (restrictions = {}) => {
  return DEVICE_RESTRICTION_KEYS.reduce((normalized, key) => {
    normalized[key] = Boolean(restrictions?.[key]);
    return normalized;
  }, {});
};

export const normalizeDeviceRestrictionState = (restrictionState = {}) => ({
  desired: normalizeDeviceRestrictions(restrictionState?.desired),
  applied: normalizeDeviceRestrictions(restrictionState?.applied),
  desiredVersion: Math.max(Number(restrictionState?.desiredVersion || 0), 0),
  appliedVersion: Math.max(Number(restrictionState?.appliedVersion || 0), 0),
  updatedAt: restrictionState?.updatedAt || null,
  appliedAt: restrictionState?.appliedAt || null,
  updatedBy: restrictionState?.updatedBy || null
});
