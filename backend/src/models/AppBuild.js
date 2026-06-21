import mongoose from "mongoose";

export const APP_BUILD_CHANNELS = Object.freeze({
  PRODUCTION: "production",
  QA: "qa"
});

export const APP_BUILD_PLATFORMS = Object.freeze({
  ANDROID: "android"
});

export const APP_BUILD_STATUSES = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived"
});

export const APP_BUILD_TYPES = Object.freeze({
  RELEASE: "release",
  DEBUG: "debug",
  QA: "qa"
});

const appBuildSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: Object.values(APP_BUILD_PLATFORMS),
      required: true,
      trim: true,
      lowercase: true
    },
    packageName: {
      type: String,
      required: true,
      trim: true
    },
    channel: {
      type: String,
      enum: Object.values(APP_BUILD_CHANNELS),
      default: APP_BUILD_CHANNELS.PRODUCTION,
      required: true,
      trim: true,
      lowercase: true
    },
    versionName: {
      type: String,
      required: true,
      trim: true
    },
    versionCode: {
      type: Number,
      required: true,
      min: 1
    },
    minimumSupportedVersionCode: {
      type: Number,
      required: true,
      min: 1
    },
    apkUrl: {
      type: String,
      required: true,
      trim: true
    },
    apkSha256: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    apkStoragePath: {
      type: String,
      trim: true
    },
    apkSizeBytes: {
      type: Number,
      required: true,
      min: 1
    },
    apkMimeType: {
      type: String,
      required: true,
      trim: true
    },
    releaseNotes: {
      type: String,
      trim: true,
      default: ""
    },
    buildType: {
      type: String,
      enum: Object.values(APP_BUILD_TYPES),
      default: APP_BUILD_TYPES.RELEASE,
      required: true,
      trim: true,
      lowercase: true
    },
    checksumRequired: {
      type: Boolean,
      default: true
    },
    status: {
      type: String,
      enum: Object.values(APP_BUILD_STATUSES),
      default: APP_BUILD_STATUSES.DRAFT,
      required: true,
      index: true
    },
    publishedAt: Date,
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  { timestamps: true }
);

// One build number can exist only once per app/channel, while publish logic
// separately guarantees one currently published build per app/channel.
appBuildSchema.index(
  { platform: 1, packageName: 1, channel: 1, versionCode: 1 },
  { unique: true }
);
appBuildSchema.index({ platform: 1, packageName: 1, channel: 1, status: 1 });

export const AppBuild = mongoose.model("AppBuild", appBuildSchema);
