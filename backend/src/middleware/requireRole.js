import { sendError } from "../utils/apiResponse.js";

export const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.auth || req.auth.tokenType !== "account") {
        return sendError(res, 401, "Account authentication is required");
      }

      if (!allowedRoles.includes(req.auth.role)) {
        return sendError(res, 403, "You are not authorized to perform this action");
      }

      return next();
    } catch (error) {
      return sendError(res, 500, error.message || "Internal server error");
    }
  };
};
