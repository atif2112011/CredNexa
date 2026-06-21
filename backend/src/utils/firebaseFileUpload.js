import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { firebaseStorage } from "../config/firebase.js";

const sanitizePathSegment = (value) => {
  return String(value || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
};

export const uploadFileToFirebase = async ({ file, folder, storageName, metadata = {} }) => {
  if (!file) return null;

  const safeStorageName = sanitizePathSegment(storageName || file.originalname || "file.bin");
  const storagePath = [folder, `${Date.now()}-${safeStorageName}`].join("/");
  const storageRef = ref(firebaseStorage, storagePath);

  await uploadBytes(storageRef, file.buffer, {
    contentType: file.mimetype,
    customMetadata: metadata
  });

  const fileUrl = await getDownloadURL(storageRef);

  return {
    fileUrl,
    storagePath,
    mimeType: file.mimetype,
    originalName: file.originalname,
    size: file.size,
    uploadedAt: new Date()
  };
};
