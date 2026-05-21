import { NextResponse } from "next/server";

import { SUPER_ADMIN_COOKIE } from "@/lib/constants";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SUPER_ADMIN_COOKIE);
  return response;
}
