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
  port: Number(process.env.PORT || 5000),
  mongodbUri: process.env.MONGODB_URI,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || "refreshToken",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : ["http://localhost:3000"],
  vercelDeploy: process.env.VERCEL === "true",
  // Shared secret used by Vercel cron paths, passed as a query parameter in vercel.json.
  vercelCronSecret: process.env.VERCEL_CRON_SECRET,
  otpProvider: (process.env.OTP_PROVIDER || "mock").trim().toLowerCase(),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
  twilioDefaultCountryCode: process.env.TWILIO_DEFAULT_COUNTRY_CODE || "+91",
  partnerLeadWebhookUrl: process.env.PARTNER_LEAD_WEBHOOK_URL,
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
  firebaseAdminProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  firebaseAdminClientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  firebaseAdminPrivateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  // Firebase configuration
  firebaseApiKey: process.env.FIREBASE_API_KEY,
  firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  firebaseAppId: process.env.FIREBASE_APP_ID,
  firebaseMeasurementId: process.env.FIREBASE_MEASUREMENT_ID,
  nodeEnv: process.env.NODE_ENV=="development"?"development":"production"
};
