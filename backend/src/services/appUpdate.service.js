import crypto from "crypto";

import {
  APP_BUILD_CHANNELS,
  APP_BUILD_PLATFORMS,
  APP_BUILD_STATUSES,
  APP_BUILD_TYPES,
  AppBuild
} from "../models/AppBuild.js";
import { uploadFileToFirebase } from "../utils/firebaseFileUpload.js";

export const BORROWER_ANDROID_PACKAGE_NAME = "com.crednexa.app";

const HTTPS_URL_PATTERN = /^https:\/\//i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export const normalizeUpdateChannel = (channel) => {
  return String(channel || APP_BUILD_CHANNELS.PRODUCTION)
    .trim()
    .toLowerCase();
};

export const normalizePlatform = (platform) => String(platform || "").trim().toLowerCase();

export const normalizeBuildType = (buildType) => {
  return String(buildType || APP_BUILD_TYPES.RELEASE)
    .trim()
    .toLowerCase();
};

export const parsePositiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const isHttpsUrl = (value) => HTTPS_URL_PATTERN.test(String(value || "").trim());

export const calculateSha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

export const validateAppBuildIdentity = ({ platform, packageName, channel }) => {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedChannel = normalizeUpdateChannel(channel);
  const normalizedPackageName = String(packageName || "").trim();

  if (normalizedPlatform !== APP_BUILD_PLATFORMS.ANDROID) {
    return { error: "platform must be android" };
  }

  if (normalizedPackageName !== BORROWER_ANDROID_PACKAGE_NAME) {
    return { error: `packageName must be ${BORROWER_ANDROID_PACKAGE_NAME}` };
  }

  if (!Object.values(APP_BUILD_CHANNELS).includes(normalizedChannel)) {
    return { error: "channel must be production or qa" };
  }

  return {
    value: {
      platform: normalizedPlatform,
      packageName: normalizedPackageName,
      channel: normalizedChannel
    }
  };
};

export const validateBuildPayload = (body, { partial = false } = {}) => {
  const identity = validateAppBuildIdentity(body);
  if (identity.error && !partial) return identity;

  const versionCode = body.versionCode === undefined ? null : parsePositiveInteger(body.versionCode);
  const minimumSupportedVersionCode =
    body.minimumSupportedVersionCode === undefined ? null : parsePositiveInteger(body.minimumSupportedVersionCode);
  const buildType = normalizeBuildType(body.buildType);

  if (!partial || body.versionName !== undefined) {
    if (!String(body.versionName || "").trim()) return { error: "versionName is required" };
  }

  if (!partial || body.versionCode !== undefined) {
    if (!versionCode) return { error: "versionCode must be a positive integer" };
  }

  if (!partial || body.minimumSupportedVersionCode !== undefined) {
    if (!minimumSupportedVersionCode) return { error: "minimumSupportedVersionCode must be a positive integer" };
  }

  if (versionCode && minimumSupportedVersionCode && versionCode < minimumSupportedVersionCode) {
    return { error: "versionCode must be greater than or equal to minimumSupportedVersionCode" };
  }

  if (body.apkUrl !== undefined && !isHttpsUrl(body.apkUrl)) {
    return { error: "apkUrl must use HTTPS" };
  }

  if (body.apkSha256 !== undefined && !SHA256_PATTERN.test(String(body.apkSha256 || "").trim())) {
    return { error: "apkSha256 must be a valid SHA-256 hex digest" };
  }

  if (body.buildType !== undefined && !Object.values(APP_BUILD_TYPES).includes(buildType)) {
    return { error: "buildType must be release, debug, or qa" };
  }

  return {
    value: {
      ...(identity.value || {}),
      ...(body.versionName !== undefined ? { versionName: String(body.versionName).trim() } : {}),
      ...(versionCode ? { versionCode } : {}),
      ...(minimumSupportedVersionCode ? { minimumSupportedVersionCode } : {}),
      ...(body.releaseNotes !== undefined ? { releaseNotes: String(body.releaseNotes || "").trim() } : {}),
      ...(body.buildType !== undefined ? { buildType } : {}),
      ...(body.checksumRequired !== undefined ? { checksumRequired: body.checksumRequired === true || body.checksumRequired === "true" } : {})
    }
  };
};

export const buildApkStorageName = ({ packageName, channel, versionCode }) => {
  return `${packageName}-${channel}-v${versionCode}.apk`;
};

export const uploadBuildApk = async ({ file, buildData, actorId }) => {
  const apkSha256 = calculateSha256(file.buffer);
  const uploadedApk = await uploadFileToFirebase({
    file,
    folder: `app-builds/${buildData.platform}/${buildData.packageName}/${buildData.channel}`,
    storageName: buildApkStorageName(buildData),
    metadata: {
      uploadedBy: String(actorId || "system"),
      packageName: buildData.packageName,
      channel: buildData.channel,
      versionCode: String(buildData.versionCode)
    }
  });

  return {
    apkUrl: uploadedApk.fileUrl,
    apkSha256,
    apkStoragePath: uploadedApk.storagePath,
    apkSizeBytes: uploadedApk.size,
    apkMimeType: uploadedApk.mimeType
  };
};

export const findPublishedBuild = ({ platform, packageName, channel }) => {
  return AppBuild.findOne({
    platform,
    packageName,
    channel,
    status: APP_BUILD_STATUSES.PUBLISHED
  })
    .sort({ versionCode: -1, publishedAt: -1 })
    .lean();
};

export const buildUpdateCheckResponse = ({ build, currentVersionCode }) => {
  const forceUpdate = currentVersionCode < build.minimumSupportedVersionCode;
  const updateAvailable = forceUpdate || currentVersionCode < build.versionCode;

  return {
    platform: build.platform,
    packageName: build.packageName,
    channel: build.channel,
    updateAvailable,
    forceUpdate,
    latestVersion: build.versionName,
    latestVersionCode: build.versionCode,
    minimumSupportedVersionCode: build.minimumSupportedVersionCode,
    releaseNotes: build.releaseNotes || "",
    checksumRequired: Boolean(build.checksumRequired),
    ...(updateAvailable
      ? {
          apkUrl: build.apkUrl,
          apkSha256: build.apkSha256
        }
      : {})
  };
};

export const publishBuild = async ({ build, actorId }) => {
  await AppBuild.updateMany(
    {
      _id: { $ne: build._id },
      platform: build.platform,
      packageName: build.packageName,
      channel: build.channel,
      status: APP_BUILD_STATUSES.PUBLISHED
    },
    {
      $set: {
        status: APP_BUILD_STATUSES.ARCHIVED,
        updatedBy: actorId
      }
    }
  );

  build.status = APP_BUILD_STATUSES.PUBLISHED;
  build.publishedAt = new Date();
  build.publishedBy = actorId;
  build.updatedBy = actorId;
  return build.save();
};
