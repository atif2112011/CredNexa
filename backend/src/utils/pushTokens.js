import crypto from "crypto";

export const hashFcmToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

export const isInvalidFcmTokenError = (error) => {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token" ||
    message.includes("registration-token-not-registered") ||
    message.includes("invalid-registration-token")
  );
};
