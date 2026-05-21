import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { sendError } from "../utils/apiResponse.js";

export const verifyJwt = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(res, 401, "Authentication token is required");
    }

    const token = authHeader.replace("Bearer ", "");
    const payload = jwt.verify(token, env.jwtAccessSecret);

    req.auth = payload;
    return next();
  } catch (error) {
    return sendError(res, 401, "Invalid or expired token");
  }
};
