import crypto from "crypto";

export const MAX_DIRECT_APK_BYTES = 500 * 1024 * 1024;
export const DIRECT_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
export const DIRECT_UPLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const DIRECT_UPLOAD_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const ALLOWED_APK_MIME_TYPES = new Set([
  "application/vnd.android.package-archive",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed"
]);

export const normalizeApkMimeType = (value) => {
  return String(value || "application/vnd.android.package-archive")
    .split(";")[0]
    .trim()
    .toLowerCase();
};

export const validateDirectApkDescriptor = ({ fileName, fileSize, mimeType }) => {
  const normalizedFileName = String(fileName || "").trim();
  const normalizedMimeType = normalizeApkMimeType(mimeType);
  const normalizedFileSize = Number(fileSize);

  if (!normalizedFileName.toLowerCase().endsWith(".apk")) {
    return { error: "APK file must use the .apk extension" };
  }

  if (!Number.isInteger(normalizedFileSize) || normalizedFileSize <= 0) {
    return { error: "APK file size must be a positive integer" };
  }

  if (normalizedFileSize > MAX_DIRECT_APK_BYTES) {
    return { error: "APK file must be 500 MB or smaller" };
  }

  if (!ALLOWED_APK_MIME_TYPES.has(normalizedMimeType)) {
    return { error: "APK file must use an Android package or ZIP MIME type" };
  }

  return {
    value: {
      fileName: normalizedFileName,
      fileSize: normalizedFileSize,
      mimeType: normalizedMimeType
    }
  };
};

export const hasApkZipSignature = (bytes) => {
  return Boolean(bytes?.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b);
};

export const validateStoredApkMetadata = ({ size, contentType }, { expectedSize, expectedMimeType }) => {
  if (Number(size) !== expectedSize) {
    return { error: "Uploaded APK size does not match the upload session" };
  }
  const storedMimeType = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (storedMimeType !== expectedMimeType) {
    return { error: "Uploaded APK MIME type does not match the upload session" };
  }
  return { value: { size: expectedSize, mimeType: expectedMimeType } };
};

export const inspectApkReadable = (readable) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const signature = [];
    let size = 0;

    readable.on("data", (chunk) => {
      size += chunk.length;
      hash.update(chunk);
      for (let index = 0; index < chunk.length && signature.length < 4; index += 1) {
        signature.push(chunk[index]);
      }
    });
    readable.on("error", reject);
    readable.on("end", () => {
      resolve({
        size,
        sha256: hash.digest("hex"),
        hasValidSignature: hasApkZipSignature(signature)
      });
    });
  });
};
