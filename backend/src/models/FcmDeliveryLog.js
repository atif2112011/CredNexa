import mongoose from "mongoose";

const fcmDeliveryLogSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device"
    },
    commandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeviceCommand"
    },
    notificationJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AppNotificationJob"
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    },
    accountPushTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountPushToken"
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant"
    },
    channelPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelPartner"
    },
    token: String,
    tokenHash: String,
    targetApp: {
      type: String,
      enum: ["borrower_app", "tenant_app", "partner_app"]
    },
    recipientType: {
      type: String,
      enum: ["device", "tenant_admin", "partner_admin"]
    },
    notificationType: String,
    messageType: {
      type: String,
      default: "POLICY_UPDATE"
    },
    status: {
      type: String,
      enum: ["sent", "failed", "skipped"],
      required: true
    },
    providerMessageId: String,
    error: String,
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

export const FcmDeliveryLog = mongoose.model("FcmDeliveryLog", fcmDeliveryLogSchema);
