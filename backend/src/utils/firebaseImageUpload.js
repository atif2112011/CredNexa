import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { firebaseStorage } from "../config/firebase.js";

const getImageExtension = (mimeType) => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "bin";
};

export const uploadImageToFirebase = async ({ file, folder, recordId, userId, tenantId, metadata = {} }) => {
  if (!file) return null;

  const extension = getImageExtension(file.mimetype);
  const storagePath = [
    folder,
    tenantId.toString(),
    userId.toString(),
    `${recordId.toString()}-${Date.now()}.${extension}`
  ].join("/");
  const storageRef = ref(firebaseStorage, storagePath);

  await uploadBytes(storageRef, file.buffer, {
    contentType: file.mimetype,
    customMetadata: {
      userId: userId.toString(),
      tenantId: tenantId.toString(),
      ...metadata
    }
  });

  const imageUrl = await getDownloadURL(storageRef);

  return {
    imageUrl,
    storagePath,
    mimeType: file.mimetype,
    originalName: file.originalname,
    size: file.size,
    uploadedAt: new Date()
  };
};
