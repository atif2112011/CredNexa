import mongoose from "mongoose";

export const ACCOUNT_PUSH_TARGET_APPS = Object.freeze({
  TENANT_APP: "tenant_app",
  PARTNER_APP: "partner_app"
});

export const ACCOUNT_PUSH_PLATFORMS = Object.freeze({
  ANDROID: "android",
  IOS: "ios",
  WEB: "web"
});

const accountPushTokenSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true
    },
    role: {
      type: String,
      required: true,
      trim: true
    },
    targetApp: {
      type: String,
      enum: Object.values(ACCOUNT_PUSH_TARGET_APPS),
      required: true
    },
    platform: {
      type: String,
      enum: Object.values(ACCOUNT_PUSH_PLATFORMS),
      required: true
    },
    fcmToken: {
      type: String,
      required: true
    },
    tokenHash: {
      type: String,
      required: true
    },
    appVersion: {
      type: String,
      trim: true
    },
    lastSeenAt: Date,
    isActive: {
      type: Boolean,
      default: true
    },
    deactivatedAt: Date,
    deactivationReason: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

accountPushTokenSchema.index(
  { accountId: 1, targetApp: 1, platform: 1, tokenHash: 1 },
  { unique: true, name: "account_push_token_unique_device" }
);
accountPushTokenSchema.index({ targetApp: 1, accountId: 1, isActive: 1 }, { name: "account_push_token_delivery_lookup" });
accountPushTokenSchema.index({ tokenHash: 1 }, { name: "account_push_token_hash_lookup" });

export const AccountPushToken = mongoose.model("AccountPushToken", accountPushTokenSchema);
