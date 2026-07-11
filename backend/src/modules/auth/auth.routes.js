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
import { verifyJwt } from "../../middleware/verifyJwt.js";

export const authRoutes = Router();

authRoutes.post("/login", loginAccount);
authRoutes.post("/refresh-token", refreshAccessToken);
authRoutes.post("/logout", logoutAccount);
authRoutes.post("/forgot-password/send-otp", forgotPasswordSendOtp);
authRoutes.post("/forgot-password/resend-otp", forgotPasswordResendOtp);
authRoutes.post("/forgot-password/verify-otp", forgotPasswordVerifyOtp);
authRoutes.post("/forgot-password/reset", resetForgotPassword);
authRoutes.post("/push-token", verifyJwt, registerAccountPushToken);
authRoutes.post("/push-token/deactivate", verifyJwt, deactivateAccountPushToken);
authRoutes.get("/me", verifyJwt, getCurrentAccount);
