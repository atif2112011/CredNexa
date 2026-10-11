import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import express from "express";
import mongoose from "mongoose";

import { env } from "../src/config/env.js";
import { ACCOUNT_ROLES } from "../src/constants/roles.js";
import { TENANT_CAPABILITIES } from "../src/constants/tenant.js";
import { authRoutes } from "../src/modules/auth/auth.routes.js";
import { distributorRoutes } from "../src/modules/distributor/distributor.routes.js";
import { Account } from "../src/models/Account.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { Device } from "../src/models/Device.js";
import { EmiSchedule } from "../src/models/EmiSchedule.js";
import { EnrollmentToken } from "../src/models/EnrollmentToken.js";
import { Tenant } from "../src/models/Tenant.js";
import { TenantCreditLedger } from "../src/models/TenantCreditLedger.js";
import { TenantPolicy } from "../src/models/TenantPolicy.js";
import { UnlockRequest } from "../src/models/UnlockRequest.js";
import { User } from "../src/models/User.js";

test("dealer HTTP login, running borrower registration, and Generate QR sequence", async () => {
  // Exercise the same HTTP requests used in Postman against isolated model fakes.
  // This test must never connect to the configured (potentially production) MongoDB.
  const replacements = [];
  const replace = (object, key, value) => {
    replacements.push([object, key, object[key]]);
    object[key] = value;
  };
  const tenantId = new mongoose.Types.ObjectId();
  const dealerId = new mongoose.Types.ObjectId();
  const borrowerId = new mongoose.Types.ObjectId();
  const scheduleId = new mongoose.Types.ObjectId();
  const enrollmentId = new mongoose.Types.ObjectId();
  const tenant = {
    _id: tenantId, isActive: true, name: "Test dealer", creditBalance: 2,
    capabilities: [TENANT_CAPABILITIES.DISTRIBUTE]
  };
  const account = {
    _id: dealerId, name: "Test dealer admin", email: "dealer@example.test",
    role: ACCOUNT_ROLES.TENANT_ADMIN, tenantId, isActive: true,
    passwordHash: bcrypt.hashSync("TestPassword123", 4),
    async save() {}
  };
  let borrower;
  let enrollment;
  let creditDebits = 0;
  let server;
  try {
    replace(console, "log", () => {});
    replace(env, "runningEnrollmentSecretKey", crypto.randomBytes(32).toString("hex"));
    replace(env, "runningEnrollmentLinkBase", "https://enroll.example.test/running-enrollment");
    replace(mongoose, "startSession", async () => ({
      startTransaction() {}, async commitTransaction() {}, async abortTransaction() {},
      inTransaction: () => false, endSession() {}
    }));
    replace(Account, "find", (filter) => {
      assert.equal(filter.email, "dealer@example.test");
      assert.equal(filter.role, ACCOUNT_ROLES.TENANT_ADMIN);
      return { limit: async () => [account] };
    });
    replace(Tenant, "findById", () => ({ lean: async () => tenant }));
    replace(Tenant, "findOneAndUpdate", async (_filter, update) => {
      assert.equal(update.$inc.creditBalance, -1);
      creditDebits += 1;
      return tenant;
    });
    replace(Tenant, "updateOne", async () => ({}));
    replace(TenantPolicy, "findOne", () => ({
      lean: async () => ({ runningEnrollmentEnabled: true }),
      select: () => ({ lean: async () => ({ runningEnrollmentEnabled: true }) })
    }));
    replace(User, "findOne", (filter) => ({
      lean: async () => filter.mobile ? null : borrower
    }));
    replace(User, "exists", async () => false);
    replace(User, "create", async ([data]) => {
      borrower = { ...data, _id: borrowerId, isActive: true, isDeviceLinked: false };
      return [borrower];
    });
    replace(User, "countDocuments", async () => borrower ? 1 : 0);
    replace(EmiSchedule, "create", async () => [{ _id: scheduleId, tenantId }]);
    replace(EnrollmentToken, "create", async ([data]) => {
      enrollment = { ...data, _id: enrollmentId, async save() {} };
      return [enrollment];
    });
    replace(EnrollmentToken, "findOne", (filter) => {
      assert.equal(filter.enrollmentMode, "RUNNING_APP");
      return { select: () => ({ sort: async () => enrollment }) };
    });
    replace(TenantCreditLedger, "create", async () => [{}]);
    replace(AuditLog, "create", async () => [{}]);
    replace(Device, "findOne", () => ({ lean: async () => null }));
    replace(Device, "countDocuments", async () => 0);
    replace(UnlockRequest, "countDocuments", async () => 0);

    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.use("/api/distributor", distributorRoutes);
    server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const post = async (path, body, accessToken) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };

    const login = await post("/api/auth/login", {
      email: "dealer@example.test", password: "TestPassword123", targetApp: "tenant_app"
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.tokenType, "account");
    assert.equal(login.body.data.account.role, ACCOUNT_ROLES.TENANT_ADMIN);
    const accessToken = login.body.data.accessToken;
    assert.ok(accessToken);

    const registration = await post("/api/distributor/users/register", {
      name: "Test running borrower", mobile: "9000000001",
      aadhaarLinkedMobile: "9000000001", loanAmount: 12000,
      emiAmount: 2000, tenureMonths: 6,
      disbursementDate: new Date().toISOString().slice(0, 10),
      enrollmentMode: "RUNNING_APP"
    }, accessToken);
    assert.equal(registration.status, 201, JSON.stringify(registration.body));
    assert.equal(registration.body.data.userId, borrowerId.toString());
    assert.equal(registration.body.data.enrollmentMode, "RUNNING_APP");
    assert.equal(registration.body.data.enrollmentToken, undefined);
    assert.equal(creditDebits, 1);

    const qrPath = `/api/distributor/users/${registration.body.data.userId}/enrollment/qr`;
    const qr = await post(qrPath, { enrollmentMode: "RUNNING_APP" }, accessToken);
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    assert.equal(qr.body.data.qrType, "RUNNING_APP_LINK");
    assert.equal(qr.body.data.reusedExistingToken, true);
    assert.match(qr.body.data.qrCodeDataUrl, /^data:image\/png;base64,/);
    assert.ok(new URL(qr.body.data.qrText).searchParams.get("code"));
    assert.equal(qr.body.data.enrollmentToken, undefined);
    assert.equal(creditDebits, 1);

    const repeatQr = await post(qrPath, { enrollmentMode: "RUNNING_APP" }, accessToken);
    assert.equal(repeatQr.status, 200);
    assert.equal(repeatQr.body.data.qrText, qr.body.data.qrText);
    assert.equal(creditDebits, 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const [object, key, original] of replacements.reverse()) object[key] = original;
  }
});
