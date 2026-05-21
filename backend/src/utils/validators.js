import mongoose from "mongoose";

export const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

export const hasRequiredFields = (body, fields) => {
  return fields.every((field) => body[field] !== undefined && body[field] !== null && body[field] !== "");
};
