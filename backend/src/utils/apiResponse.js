export const sendSuccess = (res, statusCode, message, data = null) => {
  if (env.nodeEnv == "production") {
    console.log("API Success", {res, statusCode, message, data:JSON.stringify(data)});
  }
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
