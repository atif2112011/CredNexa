import { NextResponse } from "next/server";
import { z } from "zod";

import { BACKEND_API_URL, SUPER_ADMIN_COOKIE } from "@/lib/constants";
import type { ApiResponse } from "@/types/api";

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
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const backendResponse = await fetch(`${BACKEND_API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data)
  });

  const payload = (await backendResponse.json()) as ApiResponse<LoginData>;
  if (!backendResponse.ok || !payload.success) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (payload.data.account.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can access this portal." }, { status: 403 });
  }

  const response = NextResponse.json({
    account: payload.data.account
  });

  response.cookies.set(SUPER_ADMIN_COOKIE, payload.data.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });

  return response;
}
