
const SENSITIVE_LOG_FIELDS = new Set(["accesstoken", "refreshtoken", "resettoken", "password", "newpassword", "confirmpassword", "otp"]);
const MAX_LOG_DEPTH = 6;

const redactForLogs = (value, seen = new WeakSet(), depth = 0) => {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_LOG_DEPTH) return "[MaxDepth]";

  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactForLogs(entry, seen, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalizedKey = key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
      if (SENSITIVE_LOG_FIELDS.has(normalizedKey)) {
        return [key, "[REDACTED]"];
      }

      return [key, redactForLogs(entry, seen, depth + 1)];
    })
  );
};

const stringifyForLogs = (value) => {
  try {
    return JSON.stringify(redactForLogs(value));
  } catch (error) {
    return JSON.stringify({
      logSerializationError: error.message,
      valueType: value?.constructor?.name || typeof value
    });
  }
};

const getErrorMessage = (error) => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error || "Internal server error");
};

export const sendSuccess = (res, statusCode, message, data = null) => {
  console.log("API Success", {
    statusCode,
    message,
    data: stringifyForLogs(data)
  });
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

export const sendError = (res, statusCode, error, data = null) => {
  const errorMessage = getErrorMessage(error);
  console.error("API Error", {
    statusCode,
    error: errorMessage,
    data: stringifyForLogs(data),
    stack: error instanceof Error ? error.stack : undefined
  });
  return res.status(statusCode).json({
    success: false,
    error: errorMessage,
    ...(data ? { data } : {})
  });
};
