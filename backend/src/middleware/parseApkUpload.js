import multer from "multer";

import { sendError } from "../utils/apiResponse.js";

export const APK_FILE_FIELD_NAME = "apkFile";
export const MAX_APK_BYTES = 150 * 1024 * 1024;

const ALLOWED_APK_MIME_TYPES = new Set([
  "application/vnd.android.package-archive",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed"
]);

const apkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_APK_BYTES,
    files: 1,
    fields: 20,
    parts: 24
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== APK_FILE_FIELD_NAME) {
      return cb(new Error(`Unsupported file field: ${file.fieldname}`));
    }

    if (!ALLOWED_APK_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("APK file must use an Android package or ZIP MIME type"));
    }

    return cb(null, true);
  }
}).single(APK_FILE_FIELD_NAME);

const hasZipSignature = (buffer) => {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
};

export const parseApkUpload = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    return next();
  }

  return apkUpload(req, res, (error) => {
    if (error) {
      const message = error.code === "LIMIT_FILE_SIZE" ? "APK file must be 150 MB or smaller" : error.message;
      return sendError(res, 400, message || "Invalid APK upload");
    }

    // APK files are ZIP containers. This lightweight check rejects obvious
    // non-APK content before it is uploaded and trusted by borrower devices.
    if (req.file && !hasZipSignature(req.file.buffer)) {
      return sendError(res, 400, "APK file content is not a valid ZIP/APK package");
    }

    return next();
  });
};
