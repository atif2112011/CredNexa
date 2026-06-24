import { ACCOUNT_ROLES } from "../constants/roles.js";
import {
  AppNotificationJob,
  APP_NOTIFICATION_RECIPIENT_TYPES
} from "../models/AppNotificationJob.js";
import { AccountPushToken, ACCOUNT_PUSH_TARGET_APPS } from "../models/AccountPushToken.js";
import { Account } from "../models/Account.js";

const normalizeNotificationText = ({ title, text }) => ({
  title: String(title || "").trim(),
  text: String(text || "").trim()
});

const validateNotificationText = ({ title, text }) => {
  if (!title || !text) {
    throw new Error("Notification title and text are required");
  }
  if (title.length > 120) {
    throw new Error("Notification title must be 120 characters or fewer");
  }
  if (text.length > 1000) {
    throw new Error("Notification text must be 1000 characters or fewer");
  }
};

const getAccountsWithActiveTokens = async ({ accountFilter, targetApp }) => {
  const accounts = await Account.find({ ...accountFilter, isActive: true }).select("_id role tenantId channelPartnerId").lean();
  if (!accounts.length) return [];

  const activeTokenAccountIds = await AccountPushToken.distinct("accountId", {
    accountId: { $in: accounts.map((account) => account._id) },
    targetApp,
    isActive: true
  });
  const activeTokenAccountIdSet = new Set(activeTokenAccountIds.map((accountId) => accountId.toString()));

  return accounts.filter((account) => activeTokenAccountIdSet.has(account._id.toString()));
};

const createNotificationJobs = async ({ accounts, targetApp, recipientType, tenantId, channelPartnerId, title, text, data, notificationType }) => {
  if (!accounts.length) return [];

  return AppNotificationJob.create(
    accounts.map((account) => ({
      targetApp,
      recipientType,
      accountId: account._id,
      tenantId,
      channelPartnerId,
      title,
      text,
      data: data || {},
      notificationType: notificationType || "CUSTOM"
    }))
  );
};

export const queueTenantAppNotification = async ({ tenantId, accountId, title, text, data = {}, notificationType = "CUSTOM" }) => {
  const normalized = normalizeNotificationText({ title, text });
  validateNotificationText(normalized);

  const accountFilter = {
    role: ACCOUNT_ROLES.TENANT_ADMIN,
    tenantId
  };
  if (accountId) accountFilter._id = accountId;

  const accounts = await getAccountsWithActiveTokens({
    accountFilter,
    targetApp: ACCOUNT_PUSH_TARGET_APPS.TENANT_APP
  });

  return createNotificationJobs({
    accounts,
    targetApp: ACCOUNT_PUSH_TARGET_APPS.TENANT_APP,
    recipientType: APP_NOTIFICATION_RECIPIENT_TYPES.TENANT_ADMIN,
    tenantId,
    title: normalized.title,
    text: normalized.text,
    data,
    notificationType
  });
};

export const queuePartnerAppNotification = async ({ channelPartnerId, accountId, title, text, data = {}, notificationType = "CUSTOM" }) => {
  const normalized = normalizeNotificationText({ title, text });
  validateNotificationText(normalized);

  const accountFilter = {
    role: ACCOUNT_ROLES.PARTNER_ADMIN,
    channelPartnerId
  };
  if (accountId) accountFilter._id = accountId;

  const accounts = await getAccountsWithActiveTokens({
    accountFilter,
    targetApp: ACCOUNT_PUSH_TARGET_APPS.PARTNER_APP
  });

  return createNotificationJobs({
    accounts,
    targetApp: ACCOUNT_PUSH_TARGET_APPS.PARTNER_APP,
    recipientType: APP_NOTIFICATION_RECIPIENT_TYPES.PARTNER_ADMIN,
    channelPartnerId,
    title: normalized.title,
    text: normalized.text,
    data,
    notificationType
  });
};
