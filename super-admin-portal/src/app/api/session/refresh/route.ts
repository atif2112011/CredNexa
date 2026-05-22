import { NextResponse } from "next/server";

import { REFRESH_COOKIE, SUPER_ADMIN_COOKIE, SUPER_ADMIN_EMAIL_COOKIE } from "@/lib/constants";
import { refreshAccessToken } from "@/lib/session";

export async function POST(request: Request) {
  const accessToken = await refreshAccessToken(request.headers.get("cookie"));

  if (!accessToken) {
    const response = NextResponse.json({ error: "Session expired" }, { status: 401 });
    response.cookies.delete(SUPER_ADMIN_COOKIE);
    response.cookies.delete(SUPER_ADMIN_EMAIL_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  }

  const response = NextResponse.json({ accessToken });
  response.cookies.set(SUPER_ADMIN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  return response;
}
