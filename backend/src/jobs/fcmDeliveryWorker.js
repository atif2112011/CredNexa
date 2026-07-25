import { connectDatabase } from "../config/database.js";
import { AccountPushToken } from "../models/AccountPushToken.js";
import { AppNotificationJob } from "../models/AppNotificationJob.js";
import { Device } from "../models/Device.js";
import {
  DEVICE_COMMAND_FAILURE_SOURCES,
  DeviceCommand
} from "../models/DeviceCommand.js";
import { FcmDeliveryLog } from "../models/FcmDeliveryLog.js";
import { isInvalidFcmTokenError } from "../utils/pushTokens.js";

let firebaseApp;

const buildServiceAccountFromEnv = () => {
  const projectId =
    process.env.ADMIN_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.APP_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.ADMIN_FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = (process.env.ADMIN_FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY)?.replace(
    /\\n/g,
    "\n"
  );

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey
  };
};

const loadFirebaseAdmin = async () => {
  if (process.env.FCM_MOCK_MODE !== "false") return null;
  if (firebaseApp) return firebaseApp;

  const admin = await import("firebase-admin");
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccount = buildServiceAccountFromEnv();

  if (serviceAccountJson) {
    firebaseApp = admin.default.initializeApp({
      credential: admin.default.credential.cert(JSON.parse(serviceAccountJson))
    });
    return firebaseApp;
  }

  if (serviceAccount) {
    firebaseApp = admin.default.initializeApp({
      credential: admin.default.credential.cert(serviceAccount)
    });
    return firebaseApp;
  }

  firebaseApp = admin.default.initializeApp({
    credential: admin.default.credential.applicationDefault()
  });
  return firebaseApp;
};

export const buildPolicyUpdateMessage = ({ device, command }) => {
  const baseData = {
    commandId: command._id.toString(),
    commandType: command.commandType
  };
  const securityCommandTypes = new Set([
    "RUN_INTEGRITY_CHECK",
    "SHOW_REMEDIATION",
    "INSTALL_UPDATE",
    "WIPE_DEVICE",
    "REPROVISION_REQUIRED",
    "RESTRICTIONS_UPDATE",
    "RELEASE_DEVICE"
  ]);

  if (command.commandType === "NOTIFICATION") {
    return {
      token: device.fcmToken,
      notification: {
        title: String(command.payload?.title || ""),
        body: String(command.payload?.text || "")
      },
      data: {
        ...baseData,
        ...stringifyDataPayload(command.payload?.data),
        type: "NOTIFICATION",
        notificationType: String(command.payload?.notificationType || "CUSTOM"),
        title: String(command.payload?.title || ""),
        text: String(command.payload?.text || "")
      },
      android: {
        priority: "high",
        notification: {
          channelId: "custom_notifications"
        }
      }
    };
  }

  if (command.commandType === "UPCOMING_PAYMENT") {
    return {
      token: device.fcmToken,
      data: {
        ...baseData,
        type: "UPCOMING_PAYMENT",
        installmentId: String(command.payload?.installmentId || ""),
        installmentNumber: String(command.payload?.installmentNumber || ""),
        dueDate: command.payload?.dueDate ? new Date(command.payload.dueDate).toISOString() : "",
        outstandingAmount: String(command.payload?.outstandingAmount || 0)
      },
      android: {
        priority: "high"
      }
    };
  }

  if (securityCommandTypes.has(command.commandType)) {
    return {
      token: device.fcmToken,
      data: {
        ...baseData,
        ...stringifyDataPayload(command.payload),
        type: command.commandType
      },
      android: {
        priority: "high"
      }
    };
  }

  return {
    token: device.fcmToken,
    data: {
      ...baseData,
      ...stringifyDataPayload(command.payload),
      type: "POLICY_UPDATE",
      policyKey: String(command.payload?.policyKey || device.currentPolicyKey),
      policyVersion: String(command.payload?.policyVersion || device.desiredPolicyVersion)
    },
    android: {
      priority: "high"
    }
  };
};

const stringifyDataPayload = (data = {}) =>
  Object.entries(data || {}).reduce((result, [key, value]) => {
    if (value === undefined || value === null) return result;
    result[key] = typeof value === "string" ? value : JSON.stringify(value);
    return result;
  }, {});

const buildAppNotificationMessage = ({ pushToken, job }) => ({
  token: pushToken.fcmToken,
  notification: {
    title: String(job.title || ""),
    body: String(job.text || "")
  },
  data: {
    ...stringifyDataPayload(job.data),
    type: "APP_NOTIFICATION",
    notificationJobId: job._id.toString(),
    notificationType: String(job.notificationType || "CUSTOM"),
    targetApp: String(job.targetApp),
    title: String(job.title || ""),
    text: String(job.text || "")
  },
  android: {
    priority: "high",
    notification: {
      channelId: "app_notifications"
    }
  }
});

export const buildDeviceCommandDeliveryFilter = ({ now = new Date() } = {}) => ({
  retryCount: { $lt: 5 },
  $and: [
    {
      $or: [
        { status: "pending" },
        {
          status: "failed",
          failureSource: { $ne: DEVICE_COMMAND_FAILURE_SOURCES.DEVICE_ENFORCEMENT }
        }
      ]
    },
    {
      $or: [
        { nextRetryAt: { $exists: false } },
        { nextRetryAt: null },
        { nextRetryAt: { $lte: now } }
      ]
    }
  ]
});

export const runFcmDeliveryBatch = async ({ limit = 50, commandIds } = {}) => {
  await connectDatabase();

  const commandFilter = buildDeviceCommandDeliveryFilter();

  if (commandIds?.length) {
    commandFilter._id = { $in: commandIds };
  }

  const commands = await DeviceCommand.find(commandFilter)
    .sort({ createdAt: 1 })
    .limit(limit);

  const firebase = await loadFirebaseAdmin();
  const results = [];

  for (const command of commands) {
    const device = await Device.findById(command.deviceId).lean();

    if (!device?.fcmToken) {
      command.status = "failed";
      command.retryCount += 1;
      command.nextRetryAt = new Date(Date.now() + 5 * 60 * 1000);
      command.failureReason = "Device FCM token not found";
      command.failureSource = DEVICE_COMMAND_FAILURE_SOURCES.DELIVERY;
      await command.save();
      await FcmDeliveryLog.create({
        deviceId: command.deviceId,
        commandId: command._id,
        status: "skipped",
        messageType: command.commandType === "NOTIFICATION" ? "NOTIFICATION" : "POLICY_UPDATE",
        error: command.failureReason
      });
      results.push({ commandId: command._id, status: "skipped" });
      continue;
    }

    try {
      const message = buildPolicyUpdateMessage({ device, command });
      let providerMessageId = `mock_fcm_${command._id}`;

      if (firebase) {
        providerMessageId = await firebase.messaging().send(message);
      }

      command.status = "sent";
      command.sentAt = new Date();
      command.fcmMessageId = providerMessageId;
      command.failureReason = undefined;
      command.failureSource = undefined;
      await command.save();

      await FcmDeliveryLog.create({
        deviceId: command.deviceId,
        commandId: command._id,
        token: device.fcmToken,
        messageType: command.commandType === "NOTIFICATION" ? "NOTIFICATION" : "POLICY_UPDATE",
        status: "sent",
        providerMessageId,
        metadata: { mockMode: !firebase }
      });
      results.push({ commandId: command._id, status: "sent", providerMessageId });
    } catch (error) {
      command.status = "failed";
      command.retryCount += 1;
      command.nextRetryAt = new Date(Date.now() + Math.min(command.retryCount + 1, 5) * 5 * 60 * 1000);
      command.failureReason = error.message;
      command.failureSource = DEVICE_COMMAND_FAILURE_SOURCES.DELIVERY;
      await command.save();

      await FcmDeliveryLog.create({
        deviceId: command.deviceId,
        commandId: command._id,
        token: device.fcmToken,
        messageType: command.commandType === "NOTIFICATION" ? "NOTIFICATION" : "POLICY_UPDATE",
        status: "failed",
        error: error.message
      });
      results.push({ commandId: command._id, status: "failed", error: error.message });
    }
  }

  return results;
};

export const runAppNotificationDeliveryBatch = async ({ limit = 50, jobIds } = {}) => {
  await connectDatabase();

  const jobFilter = {
    status: { $in: ["pending", "failed"] },
    $expr: { $lt: ["$retryCount", "$maxRetries"] },
    $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }]
  };

  if (jobIds?.length) {
    jobFilter._id = { $in: jobIds };
  }

  const jobs = await AppNotificationJob.find(jobFilter).sort({ createdAt: 1 }).limit(limit);
  const firebase = await loadFirebaseAdmin();
  const results = [];

  for (const job of jobs) {
    const pushTokens = await AccountPushToken.find({
      accountId: job.accountId,
      targetApp: job.targetApp,
      isActive: true
    }).lean();

    if (!pushTokens.length) {
      job.status = "skipped";
      job.failureReason = "Active account FCM token not found";
      await job.save();
      await FcmDeliveryLog.create({
        notificationJobId: job._id,
        accountId: job.accountId,
        tenantId: job.tenantId,
        channelPartnerId: job.channelPartnerId,
        targetApp: job.targetApp,
        recipientType: job.recipientType,
        notificationType: job.notificationType,
        messageType: "APP_NOTIFICATION",
        status: "skipped",
        error: job.failureReason
      });
      results.push({ jobId: job._id, status: "skipped" });
      continue;
    }

    const deliveryResults = [];

    for (const pushToken of pushTokens) {
      try {
        const message = buildAppNotificationMessage({ pushToken, job });
        let providerMessageId = `mock_app_fcm_${job._id}_${pushToken._id}`;

        if (firebase) {
          providerMessageId = await firebase.messaging().send(message);
        }

        await FcmDeliveryLog.create({
          notificationJobId: job._id,
          accountId: job.accountId,
          accountPushTokenId: pushToken._id,
          tenantId: job.tenantId,
          channelPartnerId: job.channelPartnerId,
          tokenHash: pushToken.tokenHash,
          targetApp: job.targetApp,
          recipientType: job.recipientType,
          notificationType: job.notificationType,
          messageType: "APP_NOTIFICATION",
          status: "sent",
          providerMessageId,
          metadata: { mockMode: !firebase }
        });
        deliveryResults.push({ status: "sent", providerMessageId });
      } catch (error) {
        if (isInvalidFcmTokenError(error)) {
          await AccountPushToken.updateOne(
            { _id: pushToken._id },
            {
              $set: {
                isActive: false,
                deactivatedAt: new Date(),
                deactivationReason: "invalid_token"
              }
            }
          );
        }

        await FcmDeliveryLog.create({
          notificationJobId: job._id,
          accountId: job.accountId,
          accountPushTokenId: pushToken._id,
          tenantId: job.tenantId,
          channelPartnerId: job.channelPartnerId,
          tokenHash: pushToken.tokenHash,
          targetApp: job.targetApp,
          recipientType: job.recipientType,
          notificationType: job.notificationType,
          messageType: "APP_NOTIFICATION",
          status: "failed",
          error: error.message
        });
        deliveryResults.push({ status: "failed", error: error.message });
      }
    }

    const sentCount = deliveryResults.filter((result) => result.status === "sent").length;
    if (sentCount > 0) {
      job.status = "sent";
      job.sentAt = new Date();
      job.failureReason = undefined;
    } else {
      job.status = "failed";
      job.retryCount += 1;
      job.nextRetryAt = new Date(Date.now() + Math.min(job.retryCount + 1, 5) * 5 * 60 * 1000);
      job.failureReason = deliveryResults.find((result) => result.error)?.error || "FCM delivery failed";
    }
    await job.save();

    results.push({
      jobId: job._id,
      status: job.status,
      sentCount,
      failedCount: deliveryResults.length - sentCount
    });
  }

  return results;
};

export const runAllFcmDeliveryBatches = async ({ limit = 50 } = {}) => {
  const deviceCommands = await runFcmDeliveryBatch({ limit });
  const appNotifications = await runAppNotificationDeliveryBatch({ limit });

  return { deviceCommands, appNotifications };
};

if (process.argv[1]?.endsWith("fcmDeliveryWorker.js")) {
  runAllFcmDeliveryBatches()
    .then((results) => {
      console.log(
        `FCM delivery batch completed: ${results.deviceCommands.length} device command(s), ${results.appNotifications.length} app notification(s) processed`
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
