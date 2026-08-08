import crypto from "crypto";

import { getDownloadURL } from "firebase-admin/storage";

import { env } from "../config/env.js";
import { getFirebaseAdminBucket } from "../config/firebaseAdminStorage.js";
import { AppBuild, APP_BUILD_STATUSES } from "../models/AppBuild.js";
import {
  APP_BUILD_UPLOAD_STATUSES,
  AppBuildUploadSession
} from "../models/AppBuildUploadSession.js";
import {
  DIRECT_UPLOAD_CHUNK_SIZE,
  DIRECT_UPLOAD_SESSION_RETENTION_MS,
  DIRECT_UPLOAD_SESSION_TTL_MS,
  inspectApkReadable,
  validateStoredApkMetadata,
  validateDirectApkDescriptor
} from "./appBuildUploadValidation.js";
import {
  buildApkStorageName,
  validateBuildPayload
} from "./appUpdate.service.js";

export class AppBuildUploadError extends Error {
  constructor(message, { statusCode = 400, terminal = false, cleanup = false } = {}) {
    super(message);
    this.name = "AppBuildUploadError";
    this.statusCode = statusCode;
    this.terminal = terminal;
    this.cleanup = cleanup;
  }
}

const normalizeAllowedOrigin = (value) => {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "";
  }
};

export const resolveDirectUploadOrigin = (requestedOrigin) => {
  const allowedOrigins = env.directUploadAllowedOrigins
    .map(normalizeAllowedOrigin)
    .filter(Boolean);
  const normalizedRequestedOrigin = normalizeAllowedOrigin(requestedOrigin);

  if (!normalizedRequestedOrigin || !allowedOrigins.includes(normalizedRequestedOrigin)) {
    throw new AppBuildUploadError("Upload origin is not allowed", { statusCode: 403 });
  }

  return normalizedRequestedOrigin;
};

const getSessionDates = (now = new Date()) => ({
  expiresAt: new Date(now.getTime() + DIRECT_UPLOAD_SESSION_TTL_MS),
  purgeAt: new Date(now.getTime() + DIRECT_UPLOAD_SESSION_RETENTION_MS)
});

const getPermanentStoragePath = (session) => {
  const buildData = session.buildData;
  return [
    "app-builds",
    buildData.platform,
    buildData.packageName,
    buildData.channel,
    `${session._id}-${buildApkStorageName(buildData)}`
  ].join("/");
};

const safeDelete = async (file) => {
  try {
    await file.delete({ ignoreNotFound: true });
  } catch {
    // Staging lifecycle rules provide a final cleanup fallback.
  }
};

const markSessionFailure = async (session, error, stagingFile) => {
  if (error.cleanup) {
    await safeDelete(stagingFile);
  }

  if (error.terminal) {
    session.status = APP_BUILD_UPLOAD_STATUSES.FAILED;
    session.failureReason = error.message;
  } else {
    session.status = APP_BUILD_UPLOAD_STATUSES.PENDING;
  }
  await session.save();
};

export const createDirectBuildUploadSession = async ({
  body,
  actorId,
  requestedOrigin,
  bucket = getFirebaseAdminBucket()
}) => {
  const buildValidation = validateBuildPayload({
    ...body,
    buildType: body.buildType ?? "release",
    checksumRequired: body.checksumRequired ?? true
  });
  if (buildValidation.error) {
    throw new AppBuildUploadError(buildValidation.error);
  }

  const fileValidation = validateDirectApkDescriptor(body);
  if (fileValidation.error) {
    throw new AppBuildUploadError(fileValidation.error);
  }

  const existingBuild = await AppBuild.exists({
    platform: buildValidation.value.platform,
    packageName: buildValidation.value.packageName,
    channel: buildValidation.value.channel,
    versionCode: buildValidation.value.versionCode
  });
  if (existingBuild) {
    throw new AppBuildUploadError("App build versionCode already exists for this app channel", {
      statusCode: 409
    });
  }

  const uploadOrigin = resolveDirectUploadOrigin(requestedOrigin);
  const dates = getSessionDates();
  const session = new AppBuildUploadSession({
    createdBy: actorId,
    buildData: buildValidation.value,
    fileName: fileValidation.value.fileName,
    expectedSize: fileValidation.value.fileSize,
    expectedMimeType: fileValidation.value.mimeType,
    storagePath: `app-builds/staging/${crypto.randomUUID()}.apk`,
    uploadOrigin,
    ...dates
  });

  const stagingFile = bucket.file(session.storagePath);
  const [uploadUrl] = await stagingFile.createResumableUpload({
    origin: uploadOrigin,
    metadata: {
      contentType: session.expectedMimeType,
      contentLength: String(session.expectedSize),
      metadata: {
        uploadSessionId: String(session._id),
        uploadedBy: String(actorId)
      }
    }
  });

  await session.save();

  return {
    uploadSessionId: session._id,
    uploadUrl,
    expiresAt: session.expiresAt,
    chunkSize: DIRECT_UPLOAD_CHUNK_SIZE
  };
};

const getCompletedBuild = async (session) => {
  if (!session.appBuildId) return null;
  return AppBuild.findById(session.appBuildId);
};

const markCompleted = async (session, appBuild) => {
  session.status = APP_BUILD_UPLOAD_STATUSES.COMPLETED;
  session.appBuildId = appBuild._id;
  session.failureReason = undefined;
  await session.save();
  return appBuild;
};

export const completeDirectBuildUploadSession = async ({
  sessionId,
  actorId,
  bucket = getFirebaseAdminBucket()
}) => {
  const session = await AppBuildUploadSession.findOne({
    _id: sessionId,
    createdBy: actorId
  });
  if (!session) {
    throw new AppBuildUploadError("Build upload session not found", { statusCode: 404 });
  }

  if (session.status === APP_BUILD_UPLOAD_STATUSES.COMPLETED) {
    const completedBuild = await getCompletedBuild(session);
    if (completedBuild) return completedBuild;
    throw new AppBuildUploadError("Completed upload is missing its build record", { statusCode: 409 });
  }

  const stagingFile = bucket.file(session.storagePath);
  if (session.expiresAt.getTime() <= Date.now()) {
    session.status = APP_BUILD_UPLOAD_STATUSES.EXPIRED;
    session.failureReason = "Build upload session expired";
    await session.save();
    await safeDelete(stagingFile);
    throw new AppBuildUploadError("Build upload session expired", { statusCode: 410 });
  }

  if (session.status === APP_BUILD_UPLOAD_STATUSES.FAILED) {
    throw new AppBuildUploadError(session.failureReason || "Build upload session failed", {
      statusCode: 409
    });
  }

  if (session.status === APP_BUILD_UPLOAD_STATUSES.FINALIZING) {
    throw new AppBuildUploadError("Build upload is already being finalized", { statusCode: 409 });
  }

  session.status = APP_BUILD_UPLOAD_STATUSES.FINALIZING;
  await session.save();

  let permanentFile;
  try {
    const [exists] = await stagingFile.exists();
    if (!exists) {
      throw new AppBuildUploadError("Uploaded APK was not found in Firebase Storage", {
        statusCode: 409
      });
    }

    const [metadata] = await stagingFile.getMetadata();
    const metadataValidation = validateStoredApkMetadata(metadata, {
      expectedSize: session.expectedSize,
      expectedMimeType: session.expectedMimeType
    });
    if (metadataValidation.error) {
      throw new AppBuildUploadError(metadataValidation.error, {
        terminal: true,
        cleanup: true
      });
    }

    const inspection = await inspectApkReadable(stagingFile.createReadStream());
    if (inspection.size !== session.expectedSize) {
      throw new AppBuildUploadError("Uploaded APK is incomplete", {
        terminal: true,
        cleanup: true
      });
    }
    if (!inspection.hasValidSignature) {
      throw new AppBuildUploadError("APK file content is not a valid ZIP/APK package", {
        terminal: true,
        cleanup: true
      });
    }

    const permanentStoragePath = getPermanentStoragePath(session);
    session.permanentStoragePath = permanentStoragePath;
    await session.save();

    permanentFile = bucket.file(permanentStoragePath);
    const [permanentExists] = await permanentFile.exists();
    if (!permanentExists) {
      await stagingFile.copy(permanentFile);
    }

    const downloadToken = crypto.randomUUID();
    await permanentFile.setMetadata({
      contentType: session.expectedMimeType,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        uploadedBy: String(actorId),
        packageName: session.buildData.packageName,
        channel: session.buildData.channel,
        versionCode: String(session.buildData.versionCode)
      }
    });
    const apkUrl = await getDownloadURL(permanentFile);

    let appBuild;
    try {
      appBuild = await AppBuild.create({
        ...session.buildData.toObject(),
        apkUrl,
        apkSha256: inspection.sha256,
        apkStoragePath: permanentStoragePath,
        apkSizeBytes: session.expectedSize,
        apkMimeType: session.expectedMimeType,
        status: APP_BUILD_STATUSES.DRAFT,
        createdBy: actorId,
        updatedBy: actorId
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;

      const existingBuild = await AppBuild.findOne({
        platform: session.buildData.platform,
        packageName: session.buildData.packageName,
        channel: session.buildData.channel,
        versionCode: session.buildData.versionCode
      });
      if (!existingBuild || existingBuild.apkStoragePath !== permanentStoragePath) {
        await safeDelete(permanentFile);
        throw new AppBuildUploadError("App build versionCode already exists for this app channel", {
          statusCode: 409,
          terminal: true,
          cleanup: true
        });
      }
      appBuild = existingBuild;
    }

    await safeDelete(stagingFile);
    return markCompleted(session, appBuild);
  } catch (error) {
    const uploadError =
      error instanceof AppBuildUploadError
        ? error
        : new AppBuildUploadError(error.message || "Unable to finalize build upload", {
            statusCode: 500
          });
    await markSessionFailure(session, uploadError, stagingFile);
    throw uploadError;
  }
};
