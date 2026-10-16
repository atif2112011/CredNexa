import assert from "node:assert/strict";
import test from "node:test";

import bcrypt from "bcryptjs";

import { env, parseTestOtpMobilePrefix } from "../src/config/env.js";
import { OtpRecord } from "../src/models/OtpRecord.js";
import {
  isTestOtpMobile,
  MOCK_OTP,
  OTP_PROVIDERS,
  resendOtp,
  resolveOtpProvider,
  sendOtp,
  verifyOtpCode
} from "../src/services/otp.service.js";

const TEST_MOBILE_PREFIX = "99999000";

test("temporary device-testing numbers use mock OTP without bypassing nearby numbers", () => {
  for (const mobile of ["9336616695", "9336616697", "9336616698", "+91 9336616695", "09336616697"]) {
    assert.equal(resolveOtpProvider({ mobile, configuredProvider: OTP_PROVIDERS.MSG91, testMobilePrefix: "" }), OTP_PROVIDERS.MOCK);
  }
  for (const mobile of ["9336616694", "9336616696", "9336616699"]) {
    assert.equal(resolveOtpProvider({ mobile, configuredProvider: OTP_PROVIDERS.MSG91, testMobilePrefix: "" }), OTP_PROVIDERS.MSG91);
  }
});

test("recognizes the complete configured test-number range", () => {
  assert.equal(isTestOtpMobile("9999900000", TEST_MOBILE_PREFIX), true);
  assert.equal(isTestOtpMobile("9999900042", TEST_MOBILE_PREFIX), true);
  assert.equal(isTestOtpMobile("9999900099", TEST_MOBILE_PREFIX), true);
  assert.equal(isTestOtpMobile("+91 9999900042", TEST_MOBILE_PREFIX), true);
  assert.equal(isTestOtpMobile("9999899999", TEST_MOBILE_PREFIX), false);
  assert.equal(isTestOtpMobile("9999900100", TEST_MOBILE_PREFIX), false);
  assert.equal(isTestOtpMobile("9876543210", TEST_MOBILE_PREFIX), false);
});

test("overrides MSG91 only for configured test numbers", () => {
  assert.equal(
    resolveOtpProvider({
      mobile: "9999900000",
      configuredProvider: OTP_PROVIDERS.MSG91,
      testMobilePrefix: TEST_MOBILE_PREFIX
    }),
    OTP_PROVIDERS.MOCK
  );
  assert.equal(
    resolveOtpProvider({
      mobile: "9876543210",
      configuredProvider: OTP_PROVIDERS.MSG91,
      testMobilePrefix: TEST_MOBILE_PREFIX
    }),
    OTP_PROVIDERS.MSG91
  );
  assert.equal(
    resolveOtpProvider({
      mobile: "9999900000",
      configuredProvider: OTP_PROVIDERS.MSG91,
      testMobilePrefix: ""
    }),
    OTP_PROVIDERS.MSG91
  );
});

test("validates the optional test mobile prefix", () => {
  assert.equal(parseTestOtpMobilePrefix(undefined), "");
  assert.equal(parseTestOtpMobilePrefix(" 99999000 "), TEST_MOBILE_PREFIX);
  assert.throws(() => parseTestOtpMobilePrefix("99999x00"), /exactly 8 digits/);
  assert.throws(() => parseTestOtpMobilePrefix("9999900"), /exactly 8 digits/);
  assert.throws(() => parseTestOtpMobilePrefix("999990000"), /exactly 8 digits/);
});

test("test-number sessions remain mock for send, verification, and resend", async (t) => {
  const previousProvider = env.otpProvider;
  const previousPrefix = env.testOtpMobilePrefix;
  let createdRecord;
  let fetchCalls = 0;

  env.otpProvider = OTP_PROVIDERS.MSG91;
  env.testOtpMobilePrefix = TEST_MOBILE_PREFIX;

  t.mock.method(OtpRecord, "create", async (record) => {
    createdRecord = record;
    return record;
  });
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls += 1;
    throw new Error("MSG91 must not be called for a test number");
  });

  try {
    const result = await sendOtp({
      mobile: "9999900042",
      purpose: "partner_signup",
      flowType: "PARTNER_SIGNUP"
    });

    assert.match(result.verificationSessionId, /^otp_/);
    assert.equal(createdRecord.provider, OTP_PROVIDERS.MOCK);
    assert.equal(createdRecord.providerResponse.mode, "mock");
    assert.equal(await bcrypt.compare(MOCK_OTP, createdRecord.otpHash), true);

    const otpRecord = {
      ...createdRecord,
      providerResponse: {
        ...createdRecord.providerResponse,
        lastSentAt: new Date(Date.now() - 60_000)
      },
      saveCalls: 0,
      async save() {
        this.saveCalls += 1;
      }
    };

    assert.equal(await verifyOtpCode({ otpRecord, otp: MOCK_OTP }), true);
    assert.equal(await verifyOtpCode({ otpRecord, otp: "654321" }), false);

    const resendResult = await resendOtp({ otpRecord });
    assert.equal(resendResult.providerReferenceId, createdRecord.providerReferenceId);
    assert.equal(otpRecord.providerResponse.status, "OTP_RESENT");
    assert.equal(otpRecord.saveCalls, 1);
    assert.equal(fetchCalls, 0);
  } finally {
    env.otpProvider = previousProvider;
    env.testOtpMobilePrefix = previousPrefix;
  }
});
