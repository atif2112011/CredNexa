import dotenv from "dotenv";

dotenv.config();

const requiredEnv = ["MONGODB_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`${key} is required`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.APP_PORT || process.env.PORT || 5000),
  mongodbUri: process.env.MONGODB_URI,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || "refreshToken",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : ["http://localhost:3000"],
  cronSecret: process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET,
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 300),
  otpRateLimitWindowMs: Number(process.env.OTP_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  otpRateLimitMaxRequests: Number(process.env.OTP_RATE_LIMIT_MAX_REQUESTS || 5),
  otpProvider: (process.env.OTP_PROVIDER || "mock").trim().toLowerCase(),
  otpExpiresInSeconds: Number(process.env.OTP_EXPIRES_IN_SECONDS || 900),
  otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 30),
  msg91AuthKey: process.env.MSG91_AUTH_KEY,
  msg91OtpTemplateId: process.env.MSG91_OTP_TEMPLATE_ID,
  msg91DefaultCountryCode: process.env.MSG91_DEFAULT_COUNTRY_CODE || "91",
  msg91ResendRetryType: process.env.MSG91_RESEND_RETRY_TYPE || "text",
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_PASSWORD,
  mailFrom: process.env.MAIL_FROM,
  deviceIntegrityMode: (process.env.DEVICE_INTEGRITY_MODE || "observe").trim().toLowerCase(),
  playIntegrityPackageName: process.env.PLAY_INTEGRITY_PACKAGE_NAME || "com.crednexa.app",
  playIntegrityChallengeTtlSeconds: Number(process.env.PLAY_INTEGRITY_CHALLENGE_TTL_SECONDS || 600),
  playIntegrityRequiredDeviceVerdict: process.env.PLAY_INTEGRITY_REQUIRED_DEVICE_VERDICT || "MEETS_DEVICE_INTEGRITY",
  playIntegrityRequirePlayRecognizedApp: process.env.PLAY_INTEGRITY_REQUIRE_PLAY_RECOGNIZED_APP === "true",
  playIntegrityServiceAccountJson: process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON,
  manualOverridePrivateKey: process.env.MANUAL_OVERRIDE_PRIVATE_KEY,
  manualOverridePublicKeyId: process.env.MANUAL_OVERRIDE_PUBLIC_KEY_ID || "manual-override-v1",
  manualOverrideSigningAlgorithm: process.env.MANUAL_OVERRIDE_SIGNING_ALGORITHM || "RS256",
  manualOverrideAllowInsecureKeySize: process.env.MANUAL_OVERRIDE_ALLOW_INSECURE_KEY_SIZE === "true",
  manualOverrideTokenValidityDays: Number(process.env.MANUAL_OVERRIDE_TOKEN_VALIDITY_DAYS || 30),
  manualOverrideRenewalWindowDays: Number(process.env.MANUAL_OVERRIDE_RENEWAL_WINDOW_DAYS || 7),
  firebaseAdminProjectId:
    process.env.ADMIN_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.APP_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID,
  firebaseAdminClientEmail: process.env.ADMIN_FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  firebaseAdminPrivateKey: process.env.ADMIN_FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  // Firebase configuration
  firebaseApiKey: process.env.APP_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  firebaseAuthDomain: process.env.APP_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  firebaseProjectId: process.env.APP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.APP_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  firebaseMessagingSenderId:
    process.env.APP_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  firebaseAppId: process.env.APP_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
  firebaseMeasurementId: process.env.APP_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID,
  firebaseFunctionsRegion: process.env.FUNCTIONS_REGION || process.env.FIREBASE_FUNCTIONS_REGION || "asia-south1",
  firebaseSchedulerTimeZone:
    process.env.SCHEDULER_TIME_ZONE || process.env.FIREBASE_SCHEDULER_TIME_ZONE || "UTC"
};
