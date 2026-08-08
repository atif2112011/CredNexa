import mongoose from "mongoose";

import { sendTestMail } from "../../services/mail.service.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";

export const getHealth = async (req, res) => {
  try {
    return sendSuccess(res, 200, "Server is healthy", {
      uptime: process.uptime(),
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
};

export const testMailDelivery = async (req, res) => {
  try {
    const result = await sendTestMail();

    return sendSuccess(res, 200, "Test email sent successfully", {
      messageId: result.messageId
    });
  } catch (error) {
    console.error("Failed to send test email", {
      errorCode: error.code || "MAIL_SEND_FAILED",
      smtpCommand: error.command || null,
      responseCode: error.responseCode || null
    });

    return sendError(res, 500, "Unable to send test email");
  }
};
