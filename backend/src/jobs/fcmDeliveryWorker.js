import { connectDatabase } from "../config/database.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";
import { FcmDeliveryLog } from "../models/FcmDeliveryLog.js";

let firebaseApp;

const buildServiceAccountFromEnv = () => {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

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

const buildPolicyUpdateMessage = ({ device, command }) => {
  const baseData = {
    commandId: command._id.toString(),
    commandType: command.commandType
  };

  if (command.commandType === "NOTIFICATION") {
    return {
      token: device.fcmToken,
      notification: {
        title: String(command.payload?.title || ""),
        body: String(command.payload?.text || "")
      },
      data: {
        ...baseData,
        type: "NOTIFICATION",
        notificationType: "CUSTOM",
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

  return {
    token: device.fcmToken,
    data: {
      ...baseData,
      type: "POLICY_UPDATE",
      policyKey: String(command.payload?.policyKey || device.currentPolicyKey),
      policyVersion: String(command.payload?.policyVersion || device.desiredPolicyVersion)
    },
    android: {
      priority: "high"
    }
  };
};

export const runFcmDeliveryBatch = async ({ limit = 50, commandIds } = {}) => {
  await connectDatabase();

  const commandFilter = {
    status: { $in: ["pending", "failed"] },
    retryCount: { $lt: 5 },
    $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }]
  };

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

if (process.argv[1]?.endsWith("fcmDeliveryWorker.js")) {
  runFcmDeliveryBatch()
    .then((results) => {
      console.log(`FCM delivery batch completed: ${results.length} command(s) processed`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
