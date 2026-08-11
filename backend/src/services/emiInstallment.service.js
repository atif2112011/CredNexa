import { settleCompletedSchedule } from "./deviceRelease.service.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MARKABLE_INSTALLMENT_STATUSES = new Set(["pending", "overdue", "partial"]);

const startOfUtcDay = (date) => {
  const value = new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
};

const getInstallmentOutstanding = (installment) => {
  const totalPayable = Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0);
  return Math.max(totalPayable - Number(installment.paidAmount || 0), 0);
};

export const markEmiInstallmentPaid = ({
  schedule,
  installmentId,
  accountId,
  reason,
  reference,
  paidAt = new Date(),
  now = new Date()
}) => {
  const installment = schedule?.installments?.find(
    (item) => item._id?.toString() === installmentId?.toString()
  );

  if (!installment) {
    const error = new Error("EMI installment not found");
    error.statusCode = 404;
    error.code = "EMI_INSTALLMENT_NOT_FOUND";
    throw error;
  }

  if (!MARKABLE_INSTALLMENT_STATUSES.has(installment.status)) {
    const error = new Error(`EMI installment cannot be marked paid from status ${installment.status}`);
    error.statusCode = 409;
    error.code = "EMI_INSTALLMENT_NOT_MARKABLE";
    throw error;
  }

  const outstandingAmount = getInstallmentOutstanding(installment);
  const totalPayable = Number(installment.emiAmount || 0) + Number(installment.penaltyAmount || 0);
  installment.status = "paid";
  installment.paidAmount = totalPayable;
  installment.paidAt = paidAt;
  installment.markedPaidBy = accountId;
  installment.markPaidReason = reason;
  installment.markPaidReference = reference || undefined;

  const overdueInstallments = schedule.installments.filter((item) =>
    ["overdue", "partial"].includes(item.status)
  );
  schedule.overdueInstallments = overdueInstallments.length;
  schedule.overdueAmount = overdueInstallments.reduce(
    (sum, item) => sum + getInstallmentOutstanding(item),
    0
  );
  schedule.dpd = overdueInstallments.reduce((maximumDpd, item) => {
    const installmentDpd = Math.max(
      Math.floor(
        (startOfUtcDay(now).getTime() - startOfUtcDay(item.dueDate).getTime()) / DAY_IN_MS
      ),
      0
    );
    return Math.max(maximumDpd, installmentDpd);
  }, 0);

  const settlement = settleCompletedSchedule(schedule, now);

  return {
    installment,
    outstandingAmount,
    totalPayable,
    ...settlement
  };
};
