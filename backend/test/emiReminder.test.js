import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmiReminderPayload,
  EMI_REMINDER_TYPES,
  findUpcomingEmiInstallment,
  normalizeUpcomingReminderWindowDays
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

test("selects the earliest unpaid upcoming EMI inside the reminder window", () => {
  const result = findUpcomingEmiInstallment({
    now: "2026-08-01T00:00:00.000Z",
    windowDays: 10,
    schedule: {
      installments: [
        { installmentNumber: 1, status: "overdue", dueDate: "2026-07-20T00:00:00.000Z" },
        { installmentNumber: 4, status: "pending", dueDate: "2026-08-09T00:00:00.000Z" },
        { installmentNumber: 3, status: "partial", dueDate: "2026-08-05T00:00:00.000Z" },
        { installmentNumber: 5, status: "pending", dueDate: "2026-08-20T00:00:00.000Z" },
        { installmentNumber: 2, status: "paid", dueDate: "2026-08-03T00:00:00.000Z" }
      ]
    }
  });

  assert.equal(result.installmentNumber, 3);
});

test("returns no upcoming EMI when none qualifies", () => {
  assert.equal(
    findUpcomingEmiInstallment({
      now: "2026-08-01T00:00:00.000Z",
      windowDays: 7,
      schedule: {
        installments: [
          { installmentNumber: 1, status: "paid", dueDate: "2026-08-03T00:00:00.000Z" },
          { installmentNumber: 2, status: "pending", dueDate: "2026-08-20T00:00:00.000Z" }
        ]
      }
    }),
    null
  );
});

test("normalizes the upcoming EMI reminder window to 1 through 30 days", () => {
  assert.equal(normalizeUpcomingReminderWindowDays(undefined), 7);
  assert.equal(normalizeUpcomingReminderWindowDays(0), 1);
  assert.equal(normalizeUpcomingReminderWindowDays(12), 12);
  assert.equal(normalizeUpcomingReminderWindowDays(90), 30);
});
