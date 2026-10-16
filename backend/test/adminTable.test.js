import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { Device } from "../src/models/Device.js";
import { User } from "../src/models/User.js";
import { Tenant } from "../src/models/Tenant.js";
import { Account } from "../src/models/Account.js";
import { TenantPolicy } from "../src/models/TenantPolicy.js";
import { ADMIN_TABLES, findAdminTablePage, getAdminTableSort } from "../src/services/adminTable.service.js";

const valueAt = (row, path) => path.split(".").reduce((value, key) => value?.[key], row);
const matches = (row, filter) => Object.entries(filter).every(([key, expected]) => {
  if (key === "$and") return expected.every((entry) => matches(row, entry));
  if (key === "$or") return expected.some((entry) => matches(row, entry));
  const actual = valueAt(row, key);
  if (expected instanceof RegExp) return expected.test(String(actual || ""));
  if (expected && typeof expected === "object" && "$in" in expected) return expected.$in.some((entry) => String(entry) === String(actual));
  return String(actual) === String(expected);
});

function stubModel(t, model, rows) {
  t.mock.method(model, "find", (filter = {}) => {
    let skip = 0, limit = Infinity, sort = {}, select;
    const query = {
      select(value) { select = value; return this; }, populate() { return this; },
      sort(value) { sort = value; return this; }, skip(value) { skip = value; return this; }, limit(value) { limit = value; return this; },
      cast() { return filter; },
      async lean() {
        return rows.filter((row) => matches(row, filter)).sort((a, b) => {
          for (const [key, direction] of Object.entries(sort)) {
            const left = valueAt(a, key), right = valueAt(b, key);
            if (left < right) return -direction;
            if (left > right) return direction;
          }
          return 0;
        }).slice(skip, skip + limit).map((row) => {
          const result = { ...row };
          if (select === "-passwordHash") delete result.passwordHash;
          return result;
        });
      }
    };
    return query;
  });
  t.mock.method(model, "countDocuments", async (filter) => rows.filter((row) => matches(row, filter)).length);
}

function fixture(t) {
  const rows = Array.from({ length: 45 }, (_, index) => ({
    _id: String(index).padStart(3, "0"), imei: `8609750504${String(index).padStart(5, "0")}`,
    userId: index >= 22 && index <= 24 ? "older-borrower" : "other", tenantId: "dealer", state: index === 24 ? "LOCKED" : "ACTIVE", updatedAt: index
  }));
  stubModel(t, Device, rows);
  stubModel(t, User, [{ _id: "older-borrower", name: "Historical borrower", mobile: "9336616695" }]);
  stubModel(t, Tenant, [{ _id: "dealer", name: "Test dealer" }]);
  return rows;
}

test("pages reach every record without duplicates, and totals cover all matches", async (t) => {
  fixture(t);
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const result = await findAdminTablePage({ model: Device, filter: {}, query: {}, page, limit: 20, skip: (page - 1) * 20 });
    assert.equal(result.total, 45);
    assert.equal(result.pagination.pages, 3);
    assert.equal(result.items.length, page === 3 ? 5 : 20);
    ids.push(...result.items.map((item) => item._id));
  }
  assert.equal(new Set(ids).size, 45);
});

test("global borrower search finds older records and combines with existing filters", async (t) => {
  fixture(t);
  const options = { model: Device, query: { search: "9336616695" }, page: 1, limit: 20, skip: 0 };
  const all = await findAdminTablePage({ ...options, filter: {} });
  assert.equal(all.total, 3);
  const filtered = await findAdminTablePage({ ...options, filter: { state: "LOCKED" } });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0]._id, "024");
});

test("search treats regex syntax literally rather than matching unrelated records", async (t) => {
  fixture(t);
  const result = await findAdminTablePage({ model: Device, filter: {}, query: { search: ".*" }, page: 1, limit: 20, skip: 0 });
  assert.equal(result.total, 0);
});

test("sorting happens before selecting a later page and rejects arbitrary fields", async (t) => {
  fixture(t);
  const result = await findAdminTablePage({ model: Device, filter: {}, query: { sortBy: "updatedAt", sortOrder: "asc" }, page: 2, limit: 20, skip: 20 });
  assert.equal(result.items[0].updatedAt, 20);
  assert.equal(result.items.at(-1).updatedAt, 39);
  assert.deepEqual(getAdminTableSort(ADMIN_TABLES.Account, { sortBy: "passwordHash", sortOrder: "asc" }), ADMIN_TABLES.Account.defaultSort);
});

test("joined account sorting retains filters, paginates globally, and excludes password hashes", async (t) => {
  stubModel(t, Account, []);
  let pipeline;
  t.mock.method(Account, "aggregate", async (stages) => { pipeline = stages; return []; });
  t.mock.method(Account, "populate", async (items) => items);
  await findAdminTablePage({ model: Account, filter: { role: "tenant_admin" }, query: { sortBy: "tenantId.name", sortOrder: "asc" }, page: 2, limit: 20, skip: 20 });
  assert.deepEqual(pipeline[0], { $match: { role: "tenant_admin" } });
  assert.equal(pipeline[1].$lookup.from, Tenant.collection.name);
  assert.ok(pipeline.findIndex((stage) => stage.$sort) < pipeline.findIndex((stage) => "$skip" in stage));
  assert.equal(pipeline.find((stage) => stage.$project).$project.passwordHash, 0);
  assert.equal(pipeline.find((stage) => "$skip" in stage).$skip, 20);
});

test("computed dealer/provisioning sorts are available while missing policies default to automatic", async (t) => {
  fixture(t);
  let pipeline;
  t.mock.method(Device, "aggregate", async (stages) => { pipeline = stages; return []; });
  t.mock.method(Device, "populate", async (items) => items);
  await findAdminTablePage({ model: Device, filter: {}, query: { sortBy: "dealerModeLabel", sortOrder: "asc" }, page: 1, limit: 20, skip: 0 });
  assert.equal(pipeline[1].$lookup.from, TenantPolicy.collection.name);
  assert.equal(pipeline[1].$lookup.foreignField, "tenantId");
  assert.equal(pipeline.find((stage) => stage.$set).$set.__tableSort.$cond.at(-1), "Automatic");
  assert.equal(getAdminTableSort(ADMIN_TABLES.Device, { sortBy: "provisioningLabel", sortOrder: "asc" }).provisioningLabel, 1);
  assert.equal(mongoose.connection.readyState, 0, "Regression tests never connect to the real database");
});
