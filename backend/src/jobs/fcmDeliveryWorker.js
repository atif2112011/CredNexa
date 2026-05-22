import { connectDatabase } from "../config/database.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";
import { FcmDeliveryLog } from "../models/FcmDeliveryLog.js";

let firebaseApp;

const loadFirebaseAdmin = async () => {
  if (process.env.FCM_MOCK_MODE !== "false") return null;
  if (firebaseApp) return firebaseApp;

  const admin = await import("firebase-admin");
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    firebaseApp = admin.default.initializeApp({
      credential: admin.default.credential.cert(JSON.parse(serviceAccountJson))
    });
    return firebaseApp;
  }

  firebaseApp = admin.default.initializeApp({
    credential: admin.default.credential.applicationDefault()
  });
  return firebaseApp;
};

const buildPolicyUpdateMessage = ({ device, command }) => ({
  token: device.fcmToken,
  data: {
    type: "POLICY_UPDATE",
    commandId: command._id.toString(),
    commandType: command.commandType,
    policyKey: String(command.payload?.policyKey || device.currentPolicyKey),
    policyVersion: String(command.payload?.policyVersion || device.desiredPolicyVersion)
  },
  android: {
    priority: "high"
  }
});

export const runFcmDeliveryBatch = async ({ limit = 50 } = {}) => {
  await connectDatabase();

  const commands = await DeviceCommand.find({
    status: { $in: ["pending", "failed"] },
    retryCount: { $lt: 5 },
    $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }]
  })
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
