import { Router } from "express";

import { verifyJwt } from "../../middleware/verifyJwt.js";
import { requireTokenType } from "../../middleware/requireTokenType.js";
import { parsePaymentProofUpload, parseTenantQrImageUpload } from "../../middleware/parsePaymentProofUpload.js";
import {
  activateQrCode,
  addQrCode,
  approvePayment,
  approveTenantUnlockRequest,
  deleteQrCode,
  generateEnrollmentQr,
  getBorrowersWithPendingEmis,
  getBorrowersWithOverdueEmis,
  getCreditPurchaseOptions,
  getCreditPurchaseRequestById,
  getDashboard,
  getDistributorDeviceById,
  getDistributorDevices,
  getDistributorUserById,
  getDistributorUsers,
  getEnrollmentStatusByToken,
  getPaymentById,
  getTenantUnlockRequestByCaseId,
  getUserEmiInstallments,
  listCreditPurchaseRequests,
  listPaymentApprovalRequests,
  listPendingPayments,
  listQrCodes,
  listTenantUnlockRequests,
  lockTenantDevice,
  regenerateEnrollmentQr,
  registerBorrower,
  rejectPayment,
  rejectTenantUnlockRequest,
  requestTenantDeviceLocation,
  sendBulkOverdueEmiReminders,
  sendOverdueEmiReminder,
  sendUpcomingPaymentCommand,
  submitCreditPurchaseRequest,
  tempUnlockTenantDevice,
  tempUnlockTenantUnlockRequest,
  updateTenantAdhaarVerification,
  updateTenantDeviceRestrictions,
  updateTenantFactoryResetControl,
  updateTenantUsbDebuggingControl,
  updateTenantUnknownAppInstallsControl,
  unlockTenantDevice
} from "./distributor.controller.js";

export const distributorRoutes = Router();

distributorRoutes.use(verifyJwt);
distributorRoutes.use(requireTokenType("account"));
distributorRoutes.get("/dashboard", getDashboard);
distributorRoutes.patch("/settings/adhaar-verification", updateTenantAdhaarVerification);
distributorRoutes.get("/credits/purchase/options", getCreditPurchaseOptions);
distributorRoutes.get("/credits/purchase/requests", listCreditPurchaseRequests);
distributorRoutes.post("/credits/purchase/requests", parsePaymentProofUpload, submitCreditPurchaseRequest);
distributorRoutes.get("/credits/purchase/requests/:requestId", getCreditPurchaseRequestById);
distributorRoutes.post("/users/register", registerBorrower);
distributorRoutes.post("/enrollment/qr", generateEnrollmentQr);
distributorRoutes.get("/enrollments/:token/status", getEnrollmentStatusByToken);
distributorRoutes.get("/users", getDistributorUsers);
distributorRoutes.get("/users/pending-emis", getBorrowersWithPendingEmis);
distributorRoutes.get("/users/overdue-emis", getBorrowersWithOverdueEmis);
distributorRoutes.post("/users/overdue-emis/reminders", sendBulkOverdueEmiReminders);
distributorRoutes.post("/users/:userId/overdue-emi-reminder", sendOverdueEmiReminder);
distributorRoutes.post("/users/:userId/enrollment/qr", regenerateEnrollmentQr);
distributorRoutes.get("/users/:id/emi-installments", getUserEmiInstallments);
distributorRoutes.get("/users/:id", getDistributorUserById);
distributorRoutes.get("/devices", getDistributorDevices);
distributorRoutes.get("/devices/:id", getDistributorDeviceById);
distributorRoutes.post("/devices/:id/upcoming-payment-reminder", sendUpcomingPaymentCommand);
distributorRoutes.post("/devices/:id/lock", lockTenantDevice);
distributorRoutes.post("/devices/:id/unlock", unlockTenantDevice);
distributorRoutes.post("/devices/:id/temp-unlock", tempUnlockTenantDevice);
distributorRoutes.patch("/devices/:id/restrictions", updateTenantDeviceRestrictions);
distributorRoutes.patch("/devices/:id/controls/factory-reset", updateTenantFactoryResetControl);
distributorRoutes.patch("/devices/:id/controls/usb-debugging", updateTenantUsbDebuggingControl);
distributorRoutes.patch("/devices/:id/controls/unknown-app-installs", updateTenantUnknownAppInstallsControl);
distributorRoutes.post("/devices/:id/location-request", requestTenantDeviceLocation);
distributorRoutes.get("/qr-codes", listQrCodes);
distributorRoutes.post("/qr-codes", parseTenantQrImageUpload, addQrCode);
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
