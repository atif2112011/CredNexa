import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../src/config/env.js";
import { createTestBorrowerName, isTestBorrowerName } from "../src/constants/testBorrowers.js";
import { createBorrowerEnrollment } from "../src/services/borrowerEnrollment.service.js";
import { isTestOtpMobile, resolveOtpProvider } from "../src/services/otp.service.js";
import { devPagination, getTestMobileCandidates } from "../src/services/adminDevTools.service.js";
import { id, installDevToolsFixture, serveDevTools } from "./helpers/devToolsFixture.js";

const root = "/api/admin/dev-tools";
async function fixture(t) {
  const replace = (object, key, value) => t.mock.method(object, key, value);
  // env properties are values, not methods.
  const patch = (object, key, value) => {
    if (typeof value === "function") replace(object, key, value);
    else { const old = object[key]; object[key] = value; t.after(() => { object[key] = old; }); }
  };
  const state = installDevToolsFixture(patch);
  replace(console, "log", () => {}); replace(console, "error", () => {});
  const http = await serveDevTools(state);
  t.after(() => new Promise((resolve) => http.server.close(resolve)));
  return { state, ...http };
}
const create = (http, tenant, mode, extra = {}) => http.request(`${root}/test-borrowers`, { tenantId: tenant._id, enrollmentMode: mode, ...extra });

test("test naming and pagination are strict and test-number candidates stay inside the configured pool", () => {
  const name = createTestBorrowerName("RUNNING_APP", new Date("2026-10-13T23:59:00Z"));
  assert.match(name, /^TESTBORROWER-RUNNING-20261013-[A-F0-9]{8}$/);
  assert.equal(isTestBorrowerName(name), true);
  for (const value of ["Test borrower", "TESTBORROWER-QR-20261013-ABCD", name + "suffix", "x" + name]) assert.equal(isTestBorrowerName(value), false);
  assert.equal(getTestMobileCandidates("99999000").length, 100);
  assert.equal(getTestMobileCandidates("99999000").at(-1), "9999900099");
  assert.throws(() => getTestMobileCandidates(""), (error) => error.statusCode === 409);
  assert.deepEqual(devPagination({ page: "Infinity", limit: "-1" }), { page: 1, limit: 1, skip: 0 });
});

test("all Dev Tools endpoints require the super-admin role", async (t) => {
  const http = await fixture(t);
  for (const [path, body] of [["dealers?enrollmentMode=RUNNING_APP"], ["test-borrowers"], ["test-borrowers", {}], [`test-borrowers/${id()}/enrollment/qr`, {}]]) {
    assert.equal((await http.request(`${root}/${path}`, body, null)).status, 401);
    for (const role of ["tenant_admin", "partner_admin"]) assert.equal((await http.request(`${root}/${path}`, body, http.token(role))).status, 403);
  }
  assert.equal(http.state.db.users.length, 0);
});

test("both enrollment types under automatic/manual zero-key dealers create free schedules with mock OTP", async (t) => {
  const http = await fixture(t);
  http.state.db.accounts.push({ _id: id(), mobile: "9999900000" });
  http.state.db.users.push({ _id: id(), name: "Existing user", mobile: "+91 9999900001" });
  for (const dealerMode of ["EMI_AUTOMATED", "MANUAL"]) {
    const tenant = http.state.addDealer(dealerMode);
    for (const enrollmentMode of ["DEVICE_OWNER_QR", "RUNNING_APP"]) {
      const result = await create(http, tenant, enrollmentMode, { mobile: "9876543210", name: "client override", loanAmount: 1, freeTest: false });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const data = result.body.data;
      assert.equal(data.creditsCharged, 0); assert.equal(data.otp, "123456");
      assert.equal(data.borrower.loanAmount, 12000); assert.equal(data.borrower.emiAmount, 2000); assert.equal(data.borrower.tenureMonths, 6);
      assert.equal(data.borrower.deviceControlMode, dealerMode); assert.equal(isTestBorrowerName(data.borrower.name), true);
      assert.match(data.loanId, /^BRW-\d{4}-[A-F0-9]{8}$/);
      assert.equal(isTestOtpMobile(data.borrower.mobile), true); assert.equal(resolveOtpProvider({ mobile: data.borrower.mobile, configuredProvider: "msg91" }), "mock");
      assert.notEqual(data.borrower.mobile, "9999900000"); assert.notEqual(data.borrower.mobile, "9999900001");
      const schedule = http.state.db.schedules.find((entry) => entry.userId === data.userId);
      assert.equal(schedule.installments.length, 6); assert.ok(schedule.installments.every((entry) => entry.emiAmount === 2000 && entry.status === "pending"));
      assert.ok(new Date(schedule.installments[0].dueDate) > new Date(data.borrower.disbursementDate));
    }
  }
  assert.equal(http.state.db.ledger.length, 0);
  assert.ok(http.state.db.tenants.every((tenant) => tenant.creditBalance === 0));
  const audits = http.state.db.audits.filter((entry) => entry.eventType === "ADMIN_TEST_BORROWER_CREATED");
  assert.equal(audits.length, 4); assert.ok(audits.every((entry) => entry.actorId === http.actorId && entry.metadata.creditsCharged === 0));
  assert.equal(http.state.db.audits.filter((entry) => entry.eventType === "TENANT_CREDIT_CONSUMED").length, 0);
});

test("normal dealer registration cannot waive keys through test names or body flags, and legacy owner shape remains", async (t) => {
  const http = await fixture(t); const tenant = http.state.addDealer(); tenant.creditBalance = 2;
  for (const enrollmentMode of [undefined, "RUNNING_APP"]) {
    const result = await http.request("/api/distributor/users/register", {
      name: createTestBorrowerName(enrollmentMode), mobile: enrollmentMode ? "9000030102" : "9000030101",
      aadhaarLinkedMobile: "9000030101", loanAmount: 12000, emiAmount: 2000, tenureMonths: 6,
      disbursementDate: new Date().toISOString().slice(0, 10), enrollmentMode, freeTest: true, creditsCharged: 0
    }, http.token("tenant_admin", tenant._id));
    assert.equal(result.status, 201, JSON.stringify(result.body));
    if (!enrollmentMode) { assert.ok(result.body.data.enrollmentToken); assert.equal(result.body.data.enrollmentMode, undefined); }
  }
  assert.equal(http.state.db.tenants[0].creditBalance, 0); assert.equal(http.state.db.ledger.length, 2);
  assert.equal(http.state.db.audits.filter((entry) => entry.eventType === "TENANT_CREDIT_CONSUMED").length, 2);
  const denied = await http.request("/api/distributor/users/register", {
    name: createTestBorrowerName("RUNNING_APP"), mobile: "9999900043", aadhaarLinkedMobile: "9999900043",
    loanAmount: 12000, emiAmount: 2000, tenureMonths: 6, disbursementDate: new Date().toISOString().slice(0, 10),
    enrollmentMode: "RUNNING_APP", freeTest: true
  }, http.token("tenant_admin", tenant._id));
  assert.equal(denied.status, 402); assert.equal(http.state.db.users.length, 2); assert.equal(http.state.db.ledger.length, 2);
  await assert.rejects(createBorrowerEnrollment({ tenant, actor: { role: "tenant_admin" }, body: { name: createTestBorrowerName("RUNNING_APP"), mobile: "9999900042" }, freeTest: true }), (error) => error.statusCode === 403);
});

test("dealer lookup filters eligibility server-side, includes both dealer modes and paginates beyond 20", async (t) => {
  const http = await fixture(t);
  for (let index = 0; index < 25; index++) http.state.addDealer(index % 2 ? "MANUAL" : "EMI_AUTOMATED", index !== 0, `Dealer ${String(index).padStart(2, "0")}`);
  http.state.addDealer().isActive = false;
  http.state.addDealer().capabilities = ["lend"];
  const owner = await http.request(`${root}/dealers?enrollmentMode=DEVICE_OWNER_QR&page=2`);
  assert.equal(owner.body.data.pagination.total, 25); assert.equal(owner.body.data.items.length, 5);
  const running = await http.request(`${root}/dealers?enrollmentMode=RUNNING_APP&search=Dealer%200`);
  assert.equal(running.body.data.pagination.total, 9); assert.ok(running.body.data.items.some((item) => item.deviceControlMode === "MANUAL"));
  assert.ok(running.body.data.items.every((item) => item.creditBalance === 0 && item.name !== "Dealer 00"));
  assert.equal((await http.request(`${root}/dealers?enrollmentMode=invalid`)).status, 400);
  const disabled = await create(http, http.state.db.tenants[0], "RUNNING_APP"); assert.equal(disabled.status, 409);
  assert.equal(disabled.body.data.code, "RUNNING_ENROLLMENT_DISABLED");
});

test("test-borrower table applies strict namespace before global search/pagination and resolves actual device links", async (t) => {
  const http = await fixture(t); const tenant = http.state.addDealer("MANUAL", true, "Searchable dealer");
  for (let index = 0; index < 25; index++) http.state.db.users.push({ _id: id(), tenantId: tenant._id,
    name: `TESTBORROWER-${index % 2 ? "RUNNING" : "QR"}-20261013-${index.toString(16).toUpperCase().padStart(8, "0")}`,
    loanId: index === 0 ? "BRW-[literal]" : `BRW-${index}`, mobile: `99999000${String(index).padStart(2, "0")}`,
    enrollmentMode: index % 2 ? "RUNNING_APP" : "DEVICE_OWNER_QR", isActive: true, isDeviceLinked: index === 1,
    createdAt: new Date(Date.now() - index * 1000) });
  http.state.db.users.push({ _id: id(), name: "TESTBORROWER-not-generated", mobile: "0000000000", loanId: "real", tenantId: tenant._id });
  const deviceId = id(); http.state.db.devices.push({ _id: deviceId, userId: http.state.db.users[0]._id, tenantId: tenant._id });
  const first = (await http.request(`${root}/test-borrowers`)).body.data;
  assert.equal(first.pagination.total, 25); assert.equal(first.items.length, 20);
  assert.equal(first.items[0].enrollmentStatus, "PROVISIONED"); assert.equal(first.items[0].linkedDeviceId, deviceId); assert.equal(first.items[0].canShowQr, false);
  assert.equal(first.items[1].enrollmentStatus, "LINKED_DEVICE_UNAVAILABLE"); assert.equal(first.items[1].linkedDeviceId, null); assert.equal(first.items[1].canShowQr, false);
  assert.equal(first.items[2].canShowQr, true); assert.ok(first.items.every((item) => item.deviceControlMode === "MANUAL"));
  assert.equal((await http.request(`${root}/test-borrowers?page=2`)).body.data.items.length, 5);
  assert.equal((await http.request(`${root}/test-borrowers?search=9999900024`)).body.data.items.length, 1);
  assert.equal((await http.request(`${root}/test-borrowers?search=${encodeURIComponent("[literal]")}`)).body.data.items.length, 1);
  assert.equal((await http.request(`${root}/test-borrowers?search=Searchable%20dealer&limit=50`)).body.data.items.length, 25);
  assert.equal((await http.request(`${root}/test-borrowers?search=not-generated`)).body.data.pagination.total, 0);
});

test("admin QR reuse/expiry uses each saved format, does not charge credits, and rebinds running consent", async (t) => {
  const http = await fixture(t); const tenant = http.state.addDealer();
  for (const mode of ["DEVICE_OWNER_QR", "RUNNING_APP"]) {
    const created = (await create(http, tenant, mode)).body.data;
    const path = `${root}/test-borrowers/${created.userId}/enrollment/qr`;
    const first = await http.request(path, { enrollmentMode: mode === "RUNNING_APP" ? "DEVICE_OWNER_QR" : "RUNNING_APP", rotate: true });
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.data.enrollmentMode, mode);
    assert.match(first.body.data.qrCodeDataUrl, /^data:image\/png;base64,/);
    if (mode === "RUNNING_APP") assert.equal(new URL(first.body.data.qrText).pathname, "/running-enrollment");
    else assert.equal(first.body.data.qrPayload["android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE"].enrollmentToken, created.enrollmentToken);
    const second = await http.request(path, {}); assert.equal(first.body.data.qrCodeDataUrl, second.body.data.qrCodeDataUrl);
    const old = http.state.db.tokens.find((token) => token.userId === created.userId); old.expiresAt = new Date(Date.now() - 1000);
    const user = http.state.db.users.find((entry) => entry._id === created.userId); user.consentRecordId = id();
    const renewed = await http.request(path, {}); assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
    assert.equal(renewed.body.data.reusedExistingToken, false); assert.ok(http.state.db.tokens.find((token) => token._id === old._id).cancelledAt);
    if (mode === "RUNNING_APP") assert.equal(http.state.db.users.find((entry) => entry._id === created.userId).consentRecordId, null);
    user.isDeviceLinked = true; assert.equal((await http.request(path, {})).status, 400);
  }
  assert.equal(http.state.db.ledger.length, 0); assert.equal(http.state.db.tenants[0].creditBalance, 0);
  const regular = { _id: id(), name: "Regular borrower", tenantId: tenant._id, isActive: true }; http.state.db.users.push(regular);
  assert.equal((await http.request(`${root}/test-borrowers/${regular._id}/enrollment/qr`, {})).status, 404);
});

test("configuration failures, full range and disabled dealers do not create partial records", async (t) => {
  const http = await fixture(t); const tenant = http.state.addDealer();
  http.state.db.provisioning = [];
  assert.equal((await create(http, tenant, "DEVICE_OWNER_QR")).body.data.code, "OWNER_PROVISIONING_NOT_CONFIGURED");
  env.runningEnrollmentSecretKey = "";
  assert.equal((await create(http, tenant, "RUNNING_APP")).body.data.code, "RUNNING_ENROLLMENT_NOT_CONFIGURED");
  env.runningEnrollmentSecretKey = "a".repeat(64);
  env.testOtpMobilePrefix = "";
  assert.equal((await create(http, tenant, "RUNNING_APP")).body.data.code, "TEST_MOBILE_RANGE_NOT_CONFIGURED");
  env.testOtpMobilePrefix = "99999000";
  http.state.db.accounts = getTestMobileCandidates().map((mobile) => ({ _id: id(), mobile }));
  assert.equal((await create(http, tenant, "RUNNING_APP")).body.data.code, "TEST_MOBILE_RANGE_EXHAUSTED");
  assert.equal(http.state.db.users.length, 0); assert.equal(http.state.db.schedules.length, 0); assert.equal(http.state.db.tokens.length, 0);
});

test("unique-mobile collisions retry a rolled-back transaction and schedule failures roll back every record", async (t) => {
  const http = await fixture(t); const tenant = http.state.addDealer(); http.state.collisions = 1;
  const result = await create(http, tenant, "RUNNING_APP"); assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.borrower.mobile, "9999900001"); assert.equal(http.state.aborted, 1); assert.equal(http.state.committed, 1);
  assert.equal(http.state.db.users.length, 1);
  http.state.failSchedule = true;
  const before = structuredClone(http.state.db);
  assert.equal((await create(http, tenant, "RUNNING_APP")).status, 500);
  assert.deepEqual(http.state.db, before); assert.equal(http.state.db.ledger.length, 0);
});

test("QR requests revalidate changed dealers, inactive borrowers, and devices even with a stale link flag", async (t) => {
  const http = await fixture(t); const tenant = http.state.addDealer();
  const created = (await create(http, tenant, "RUNNING_APP")).body.data;
  const user = http.state.db.users.find((entry) => entry._id === created.userId);
  const path = `${root}/test-borrowers/${user._id}/enrollment/qr`;
  http.state.db.policies[0].runningEnrollmentEnabled = false;
  assert.equal((await http.request(path, {})).body.data.code, "RUNNING_ENROLLMENT_DISABLED");
  http.state.db.policies[0].runningEnrollmentEnabled = true;
  tenant.isActive = false; assert.equal((await http.request(path, {})).body.data.code, "DEALER_NOT_ELIGIBLE");
  tenant.isActive = true; user.isActive = false; assert.equal((await http.request(path, {})).status, 404);
  user.isActive = true;
  http.state.db.devices.push({ _id: id(), userId: user._id, tenantId: tenant._id });
  assert.equal(user.isDeviceLinked, false); assert.equal((await http.request(path, {})).status, 400);
  assert.equal(http.state.db.ledger.length, 0);
});
