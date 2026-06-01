import { Router } from "express";

import { verifyJwt } from "../../middleware/verifyJwt.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import {
  activateQrCode,
  addQrCode,
  approvePayment,
  approveTenantUnlockRequest,
  deleteQrCode,
  generateEnrollmentQr,
  getBorrowersWithPendingEmis,
  getBorrowersWithOverdueEmis,
  getDashboard,
  getDistributorDeviceById,
  getDistributorDevices,
  getDistributorUserById,
  getDistributorUsers,
  getEnrollmentStatusByToken,
  getPaymentById,
  getTenantUnlockRequestByCaseId,
  getUserEmiInstallments,
  listPaymentApprovalRequests,
  listPendingPayments,
  listQrCodes,
  listTenantUnlockRequests,
  lockTenantDevice,
  regenerateEnrollmentQr,
  registerBorrower,
  rejectPayment,
  rejectTenantUnlockRequest,
  sendUpcomingPaymentCommand,
  tempUnlockTenantDevice,
  tempUnlockTenantUnlockRequest,
  unlockTenantDevice
} from "./distributor.controller.js";

export const distributorRoutes = Router();

distributorRoutes.use(verifyJwt);
distributorRoutes.use(requireTokenType("account"));
distributorRoutes.get("/dashboard", getDashboard);
distributorRoutes.post("/users/register", registerBorrower);
distributorRoutes.post("/enrollment/qr", generateEnrollmentQr);
distributorRoutes.get("/enrollments/:token/status", getEnrollmentStatusByToken);
distributorRoutes.get("/users", getDistributorUsers);
distributorRoutes.get("/users/pending-emis", getBorrowersWithPendingEmis);
distributorRoutes.get("/users/overdue-emis", getBorrowersWithOverdueEmis);
distributorRoutes.post("/users/:userId/enrollment/qr", regenerateEnrollmentQr);
distributorRoutes.get("/users/:id/emi-installments", getUserEmiInstallments);
distributorRoutes.get("/users/:id", getDistributorUserById);
distributorRoutes.get("/devices", getDistributorDevices);
distributorRoutes.get("/devices/:id", getDistributorDeviceById);
distributorRoutes.post("/devices/:id/upcoming-payment-reminder", sendUpcomingPaymentCommand);
distributorRoutes.post("/devices/:id/lock", lockTenantDevice);
distributorRoutes.post("/devices/:id/unlock", unlockTenantDevice);
distributorRoutes.post("/devices/:id/temp-unlock", tempUnlockTenantDevice);
distributorRoutes.get("/qr-codes", listQrCodes);
distributorRoutes.post("/qr-codes", addQrCode);
distributorRoutes.patch("/qr-codes/:qrId/activate", activateQrCode);
distributorRoutes.delete("/qr-codes/:qrId", deleteQrCode);
distributorRoutes.get("/payments/approval-requests", listPaymentApprovalRequests);
distributorRoutes.get("/payments/pending-approval", listPendingPayments);
distributorRoutes.get("/payments/:paymentId", getPaymentById);
distributorRoutes.post("/payments/:paymentId/approve", approvePayment);
distributorRoutes.post("/payments/:paymentId/reject", rejectPayment);
distributorRoutes.get("/unlock-requests", listTenantUnlockRequests);
distributorRoutes.get("/unlock-requests/:caseId", getTenantUnlockRequestByCaseId);
distributorRoutes.post("/unlock-requests/:caseId/approve", approveTenantUnlockRequest);
distributorRoutes.post("/unlock-requests/:caseId/temp-unlock", tempUnlockTenantUnlockRequest);
distributorRoutes.post("/unlock-requests/:caseId/reject", rejectTenantUnlockRequest);
