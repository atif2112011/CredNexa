export const sendSuccess = (res, statusCode, message, data = null) => {
  console.log("API Success", {res, statusCode, message, data});
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

export const sendError = (res, statusCode, error) => {
  console.error("API Error", {
    statusCode,
    error
  });
  return res.status(statusCode).json({
    success: false,
    error
  });
};
