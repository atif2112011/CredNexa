import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmiReminderPayload,
  EMI_REMINDER_TYPES
} from "../src/services/emiReminder.service.js";
import { buildPolicyUpdateMessage } from "../src/jobs/fcmDeliveryWorker.js";

test("builds the exact borrower EMI reminder payload", () => {
  assert.deepEqual(
    buildEmiReminderPayload({
      reminderType: EMI_REMINDER_TYPES.OVERDUE,
      amount: 12500,
      dueDate: "2026-07-20T00:00:00.000Z",
      installmentNumber: 4,
      totalInstallments: 12
    }),
    {
      reminderType: "OVERDUE",
      message: "Your EMI payment is overdue.",
      amount: 12500,
      dueDate: "2026-07-20T00:00:00.000Z",
      installmentNumber: 4,
      totalInstallments: 12
    }
  );
});

test("omits optional EMI reminder fields when they are unavailable", () => {
  assert.deepEqual(
    buildEmiReminderPayload({
      reminderType: EMI_REMINDER_TYPES.PENDING,
      message: "Payment remains pending."
    }),
    {
      reminderType: "PENDING",
      message: "Payment remains pending."
    }
  );
});

test("builds EMI reminder FCM as a data-only wake-up", () => {
  const message = buildPolicyUpdateMessage({
    device: { fcmToken: "fcm-token" },
    command: {
      _id: { toString: () => "command-id" },
      commandType: "EMI_REMINDER",
      payload: {
        reminderType: "OVERDUE",
        message: "Authoritative reminder content",
        amount: 12500
      }
    }
  });

  assert.deepEqual(message.data, {
    commandId: "command-id",
    commandType: "EMI_REMINDER",
    type: "EMI_REMINDER"
  });
  assert.equal(message.notification, undefined);
  assert.equal(message.android.priority, "high");
});
