import assert from "node:assert/strict";
import test from "node:test";

import { EMI_SCHEDULE_STATUSES } from "../src/models/EmiSchedule.js";
import { markEmiInstallmentPaid } from "../src/services/emiInstallment.service.js";

const id = (value) => ({ toString: () => value });

test("marks one partial installment fully paid and recalculates overdue totals", () => {
  const schedule = {
    status: EMI_SCHEDULE_STATUSES.ACTIVE,
    installments: [
      {
        _id: id("target"),
        installmentNumber: 1,
        dueDate: new Date("2026-08-01T00:00:00.000Z"),
        emiAmount: 3000,
        penaltyAmount: 200,
        paidAmount: 1000,
        status: "partial"
      },
      {
        _id: id("other"),
        installmentNumber: 2,
        dueDate: new Date("2026-08-05T00:00:00.000Z"),
        emiAmount: 3000,
        penaltyAmount: 0,
        paidAmount: 0,
        status: "overdue"
      }
    ]
  };

  const result = markEmiInstallmentPaid({
    schedule,
    installmentId: "target",
    accountId: "account-id",
    reason: "Cash received",
    reference: "CASH-1",
    paidAt: new Date("2026-08-09T10:00:00.000Z"),
    now: new Date("2026-08-10T10:00:00.000Z")
  });

  assert.equal(result.outstandingAmount, 2200);
  assert.equal(result.installment.status, "paid");
  assert.equal(result.installment.paidAmount, 3200);
  assert.equal(result.installment.markedPaidBy, "account-id");
  assert.equal(result.installment.markPaidReason, "Cash received");
  assert.equal(result.installment.markPaidReference, "CASH-1");
  assert.equal(schedule.overdueInstallments, 1);
  assert.equal(schedule.overdueAmount, 3000);
  assert.equal(schedule.dpd, 5);
  assert.equal(schedule.status, EMI_SCHEDULE_STATUSES.ACTIVE);
  assert.equal(result.newlySettled, false);
});

test("settles the schedule when the marked installment is the final unpaid EMI", () => {
  const now = new Date("2026-08-10T10:00:00.000Z");
  const schedule = {
    status: EMI_SCHEDULE_STATUSES.ACTIVE,
    installments: [
      { _id: id("paid"), emiAmount: 3000, paidAmount: 3000, status: "paid" },
      { _id: id("target"), emiAmount: 3000, paidAmount: 0, status: "pending" }
    ]
  };

  const result = markEmiInstallmentPaid({
    schedule,
    installmentId: "target",
    accountId: "account-id",
    reason: "Bank transfer verified",
    now,
    paidAt: now
  });

  assert.equal(result.newlySettled, true);
  assert.equal(schedule.status, EMI_SCHEDULE_STATUSES.SETTLED);
  assert.equal(schedule.settlementTime, now);
  assert.equal(schedule.overdueInstallments, 0);
  assert.equal(schedule.overdueAmount, 0);
  assert.equal(schedule.dpd, 0);
});

test("rejects missing and terminal installments", () => {
  const schedule = {
    status: EMI_SCHEDULE_STATUSES.ACTIVE,
    installments: [{ _id: id("paid"), emiAmount: 3000, paidAmount: 3000, status: "paid" }]
  };

  assert.throws(
    () =>
      markEmiInstallmentPaid({
        schedule,
        installmentId: "missing",
        accountId: "account-id",
        reason: "Test"
      }),
    (error) => error.code === "EMI_INSTALLMENT_NOT_FOUND" && error.statusCode === 404
  );

  assert.throws(
    () =>
      markEmiInstallmentPaid({
        schedule,
        installmentId: "paid",
        accountId: "account-id",
        reason: "Test"
      }),
    (error) => error.code === "EMI_INSTALLMENT_NOT_MARKABLE" && error.statusCode === 409
  );
});
