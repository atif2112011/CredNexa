import type { Pagination } from "@/types/api";

export type EnrollmentMode = "DEVICE_OWNER_QR" | "RUNNING_APP";
export type DevDealer = { _id: string; name: string; deviceControlMode: "MANUAL" | "EMI_AUTOMATED"; creditBalance: number };
export type DevBorrower = {
  _id: string; name: string; mobile: string; loanId: string; enrollmentMode: EnrollmentMode;
  tenantId: { _id: string; name: string } | null; deviceControlMode: "MANUAL" | "EMI_AUTOMATED";
  isActive: boolean; isDeviceLinked: boolean; linkedDeviceId: string | null; canShowQr: boolean;
  enrollmentStatus: "PROVISIONED" | "LINKED_DEVICE_UNAVAILABLE" | "INACTIVE" | "PENDING_ENROLLMENT";
  createdAt: string;
};
export type DevBorrowerList = { items: DevBorrower[]; pagination: Pagination; otp: string };
export type DevDealerList = { items: DevDealer[]; pagination: Pagination };
export type DevCreation = {
  borrower: { id: string; name: string; mobile: string; loanId: string; enrollmentMode: EnrollmentMode };
  creditsCharged: 0; otp: string;
};
export type DevQr = { enrollmentMode: EnrollmentMode; qrCodeDataUrl: string; tokenExpiresAt: string; otp: string };
export const provisioningLabel = (mode: EnrollmentMode) => mode === "RUNNING_APP" ? "Running Provisioned" : "QR Provisioned";
export const dealerModeLabel = (mode: string) => mode === "MANUAL" ? "Manual" : "Automatic";
