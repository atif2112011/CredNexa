import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_API_URL, REFRESH_COOKIE, SUPER_ADMIN_COOKIE, SUPER_ADMIN_EMAIL_COOKIE } from "@/lib/constants";
import type { ApiResponse, RecordItem } from "@/types/api";

const protectedPrefixes = [
  "/dashboard",
  "/partners",
  "/tenants",
  "/accounts",
  "/consent-versions",
  "/escalations",
  "/devices",
  "/risk-flags",
  "/audit-logs"
];

type CurrentUserData = {
  account: RecordItem;
};

type RefreshData = {
  accessToken: string;
};

function isProtectedPath(pathname: string) {
  return protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToLogin(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SUPER_ADMIN_COOKIE);
  response.cookies.delete(SUPER_ADMIN_EMAIL_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}

async function fetchCurrentUser(accessToken: string) {
  const response = await fetch(`${BACKEND_API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as ApiResponse<CurrentUserData> | null;

  if (!response.ok || !payload?.success || payload.data.account.role !== "super_admin") {
    return null;
  }

  return payload.data.account;
}

async function refreshToken(cookieHeader: string) {
  const response = await fetch(`${BACKEND_API_URL}/auth/refresh-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader
    },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as ApiResponse<RefreshData> | null;

  if (!response.ok || !payload?.success) {
    return null;
  }

  return payload.data.accessToken;
}

export async function middleware(request: NextRequest) {
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  const cookieHeader = request.headers.get("cookie") || "";
  let accessToken = request.cookies.get(SUPER_ADMIN_COOKIE)?.value;
  let account = accessToken ? await fetchCurrentUser(accessToken) : null;

  if (!account) {
    const refreshedToken = await refreshToken(cookieHeader);

    if (!refreshedToken) {
      return redirectToLogin(request);
    }

    accessToken = refreshedToken;
    account = await fetchCurrentUser(refreshedToken);

    if (!account) {
      return redirectToLogin(request);
    }

    requestHeaders.set("cookie", `${cookieHeader}; ${SUPER_ADMIN_COOKIE}=${refreshedToken}`);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.set(SUPER_ADMIN_COOKIE, refreshedToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
    response.cookies.set(SUPER_ADMIN_EMAIL_COOKIE, String(account.email || ""), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
    return response;
  }

  const response = NextResponse.next();
  if (account.email) {
    response.cookies.set(SUPER_ADMIN_EMAIL_COOKIE, String(account.email), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
  }
  return response;
}
