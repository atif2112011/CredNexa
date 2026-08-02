import { redirect } from "next/navigation";

import { BACKEND_API_URL, SUPER_ADMIN_COOKIE } from "@/lib/constants";
import { getBackendProxyHeaders } from "@/lib/backend-proxy-headers";
import type { ApiResponse, RecordItem } from "@/types/api";

type RefreshData = {
  accessToken: string;
  tokenType: string;
};

type CurrentUserData = {
  account: RecordItem;
};

export async function refreshAccessToken(cookieHeader?: string | null, incomingHeaders?: Headers | null) {
  const requestHeaders = incomingHeaders || (await import("next/headers").then(({ headers }) => headers()));
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...getBackendProxyHeaders(requestHeaders)
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
  const { cookies, headers } = await import("next/headers");
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const token = cookieStore.get(SUPER_ADMIN_COOKIE)?.value;

  if (!token) {
    if (redirectOnFail) redirect("/login");
    return null;
  }

  let response = await fetch(`${BACKEND_API_URL}/auth/me`, {
    headers: {
      ...getBackendProxyHeaders(requestHeaders),
      Authorization: `Bearer ${token}`
    },
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
