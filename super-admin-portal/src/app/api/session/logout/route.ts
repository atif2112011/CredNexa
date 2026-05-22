import { NextResponse } from "next/server";

import { BACKEND_API_URL, REFRESH_COOKIE, SUPER_ADMIN_COOKIE, SUPER_ADMIN_EMAIL_COOKIE } from "@/lib/constants";

export async function POST(request: Request) {
  await fetch(`${BACKEND_API_URL}/auth/logout`, {
    method: "POST",
    headers: {
      Cookie: request.headers.get("cookie") || ""
    }
  }).catch(() => null);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SUPER_ADMIN_COOKIE);
  response.cookies.delete(SUPER_ADMIN_EMAIL_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
