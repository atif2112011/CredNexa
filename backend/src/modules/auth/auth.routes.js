import { Router } from "express";

import {
  deactivateAccountPushToken,
  forgotPasswordResendOtp,
  forgotPasswordSendOtp,
  forgotPasswordVerifyOtp,
  getCurrentAccount,
  loginAccount,
  logoutAccount,
  refreshAccessToken,
  registerAccountPushToken,
  resetForgotPassword
} from "./auth.controller.js";
import { otpRateLimiter } from "../../middleware/rateLimiters.js";
import { verifyJwt } from "../../middleware/verifyJwt.js";

export const authRoutes = Router();

authRoutes.post("/login", loginAccount);
authRoutes.post("/refresh-token", refreshAccessToken);
authRoutes.post("/logout", logoutAccount);
authRoutes.post("/forgot-password/send-otp", otpRateLimiter, forgotPasswordSendOtp);
authRoutes.post("/forgot-password/resend-otp", otpRateLimiter, forgotPasswordResendOtp);
authRoutes.post("/forgot-password/verify-otp", otpRateLimiter, forgotPasswordVerifyOtp);
authRoutes.post("/forgot-password/reset", resetForgotPassword);
authRoutes.post("/push-token", verifyJwt, registerAccountPushToken);
authRoutes.post("/push-token/deactivate", verifyJwt, deactivateAccountPushToken);
authRoutes.get("/me", verifyJwt, getCurrentAccount);
