import mongoose from "mongoose";

import { env } from "./env.js";

let cachedConnection = null;
let cachedConnectionPromise = null;

export const connectDatabase = async () => {
  mongoose.set("strictQuery", true);

  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  if (!cachedConnectionPromise) {
    cachedConnectionPromise = mongoose
      .connect(env.mongodbUri, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000
      })
      .then((connection) => {
        cachedConnection = connection;
        console.log("MongoDB connected");
        return connection;
      })
      .catch((error) => {
        cachedConnection = null;
        cachedConnectionPromise = null;
        throw error;
      });
  }

  return cachedConnectionPromise;
};
