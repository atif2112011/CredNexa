import { ACCOUNT_ROLES } from "../constants/roles.js";
import {
  AppNotificationJob,
  APP_NOTIFICATION_RECIPIENT_TYPES
} from "../models/AppNotificationJob.js";
import { AccountPushToken, ACCOUNT_PUSH_TARGET_APPS } from "../models/AccountPushToken.js";
import { Account } from "../models/Account.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";

export const NOTIFICATION_AUDIENCES = Object.freeze({
  BORROWER: "borrower",
  TENANT: "tenant",
  PARTNER: "partner"
});

export const APP_LOCK_NOTIFICATION = Object.freeze({
  title: "App access restricted",
  text: "Access to this app has been temporarily blocked because your EMI payment is overdue. Please pay your pending EMI to avoid further app restrictions.",
  notificationType: "APP_LOCKED_OVERDUE_EMI"
});

export const UPCOMING_EMI_NOTIFICATION = Object.freeze({
  title: "EMI payment due soon",
  notificationType: "UPCOMING_EMI_REMINDER"
});

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

const queueTenantNotification = async ({ tenantId, accountId, title, text, data = {}, notificationType = "CUSTOM" }) => {
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

const queuePartnerNotification = async ({ channelPartnerId, accountId, title, text, data = {}, notificationType = "CUSTOM" }) => {
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

export const queueBorrowerNotification = async ({
  tenantId,
  deviceId,
  userId,
  title,
  text,
  data = {},
  notificationType = "CUSTOM",
  triggeredBy = "system_notification",
  triggeredByAccountId
}) => {
  const normalized = normalizeNotificationText({ title, text });
  validateNotificationText(normalized);

  const deviceFilter = {};
  if (deviceId) deviceFilter._id = deviceId;
  if (userId) deviceFilter.userId = userId;
  if (tenantId) deviceFilter.tenantId = tenantId;

  if (!Object.keys(deviceFilter).length) {
    throw new Error("Borrower notification requires tenantId, deviceId, or userId");
  }

  const devices = await Device.find(deviceFilter).select("_id tenantId").lean();
  if (!devices.length) return [];

  return DeviceCommand.create(
    devices.map((device) => ({
      deviceId: device._id,
      tenantId: device.tenantId,
      commandType: "NOTIFICATION",
      triggeredBy,
      triggeredByAccountId,
      payload: {
        title: normalized.title,
        text: normalized.text,
        notificationType: notificationType || "CUSTOM",
        data: data || {}
      }
    }))
  );
};

export const queueAppLockNotification = async ({
  deviceId,
  tenantId,
  sourceCommandId,
  triggeredBy = "manual_tenant",
  triggeredByAccountId
}) => {
  if (!deviceId || !tenantId || !sourceCommandId) {
    throw new Error("App lock notification requires deviceId, tenantId, and sourceCommandId");
  }

  const normalizedSourceCommandId = String(sourceCommandId);
  const existingCommand = await DeviceCommand.findOne({
    deviceId,
    tenantId,
    commandType: "NOTIFICATION",
    "payload.notificationType": APP_LOCK_NOTIFICATION.notificationType,
    "payload.data.sourceCommandId": normalizedSourceCommandId
  }).lean();

  if (existingCommand) {
    return { command: existingCommand, created: false };
  }

  const commands = await queueBorrowerNotification({
    deviceId,
    tenantId,
    title: APP_LOCK_NOTIFICATION.title,
    text: APP_LOCK_NOTIFICATION.text,
    notificationType: APP_LOCK_NOTIFICATION.notificationType,
    data: { sourceCommandId: normalizedSourceCommandId },
    triggeredBy,
    triggeredByAccountId
  });

  return {
    command: commands[0] || null,
    created: commands.length > 0
  };
};

export const safeQueueAppLockNotification = async (payload) => {
  try {
    return await queueAppLockNotification(payload);
  } catch (error) {
    console.error("Failed to queue app lock notification", {
      deviceId: payload?.deviceId,
      tenantId: payload?.tenantId,
      sourceCommandId: payload?.sourceCommandId,
      message: error.message
    });
    return { command: null, created: false, error: error.message };
  }
};

export const queueUpcomingEmiNotification = async ({
  deviceId,
  tenantId,
  userId,
  sourceCommandId,
  text,
  data = {},
  triggeredBy = "manual_tenant",
  triggeredByAccountId
}) => {
  if (!deviceId || !tenantId || !sourceCommandId) {
    throw new Error("Upcoming EMI notification requires deviceId, tenantId, and sourceCommandId");
  }

  const normalizedSourceCommandId = String(sourceCommandId);
  const existingCommand = await DeviceCommand.findOne({
    deviceId,
    tenantId,
    commandType: "NOTIFICATION",
    "payload.notificationType": UPCOMING_EMI_NOTIFICATION.notificationType,
    "payload.data.sourceCommandId": normalizedSourceCommandId
  }).lean();

  if (existingCommand) {
    return { command: existingCommand, created: false };
  }

  const commands = await queueBorrowerNotification({
    deviceId,
    tenantId,
    userId,
    title: UPCOMING_EMI_NOTIFICATION.title,
    text,
    notificationType: UPCOMING_EMI_NOTIFICATION.notificationType,
    data: {
      ...data,
      sourceCommandId: normalizedSourceCommandId
    },
    triggeredBy,
    triggeredByAccountId
  });

  return {
    command: commands[0] || null,
    created: commands.length > 0
  };
};

export const safeQueueUpcomingEmiNotification = async (payload) => {
  try {
    return await queueUpcomingEmiNotification(payload);
  } catch (error) {
    console.error("Failed to queue upcoming EMI notification", {
      deviceId: payload?.deviceId,
      tenantId: payload?.tenantId,
      sourceCommandId: payload?.sourceCommandId,
      message: error.message
    });
    return { command: null, created: false, error: error.message };
  }
};

export const queueNotification = async ({
  audience,
  tenantId,
  channelPartnerId,
  deviceId,
  userId,
  accountId,
  title,
  text,
  data = {},
  notificationType = "CUSTOM",
  triggeredBy,
  triggeredByAccountId
}) => {
  if (audience === NOTIFICATION_AUDIENCES.TENANT) {
    return queueTenantNotification({ tenantId, accountId, title, text, data, notificationType });
  }

  if (audience === NOTIFICATION_AUDIENCES.PARTNER) {
    return queuePartnerNotification({ channelPartnerId, accountId, title, text, data, notificationType });
  }

  if (audience === NOTIFICATION_AUDIENCES.BORROWER) {
    return queueBorrowerNotification({
      tenantId,
      deviceId,
      userId,
      title,
      text,
      data,
      notificationType,
      triggeredBy,
      triggeredByAccountId
    });
  }

  throw new Error("Unsupported notification audience");
};

export const safeQueueNotification = async (payload) => {
  try {
    return await queueNotification(payload);
  } catch (error) {
    console.error("Failed to queue notification", {
      audience: payload?.audience,
      notificationType: payload?.notificationType,
      tenantId: payload?.tenantId,
      channelPartnerId: payload?.channelPartnerId,
      deviceId: payload?.deviceId,
      userId: payload?.userId,
      message: error.message
    });
    return [];
  }
};

export const queueTenantAppNotification = async (payload) =>
  queueNotification({ ...payload, audience: NOTIFICATION_AUDIENCES.TENANT });

export const queuePartnerAppNotification = async (payload) =>
  queueNotification({ ...payload, audience: NOTIFICATION_AUDIENCES.PARTNER });
