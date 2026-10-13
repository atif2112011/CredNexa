import crypto from "crypto";
import { ENROLLMENT_MODES } from "./enrollmentModes.js";

// The namespace is shared by creation, listing and admin QR validation. It is
// only a discovery convention: dealer creation must still charge normal keys.
export const TEST_BORROWER_PATTERN = /^TESTBORROWER-(QR|RUNNING)-\d{8}-[A-F0-9]{8}$/;
export const isTestBorrowerName = (name) => typeof name === "string" && TEST_BORROWER_PATTERN.test(name);
export const createTestBorrowerName = (mode, now = new Date()) =>
  `TESTBORROWER-${mode === ENROLLMENT_MODES.RUNNING_APP ? "RUNNING" : "QR"}-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
