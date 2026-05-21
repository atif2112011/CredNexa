import { sendError } from "../utils/apiResponse.js";

export const errorHandler = (error, req, res, next) => {
  console.error("Unhandled request error", {
    method: req.method,
    path: req.originalUrl,
    message: error.message
  });

  return sendError(res, 500, "Internal server error");
};
