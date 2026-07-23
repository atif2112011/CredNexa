const MAX_LOCATION_FUTURE_SKEW_MS = 5 * 60 * 1000;
const SIM_FIELDS = ["simOperator", "simSerial", "phoneNumber"];

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const buildWarning = (code, message) => ({ field: "location", code, message });

export const parseLocationTelemetry = ({ location, currentLocation, now = new Date() }) => {
  if (location === undefined) return { value: null, warnings: [] };

  if (!location || typeof location !== "object" || Array.isArray(location)) {
    return {
      value: null,
      warnings: [buildWarning("INVALID_LOCATION", "location must be an object")]
    };
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracyMeters = Number(location.accuracyMeters);
  const capturedAt = new Date(location.capturedAt);

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters < 0 ||
    Number.isNaN(capturedAt.getTime())
  ) {
    return {
      value: null,
      warnings: [
        buildWarning(
          "INVALID_LOCATION",
          "location requires valid latitude, longitude, non-negative accuracyMeters, and capturedAt"
        )
      ]
    };
  }

  if (capturedAt.getTime() > now.getTime() + MAX_LOCATION_FUTURE_SKEW_MS) {
    return {
      value: null,
      warnings: [buildWarning("FUTURE_LOCATION", "location capturedAt is too far in the future")]
    };
  }

  const currentCapturedAt = currentLocation?.capturedAt
    ? new Date(currentLocation.capturedAt)
    : null;
  if (
    currentCapturedAt &&
    !Number.isNaN(currentCapturedAt.getTime()) &&
    capturedAt.getTime() < currentCapturedAt.getTime()
  ) {
    return {
      value: null,
      warnings: [buildWarning("STALE_LOCATION", "location is older than the stored location")]
    };
  }

  return {
    value: {
      latitude,
      longitude,
      accuracyMeters,
      capturedAt,
      receivedAt: now
    },
    warnings: []
  };
};

export const applyDevicePingTelemetry = ({ device, body = {}, now = new Date() }) => {
  const telemetryWarnings = [];
  const locationResult = parseLocationTelemetry({
    location: body.location,
    currentLocation: device.lastLocation,
    now
  });

  telemetryWarnings.push(...locationResult.warnings);
  if (locationResult.value) {
    device.lastLocation = locationResult.value;
  }

  if (body.simInfo !== undefined) {
    if (!body.simInfo || typeof body.simInfo !== "object" || Array.isArray(body.simInfo)) {
      telemetryWarnings.push({
        field: "simInfo",
        code: "INVALID_SIM_INFO",
        message: "simInfo must be an object"
      });
    } else {
      const nextSimInfo = {
        simOperator: device.simInfo?.simOperator,
        simSerial: device.simInfo?.simSerial,
        phoneNumber: device.simInfo?.phoneNumber
      };
      let changed = false;

      for (const field of SIM_FIELDS) {
        if (!hasOwn(body.simInfo, field)) continue;
        const nextValue =
          body.simInfo[field] === null || body.simInfo[field] === undefined
            ? null
            : String(body.simInfo[field]).trim();
        if ((nextSimInfo[field] ?? null) !== nextValue) {
          nextSimInfo[field] = nextValue;
          changed = true;
        }
      }

      if (changed) {
        device.simInfo = nextSimInfo;
        device.simChangedAt = now;
      }
    }
  }

  return { telemetryWarnings };
};

export const sanitizePingEventPayload = (body = {}) => {
  const { location, simInfo, ...safePayload } = body;
  return {
    ...safePayload,
    locationReported: location !== undefined,
    simInfoReported: simInfo !== undefined
  };
};
