import { getApp, getApps, initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";
import { env } from "./env.js";

const firebaseConfig = {
  apiKey: env.firebaseApiKey,
  authDomain: env.firebaseAuthDomain,
  projectId: env.firebaseProjectId,
  storageBucket: env.firebaseStorageBucket,
  messagingSenderId: env.firebaseMessagingSenderId,
  appId: env.firebaseAppId,
  measurementId: env.firebaseMeasurementId
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseStorage = getStorage(firebaseApp);
