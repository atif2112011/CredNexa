import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BACKEND_API_URL, SUPER_ADMIN_COOKIE } from "@/lib/constants";

type Params = {
  params: Promise<{ path: string[] }>;
};

async function proxy(request: Request, { params }: Params) {
  const { path } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SUPER_ADMIN_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const incomingUrl = new URL(request.url);
  const backendUrl = new URL(`${BACKEND_API_URL}/admin/${path.join("/")}`);
  backendUrl.search = incomingUrl.search;

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const response = await fetch(backendUrl.toString(), {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: hasBody ? await request.text() : undefined
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" }
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
