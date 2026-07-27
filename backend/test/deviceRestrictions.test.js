import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDeviceRestrictionState,
  normalizeDeviceRestrictions
} from "../src/constants/deviceRestrictions.js";
import {
  buildDeviceRestrictionUpdate,
  formatLatestRestrictionCommand,
  shouldAdvanceAppliedRestrictionState,
  validateDeviceRestrictionRetry,
  validateDeviceRestrictionUpdate
} from "../src/services/deviceRestrictions.service.js";
import {
  buildDeviceCommandDeliveryFilter,
  buildPolicyUpdateMessage
} from "../src/jobs/fcmDeliveryWorker.js";

test("exposes persisted per-key results without fabricating missing results", () => {
  const results = {
    dialer: { status: "applied" },
    playStore: { status: "failed" }
  };
  assert.deepEqual(
    formatLatestRestrictionCommand({
      _id: "command-id",
      status: "failed",
      ackPayload: { restrictionResults: results }
    }),
    {
      _id: "command-id",
      commandId: "command-id",
      status: "failed",
      ackPayload: { restrictionResults: results },
      restrictionResults: results
    }
  );
  assert.equal(
    formatLatestRestrictionCommand({
      _id: "historical-command",
      ackPayload: {}
    }).restrictionResults,
    null
  );
});

test("normalizes missing restriction state to unlocked defaults", () => {
  assert.deepEqual(normalizeDeviceRestrictionState(), {
    desired: {
      dialer: false,
      camera: false,
      whatsapp: false,
      youtube: false,
      playStore: false
    },
    applied: {
      dialer: false,
      camera: false,
      whatsapp: false,
      youtube: false,
      playStore: false
    },
    desiredVersion: 0,
    appliedVersion: 0,
    updatedAt: null,
    appliedAt: null,
    updatedBy: null
  });
});

test("keeps only supported restriction keys", () => {
  assert.deepEqual(
    normalizeDeviceRestrictions({
      dialer: true,
      camera: true,
      arbitraryPackage: true
    }),
    {
      dialer: true,
      camera: true,
      whatsapp: false,
      youtube: false,
      playStore: false
    }
  );
});

test("validates restriction updates and retry requests", () => {
  assert.deepEqual(
    validateDeviceRestrictionUpdate({
      restriction: "playStore",
      locked: true,
      retry: true
    }),
    {
      value: {
        restriction: "playStore",
        locked: true,
        retry: true
      }
    }
  );
  assert.match(
    validateDeviceRestrictionUpdate({ restriction: "settings", locked: true }).error,
    /restriction must be/
  );
  assert.equal(
    validateDeviceRestrictionUpdate({ restriction: "camera", locked: "true" }).error,
    "locked must be a boolean"
  );
});

test("increments normal updates and reuses the desired version for retries", () => {
  const restrictionState = {
    desired: { camera: true },
    applied: { camera: false },
    desiredVersion: 8,
    appliedVersion: 7
  };

  const update = buildDeviceRestrictionUpdate({
    restrictionState,
    restriction: "youtube",
    locked: true
  });
  const retry = buildDeviceRestrictionUpdate({
    restrictionState,
    restriction: "camera",
    locked: true,
    retry: true
  });

  assert.equal(update.desiredVersion, 9);
  assert.equal(update.desired.youtube, true);
  assert.equal(retry.desiredVersion, 8);
  assert.equal(retry.reuseVersion, true);
});

test("does not regress applied state for out-of-order acknowledgements", () => {
  assert.equal(
    shouldAdvanceAppliedRestrictionState({
      currentAppliedVersion: 6,
      acknowledgedVersion: 5
    }),
    false
  );
  assert.equal(
    shouldAdvanceAppliedRestrictionState({
      currentAppliedVersion: 6,
      acknowledgedVersion: 7
    }),
    true
  );
});

test("allows retries only for the current unapplied desired value", () => {
  const restrictionState = {
    desired: { camera: true },
    applied: { camera: false },
    desiredVersion: 4,
    appliedVersion: 3
  };

  assert.equal(
    validateDeviceRestrictionRetry({
      restrictionState,
      restriction: "camera",
      locked: true,
      retry: true
    }),
    null
  );
  assert.match(
    validateDeviceRestrictionRetry({
      restrictionState,
      restriction: "camera",
      locked: false,
      retry: true
    }),
    /must match/
  );
});

test("sends restriction updates as a dedicated high-priority FCM command", () => {
  const message = buildPolicyUpdateMessage({
    device: {
      fcmToken: "fcm-token",
      currentPolicyKey: "EMI_PAID",
      desiredPolicyVersion: 1
    },
    command: {
      _id: "command-id",
      commandType: "RESTRICTIONS_UPDATE",
      payload: {
        restrictionVersion: 3,
        restrictions: {
          dialer: false,
          camera: true,
          whatsapp: false,
          youtube: false,
          playStore: true
        }
      }
    }
  });

  assert.equal(message.data.type, "RESTRICTIONS_UPDATE");
  assert.equal(message.data.restrictionVersion, "3");
  assert.equal(message.data.restrictions, JSON.stringify({
    dialer: false,
    camera: true,
    whatsapp: false,
    youtube: false,
    playStore: true
  }));
  assert.equal(message.android.priority, "high");
});

test("automatically retries delivery failures but not device enforcement failures", () => {
  const now = new Date("2026-07-24T10:00:00.000Z");
  const filter = buildDeviceCommandDeliveryFilter({ now });

  assert.deepEqual(filter.$and[0], {
    $or: [
      { status: "pending" },
      {
        status: "failed",
        failureSource: { $ne: "device_enforcement" }
      }
    ]
  });
  assert.equal(filter.$and[1].$or[2].nextRetryAt.$lte, now);
});
