import mongoose from "mongoose";

import { ACCOUNT_PUSH_TARGET_APPS } from "./AccountPushToken.js";

export const APP_NOTIFICATION_RECIPIENT_TYPES = Object.freeze({
  TENANT_ADMIN: "tenant_admin",
  PARTNER_ADMIN: "partner_admin"
});

export const APP_NOTIFICATION_JOB_STATUSES = Object.freeze({
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
  SKIPPED: "skipped"
});

const appNotificationJobSchema = new mongoose.Schema(
  {
    targetApp: {
      type: String,
      enum: Object.values(ACCOUNT_PUSH_TARGET_APPS),
      required: true
    },
    recipientType: {
      type: String,
      enum: Object.values(APP_NOTIFICATION_RECIPIENT_TYPES),
      required: true
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant"
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner"
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    text: {
      type: String,
      required: true,
      trim: true
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    notificationType: {
      type: String,
      default: "CUSTOM",
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(APP_NOTIFICATION_JOB_STATUSES),
      default: APP_NOTIFICATION_JOB_STATUSES.PENDING
    },
    retryCount: {
      type: Number,
      default: 0
    },
    maxRetries: {
      type: Number,
      default: 5
    },
    nextRetryAt: Date,
    sentAt: Date,
    failureReason: String
  },
  { timestamps: true }
);

appNotificationJobSchema.index(
  { status: 1, nextRetryAt: 1, createdAt: 1 },
  { name: "app_notification_delivery_queue" }
);
appNotificationJobSchema.index({ accountId: 1, targetApp: 1, status: 1 }, { name: "app_notification_account_lookup" });
appNotificationJobSchema.index({ tenantId: 1, status: 1 }, { name: "app_notification_tenant_lookup" });
appNotificationJobSchema.index({ channelPartnerId: 1, status: 1 }, { name: "app_notification_partner_lookup" });

export const AppNotificationJob = mongoose.model("AppNotificationJob", appNotificationJobSchema);
