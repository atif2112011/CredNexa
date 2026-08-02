import { NextResponse } from "next/server";
import { z } from "zod";

import { BACKEND_API_URL, SUPER_ADMIN_COOKIE, SUPER_ADMIN_EMAIL_COOKIE } from "@/lib/constants";
import { getBackendProxyHeaders } from "@/lib/backend-proxy-headers";
import type { ApiResponse } from "@/types/api";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private"
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

type LoginData = {
  accessToken: string;
  account: {
    role: string;
    name: string;
    email: string;
  };
};

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid email and password." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${BACKEND_API_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getBackendProxyHeaders(request.headers)
      },
      body: JSON.stringify({ ...parsed.data, role: "super_admin" }),
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      { error: "Login service is temporarily unavailable. Please try again." },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  const payload = (await backendResponse.json().catch(() => null)) as ApiResponse<LoginData> | null;
  if (!backendResponse.ok || !payload?.success) {
    if (backendResponse.status === 401) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const status = backendResponse.status === 429 ? 429 : 503;
    const response = NextResponse.json(
      {
        error:
          backendResponse.status === 429
            ? payload?.error || "Too many requests. Please try again later."
            : "Login service is temporarily unavailable. Please try again."
      },
      { status, headers: NO_STORE_HEADERS }
    );
    const retryAfter = backendResponse.headers.get("retry-after");
    if (retryAfter) response.headers.set("Retry-After", retryAfter);
    return response;
  }

  if (payload.data.account.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can access this portal." },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const response = NextResponse.json(
    { account: payload.data.account },
    { headers: NO_STORE_HEADERS }
  );

  response.cookies.set(SUPER_ADMIN_COOKIE, payload.data.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  response.cookies.set(SUPER_ADMIN_EMAIL_COOKIE, payload.data.account.email, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });

  const setCookie = backendResponse.headers.get("set-cookie");
  if (setCookie) {
    response.headers.append("set-cookie", setCookie.replace(/Path=[^;]+/i, "Path=/"));
  }

  return response;
}
