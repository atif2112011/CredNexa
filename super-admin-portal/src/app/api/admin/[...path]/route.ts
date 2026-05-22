import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BACKEND_API_URL, SUPER_ADMIN_COOKIE } from "@/lib/constants";
import { refreshAccessToken } from "@/lib/session";

type Params = {
  params: Promise<{ path: string[] }>;
};

async function proxy(request: Request, { params }: Params) {
  const { path } = await params;
  const cookieStore = await cookies();
  let token = cookieStore.get(SUPER_ADMIN_COOKIE)?.value;
  let refreshedAccessToken: string | null = null;
  if (!token) {
    const refreshedToken = await refreshAccessToken(request.headers.get("cookie"));
    token = refreshedToken || undefined;
    refreshedAccessToken = refreshedToken;
  }
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const incomingUrl = new URL(request.url);
  const backendUrl = new URL(`${BACKEND_API_URL}/admin/${path.join("/")}`);
  backendUrl.search = incomingUrl.search;

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const body = hasBody ? await request.text() : undefined;
  const requestInit = (accessToken: string) => ({
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body
  });
  let response = await fetch(backendUrl.toString(), requestInit(token));

  if (response.status === 401) {
    const refreshedToken = await refreshAccessToken(request.headers.get("cookie"));

    if (!refreshedToken) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    response = await fetch(backendUrl.toString(), requestInit(refreshedToken));
    refreshedAccessToken = refreshedToken;
  }

  const text = await response.text();
  const proxyResponse = new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" }
  });
  if (refreshedAccessToken) {
    proxyResponse.cookies.set(SUPER_ADMIN_COOKIE, refreshedAccessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
  }
  return proxyResponse;
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
