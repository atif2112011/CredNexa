import mongoose from "mongoose";

import { sendSuccess } from "../../utils/apiResponse.js";

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
