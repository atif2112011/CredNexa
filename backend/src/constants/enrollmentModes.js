export const ENROLLMENT_MODES = Object.freeze({
  DEVICE_OWNER_QR: "DEVICE_OWNER_QR",
  RUNNING_APP: "RUNNING_APP"
});

// Older rows and clients predate enrollmentMode; they always mean owner provisioning.
export const getEnrollmentMode = (record) => record?.enrollmentMode || ENROLLMENT_MODES.DEVICE_OWNER_QR;

export const isRunningDevice = (record) => getEnrollmentMode(record) === ENROLLMENT_MODES.RUNNING_APP;
