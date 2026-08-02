import { BACKEND_PROXY_SECRET } from "@/lib/constants";

const normalizeClientIp = (value: string | null) => String(value || "").split(",")[0].trim();

export function getBackendProxyHeaders(requestHeaders?: Headers | null): Record<string, string> {
  if (!requestHeaders || !BACKEND_PROXY_SECRET) return {};

  const clientIp = normalizeClientIp(
    requestHeaders.get("x-vercel-forwarded-for") ||
      requestHeaders.get("x-forwarded-for") ||
      requestHeaders.get("x-real-ip")
  );

  if (!clientIp) return {};

  return {
    "X-CredNexa-Client-IP": clientIp,
    "X-CredNexa-Proxy-Secret": BACKEND_PROXY_SECRET
  };
}
