import mongoose from "mongoose";

export const APP_BUILD_UPLOAD_STATUSES = Object.freeze({
  PENDING: "pending",
  FINALIZING: "finalizing",
  COMPLETED: "completed",
  FAILED: "failed",
  EXPIRED: "expired"
});

const appBuildUploadSessionSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true
    },
    buildData: {
      platform: { type: String, required: true },
      packageName: { type: String, required: true },
      channel: { type: String, required: true },
      versionName: { type: String, required: true },
      versionCode: { type: Number, required: true },
      minimumSupportedVersionCode: { type: Number, required: true },
      buildType: { type: String, required: true },
      checksumRequired: { type: Boolean, required: true },
      releaseNotes: { type: String, default: "" }
    },
    fileName: {
      type: String,
      required: true,
      trim: true
    },
    expectedSize: {
      type: Number,
      required: true,
      min: 1
    },
    expectedMimeType: {
      type: String,
      required: true,
      trim: true
    },
    storagePath: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    permanentStoragePath: {
      type: String,
      trim: true
    },
    uploadOrigin: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(APP_BUILD_UPLOAD_STATUSES),
      default: APP_BUILD_UPLOAD_STATUSES.PENDING,
      required: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    purgeAt: {
      type: Date,
      required: true,
      index: { expires: 0 }
    },
    appBuildId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AppBuild"
    },
    failureReason: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

appBuildUploadSessionSchema.index({
  status: 1,
  expiresAt: 1
});

export const AppBuildUploadSession = mongoose.model("AppBuildUploadSession", appBuildUploadSessionSchema);
