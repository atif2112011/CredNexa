import assert from "node:assert/strict";
import test from "node:test";

import { DEVICE_STATES } from "../src/constants/deviceStates.js";
import { buildPolicyUpdateMessage } from "../src/jobs/fcmDeliveryWorker.js";
import { EMI_SCHEDULE_STATUSES } from "../src/models/EmiSchedule.js";
import {
  areInstallmentsCompleted,
  getDeviceReleaseSummary,
  settleCompletedSchedule
} from "../src/services/deviceRelease.service.js";

test("requires at least one installment and accepts only paid or waived installments", () => {
  assert.equal(areInstallmentsCompleted([]), false);
  assert.equal(
    areInstallmentsCompleted([{ status: "paid" }, { status: "waived" }]),
    true
  );
  assert.equal(
    areInstallmentsCompleted([{ status: "paid" }, { status: "partial" }]),
    false
  );
});

test("settles a completed schedule exactly once and preserves settlement time", () => {
  const settlementTime = new Date("2026-07-25T10:00:00.000Z");
  const schedule = {
    status: EMI_SCHEDULE_STATUSES.ACTIVE,
    installments: [{ status: "paid" }, { status: "waived" }]
  };

  assert.deepEqual(settleCompletedSchedule(schedule, settlementTime), {
    completed: true,
    newlySettled: true
  });
  assert.equal(schedule.status, EMI_SCHEDULE_STATUSES.SETTLED);
  assert.equal(schedule.settlementTime, settlementTime);

  const later = new Date("2026-07-26T10:00:00.000Z");
  assert.deepEqual(settleCompletedSchedule(schedule, later), {
    completed: true,
    newlySettled: false
  });
  assert.equal(schedule.settlementTime, settlementTime);
});

test("builds release eligibility from settled schedule and command state", () => {
  const summary = getDeviceReleaseSummary({
    schedule: {
      status: EMI_SCHEDULE_STATUSES.SETTLED,
      installments: [{ status: "paid" }, { status: "waived" }]
    },
    device: { state: DEVICE_STATES.RELEASE_PENDING },
    latestReleaseCommand: { status: "failed" }
  });

  assert.equal(summary.eligible, true);
  assert.equal(summary.canQueue, true);
  assert.equal(summary.completedInstallments, 2);
  assert.equal(summary.totalInstallments, 2);
});

test("delivers release as a dedicated high-priority command", () => {
  const message = buildPolicyUpdateMessage({
    device: { fcmToken: "token" },
    command: {
      _id: { toString: () => "command-id" },
      commandType: "RELEASE_DEVICE",
      payload: {
        reason: "All EMI installments paid or waived",
        settlementTime: "2026-07-25T10:00:00.000Z"
      }
    }
  });

  assert.equal(message.data.type, "RELEASE_DEVICE");
  assert.equal(message.data.commandType, "RELEASE_DEVICE");
  assert.equal(message.android.priority, "high");
});
