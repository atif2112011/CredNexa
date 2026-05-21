import { sendError } from "../utils/apiResponse.js";

export const requireTokenType = (tokenType) => {
  return async (req, res, next) => {
    try {
      if (!req.auth || req.auth.tokenType !== tokenType) {
        return sendError(res, 403, `${tokenType} token is required`);
      }

      return next();
    } catch (error) {
      return sendError(res, 500, error.message || "Internal server error");
    }
  };
};
