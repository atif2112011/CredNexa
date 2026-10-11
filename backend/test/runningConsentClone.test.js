import assert from "node:assert/strict";
import test from "node:test";

import { buildRunningConsentFromOwner } from "../src/services/runningConsentClone.service.js";

test("running consent copies owner agreement but removes impossible Device Owner claims", () => {
  const owner = {
    version: "1.4", isCurrent: true, enrollmentMode: "DEVICE_OWNER_QR",
    borrowerAgreementText: "Agreement [USER NAME]",
    deviceControlConsentText: [
      "Prevent factory reset, safe mode, debugging, or removal of device management.",
      "Restrict access to non-essential apps if an EMI remains overdue.",
      "Continue the last applicable restriction while the device is offline.",
      "I understand that EMI Shield will not remotely erase my personal data or monitor my calls, messages, photos, microphone, or location."
    ].join("\n"),
    privacyPolicyText: "Privacy [SELLER NAME]",
    tripartiteAckText: "Acknowledgement"
  };
  const running = buildRunningConsentFromOwner(owner);
  assert.equal(running.version, "running-1.4");
  assert.equal(running.enrollmentMode, "RUNNING_APP");
  assert.equal(running.borrowerAgreementText, owner.borrowerAgreementText);
  assert.equal(running.tripartiteAckText, owner.tripartiteAckText);
  assert.match(running.deviceControlConsentText, /app-controlled lock overlay/);
  assert.match(running.deviceControlConsentText, /cannot prevent factory reset/);
  assert.match(running.deviceControlConsentText, /one-time device location/);
  assert.match(running.privacyPolicyText, /separately consent/);
  assert.throws(() => buildRunningConsentFromOwner({ ...owner, deviceControlConsentText: "changed" }), /changed/);
});
