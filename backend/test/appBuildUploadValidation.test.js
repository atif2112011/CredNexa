import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";

import {
  MAX_DIRECT_APK_BYTES,
  hasApkZipSignature,
  inspectApkReadable,
  validateStoredApkMetadata,
  validateDirectApkDescriptor
} from "../src/services/appBuildUploadValidation.js";

test("accepts an APK descriptor at the 500 MB boundary", () => {
  const result = validateDirectApkDescriptor({
    fileName: "borrower-release.apk",
    fileSize: MAX_DIRECT_APK_BYTES,
    mimeType: "application/vnd.android.package-archive"
  });

  assert.deepEqual(result.value, {
    fileName: "borrower-release.apk",
    fileSize: MAX_DIRECT_APK_BYTES,
    mimeType: "application/vnd.android.package-archive"
  });
});

test("rejects an APK descriptor above 500 MB", () => {
  const result = validateDirectApkDescriptor({
    fileName: "borrower-release.apk",
    fileSize: MAX_DIRECT_APK_BYTES + 1,
    mimeType: "application/vnd.android.package-archive"
  });

  assert.equal(result.error, "APK file must be 500 MB or smaller");
});

test("rejects unsupported extensions and MIME types", () => {
  assert.equal(
    validateDirectApkDescriptor({
      fileName: "borrower-release.zip",
      fileSize: 100,
      mimeType: "application/zip"
    }).error,
    "APK file must use the .apk extension"
  );
  assert.equal(
    validateDirectApkDescriptor({
      fileName: "borrower-release.apk",
      fileSize: 100,
      mimeType: "text/plain"
    }).error,
    "APK file must use an Android package or ZIP MIME type"
  );
});

test("normalizes a missing browser MIME type and validates ZIP signatures", () => {
  const result = validateDirectApkDescriptor({
    fileName: "borrower-release.APK",
    fileSize: 100,
    mimeType: ""
  });

  assert.equal(result.value.mimeType, "application/vnd.android.package-archive");
  assert.equal(hasApkZipSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(hasApkZipSignature(Buffer.from("not-an-apk")), false);
});

test("validates Firebase object metadata against the authorized upload", () => {
  const expected = {
    expectedSize: 1024,
    expectedMimeType: "application/vnd.android.package-archive"
  };

  assert.ok(
    validateStoredApkMetadata(
      { size: "1024", contentType: "application/vnd.android.package-archive" },
      expected
    ).value
  );
  assert.equal(
    validateStoredApkMetadata(
      { size: "1023", contentType: "application/vnd.android.package-archive" },
      expected
    ).error,
    "Uploaded APK size does not match the upload session"
  );
  assert.equal(
    validateStoredApkMetadata(
      { size: "1024", contentType: "text/plain" },
      expected
    ).error,
    "Uploaded APK MIME type does not match the upload session"
  );
});

test("streams a Firebase APK object to validate its signature, size, and SHA-256", async () => {
  const apkBytes = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("mock-apk-payload")
  ]);
  const inspection = await inspectApkReadable(
    Readable.from([apkBytes.subarray(0, 2), apkBytes.subarray(2)])
  );

  assert.equal(inspection.size, apkBytes.length);
  assert.equal(inspection.hasValidSignature, true);
  assert.equal(inspection.sha256, crypto.createHash("sha256").update(apkBytes).digest("hex"));
});
