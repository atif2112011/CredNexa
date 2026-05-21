import { sendError } from "../utils/apiResponse.js";

export const notFoundHandler = (req, res) => {
  return sendError(res, 404, "Route not found");
};
