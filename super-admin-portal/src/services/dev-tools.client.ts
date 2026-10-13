"use client";

import type { ApiResponse } from "@/types/api";
import type { DevCreation, DevDealerList, DevQr, EnrollmentMode } from "@/types/dev-tools";

// Client interactions use the existing cookie-authenticated admin proxy. No
// operator JWT or dealer credential is exposed to the browser.
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin/dev-tools/${path}`, { ...options, cache: "no-store" });
  const payload = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok || !payload?.success) throw new Error(payload?.error || "Unable to reach Dev Tools. Please try again.");
  return payload.data;
}

export function getDevDealers(mode: EnrollmentMode, page: number, search: string, signal: AbortSignal) {
  const query = new URLSearchParams({ enrollmentMode: mode, page: String(page), limit: "20", search });
  return request<DevDealerList>(`dealers?${query}`, { signal });
}
export function createDevBorrower(tenantId: string, enrollmentMode: EnrollmentMode) {
  return request<DevCreation>("test-borrowers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId, enrollmentMode }) });
}
export function getDevBorrowerQr(userId: string, signal: AbortSignal) {
  return request<DevQr>(`test-borrowers/${encodeURIComponent(userId)}/enrollment/qr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal });
}
