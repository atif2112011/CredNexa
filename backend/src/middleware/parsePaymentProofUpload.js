import multer from "multer";

import { sendError } from "../utils/apiResponse.js";

export const PAYMENT_PROOF_FIELD_NAME = "proofImage";
export const UNLOCK_REQUEST_IMAGE_FIELD_NAME = "image";
export const TENANT_QR_IMAGE_FIELD_NAME = "qrImage";
export const ADMIN_CREDIT_PURCHASE_QR_IMAGE_FIELD_NAME = "adminCreditPurchaseQrImage";
export const MAX_PAYMENT_PROOF_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const createUpload = ({ fieldName, label }) =>
  multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_PAYMENT_PROOF_IMAGE_BYTES,
      files: 1,
      fields: 16,
      parts: 18
    },
    fileFilter: (req, file, cb) => {
      if (file.fieldname !== fieldName) {
        return cb(new Error(`Unsupported file field: ${file.fieldname}`));
      }

      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
        return cb(new Error(`${label} must be JPEG, PNG, or WebP`));
      }

      return cb(null, true);
    }
  }).single(fieldName);

const isValidImageSignature = (buffer, mimeType) => {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (mimeType === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }

  return false;
};

const createImageUploadParser = ({ fieldName, label }) => {
  const upload = createUpload({ fieldName, label });

  return (req, res, next) => {
    if (!req.is("multipart/form-data")) {
      return next();
    }

    return upload(req, res, (error) => {
      if (error) {
        const message = error.code === "LIMIT_FILE_SIZE" ? `${label} must be 5 MB or smaller` : error.message;
        return sendError(res, 400, message || `Invalid ${label.toLowerCase()} upload`);
      }

      if (req.file && !isValidImageSignature(req.file.buffer, req.file.mimetype)) {
        return sendError(res, 400, `${label} content does not match its MIME type`);
      }

      return next();
    });
  };
};

export const parsePaymentProofUpload = createImageUploadParser({
  fieldName: PAYMENT_PROOF_FIELD_NAME,
  label: "Payment proof image"
});

export const parseUnlockRequestImageUpload = createImageUploadParser({
  fieldName: UNLOCK_REQUEST_IMAGE_FIELD_NAME,
  label: "Unlock request image"
});

export const parseTenantQrImageUpload = createImageUploadParser({
  fieldName: TENANT_QR_IMAGE_FIELD_NAME,
  label: "Tenant QR image"
});

export const parseAdminCreditPurchaseQrImageUpload = createImageUploadParser({
  fieldName: ADMIN_CREDIT_PURCHASE_QR_IMAGE_FIELD_NAME,
  label: "Admin credit purchase QR image"
});
