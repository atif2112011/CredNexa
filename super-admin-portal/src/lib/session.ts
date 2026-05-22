import { redirect } from "next/navigation";

import { BACKEND_API_URL, SUPER_ADMIN_COOKIE } from "@/lib/constants";
import type { ApiResponse, RecordItem } from "@/types/api";

type RefreshData = {
  accessToken: string;
  tokenType: string;
};

type CurrentUserData = {
  account: RecordItem;
};

export async function refreshAccessToken(cookieHeader?: string | null) {
  const headers: HeadersInit = {
    "Content-Type": "application/json"
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const backendResponse = await fetch(`${BACKEND_API_URL}/auth/refresh-token`, {
    method: "POST",
    headers,
    cache: "no-store"
  });

  const payload = (await backendResponse.json().catch(() => null)) as ApiResponse<RefreshData> | null;

  if (!backendResponse.ok || !payload?.success || !payload.data.accessToken) {
    return null;
  }

  return payload.data.accessToken;
}

export async function getCurrentUser({ redirectOnFail = true }: { redirectOnFail?: boolean } = {}) {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get(SUPER_ADMIN_COOKIE)?.value;

  if (!token) {
    if (redirectOnFail) redirect("/login");
    return null;
  }

  let response = await fetch(`${BACKEND_API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  if (response.status === 401) {
    if (redirectOnFail) redirect("/login");
    return null;
  }

  const payload = (await response.json().catch(() => null)) as ApiResponse<CurrentUserData> | null;

  if (!response.ok || !payload?.success || payload.data.account.role !== "super_admin") {
    if (redirectOnFail) redirect("/login");
    return null;
  }

  return payload.data.account;
}
