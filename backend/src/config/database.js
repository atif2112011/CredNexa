import mongoose from "mongoose";

import { env } from "./env.js";
let cachedConnection = null;

export const connectDatabase = async () => {
  mongoose.set("strictQuery", true);

  if (cachedConnection) {
    return cachedConnection;
  }

  const connection = await mongoose.connect(env.mongodbUri);
  cachedConnection = connection;
  console.log("MongoDB connected");
  return connection;
};
