import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import sharp from "sharp";

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

export const uploadCompressedQrImageToFirebase = async ({ file, folder, recordId, userId, metadata = {} }) => {
  if (!file) return null;

  const compressedBuffer = await sharp(file.buffer)
    .rotate()
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside",
      withoutEnlargement: true
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true
    })
    .toBuffer();

  const storagePath = [
    folder,
    userId.toString(),
    `${recordId.toString()}-${Date.now()}.png`
  ].join("/");
  const storageRef = ref(firebaseStorage, storagePath);

  await uploadBytes(storageRef, compressedBuffer, {
    contentType: "image/png",
    customMetadata: {
      userId: userId.toString(),
      originalMimeType: file.mimetype,
      originalName: file.originalname || "",
      originalSize: String(file.size || 0),
      compressedSize: String(compressedBuffer.length),
      ...metadata
    }
  });

  const imageUrl = await getDownloadURL(storageRef);

  return {
    imageUrl,
    storagePath,
    mimeType: "image/png",
    originalName: file.originalname,
    originalMimeType: file.mimetype,
    originalSize: file.size,
    size: compressedBuffer.length,
    uploadedAt: new Date()
  };
};
