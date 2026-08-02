import assert from "node:assert/strict";
import test from "node:test";

import { resolveRateLimitClientIp } from "../src/middleware/rateLimiters.js";

const buildRequest = ({ headers = {}, ip = "10.0.0.10" } = {}) => ({
  headers,
  ip,
  socket: { remoteAddress: ip },
  get(name) {
    return this.headers[String(name).toLowerCase()];
  }
});

test("uses the forwarded Vercel client IP when the proxy secret matches", () => {
  const request = buildRequest({
    headers: {
      "x-crednexa-client-ip": "203.0.113.25",
      "x-crednexa-proxy-secret": "shared-secret"
    }
  });

  assert.equal(resolveRateLimitClientIp(request, "shared-secret"), "203.0.113.25");
});

test("ignores a spoofed client IP when the proxy secret is absent or incorrect", () => {
  const request = buildRequest({
    headers: {
      "x-crednexa-client-ip": "203.0.113.25",
      "x-crednexa-proxy-secret": "wrong-secret"
    },
    ip: "10.0.0.20"
  });

  assert.equal(resolveRateLimitClientIp(request, "shared-secret"), "10.0.0.20");
});

test("rejects invalid forwarded IP values even from a trusted proxy", () => {
  const request = buildRequest({
    headers: {
      "x-crednexa-client-ip": "not-an-ip",
      "x-crednexa-proxy-secret": "shared-secret"
    },
    ip: "10.0.0.30"
  });

  assert.equal(resolveRateLimitClientIp(request, "shared-secret"), "10.0.0.30");
});
