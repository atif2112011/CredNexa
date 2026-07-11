import { OTP_EXPIRES_IN_SECONDS, resendOtp, sendOtp, verifyOtpCode } from "./otp.service.js";

export const PASSWORD_RESET_OTP_PURPOSE = "password_reset";
export const PASSWORD_RESET_FLOW_TYPE = "PASSWORD_RESET";
export const PASSWORD_RESET_OTP_EXPIRES_IN_SECONDS = OTP_EXPIRES_IN_SECONDS;

export const sendPasswordResetOtp = async ({ mobile, account, role }) => {
  return sendOtp({
    mobile,
    purpose: PASSWORD_RESET_OTP_PURPOSE,
    flowType: PASSWORD_RESET_FLOW_TYPE,
    metadata: {
      accountId: account._id.toString(),
      role
    }
  });
};

export const resendPasswordResetOtp = async ({ otpRecord, retryType }) => {
  return resendOtp({ otpRecord, retryType });
};

export const verifyPasswordResetOtp = async ({ otpRecord, otp }) => {
  return verifyOtpCode({ otpRecord, otp });
};
