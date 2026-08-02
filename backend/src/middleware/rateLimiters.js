import crypto from "crypto";
import net from "net";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { env } from "../config/env.js";

const getPositiveNumber = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);

const normalizeRateLimitValue = (value) => String(value || "").trim().replace(/\D/g, "");

const readHeader = (req, name) => {
  if (typeof req.get === "function") return req.get(name);
  return req.headers?.[name.toLowerCase()];
};

const secretsMatch = (received, expected) => {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(String(expected));
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
};

const normalizeIp = (value) => String(value || "").split(",")[0].trim();

export const resolveRateLimitClientIp = (req, proxySecret = env.backendProxySecret) => {
  const forwardedClientIp = normalizeIp(readHeader(req, "x-crednexa-client-ip"));
  const receivedProxySecret = readHeader(req, "x-crednexa-proxy-secret");

  if (
    net.isIP(forwardedClientIp) &&
    secretsMatch(receivedProxySecret, proxySecret)
  ) {
    return forwardedClientIp;
  }

  return normalizeIp(req.ip || req.socket?.remoteAddress) || "unknown";
};

const getOtpSubject = (req) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  return (
    normalizeRateLimitValue(body.mobile) ||
    normalizeRateLimitValue(body.supportPhone) ||
    String(body.verificationSessionId || "").trim() ||
    "anonymous"
  );
};

const createRateLimitHandler = (message) => (req, res, _next, options) => {
  const retryAfterSeconds = Math.max(Math.ceil((req.rateLimit?.resetTime?.getTime() - Date.now()) / 1000), 0);

  return res.status(options.statusCode).json({
    success: false,
    error: message,
    data: {
      retryAfterSeconds
    }
  });
};

export const generalRateLimiter = rateLimit({
  windowMs: getPositiveNumber(env.rateLimitWindowMs, 15 * 60 * 1000),
  limit: getPositiveNumber(env.rateLimitMaxRequests, 300),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(resolveRateLimitClientIp(req)),
  message: "Too many requests. Please try again later.",
  handler: createRateLimitHandler("Too many requests. Please try again later.")
});

export const otpRateLimiter = rateLimit({
  windowMs: getPositiveNumber(env.otpRateLimitWindowMs, 15 * 60 * 1000),
  limit: getPositiveNumber(env.otpRateLimitMaxRequests, 5),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.method}:${req.baseUrl}${req.path}:${getOtpSubject(req)}`,
  message: "Too many OTP requests. Please try again later.",
  handler: createRateLimitHandler("Too many OTP requests. Please try again later.")
});
