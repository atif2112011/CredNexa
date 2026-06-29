import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { firebaseStorage } from "../config/firebase.js";
import { compressByPurpose } from "./imageCompression.js";

const getImageExtension = (mimeType) => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "bin";
};

const buildStoragePath = ({ folder, tenantId, userId, fileName }) =>
  [folder, tenantId?.toString(), userId.toString(), fileName].filter(Boolean).join("/");

export const uploadImageToFirebase = async ({ file, folder, recordId, userId, tenantId, metadata = {}, purpose = null }) => {
  if (!file) return null;

  const uploadPayload = purpose
    ? await compressByPurpose(file.buffer, purpose)
    : {
        buffer: file.buffer,
        contentType: file.mimetype,
        extension: getImageExtension(file.mimetype)
      };

  const storagePath = buildStoragePath({
    folder,
    tenantId,
    userId,
    fileName: `${recordId.toString()}-${Date.now()}.${uploadPayload.extension}`
  });
  const storageRef = ref(firebaseStorage, storagePath);

  await uploadBytes(storageRef, uploadPayload.buffer, {
    contentType: uploadPayload.contentType,
    customMetadata: {
      userId: userId.toString(),
      ...(tenantId ? { tenantId: tenantId.toString() } : {}),
      ...(purpose
        ? {
            compressionPurpose: purpose,
            originalMimeType: file.mimetype,
            originalName: file.originalname || "",
            originalSize: String(file.size || 0),
            compressedSize: String(uploadPayload.buffer.length)
          }
        : {}),
      ...metadata
    }
  });

  const imageUrl = await getDownloadURL(storageRef);

  return {
    imageUrl,
    storagePath,
    mimeType: uploadPayload.contentType,
    originalName: file.originalname,
    originalMimeType: file.mimetype,
    originalSize: file.size,
    size: uploadPayload.buffer.length,
    uploadedAt: new Date()
  };
};
