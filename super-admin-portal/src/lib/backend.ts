import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BACKEND_API_URL, SUPER_ADMIN_COOKIE } from "@/lib/constants";
import { refreshAccessToken } from "@/lib/session";
import type { ApiResponse } from "@/types/api";

type FetchOptions = RequestInit & {
  query?: Record<string, string | number | boolean | undefined>;
};

function buildUrl(path: string, query?: FetchOptions["query"]) {
  const url = new URL(`${BACKEND_API_URL}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

export async function backendFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const cookieStore = await cookies();
  let token = cookieStore.get(SUPER_ADMIN_COOKIE)?.value;

  if (!token) {
    const refreshedToken = await refreshAccessToken(cookieStore.toString());
    token = refreshedToken || undefined;
  }

  if (!token) {
    redirect("/login");
  }

  let response = await fetch(buildUrl(path, options.query), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    const refreshedToken = await refreshAccessToken(cookieStore.toString());

    if (!refreshedToken) {
      redirect("/login");
    }

    response = await fetch(buildUrl(path, options.query), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${refreshedToken}`,
        ...options.headers
      },
      cache: "no-store"
    });
  }

  if (response.status === 401) {
    redirect("/login");
  }

  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Request failed");
  }

  return payload.data;
}
