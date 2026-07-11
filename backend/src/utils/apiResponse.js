
const SENSITIVE_LOG_FIELDS = new Set(["accesstoken", "refreshtoken", "resettoken", "password", "newpassword", "confirmpassword", "otp"]);

const redactForLogs = (value) => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactForLogs);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalizedKey = key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
      if (SENSITIVE_LOG_FIELDS.has(normalizedKey)) {
        return [key, "[REDACTED]"];
      }

      return [key, redactForLogs(entry)];
    })
  );
};

export const sendSuccess = (res, statusCode, message, data = null) => {
  console.log("API Success", {
    statusCode,
    message,
    data: JSON.stringify(redactForLogs(data))
  });
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

export const sendError = (res, statusCode, error) => {
  console.error("API Error", {
    statusCode,
    error
  });
  return res.status(statusCode).json({
    success: false,
    error
  });
};
