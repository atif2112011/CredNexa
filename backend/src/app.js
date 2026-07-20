import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env.js";
import { connectDatabase } from "./config/database.js";
import { apiRoutes } from "./routes/index.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { generalRateLimiter } from "./middleware/rateLimiters.js";
import { healthRoutes } from "./modules/health/health.routes.js";

const SENSITIVE_LOG_FIELDS = new Set([
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "cookie",
  "authorization",
  "password",
  "newpassword",
  "confirmpassword",
  "resettoken",
  "otp",
  "mobile",
  "mobilenumber",
  "imei",
  "aadhaar",
  "aadhar",
  "paymentproof",
  "paymentproofimageurl",
  "enrollmenttoken",
  "fcmtoken"
]);
const MAX_LOG_DEPTH = 6;

const redactRequestBodyForLogs = (value, seen = new WeakSet(), depth = 0) => {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_LOG_DEPTH) return "[MaxDepth]";

  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactRequestBodyForLogs(entry, seen, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalizedKey = key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
      if (SENSITIVE_LOG_FIELDS.has(normalizedKey)) {
        return [key, "[REDACTED]"];
      }

      return [key, redactRequestBodyForLogs(entry, seen, depth + 1)];
    })
  );
};

morgan.token("body", (req) => {
  try {
    return JSON.stringify(redactRequestBodyForLogs(req.body));
  } catch (error) {
    return JSON.stringify({ logSerializationError: error.message });
  }
});

export const createApp = ({ apiBasePath = "/api" } = {}) => {
  const app = express();

  // Ensure DB is connected before every request (uses cached connection after first call)
  app.use(async (req, res, next) => {
    try {
      await connectDatabase();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  if (env.nodeEnv !== "test") {
    app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
    app.use(morgan("Request Body: :body"));
  }

  app.use(apiBasePath, generalRateLimiter, apiRoutes);
  app.use("/", healthRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export const app = createApp();
