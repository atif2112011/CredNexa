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
  otpProvider: (process.env.OTP_PROVIDER || "mock").trim().toLowerCase(),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
  twilioDefaultCountryCode: process.env.TWILIO_DEFAULT_COUNTRY_CODE || "+91",
  deviceIntegrityMode: (process.env.DEVICE_INTEGRITY_MODE || "observe").trim().toLowerCase(),
  playIntegrityPackageName: process.env.PLAY_INTEGRITY_PACKAGE_NAME || "com.crednexa.app",
  playIntegrityChallengeTtlSeconds: Number(process.env.PLAY_INTEGRITY_CHALLENGE_TTL_SECONDS || 600),
  playIntegrityRequiredDeviceVerdict: process.env.PLAY_INTEGRITY_REQUIRED_DEVICE_VERDICT || "MEETS_DEVICE_INTEGRITY",
  playIntegrityRequirePlayRecognizedApp: process.env.PLAY_INTEGRITY_REQUIRE_PLAY_RECOGNIZED_APP === "true",
  playIntegrityServiceAccountJson: process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON,
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
