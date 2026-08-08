import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

import { env } from "./env.js";

const FIREBASE_STORAGE_ADMIN_APP_NAME = "app-build-storage-admin";

const buildServiceAccount = () => {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    return JSON.parse(serviceAccountJson);
  }

  if (!env.firebaseAdminProjectId || !env.firebaseAdminClientEmail || !env.firebaseAdminPrivateKey) {
    return null;
  }

  return {
    projectId: env.firebaseAdminProjectId,
    clientEmail: env.firebaseAdminClientEmail,
    privateKey: env.firebaseAdminPrivateKey.replace(/\\n/g, "\n")
  };
};

const getFirebaseStorageAdminApp = () => {
  const existingApp = getApps().find((app) => app.name === FIREBASE_STORAGE_ADMIN_APP_NAME);
  if (existingApp) return existingApp;

  const serviceAccount = buildServiceAccount();
  return initializeApp(
    {
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      storageBucket: env.firebaseStorageBucket
    },
    FIREBASE_STORAGE_ADMIN_APP_NAME
  );
};

export const getFirebaseAdminBucket = () => {
  if (!env.firebaseStorageBucket) {
    throw new Error("APP_FIREBASE_STORAGE_BUCKET is required for direct build uploads");
  }

  return getStorage(getFirebaseStorageAdminApp()).bucket(env.firebaseStorageBucket);
};
