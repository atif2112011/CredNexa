import { NextResponse } from "next/server";

import { REFRESH_COOKIE, SUPER_ADMIN_COOKIE, SUPER_ADMIN_EMAIL_COOKIE } from "@/lib/constants";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const account = await getCurrentUser({ redirectOnFail: false });

  if (!account) {
    const response = NextResponse.json({ error: "Authentication required" }, { status: 401 });
    response.cookies.delete(SUPER_ADMIN_COOKIE);
    response.cookies.delete(SUPER_ADMIN_EMAIL_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  }

  return NextResponse.json({ account });
}
